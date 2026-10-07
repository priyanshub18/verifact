export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Stance = "supports" | "refutes" | "neutral";
export interface Evidence {
  id: number; url: string; domain: string; title: string; publisher: string; published_at: string | null;
  retrieved_at: string; source_type: string; excerpt: string; stance: Stance; quote: string; rationale: string;
  rerank_score: number; rerank_method: string; counted: boolean; discard_reason: string | null; date_note: string | null;
  credibility: { score: number; domain_class: string; https: boolean; is_primary: boolean; recency_days: number | null; signals: string[] };
}
export interface FactCheck { publisher: string; url: string; title: string; rating: string; review_date: string | null; claimant: string | null }
export interface ClaimResult {
  claim: { text: string; kind: string; checkworthy: boolean; topic_sensitivity: string; claim_date: string | null; language: string };
  verdict: string; confidence: number | null; confidence_calibrated: boolean; confidence_explanation: string;
  queries: string[]; fact_checks: FactCheck[]; evidence: Evidence[]; unknowns: string[]; how_to_verify: string[];
  weights: Record<string, number>;
}
export interface CheckResult {
  id: string; status: string; overall_verdict: string | null; claims: ClaimResult[]; errors: string[];
  limitations: string[]; llm_usage: Record<string, number>;
  input: { kind: string; text: string; url: string | null; title: string | null; domain: string | null; published_at: string | null };
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
export async function createCheck(body: { text?: string; url?: string; private: boolean; provider?: string }) {
  const r = await fetch(`${API}/api/checks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : j.detail?.message ?? "Request failed");
  return j as { id: string };
}
export async function getCheck(id: string) {
  const r = await fetch(`${API}/api/checks/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Check not found");
  return (await r.json()) as { id: string; status: string; events: ProgressEvent[]; result: CheckResult | null };
}

// Verdict encoding: never colour alone; every verdict carries a glyph and a text label.
export const VERDICT_STYLE: Record<string, { glyph: string; tone: "sup" | "ref" | "amber" | "dim" }> = {
  "True": { glyph: "✓✓", tone: "sup" }, "Mostly True": { glyph: "✓", tone: "sup" },
  "Mixed/Misleading Context": { glyph: "≈", tone: "amber" }, "Disputed": { glyph: "⇄", tone: "amber" },
  "Mostly False": { glyph: "✗", tone: "ref" }, "False": { glyph: "✗✗", tone: "ref" },
  "Manipulated Media": { glyph: "⚠", tone: "ref" }, "AI-Generated": { glyph: "◬", tone: "ref" },
  "Satire": { glyph: "☺", tone: "dim" }, "Unverifiable": { glyph: "?", tone: "dim" }, "Not Checkworthy": { glyph: "∅", tone: "dim" },
};
