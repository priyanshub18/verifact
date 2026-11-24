export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Stance = "supports" | "refutes" | "neutral";
export interface Evidence {
  id: number; url: string; domain: string; title: string; publisher: string; published_at: string | null;
  retrieved_at: string; source_type: string; excerpt: string; stance: Stance; quote: string; rationale: string;
  rerank_score: number; rerank_method: string; counted: boolean; discard_reason: string | null; date_note: string | null;
  nli_label?: string | null; nli_score?: number | null;
  credibility: { score: number; domain_class: string; https: boolean; is_primary: boolean; recency_days: number | null; signals: string[] };
}
export interface FactCheck { publisher: string; url: string; title: string; rating: string; review_date: string | null; claimant: string | null }
export interface ClaimResult {
  claim: { text: string; kind: string; checkworthy: boolean; topic_sensitivity: string; claim_date: string | null; language: string };
  verdict: string; confidence: number | null; confidence_calibrated: boolean; confidence_explanation: string;
  queries: string[]; fact_checks: FactCheck[]; evidence: Evidence[]; unknowns: string[]; how_to_verify: string[];
  weights: Record<string, number>;
}
export interface VisualAnalysis {
  scene_description: string;
  visible_text: string;
  visual_entities: string[];
  authenticity_assessment: "likely_authentic" | "suspicious_editing" | "likely_ai_generated" | "uncertain";
  authenticity_rationale: string;
  visual_anomalies: string[];
  watermarks_or_badges: string[];
  claim_alignment: "consistent" | "partially_consistent" | "mismatched_context" | "contradicts_image" | "no_claim";
  alignment_explanation: string;
  image_search_queries: string[];
  embedded_claims: string[];
}
export interface ImageProvenanceMatch {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  source_type: string;
  credibility_score: number;
}
export interface ImageAnalysis {
  image_verdict: string;
  image_is_real: boolean | null;
  image_confidence: number | null;
  forensics_source: string;
  metadata: Record<string, unknown>;
  ela_stats: Record<string, number>;
  ela_heatmap_png_base64: string | null;
  noise_stats: Record<string, number>;
  noise_heatmap_png_base64: string | null;
  spectral_stats: Record<string, number>;
  forensic_flags: string[];
  forensic_risk: string;
  visual: VisualAnalysis | null;
  provenance_finding: string;
  provenance_summary: string;
  provenance_matches: ImageProvenanceMatch[];
  limitations: string[];
}
export interface MultimodalSummary {
  image_verdict: string;
  image_is_real: boolean | null;
  claim_verdict: string;
  claim_is_real: boolean | null;
  image_claim_match: string;
  summary: string;
}
export interface CheckResult {
  id: string; status: string; overall_verdict: string | null;
  multimodal_summary?: MultimodalSummary | null;
  image_analysis?: ImageAnalysis | null;
  claims: ClaimResult[]; errors: string[];
  limitations: string[]; llm_usage: Record<string, number>;
  input: {
    kind: string; text: string; url: string | null; title: string | null; domain: string | null; published_at: string | null;
    image_name?: string | null; image_mime?: string | null; has_image?: boolean; image_url?: string | null;
  };
}
export interface CheckSummary {
  id: string;
  status: string;
  created_at: string;
  has_image: boolean;
  image_name: string | null;
  snippet: string;
  overall_verdict: string | null;
  image_verdict: string | null;
  claim_verdict: string | null;
}
export interface ProgressEvent { step: string; status: "running" | "done" | "failed"; detail: string; data: Record<string, unknown>; ts: string }
export interface Capability { id: string; label: string; configured: boolean; needs: string[]; how_to_enable: string }

export async function getCapabilities(): Promise<Capability[]> {
  const r = await fetch(`${API}/api/capabilities`, { cache: "no-store" });
  if (!r.ok) throw new Error("API unreachable");
  return r.json();
}
export interface Provider { id: string; label: string; configured: boolean; model: string; how_to_enable: string; free: boolean }
export async function getProviders(): Promise<{ default: string | null; providers: Provider[] }> {
  const r = await fetch(`${API}/api/providers`, { cache: "no-store" });
  if (!r.ok) throw new Error("API unreachable");
  return r.json();
}
export async function listChecks(limit = 8): Promise<CheckSummary[]> {
  const r = await fetch(`${API}/api/checks?limit=${limit}`, { cache: "no-store" });
  if (!r.ok) return [];
  return r.json();
}
export async function createCheck(body: { text?: string; url?: string; private: boolean; provider?: string }) {
  const r = await fetch(`${API}/api/checks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : j.detail?.message ?? "Request failed");
  return j as { id: string };
}
export async function createMultimodalCheck(args: { image?: File | null; claim?: string; url?: string; private: boolean; provider?: string }) {
  const fd = new FormData();
  if (args.image) fd.append("image", args.image);
  if (args.claim) fd.append("claim", args.claim);
  if (args.url) fd.append("url", args.url);
  fd.append("private", String(args.private));
  if (args.provider) fd.append("provider", args.provider);
  const r = await fetch(`${API}/api/checks/multimodal`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : j.detail?.message ?? "Request failed");
  return j as { id: string };
}
export async function getCheck(id: string) {
  const r = await fetch(`${API}/api/checks/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Check not found");
  return (await r.json()) as { id: string; status: string; events: ProgressEvent[]; result: CheckResult | null };
}
export function checkImageUrl(id: string) {
  return `${API}/api/checks/${id}/image`;
}

// Verdict encoding: never colour alone; every verdict carries a glyph and a text label.
export const VERDICT_STYLE: Record<string, { glyph: string; tone: "sup" | "ref" | "amber" | "dim" }> = {
  "True": { glyph: "✓✓", tone: "sup" }, "Mostly True": { glyph: "✓", tone: "sup" },
  "Likely Authentic": { glyph: "✓", tone: "sup" }, "Consistent": { glyph: "✓", tone: "sup" },
  "Partially Consistent": { glyph: "≈", tone: "amber" },
  "Mixed/Misleading Context": { glyph: "≈", tone: "amber" }, "Disputed": { glyph: "⇄", tone: "amber" },
  "Mismatched / Out of Context": { glyph: "⚠", tone: "amber" },
  "Mostly False": { glyph: "✗", tone: "ref" }, "False": { glyph: "✗✗", tone: "ref" },
  "False (Contradicted by Image)": { glyph: "✗✗", tone: "ref" },
  "Contradicts Image": { glyph: "✗", tone: "ref" },
  "Manipulated Media": { glyph: "⚠", tone: "ref" }, "Likely Manipulated": { glyph: "⚠", tone: "ref" },
  "AI-Generated": { glyph: "◬", tone: "ref" }, "Likely AI-Generated": { glyph: "◬", tone: "ref" },
  "Satire": { glyph: "☺", tone: "dim" }, "Unverifiable": { glyph: "?", tone: "dim" },
  "Inconclusive": { glyph: "?", tone: "dim" }, "Not Checkworthy": { glyph: "∅", tone: "dim" },
  "No Claim Provided": { glyph: "—", tone: "dim" },
};
