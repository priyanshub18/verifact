"use client";
import { AnimatePresence, motion } from "framer-motion";
import { VERDICT_STYLE } from "@/lib/api";
import { MULTI_LANES, MULTI_OPINION, MULTI_POST } from "@/lib/demo";

// Demo-only view: one lane per claim, mirroring the orchestrator's asyncio.gather over claims.
// Everything is a pure function of `tick`, so the autopilot can pause and jump.
export const TICK_MS = 900;
export const LAST_TICK = 21;
const STAGES = ["Plan", "Search", "Read", "Stance", "Weigh"];
const LLM_STAGES = [0, 3];
// tick at which each stage starts; index 5 = finished
const STARTS = [[3, 5, 9, 12, 15, 17], [3, 4, 7, 10, 12, 14], [4, 6, 10, 14, 18, 20]];
const SOURCES = [
  [["Fact Check", 2], ["DuckDuckGo", 9], ["GDELT", 6], ["Wikipedia", 1], ["PubMed", -1]],
  [["Fact Check", 0], ["DuckDuckGo", 7], ["GDELT", 3], ["Wikipedia", 1], ["PubMed", -1]],
  [["Fact Check", 3], ["DuckDuckGo", 8], ["GDELT", 4], ["Wikipedia", 1], ["PubMed", 5]],
] as const;
const TONE = { sup: "text-sup border-sup", ref: "text-ref border-ref", amber: "text-amber border-amber", dim: "text-dim border-line" };

const stageAt = (lane: number, t: number) => STARTS[lane].filter((s) => t >= s).length - 1; // -1 = not started, 5 = done
const sourceDone = (lane: number, j: number) => {
  const [s, e] = [STARTS[lane][1], STARTS[lane][2]];
  return s + 1 + Math.floor((j * (e - s - 1)) / SOURCES[lane].length);
};
const lanes = MULTI_LANES.map((l, i) => {
  const ev = l.result.evidence;
  return {
    ...l, i, docs: SOURCES[i].reduce((a, [, h]) => a + Math.max(0, h), 0), read: ev.length,
    setAside: ev.filter((e) => e.discard_reason && !e.discard_reason.startsWith("Stance")).length,
    kept: ev.filter((e) => e.counted && e.stance !== "neutral").length,
    dropped: ev.filter((e) => e.discard_reason?.startsWith("Stance")).length,
    S: l.result.weights.supports, R: l.result.weights.refutes,
  };
});

function logAt(t: number) {
  const out: { t: number; lane: number; msg: string }[] = [];
  lanes.forEach((l) => {
    const [plan, search, read, stance, weigh, done] = STARTS[l.i];
    out.push({ t: plan, lane: l.i, msg: "task started · planning searches (LLM)" });
    out.push({ t: search, lane: l.i, msg: `${l.queries.supporting.length + l.queries.disconfirming.length} queries (${l.queries.disconfirming.length} disconfirming)` });
    SOURCES[l.i].forEach(([n, h], j) => out.push({ t: sourceDone(l.i, j), lane: l.i, msg: h < 0 ? `${n.toLowerCase()} skipped (not a health claim)` : `${n.toLowerCase()} ✓ ${h} hits` }));
    out.push({ t: read, lane: l.i, msg: `fetching ${l.read} documents (SSRF-safe)` });
    out.push({ t: stance, lane: l.i, msg: `${l.read - l.setAside} passages ranked · ${l.setAside} set aside` });
    if (l.dropped) out.push({ t: stance + 2, lane: l.i, msg: `✗ ${l.dropped} judgement discarded: quote not verbatim` });
    out.push({ t: weigh, lane: l.i, msg: `weights: supports ${l.S} · refutes ${l.R}` });
    out.push({ t: done, lane: l.i, msg: `verdict → ${l.result.verdict}` });
  });
  return out.filter((e) => e.t <= t).sort((a, b) => a.t - b.t || a.lane - b.lane);
}

function Post({ t }: { t: number }) {
  const spans = [...MULTI_LANES.map((l, i) => ({ s: l.text.charAt(0).toLowerCase() + l.text.slice(1), tag: `C${i + 1}`, skip: false })), { s: MULTI_OPINION, tag: "opinion · skipped", skip: true }];
  const parts: React.ReactNode[] = [];
  let rest = MULTI_POST, k = 0;
  for (const sp of spans) {
    const at = rest.indexOf(sp.s);
    if (at < 0) continue;
    parts.push(rest.slice(0, at));
    parts.push(
      <span key={k++} className={`relative rounded px-0.5 transition-colors duration-500 ${t >= 1 ? (sp.skip ? "text-dim line-through decoration-dim" : "bg-signal/15 text-fg underline decoration-signal decoration-2 underline-offset-4") : ""}`}>
        {sp.s}{t >= 1 && <sup className={`ml-1 font-mono text-[10px] ${sp.skip ? "text-dim" : "text-signal"}`}>{sp.tag}</sup>}
      </span>);
    rest = rest.slice(at + sp.s.length);
  }
  parts.push(rest);
  return <p className="text-lg leading-relaxed">{parts}</p>;
}

function Lane({ l, t }: { l: (typeof lanes)[number]; t: number }) {
  const st = stageAt(l.i, t);
  if (st < 0) return <div className="glass grid min-h-[380px] place-items-center rounded-2xl p-5 font-mono text-xs text-dim">C{l.i + 1} · queued (waiting for a slot)</div>;
  const v = VERDICT_STYLE[l.result.verdict];
  const weighFrac = st >= 5 ? 1 : st === 4 ? Math.min(1, (t - STARTS[l.i][4] + 1) / (STARTS[l.i][5] - STARTS[l.i][4])) : 0;
  const stageProgress = (n: number) => Math.min(1, (t - STARTS[l.i][n] + 1) / (STARTS[l.i][n + 1] - STARTS[l.i][n]));
  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className={`glass relative min-h-[380px] overflow-hidden rounded-2xl p-5 ${st < 5 ? "border-signal/50" : ""}`}>
      {st < 5 && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-transparent via-signal/10 to-transparent" style={{ animation: "scan 2.4s linear infinite" }} />}
      <div className="flex items-start justify-between gap-2">
        <span className="rounded border border-signal px-1.5 font-mono text-xs text-signal">C{l.i + 1}</span>
        {l.sensitivity !== "none" && <span className="rounded border border-amber/60 px-1.5 font-mono text-[10px] uppercase tracking-wider text-amber">{l.sensitivity} · needs 3 domains</span>}
      </div>
      <p className="mt-2 font-display text-xl leading-snug">“{l.text}”</p>

      {/* stage rail */}
      <ol className="mt-4 grid grid-cols-5 gap-1">
        {STAGES.map((s, n) => (
          <li key={s} className="text-center">
            <div className="h-1 overflow-hidden rounded-full bg-line">
              <motion.div className="h-full bg-signal" animate={{ width: st > n ? "100%" : st === n ? `${stageProgress(n) * 100}%` : "0%" }} transition={{ duration: TICK_MS / 1000, ease: "linear" }} />
            </div>
            <span className={`mt-1 block font-mono text-[10px] ${st === n ? "text-signal" : st > n ? "text-fg" : "text-dim"}`}>{st > n ? "✓ " : st === n ? "◐ " : ""}{s}</span>
          </li>
        ))}
      </ol>

      {/* active stage detail */}
      <div className="mt-4 min-h-[130px] font-mono text-xs">
        <AnimatePresence mode="wait">
          <motion.div key={Math.min(st, 5)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {st === 0 && <ul className="space-y-1 text-dim"><li className="text-signal">◐ LLM writing queries…</li>
              {[...l.queries.supporting.map((q) => `+ ${q}`), ...l.queries.disconfirming.map((q) => `− ${q}`)].slice(0, (t - STARTS[l.i][0] + 1) * 3).map((q) => <li key={q}>{q}</li>)}</ul>}
            {st === 1 && <ul className="space-y-1.5">{SOURCES[l.i].map(([n, h], j) => {
              const ok = t >= sourceDone(l.i, j);
              return <li key={n} className="flex justify-between"><span className={ok ? "" : "text-dim"}>{ok ? (h < 0 ? "– " : "✓ ") : <span className="inline-block animate-spin">◌</span>} {n}</span><span className="text-dim">{ok ? (h < 0 ? "skipped" : `${h} hits`) : "searching"}</span></li>;
            })}</ul>}
            {st === 2 && <div className="space-y-2"><p>Fetching & ranking {l.read} documents</p>
              <div className="grid grid-cols-10 gap-1">{Array.from({ length: l.read }, (_, j) => <motion.span key={j} className="h-5 rounded-sm bg-line" animate={{ backgroundColor: j < Math.ceil(stageProgress(2) * l.read) ? "rgb(var(--signal))" : "rgb(var(--line))" }} transition={{ delay: (j % 4) * 0.12 }} />)}</div>
              <p className="text-dim">BM25 over 110-word passages · syndication dedupe</p></div>}
            {st === 3 && <div className="space-y-2"><p className="text-signal">◐ LLM judging stance + verbatim quote check</p>
              <ul className="space-y-1">{l.result.evidence.filter((e) => !e.discard_reason || e.discard_reason.startsWith("Stance")).filter((e) => e.stance !== "neutral").slice(0, Math.ceil(stageProgress(3) * 6)).map((e) => {
                const bad = e.discard_reason?.startsWith("Stance");
                return <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{e.domain}</span><span className={bad ? "text-amber" : e.stance === "supports" ? "text-sup" : "text-ref"}>{bad ? "✗ quote" : e.stance === "supports" ? "+ sup" : "− ref"}</span></li>;
              })}</ul></div>}
            {st >= 4 && <div className="space-y-2">
              {([["refutes", l.R, "bg-ref"], ["supports", l.S, "bg-sup"]] as const).map(([k, w, c]) => (
                <div key={k} className="grid grid-cols-[64px_1fr_36px] items-center gap-2"><span>{k}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-line"><motion.span className={`block h-full ${c}`} animate={{ width: `${(w / (l.S + l.R)) * 100 * weighFrac}%` }} transition={{ duration: 0.8 }} /></span>
                  <span className="text-right">{(w * weighFrac).toFixed(2)}</span></div>))}
              <p className="text-dim">credibility × (0.5 + 0.5 × relevance)</p>
              {st >= 5 && <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring" }}
                className={`mt-2 inline-flex items-center gap-2 border-2 px-3 py-1 font-display text-2xl ${TONE[v.tone]}`}><span className="font-mono text-base">{v.glyph}</span>{l.result.verdict}</motion.span>}
            </div>}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-3 grid grid-cols-3 border-t border-line pt-3 text-center font-mono text-[10px] text-dim">
        <span><span className="block text-base text-fg">{st >= 2 ? l.docs : "–"}</span>docs found</span>
        <span><span className="block text-base text-fg">{st >= 3 ? l.read - l.setAside : "–"}</span>passages</span>
        <span><span className="block text-base text-fg">{st >= 4 ? l.kept : "–"}</span>quotes kept</span>
      </div>
    </motion.div>
  );
}

export function ParallelInvestigation({ tick }: { tick: number }) {
  const t = tick;
  const inFlight = t < 3 ? (t < 2 ? 1 : 0) : lanes.filter((l) => LLM_STAGES.includes(stageAt(l.i, t))).length;
  const running = lanes.filter((l) => { const s = stageAt(l.i, t); return s >= 0 && s < 5; }).length;
  const log = logAt(t).slice(-7);
  return (
    <section className="pt-10" aria-live="polite" aria-label="Live parallel investigation">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="label mb-2">Live investigation · parallel view</p>
          <h2 className="font-display text-4xl">{t >= LAST_TICK ? "All claims traced" : t < 3 ? "Extracting claims…" : `Tracing 3 claims in parallel…`}</h2></div>
        <div className="flex gap-2 font-mono text-xs">
          {[["elapsed", `${((t * TICK_MS) / 1000).toFixed(1)}s`], ["claim tasks", t >= 3 ? `${running} running` : "–"], ["LLM calls in flight", String(inFlight)]].map(([k, v]) => (
            <div key={k} className="glass rounded-lg px-3 py-2"><span className="block text-[10px] uppercase tracking-wider text-dim">{k}</span><span className="text-base text-fg">{v}</span></div>))}
        </div>
      </div>

      <div className="glass mt-6 rounded-2xl p-5">
        <div className="mb-2 flex items-center justify-between"><p className="label">Input post</p>
          <span className={`font-mono text-xs ${t >= 2 ? "text-sup" : "text-signal"}`}>{t >= 2 ? "✓ 3 checkworthy claims · 1 opinion skipped" : "◐ LLM extracting atomic claims…"}</span></div>
        <Post t={t} />
      </div>

      <div id="demo-lanes">{t >= 3 && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 text-center font-mono text-xs text-dim">asyncio.gather( check_claim(C1), check_claim(C2), check_claim(C3) )</motion.p>}
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {t >= 3 && lanes.map((l) => <Lane key={l.i} l={l} t={t} />)}
      </div>
      </div>

      <div className="glass mt-4 rounded-2xl p-4 font-mono text-xs">
        <p className="label mb-2">Event stream</p>
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {log.map((e) => (
              <motion.li key={`${e.t}-${e.lane}-${e.msg}`} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex gap-3">
                <span className="text-dim">{((e.t * TICK_MS) / 1000).toFixed(1).padStart(5, "0")}s</span><span className="text-signal">[C{e.lane + 1}]</span><span>{e.msg}</span>
              </motion.li>))}
          </AnimatePresence>
          {log.length === 0 && <li className="text-dim">waiting for claim extraction…</li>}
        </ul>
      </div>
    </section>
  );
}
