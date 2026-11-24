"use client";
import { useState } from "react";
import { ImageAnalysis, VERDICT_STYLE, checkImageUrl } from "@/lib/api";

const TONE = { sup: "text-sup border-sup", ref: "text-ref border-ref", amber: "text-amber border-amber", dim: "text-dim border-line" };

const ALIGN_MAP: Record<string, string> = {
  consistent: "Consistent",
  partially_consistent: "Partially Consistent",
  mismatched_context: "Mismatched / Out of Context",
  contradicts_image: "Contradicts Image",
  no_claim: "No Claim Provided",
};

function Pill({ label }: { label: string }) {
  const st = VERDICT_STYLE[label] ?? VERDICT_STYLE["Inconclusive"];
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 font-mono text-xs ${TONE[st.tone]}`}>
      <span aria-hidden>{st.glyph}</span>{label}
    </span>
  );
}

export function ImageForensicsPanel({
  checkId,
  analysis,
  hasImage,
  imageUrl,
  defaultView = "original",
}: {
  checkId: string;
  analysis: ImageAnalysis;
  hasImage?: boolean;
  imageUrl?: string | null;
  defaultView?: "original" | "ela" | "noise";
}) {
  const [view, setView] = useState<"original" | "ela" | "noise">(defaultView);
  const meta = analysis.metadata ?? {};
  const visual = analysis.visual;
  const aiMeta = Array.isArray(meta.ai_metadata_signals) ? (meta.ai_metadata_signals as string[]) : [];
  const editorMeta = Array.isArray(meta.editing_software_signals) ? (meta.editing_software_signals as string[]) : [];
  const c2paMeta = Array.isArray(meta.c2pa_signals) ? (meta.c2pa_signals as string[]) : [];
  const metaNotes = Array.isArray(meta.notes) ? (meta.notes as string[]) : [];

  const originalSrc = imageUrl || (hasImage ? checkImageUrl(checkId) : null);
  const imgSrc =
    view === "ela" && analysis.ela_heatmap_png_base64
      ? `data:image/png;base64,${analysis.ela_heatmap_png_base64}`
      : view === "noise" && analysis.noise_heatmap_png_base64
        ? `data:image/png;base64,${analysis.noise_heatmap_png_base64}`
        : originalSrc;

  return (
    <section className="glass mt-8 rounded-2xl p-5 sm:p-8" aria-label="Image authenticity and forensics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">Image Authenticity &amp; Visual Verification · engine: {analysis.forensics_source}</p>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl">Image Forensics Lab</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill label={analysis.image_verdict} />
          {analysis.image_confidence !== null && analysis.image_confidence !== undefined && (
            <span className="font-mono text-xs text-dim">
              signal strength {Math.round(analysis.image_confidence * 100)}% (uncalibrated)
            </span>
          )}
        </div>
      </div>

      {/* Viewer + Visual inspection side by side */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Image layer">
            {(["original", "ela", "noise"] as const).map((tab) => {
              const disabled =
                (tab === "original" && !originalSrc) ||
                (tab === "ela" && !analysis.ela_heatmap_png_base64) ||
                (tab === "noise" && !analysis.noise_heatmap_png_base64);
              const title = tab === "original" ? "Original Image" : tab === "ela" ? "ELA Heatmap" : "Noise Residual";
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={view === tab}
                  disabled={disabled}
                  onClick={() => setView(tab)}
                  className={`rounded-md border px-3 py-1.5 font-mono text-xs transition disabled:opacity-40 ${
                    view === tab ? "border-signal bg-signal/15 text-signal" : "border-line text-dim hover:text-fg"
                  }`}
                >
                  {title}
                </button>
              );
            })}
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-ink/80">
            {imgSrc ? (
              <img src={imgSrc} alt={`Uploaded image (${view} view)`} className="max-h-96 w-full object-contain" />
            ) : (
              <p className="p-8 text-center text-sm text-dim">Image preview unavailable.</p>
            )}
          </div>
          <p className="mt-2 text-xs text-dim">
            {view === "original" && "Original uploaded file rendered safely."}
            {view === "ela" && "Error Level Analysis (JPEG recompression difference): bright pockets contrasting with similar surroundings may hint at localized editing."}
            {view === "noise" && "High-pass median noise residual: uneven sensor noise across similar surfaces can indicate splicing."}
          </p>
        </div>

        {/* Visual & Image-Claim Consistency */}
        <div className="space-y-4">
          {visual ? (
            <>
              <div className="rounded-xl border border-line bg-ink/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="label">Image–Claim Match</p>
                  <Pill label={ALIGN_MAP[visual.claim_alignment] ?? visual.claim_alignment} />
                </div>
                <p className="mt-2 text-sm text-fg">{visual.alignment_explanation}</p>
              </div>

              <div className="rounded-xl border border-line bg-ink/40 p-4">
                <p className="label">Visual Inspection</p>
                <p className="mt-2 text-sm text-dim">{visual.scene_description}</p>
                <p className="mt-2 text-sm text-fg">{visual.authenticity_rationale}</p>
                {visual.visual_anomalies.length > 0 && (
                  <div className="mt-3">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-ref">Visual anomalies noted</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-dim">
                      {visual.visual_anomalies.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                )}
                {visual.watermarks_or_badges.length > 0 && (
                  <p className="mt-2 font-mono text-xs text-amber">
                    Watermarks / badges: {visual.watermarks_or_badges.join(" · ")}
                  </p>
                )}
                {visual.visible_text && (
                  <div className="mt-3 border-t border-line pt-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-dim">Visible text in image (OCR)</p>
                    <p className="mt-1 font-mono text-xs text-fg">{visual.visible_text}</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-line bg-ink/40 p-4 text-sm text-dim">
              Vision-model inspection was unavailable for this check; showing deterministic metadata and pixel forensics below.
            </div>
          )}
        </div>
      </div>

      {/* Forensic metrics + Metadata */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-ink/40 p-4">
          <p className="label mb-3">EXIF, Metadata &amp; C2PA Provenance</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <dt className="text-dim">Format / Size</dt>
            <dd className="font-mono text-fg">
              {String(meta.format ?? "—")} · {String(meta.width ?? "?")}×{String(meta.height ?? "?")} ·{" "}
              {meta.file_size_bytes ? `${(Number(meta.file_size_bytes) / 1024).toFixed(1)} KB` : "—"}
            </dd>
            <dt className="text-dim">EXIF Camera</dt>
            <dd className="font-mono text-fg">
              {[meta.camera_make, meta.camera_model].filter(Boolean).join(" ") || (meta.has_exif ? "Present (no camera model)" : "Absent / Stripped")}
            </dd>
            <dt className="text-dim">Software Tag</dt>
            <dd className="font-mono text-fg">{String(meta.software ?? "None")}</dd>
            <dt className="text-dim">EXIF Capture Date</dt>
            <dd className="font-mono text-fg">{String(meta.datetime_original ?? "None")}</dd>
            <dt className="text-dim">AI Metadata</dt>
            <dd className={`font-mono ${aiMeta.length ? "text-ref" : "text-sup"}`}>
              {aiMeta.length ? aiMeta.join(", ") : "None detected"}
            </dd>
            <dt className="text-dim">Editor Traces</dt>
            <dd className={`font-mono ${editorMeta.length ? "text-amber" : "text-dim"}`}>
              {editorMeta.length ? editorMeta.join(", ") : "None detected"}
            </dd>
            <dt className="text-dim">C2PA / Content Creds</dt>
            <dd className="font-mono text-fg">{c2paMeta.length ? c2paMeta.join(", ") : "No manifest found"}</dd>
            <dt className="text-dim">SHA-256 / dHash</dt>
            <dd className="truncate font-mono text-[11px] text-dim" title={String(meta.sha256 ?? "")}>
              {String(meta.sha256 ?? "").slice(0, 14)}… · {String(meta.dhash ?? "—")}
            </dd>
          </dl>
          {metaNotes.length > 0 && (
            <ul className="mt-3 list-inside list-disc space-y-1 border-t border-line pt-2 text-xs text-dim">
              {metaNotes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-line bg-ink/40 p-4">
          <p className="label mb-3">Pixel &amp; Frequency Forensic Indicators</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-line/70 p-2">
              <p className="text-[10px] text-dim">ELA BLOCK CV</p>
              <p className="mt-0.5 text-base text-fg">{analysis.ela_stats.block_error_cv ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-line/70 p-2">
              <p className="text-[10px] text-dim">ELA P99 ERROR</p>
              <p className="mt-0.5 text-base text-fg">{analysis.ela_stats.p99_error ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-line/70 p-2">
              <p className="text-[10px] text-dim">NOISE BLOCK CV</p>
              <p className="mt-0.5 text-base text-fg">{analysis.noise_stats.block_noise_cv ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-line/70 p-2">
              <p className="text-[10px] text-dim">FFT HIGH-FREQ</p>
              <p className="mt-0.5 text-base text-fg">{analysis.spectral_stats.high_freq_ratio ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-line/70 p-2">
              <p className="text-[10px] text-dim">RGB NOISE CORR</p>
              <p className="mt-0.5 text-base text-fg">{analysis.spectral_stats.rgb_noise_corr ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-line/70 p-2">
              <p className="text-[10px] text-dim">FORENSIC RISK</p>
              <p className={`mt-0.5 text-base ${analysis.forensic_risk === "low" ? "text-sup" : analysis.forensic_risk === "moderate" ? "text-amber" : "text-ref"}`}>
                {analysis.forensic_risk}
              </p>
            </div>
          </div>
          {analysis.forensic_flags.length > 0 && (
            <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-amber">
              {analysis.forensic_flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
      </div>

      {/* Image Provenance / Reverse-Context Web Leads */}
      <div className="mt-6 rounded-xl border border-line bg-ink/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label">Image Provenance &amp; Web Fact-Check Leads</p>
          <span className="font-mono text-xs text-dim">status: {analysis.provenance_finding}</span>
        </div>
        <p className="mt-2 text-sm text-fg">{analysis.provenance_summary}</p>
        {analysis.provenance_matches.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
            {analysis.provenance_matches.slice(0, 6).map((m) => (
              <li key={m.url}>
                <a className="underline decoration-line underline-offset-4 hover:decoration-signal" target="_blank" rel="noopener noreferrer" href={m.url}>
                  {m.title}
                </a>
                <span className="ml-2 font-mono text-xs text-dim">
                  {m.domain} · {m.source_type} · cred {Math.round(m.credibility_score * 100)}
                </span>
                {m.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-dim">{m.snippet}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
