import { jsPDF } from "jspdf";
import { CheckResult, ClaimResult, VERDICT_STYLE, checkImageUrl } from "./api";

type RGB = [number, number, number];

const C = {
  navy: [20, 33, 61] as RGB,
  ink: [31, 41, 55] as RGB,
  muted: [91, 100, 117] as RGB,
  dim: [138, 146, 163] as RGB,
  line: [220, 226, 234] as RGB,
  soft: [246, 248, 251] as RGB,
  white: [255, 255, 255] as RGB,
  sup: [30, 122, 79] as RGB,
  supSoft: [233, 246, 239] as RGB,
  ref: [155, 28, 44] as RGB,
  refSoft: [251, 238, 240] as RGB,
  amber: [183, 121, 31] as RGB,
  amberSoft: [251, 244, 230] as RGB,
  blue: [29, 78, 137] as RGB,
  blueSoft: [234, 241, 250] as RGB,
};

/** Normalize Unicode punctuation/glyphs to crisp Latin-1 so built-in PDF Helvetica never renders garbled chars. */
function clean(text: unknown, preserveNewlines = false): string {
  if (text === null || text === undefined) return "";
  const base = String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/\u2026/g, "...")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u00D7/g, "x")
    .replace(/\u2212/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u00B7/g, " | ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
  if (preserveNewlines) {
    return base
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }
  return base.replace(/\s+/g, " ").trim();
}

function toneColors(label: string): { fg: RGB; bg: RGB } {
  const tone = VERDICT_STYLE[label]?.tone ?? "dim";
  if (tone === "sup") return { fg: C.sup, bg: C.supSoft };
  if (tone === "ref") return { fg: C.ref, bg: C.refSoft };
  if (tone === "amber") return { fg: C.amber, bg: C.amberSoft };
  return { fg: C.muted, bg: C.soft };
}

async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; format: "JPEG" | "PNG"; w: number; h: number } | null> {
  try {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims = await measureDataUrl(dataUrl);
    const format: "JPEG" | "PNG" = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    return { dataUrl, format, w: dims.w, h: dims.h };
  } catch {
    return null;
  }
}

async function measureDataUrl(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 500 });
    img.onerror = () => resolve({ w: 800, h: 500 });
    img.src = dataUrl;
  });
}

class ReportBuilder {
  doc: jsPDF;
  pageW = 210; // A4 mm
  pageH = 297;
  margin = 16;
  contentW = 210 - 32;
  y = 0;
  reportId: string;

  constructor(reportId: string) {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    this.reportId = reportId;
    this.y = this.margin;
  }

  ensureSpace(neededMm: number) {
    const bottomLimit = this.pageH - 18;
    if (this.y + neededMm > bottomLimit) {
      this.doc.addPage();
      this.y = 22;
    }
  }

  sectionTitle(num: string, title: string, subtitle?: string) {
    this.ensureSpace(16);
    this.y += 3;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8);
    this.doc.setTextColor(...C.ref);
    this.doc.text(`SECTION ${num}`, this.margin, this.y);
    this.y += 5;

    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(14);
    this.doc.setTextColor(...C.navy);
    this.doc.text(clean(title), this.margin, this.y);
    this.y += 2.2;

    // Accent + hairline rule
    this.doc.setDrawColor(...C.line);
    this.doc.setLineWidth(0.35);
    this.doc.line(this.margin, this.y, this.margin + this.contentW, this.y);
    this.doc.setDrawColor(...C.ref);
    this.doc.setLineWidth(0.8);
    this.doc.line(this.margin, this.y, this.margin + 22, this.y);
    this.y += 5;

    if (subtitle) {
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(9);
      this.doc.setTextColor(...C.muted);
      const lines = this.doc.splitTextToSize(clean(subtitle), this.contentW);
      this.doc.text(lines, this.margin, this.y);
      this.y += lines.length * 4.2 + 2;
    }
  }

  drawPill(x: number, y: number, label: string, fontSize = 9.5): number {
    const txt = clean(label).toUpperCase();
    const { fg, bg } = toneColors(label);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(fontSize);
    const tw = this.doc.getTextWidth(txt);
    const pw = Math.min(this.contentW, tw + 8);
    const ph = fontSize * 0.55 + 3.6;
    this.doc.setFillColor(...bg);
    this.doc.setDrawColor(...fg);
    this.doc.setLineWidth(0.45);
    this.doc.roundedRect(x, y, pw, ph, 1.8, 1.8, "FD");
    this.doc.setTextColor(...fg);
    this.doc.text(txt, x + 4, y + ph - 2.3);
    return pw;
  }

  paragraph(text: string, opts?: { size?: number; color?: RGB; bold?: boolean; indent?: number; spaceAfter?: number }) {
    const size = opts?.size ?? 9.5;
    const indent = opts?.indent ?? 0;
    const color = opts?.color ?? C.ink;
    const lineH = size * 0.44 + 0.8;
    this.doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
    const lines: string[] = this.doc.splitTextToSize(clean(text), this.contentW - indent);
    for (const line of lines) {
      this.ensureSpace(lineH + 1);
      this.doc.text(line, this.margin + indent, this.y);
      this.y += lineH;
    }
    this.y += opts?.spaceAfter ?? 2.5;
  }

  calloutBox(title: string, body: string, accent: RGB = C.blue, bg: RGB = C.blueSoft) {
    const padX = 5;
    const padY = 4;
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9.2);
    const lines: string[] = this.doc.splitTextToSize(clean(body, true), this.contentW - padX * 2 - 2);
    const boxH = padY * 2 + 4.5 + lines.length * 4.3;
    this.ensureSpace(boxH + 3);

    this.doc.setFillColor(...bg);
    this.doc.setDrawColor(...C.line);
    this.doc.setLineWidth(0.25);
    this.doc.roundedRect(this.margin, this.y, this.contentW, boxH, 2, 2, "FD");
    this.doc.setFillColor(...accent);
    this.doc.rect(this.margin, this.y, 1.6, boxH, "F");

    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8);
    this.doc.setTextColor(...accent);
    this.doc.text(clean(title).toUpperCase(), this.margin + padX + 1, this.y + padY + 2.5);

    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9.2);
    this.doc.setTextColor(...C.ink);
    this.doc.text(lines, this.margin + padX + 1, this.y + padY + 7.2);
    this.y += boxH + 4;
  }

  keyValueTable(title: string, rows: [string, string][], x: number, yStart: number, w: number): number {
    let y = yStart;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...C.navy);
    this.doc.text(clean(title).toUpperCase(), x, y);
    y += 3;

    const labelW = w * 0.42;
    const valW = w - labelW - 4;

    rows.forEach(([k, v], idx) => {
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8.2);
      const vLines: string[] = this.doc.splitTextToSize(clean(v) || "-", valW);
      const rowH = Math.max(5.8, vLines.length * 3.7 + 2.2);

      this.doc.setFillColor(...(idx % 2 === 0 ? C.soft : C.white));
      this.doc.setDrawColor(...C.line);
      this.doc.setLineWidth(0.2);
      this.doc.rect(x, y, w, rowH, "FD");

      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...C.muted);
      this.doc.text(clean(k), x + 2.2, y + 4);

      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...C.ink);
      this.doc.text(vLines, x + labelW + 1.5, y + 4);
      y += rowH;
    });
    return y;
  }

  addRunningChrome() {
    const total = this.doc.getNumberOfPages();
    const generated = new Date().toLocaleString();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      if (i > 1) {
        this.doc.setDrawColor(...C.line);
        this.doc.setLineWidth(0.25);
        this.doc.line(this.margin, 13, this.margin + this.contentW, 13);
        this.doc.setFont("helvetica", "bold");
        this.doc.setFontSize(7.5);
        this.doc.setTextColor(...C.navy);
        this.doc.text("VERIFACT VERIFICATION REPORT", this.margin, 10.5);
        this.doc.setFont("helvetica", "normal");
        this.doc.setTextColor(...C.dim);
        this.doc.text(`Report ID: ${clean(this.reportId)}`, this.margin + this.contentW, 10.5, { align: "right" });
      }

      // Footer
      const fy = this.pageH - 11;
      this.doc.setDrawColor(...C.line);
      this.doc.setLineWidth(0.25);
      this.doc.line(this.margin, fy - 3.5, this.margin + this.contentW, fy - 3.5);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(...C.dim);
      this.doc.text(`VeriFact Evidence Dossier | Generated ${clean(generated)} | Indicators, not certainty`, this.margin, fy);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...C.muted);
      this.doc.text(`Page ${i} of ${total}`, this.margin + this.contentW, fy, { align: "right" });
    }
  }
}

export async function downloadPdfReport(result: CheckResult): Promise<void> {
  const rb = new ReportBuilder(result.id);
  const { doc, margin, contentW } = rb;
  const verdict = result.overall_verdict ?? "Unverifiable";

  // ============================================================
  // 1. COVER / EXECUTIVE BANNER
  // ============================================================
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, rb.pageW, 34, "F");
  doc.setFillColor(...C.ref);
  doc.rect(0, 34, rb.pageW, 1.8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...C.white);
  doc.text("VeriFact", margin, 15.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(200, 210, 224);
  doc.text("MULTIMODAL FAKE INFORMATION & FORENSICS VERIFICATION DOSSIER", margin, 22);
  doc.text(`Input Mode: ${clean(result.input.kind).toUpperCase()}   |   Report ID: ${clean(result.id)}`, margin, 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(200, 210, 224);
  doc.text(`Generated: ${clean(new Date().toLocaleString())}`, margin + contentW, 15.5, { align: "right" });
  if (result.input.domain) {
    doc.text(`Source Domain: ${clean(result.input.domain)}`, margin + contentW, 22, { align: "right" });
  }

  rb.y = 43;

  // Overall Assessment Box
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text("OVERALL VERIFICATION VERDICT", margin, rb.y);
  rb.y += 3;
  rb.drawPill(margin, rb.y, verdict, 12.5);
  rb.y += 14;

  // Submitted Input Card
  const inputSummaryParts: string[] = [];
  if (result.input.image_name) inputSummaryParts.push(`Attached Image: ${result.input.image_name} (${result.input.image_mime ?? "image"})`);
  if (result.input.url) inputSummaryParts.push(`Submitted URL: ${result.input.url}`);
  if (result.input.text) inputSummaryParts.push(`Submitted Claim / Text: "${result.input.text.slice(0, 600)}${result.input.text.length > 600 ? "..." : ""}"`);
  if (inputSummaryParts.length > 0) {
    rb.calloutBox("Submitted Material", inputSummaryParts.join("\n"), C.navy, C.soft);
  }

  // 3-Pillar Multimodal Summary Card
  const ms = result.multimodal_summary;
  if (ms) {
    const colGap = 4;
    const colW = (contentW - colGap * 2) / 3;
    const cardH = 22;
    rb.ensureSpace(cardH + 24);

    const pillars: [string, string][] = [
      ["1. IS THE IMAGE REAL?", ms.image_verdict],
      ["2. DOES IMAGE MATCH CLAIM?", ms.image_claim_match],
      ["3. IS THE CLAIM REAL?", ms.claim_verdict],
    ];
    pillars.forEach(([heading, val], i) => {
      const px = margin + i * (colW + colGap);
      doc.setFillColor(...C.soft);
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.roundedRect(px, rb.y, colW, cardH, 2, 2, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(...C.muted);
      doc.text(heading, px + 3.5, rb.y + 6);
      rb.drawPill(px + 3.5, rb.y + 9.5, val, 8.2);
    });
    rb.y += cardH + 4;
    rb.calloutBox("Executive Multimodal Summary", ms.summary, C.sup, C.supSoft);
  }

  let secNum = 1;

  // ============================================================
  // 2. IMAGE FORENSICS & VISUAL ANALYSIS SECTION
  // ============================================================
  const ia = result.image_analysis;
  if (ia) {
    rb.sectionTitle(
      String(secNum++).padStart(2, "0"),
      "Image Forensics, Visual Inspection & Provenance",
      `Engine: ${ia.forensics_source} | Assessment: ${ia.image_verdict}${ia.image_confidence != null ? ` (uncalibrated signal strength ${Math.round(ia.image_confidence * 100)}%)` : ""}`
    );

    // Visual strip: Original + ELA + Noise side-by-side
    const originalUrl = result.input.image_url || (result.input.has_image ? checkImageUrl(result.id) : null);
    const origImg = originalUrl ? await fetchImageAsDataUrl(originalUrl) : null;
    const panels: { title: string; caption: string; dataUrl: string; format: "JPEG" | "PNG"; w: number; h: number }[] = [];

    if (origImg) {
      panels.push({ title: "Original Uploaded Image", caption: clean(result.input.image_name ?? "Uploaded image"), ...origImg });
    }
    if (ia.ela_heatmap_png_base64) {
      const d = `data:image/png;base64,${ia.ela_heatmap_png_base64}`;
      const dims = await measureDataUrl(d);
      panels.push({ title: "ELA Heatmap (JPEG Q=90)", caption: `Block CV ${ia.ela_stats.block_error_cv ?? "-"} | p99 ${ia.ela_stats.p99_error ?? "-"}`, dataUrl: d, format: "PNG", ...dims });
    }
    if (ia.noise_heatmap_png_base64) {
      const d = `data:image/png;base64,${ia.noise_heatmap_png_base64}`;
      const dims = await measureDataUrl(d);
      panels.push({ title: "Median Noise Residual", caption: `Noise CV ${ia.noise_stats.block_noise_cv ?? "-"} | std ${ia.noise_stats.residual_std ?? "-"}`, dataUrl: d, format: "PNG", ...dims });
    }

    if (panels.length > 0) {
      const gap = 4;
      const pw = (contentW - gap * (panels.length - 1)) / panels.length;
      const maxImgH = 38;
      const boxH = maxImgH + 14;
      rb.ensureSpace(boxH + 4);

      panels.forEach((p, idx) => {
        const px = margin + idx * (pw + gap);
        doc.setFillColor(...C.soft);
        doc.setDrawColor(...C.line);
        doc.setLineWidth(0.3);
        doc.roundedRect(px, rb.y, pw, boxH, 1.8, 1.8, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...C.navy);
        doc.text(p.title, px + 2.5, rb.y + 4.8);

        // Fit image inside (pw - 4) x maxImgH preserving aspect ratio
        const availW = pw - 4;
        const scale = Math.min(availW / p.w, maxImgH / p.h);
        const drawW = p.w * scale;
        const drawH = p.h * scale;
        const ix = px + 2 + (availW - drawW) / 2;
        const iy = rb.y + 6.5 + (maxImgH - drawH) / 2;
        doc.setFillColor(12, 15, 14);
        doc.rect(px + 2, rb.y + 6.5, availW, maxImgH, "F");
        try {
          doc.addImage(p.dataUrl, p.format, ix, iy, drawW, drawH);
        } catch {
          // skip corrupt image gracefully
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.2);
        doc.setTextColor(...C.muted);
        doc.text(p.caption.slice(0, 44), px + 2.5, rb.y + boxH - 2.3);
      });
      rb.y += boxH + 5;
    }

    // Visual Analysis & OCR
    if (ia.visual) {
      rb.calloutBox(
        `Visual Inspection & Image-Claim Alignment (${ia.visual.claim_alignment.replace(/_/g, " ")})`,
        `Scene Observed: ${ia.visual.scene_description}\nAuthenticity Rationale: ${ia.visual.authenticity_rationale}\nClaim Alignment: ${ia.visual.alignment_explanation}`,
        C.blue,
        C.blueSoft
      );

      if (ia.visual.visible_text) {
        rb.calloutBox("Visible Text Extracted From Image (OCR)", ia.visual.visible_text, C.amber, C.amberSoft);
      }

      if (ia.visual.visual_anomalies.length > 0) {
        rb.ensureSpace(24);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...C.ref);
        doc.text("VISUAL ANOMALIES OBSERVED", margin, rb.y);
        rb.y += 4.5;
        for (const a of ia.visual.visual_anomalies) {
          rb.paragraph(`- ${a}`, { size: 8.8, indent: 2, spaceAfter: 1.2 });
        }
        rb.y += 2;
      }
    }

    // Two-column Metadata + Pixel Forensics Tables
    const meta = ia.metadata ?? {};
    const aiMeta = Array.isArray(meta.ai_metadata_signals) ? (meta.ai_metadata_signals as string[]).join(", ") : "";
    const edMeta = Array.isArray(meta.editing_software_signals) ? (meta.editing_software_signals as string[]).join(", ") : "";
    const c2paMeta = Array.isArray(meta.c2pa_signals) ? (meta.c2pa_signals as string[]).join(", ") : "";
    const camStr = [meta.camera_make, meta.camera_model].filter(Boolean).join(" ") || (meta.has_exif ? "Present (unspecified)" : "Absent / Stripped");

    const metaRows: [string, string][] = [
      ["Format & Size", `${meta.format ?? "-"} | ${meta.width ?? "?"}x${meta.height ?? "?"} | ${meta.file_size_bytes ? `${(Number(meta.file_size_bytes) / 1024).toFixed(1)} KB` : "-"}`],
      ["EXIF Camera", camStr],
      ["Capture Date", String(meta.datetime_original ?? "None")],
      ["Software Tag", String(meta.software ?? "None")],
      ["AI Metadata", aiMeta || "None detected"],
      ["Editor Traces", edMeta || "None detected"],
      ["C2PA Markers", c2paMeta || "No manifest found"],
      ["SHA-256 / dHash", `${String(meta.sha256 ?? "").slice(0, 16)}... | ${String(meta.dhash ?? "-")}`],
    ];

    const pixelRows: [string, string][] = [
      ["Forensic Risk", ia.forensic_risk],
      ["ELA Block CV", String(ia.ela_stats.block_error_cv ?? "-")],
      ["ELA p99 / Max", `${ia.ela_stats.p99_error ?? "-"} / ${ia.ela_stats.max_error ?? "-"}`],
      ["ELA Mean Error", String(ia.ela_stats.mean_error ?? "-")],
      ["Noise Block CV", String(ia.noise_stats.block_noise_cv ?? "-")],
      ["Noise Std Dev", String(ia.noise_stats.residual_std ?? "-")],
      ["FFT High-Freq", String(ia.spectral_stats.high_freq_ratio ?? "-")],
      ["RGB Noise Corr", String(ia.spectral_stats.rgb_noise_corr ?? "-")],
    ];

    rb.ensureSpace(64);
    const halfW = (contentW - 5) / 2;
    const yStart = rb.y;
    const yLeft = rb.keyValueTable("EXIF, Metadata & C2PA Provenance", metaRows, margin, yStart, halfW);
    const yRight = rb.keyValueTable("Pixel & Frequency Indicators", pixelRows, margin + halfW + 5, yStart, halfW);
    rb.y = Math.max(yLeft, yRight) + 5;

    if (ia.forensic_flags.length > 0) {
      rb.ensureSpace(12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.2);
      doc.setTextColor(...C.amber);
      doc.text("FORENSIC FLAGS & NOTES", margin, rb.y);
      rb.y += 4.2;
      for (const fl of ia.forensic_flags) {
        rb.paragraph(`- ${fl}`, { size: 8.5, color: C.muted, indent: 2, spaceAfter: 1 });
      }
      rb.y += 2;
    }

    // Provenance web matches
    if (ia.provenance_summary || ia.provenance_matches.length > 0) {
      rb.ensureSpace(18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...C.navy);
      doc.text(`IMAGE PROVENANCE & WEB LEADS (STATUS: ${clean(ia.provenance_finding).toUpperCase()})`, margin, rb.y);
      rb.y += 4.5;
      if (ia.provenance_summary) {
        rb.paragraph(ia.provenance_summary, { size: 9, spaceAfter: 2.5 });
      }
      for (const m of ia.provenance_matches.slice(0, 5)) {
        rb.ensureSpace(14);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...C.blue);
        doc.textWithLink(clean(m.title).slice(0, 95), margin + 2, rb.y, { url: m.url });
        rb.y += 3.8;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.6);
        doc.setTextColor(...C.dim);
        doc.text(`${clean(m.domain)} | ${clean(m.source_type)} | credibility prior ${Math.round(m.credibility_score * 100)}/100`, margin + 2, rb.y);
        rb.y += 3.8;
        if (m.snippet) {
          rb.paragraph(m.snippet, { size: 8.2, color: C.muted, indent: 2, spaceAfter: 2 });
        }
      }
    }
  }

  // ============================================================
  // 3. CLAIM-BY-CLAIM EVIDENCE AUDIT
  // ============================================================
  if (result.claims.length > 0) {
    rb.sectionTitle(
      String(secNum++).padStart(2, "0"),
      "Claim Verification & Evidence Audit",
      `${result.claims.length} claim(s) extracted and evaluated using retrieval-first evidence grounding.`
    );

    result.claims.forEach((c: ClaimResult, idx: number) => {
      rb.ensureSpace(34);
      // Claim Header Card
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      const claimLines: string[] = doc.splitTextToSize(`"${clean(c.claim.text)}"`, contentW - 8);
      const headerH = 19 + claimLines.length * 4.8;
      rb.ensureSpace(headerH + 4);

      doc.setFillColor(...C.soft);
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.35);
      doc.roundedRect(margin, rb.y, contentW, headerH, 2, 2, "FD");
      doc.setFillColor(...C.navy);
      doc.rect(margin, rb.y, 1.8, headerH, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.6);
      doc.setTextColor(...C.muted);
      const sensNote = c.claim.topic_sensitivity !== "none" ? ` | SENSITIVE: ${c.claim.topic_sensitivity.toUpperCase()} (>=3 DOMAINS REQUIRED)` : "";
      doc.text(`CLAIM ${idx + 1} | ${clean(c.claim.kind).toUpperCase()}${sensNote}`, margin + 5, rb.y + 5.2);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...C.navy);
      doc.text(claimLines, margin + 5, rb.y + 10.5);

      const pillY = rb.y + 10.5 + claimLines.length * 4.8 - 1.5;
      const pw = rb.drawPill(margin + 5, pillY, c.verdict, 8.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.2);
      doc.setTextColor(...C.muted);
      const strengthTxt =
        c.confidence !== null
          ? `Evidence strength: ${Math.round(c.confidence * 100)}/100 (uncalibrated) | Supports ${c.weights.supports ?? 0} vs Refutes ${c.weights.refutes ?? 0}`
          : `No single confidence applies | Supports ${c.weights.supports ?? 0} vs Refutes ${c.weights.refutes ?? 0}`;
      doc.text(strengthTxt, margin + 8 + pw, pillY + 5.3);
      rb.y += headerH + 3.5;

      rb.paragraph(c.confidence_explanation, { size: 8.8, color: C.muted, spaceAfter: 3 });

      // Existing Fact-Checks
      if (c.fact_checks.length > 0) {
        rb.ensureSpace(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...C.navy);
        doc.text("EXISTING FACT-CHECKS", margin, rb.y);
        rb.y += 4;
        for (const fc of c.fact_checks.slice(0, 4)) {
          rb.ensureSpace(6);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.3);
          doc.setTextColor(...C.blue);
          doc.textWithLink(`${clean(fc.publisher)}: "${clean(fc.rating)}" (${clean(fc.review_date ?? "undated")})`, margin + 2, rb.y, { url: fc.url });
          rb.y += 4.3;
        }
        rb.y += 1.5;
      }

      // Counted Supporting & Refuting Evidence
      const counted = c.evidence.filter((e) => e.counted && e.stance !== "neutral");
      for (const side of ["supports", "refutes"] as const) {
        const list = counted.filter((e) => e.stance === side);
        if (list.length === 0) continue;
        const accent = side === "supports" ? C.sup : C.ref;
        const heading = side === "supports" ? `+ SUPPORTING EVIDENCE (${list.length})` : `- REFUTING EVIDENCE (${list.length})`;
        rb.ensureSpace(26);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.2);
        doc.setTextColor(...accent);
        doc.text(heading, margin, rb.y);
        rb.y += 4.2;

        for (const ev of list) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8.6);
          const qLines: string[] = doc.splitTextToSize(`"${clean(ev.quote || ev.excerpt.slice(0, 260))}"`, contentW - 8);
          const blockH = qLines.length * 4 + 6.5;
          rb.ensureSpace(blockH + 2);

          doc.setFillColor(...accent);
          doc.rect(margin + 1.5, rb.y - 2.6, 1.1, blockH - 1.5, "F");

          doc.setFont("helvetica", "italic");
          doc.setFontSize(8.6);
          doc.setTextColor(...C.ink);
          doc.text(qLines, margin + 5, rb.y);
          rb.y += qLines.length * 4 + 0.5;

          const nliTxt = ev.nli_label ? ` | NLI: ${ev.nli_label} (${Math.round((ev.nli_score ?? 0) * 100)}%)` : "";
          const metaLine = `${clean(ev.domain)} (${clean(ev.credibility.domain_class)}, cred ${Math.round(ev.credibility.score * 100)}) | ${clean(ev.published_at ?? "undated")}${nliTxt}`;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.6);
          doc.setTextColor(...C.blue);
          doc.textWithLink(metaLine, margin + 5, rb.y, { url: ev.url });
          rb.y += 5;
        }
      }

      // Discarded / Uncounted Sources
      const discarded = c.evidence.filter((e) => !e.counted || e.stance === "neutral");
      if (discarded.length > 0) {
        rb.ensureSpace(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...C.muted);
        doc.text(`SOURCES CONSIDERED BUT NOT COUNTED (${discarded.length})`, margin, rb.y);
        rb.y += 4;
        for (const d of discarded.slice(0, 6)) {
          rb.paragraph(
            `- ${d.domain} (${d.stance}, ${d.rerank_method} ${d.rerank_score}): ${d.discard_reason ?? "Neutral toward the claim"}`,
            { size: 8, color: C.muted, indent: 2, spaceAfter: 1.1 }
          );
        }
        rb.y += 1.5;
      }

      // Queries + Unknowns + How to Verify
      if (c.queries.length > 0) {
        rb.paragraph(`Search Queries Executed: ${c.queries.join("  |  ")}`, { size: 7.8, color: C.dim, spaceAfter: 2 });
      }
      if (c.unknowns.length > 0) {
        rb.paragraph(`What Could Not Be Verified: ${c.unknowns.join(" ")}`, { size: 8.2, color: C.muted, spaceAfter: 2 });
      }
      if (c.how_to_verify.length > 0) {
        rb.paragraph(`How to Verify Yourself: ${c.how_to_verify.join(" | ")}`, { size: 8.2, color: C.muted, spaceAfter: 4 });
      }
    });
  }

  // ============================================================
  // 4. LIMITATIONS & AUDIT METADATA
  // ============================================================
  rb.sectionTitle(
    String(secNum++).padStart(2, "0"),
    "Known Limitations & Audit Metadata",
    "Honest disclosures attached to every VeriFact report."
  );

  for (const lim of result.limitations) {
    rb.paragraph(`- ${lim}`, { size: 8.6, color: C.muted, indent: 2, spaceAfter: 1.3 });
  }
  rb.y += 2;
  const calls = result.llm_usage.calls ?? 0;
  const inTok = result.llm_usage.input_tokens ?? 0;
  const outTok = result.llm_usage.output_tokens ?? 0;
  rb.calloutBox(
    "Execution Audit Summary",
    `Check ID: ${result.id} | Status: ${result.status} | LLM Calls: ${calls} | Tokens: ${inTok} input / ${outTok} output | Exported from VeriFact Multimodal Fake Information Detector.`,
    C.navy,
    C.soft
  );

  // Add page headers/footers across all pages
  rb.addRunningChrome();
  doc.save(`verifact-report-${result.id}.pdf`);
}
