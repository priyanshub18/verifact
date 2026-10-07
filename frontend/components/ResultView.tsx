"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { CheckResult, ClaimResult, ProgressEvent, VERDICT_STYLE } from "@/lib/api";
import { EvidenceBoard } from "./EvidenceBoard";

const TONE = { sup: "text-sup border-sup", ref: "text-ref border-ref", amber: "text-amber border-amber", dim: "text-dim border-line" };

function VerdictBadge({ verdict, big }: { verdict: string; big?: boolean }) {
  const st = VERDICT_STYLE[verdict] ?? VERDICT_STYLE["Unverifiable"];
  return (
    <span className={`inline-flex items-center gap-3 border-2 ${TONE[st.tone]} ${big ? "px-5 py-3 text-3xl sm:text-5xl" : "px-3 py-1 text-base"} font-display`}>
      <span aria-hidden className="font-mono">{st.glyph}</span>{verdict}
    </span>
  );
}

function Gauge({ value }: { value: number | null }) {
  if (value === null) return <p className="label">No single confidence applies</p>;
  const a = Math.PI * value, r = 70;
  const x = 90 - r * Math.cos(a), y = 90 - r * Math.sin(a);
  return (
    <figure aria-label={`Evidence strength ${Math.round(value * 100)} out of 100, uncalibrated`}>
      <svg viewBox="0 0 180 104" className="w-44">
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="rgb(var(--line))" strokeWidth="10" strokeLinecap="round" />
        <motion.path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="rgb(var(--signal))" strokeWidth="10" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: value }} transition={{ duration: 1, ease: "easeOut" }} />
        <circle cx={x} cy={y} r="5" fill="rgb(var(--fg))" />
        <text x="90" y="86" textAnchor="middle" fontSize="28" fill="rgb(var(--fg))" fontFamily="var(--font-display)">{Math.round(value * 100)}</text>
      </svg>
      <figcaption className="label">Evidence strength · <span className="text-amber">uncalibrated</span></figcaption>
    </figure>
  );
}

function Claim({ c, showReasoning }: { c: ClaimResult; showReasoning: boolean }) {
  const counted = c.evidence.filter((e) => e.counted && e.stance !== "neutral");
  const discarded = c.evidence.filter((e) => !e.counted || e.stance === "neutral");
  return (
    <article className="glass rounded-2xl p-5 sm:p-8">
      <p className="label">Claim · {c.claim.kind}{c.claim.topic_sensitivity !== "none" && ` · sensitive: ${c.claim.topic_sensitivity} (stricter threshold)`}</p>
      <h3 className="mt-2 font-display text-2xl sm:text-3xl">“{c.claim.text}”</h3>
      <div className="mt-6 flex flex-wrap items-center gap-8">
        <VerdictBadge verdict={c.verdict} />
        <Gauge value={c.confidence} />
      </div>
      <p className="mt-4 max-w-2xl text-dim">{c.confidence_explanation}</p>

      {c.fact_checks.length > 0 && (
        <div className="mt-6"><p className="label mb-2">Existing fact-checks</p>
          <ul className="space-y-2">{c.fact_checks.slice(0, 5).map((f) => (
            <li key={f.url}><a className="underline decoration-line underline-offset-4 hover:decoration-signal" target="_blank" rel="noopener noreferrer" href={f.url}>{f.publisher}: “{f.rating}”</a>
              <span className="text-xs text-dim"> · {f.review_date ?? "undated"}</span></li>))}</ul></div>
      )}

      {c.evidence.length > 0 && <div className="mt-8"><p className="label mb-2">Evidence board</p><EvidenceBoard claim={c} /></div>}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {(["supports", "refutes"] as const).map((s) => (
          <div key={s}><p className="label mb-2">{s === "supports" ? "+ Supporting" : "− Refuting"} ({counted.filter((e) => e.stance === s).length})</p>
            <ul className="space-y-3">{counted.filter((e) => e.stance === s).map((e) => (
              <li key={e.id} className="text-sm"><blockquote className="border-l-2 border-line pl-3 italic">{e.quote}</blockquote>
                <a className="text-xs text-dim underline" target="_blank" rel="noopener noreferrer" href={e.url}>{e.domain} · {e.published_at ?? "undated"} · retrieved {new Date(e.retrieved_at).toLocaleDateString()}</a></li>))}
              {counted.filter((e) => e.stance === s).length === 0 && <li className="text-sm text-dim">None found.</li>}</ul></div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div><p className="label mb-2">What we couldn’t verify</p>
          <ul className="list-inside list-disc text-sm text-dim">{c.unknowns.length ? c.unknowns.map((u) => <li key={u}>{u}</li>) : <li>No specific gaps flagged. This is not proof of completeness.</li>}</ul></div>
        <div><p className="label mb-2">How to verify this yourself</p>
          <ul className="list-inside list-disc text-sm text-dim">{c.how_to_verify.map((u) => <li key={u}>{u}</li>)}</ul></div>
      </div>

      {showReasoning && (
        <div className="mt-8 border-t border-line pt-6">
          <p className="label mb-2">Queries run</p>
          <ul className="font-mono text-xs text-dim">{c.queries.map((q) => <li key={q}>› {q}</li>)}</ul>
          <p className="label mb-2 mt-6">Weights: supports {c.weights.supports ?? 0} · refutes {c.weights.refutes ?? 0}</p>
          <p className="label mb-2 mt-6">Sources considered but not counted ({discarded.length})</p>
          <ul className="space-y-2 text-sm">{discarded.map((e) => (
            <li key={e.id}><a className="underline" target="_blank" rel="noopener noreferrer" href={e.url}>{e.domain}</a>
              <span className="text-dim"> · {e.stance} · {e.discard_reason ?? "neutral toward the claim"} · {e.rerank_method} {e.rerank_score}</span></li>))}</ul>
          <p className="label mb-2 mt-6">Credibility breakdown of counted sources</p>
          <ul className="space-y-2 text-xs text-dim">{counted.map((e) => <li key={e.id}><span className="text-fg">{e.domain}</span> → {Math.round(e.credibility.score * 100)}: {e.credibility.signals.join("; ")}</li>)}</ul>
        </div>
      )}
    </article>
  );
}

export function ResultView({ result, events }: { result: CheckResult; events: ProgressEvent[] }) {
  const [reason, setReason] = useState(false);
  const verdict = result.overall_verdict ?? "Unverifiable";
  const share = typeof window !== "undefined" ? window.location.href : "";
  return (
    <div className="pt-10">
      <p className="label">Overall assessment{result.input.domain && ` · ${result.input.domain}`}</p>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-3"><VerdictBadge verdict={verdict} big /></motion.div>
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <button className="glass rounded-md px-3 py-2" aria-pressed={reason} onClick={() => setReason(!reason)}>{reason ? "Hide" : "Show"} the reasoning</button>
        <button className="glass rounded-md px-3 py-2" onClick={() => navigator.clipboard?.writeText(share)}>Copy link</button>
        <button className="glass rounded-md px-3 py-2" onClick={() => {
          const b = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `verifact-${result.id}.json`; a.click();
        }}>Export JSON</button>
      </div>
      {result.errors.length > 0 && <ul className="mt-4 text-sm text-amber">{result.errors.map((e) => <li key={e}>◌ {e}</li>)}</ul>}
      <div className="mt-8 space-y-6">{result.claims.map((c, i) => <Claim key={i} c={c} showReasoning={reason} />)}</div>
      <section className="mt-10 text-sm text-dim"><p className="label mb-2">Limitations of this result</p>
        <ul className="list-inside list-disc space-y-1">{result.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="mt-3 font-mono text-xs">LLM usage: {result.llm_usage.calls ?? 0} calls · {result.llm_usage.input_tokens ?? 0} in / {result.llm_usage.output_tokens ?? 0} out tokens</p></section>
    </div>
  );
}
