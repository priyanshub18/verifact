"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckResult, ProgressEvent } from "@/lib/api";
import {
  DEMO_CLAIM,
  DEMO_IMAGE_AI_RESULT,
  DEMO_IMAGE_OOC_RESULT,
  DEMO_RESULT,
  IMG_AI_CLAIM,
  IMG_OOC_CLAIM,
  MULTI_POST,
  MULTI_RESULT,
  P,
  QUERIES,
  R,
  S,
} from "@/lib/demo";
import { Hero } from "./Hero";
import { Investigation } from "./Investigation";
import { LAST_TICK, ParallelInvestigation, TICK_MS } from "./ParallelInvestigation";
import { ResultView } from "./ResultView";

type Scene = "home" | "investigate" | "result";
interface State { scene: Scene; pressed: boolean; events: number; tick: number; reasoning: boolean; hover: string | null }
interface Beat { cap: number; ms: number; say?: string; set?: Partial<State>; target?: string; click?: boolean; type?: boolean; scroll?: string }
interface Scenario {
  id: string; name: string; tag: string; blurb: string; input: string; result: CheckResult;
  imageUrl?: string; imageName?: string; imageMeta?: string;
  captions: readonly (readonly [string, string])[]; beats: Beat[]; investigate: (st: State) => React.ReactNode;
}

const INITIAL: State = { scene: "home", pressed: false, events: 0, tick: 0, reasoning: false, hover: null };
const homeBeats = (ms: number, clickCap: number): Beat[] => [
  { cap: 0, ms: 1100, set: { ...INITIAL }, target: "#claim" },
  { cap: 0, ms, type: true, target: "#claim" },
  { cap: 0, ms: 1000, target: "#claim + div > button" },
  { cap: clickCap, ms: 1600, set: { pressed: true }, target: "#claim + div > button", click: true },
];
const reasoningBeats = (cap: number): Beat[] => [
  { cap, ms: 1400, set: { hover: null }, scroll: "btn:the reasoning", target: "btn:the reasoning" },
  { cap, ms: 4500, set: { reasoning: true }, target: "btn:the reasoning", click: true },
  { cap, ms: 3500, scroll: "text:Sources considered but not counted" },
];

const t0 = Date.parse("2026-11-24T09:12:00Z");
const ev = (step: string, status: ProgressEvent["status"], detail: string, data: Record<string, unknown> = {}, s = 0): ProgressEvent =>
  ({ step, status, detail, data, ts: new Date(t0 + s * 1000).toISOString() });
const node = (d: string) => `g[aria-label^="${d},"]`;

// ---------- HARDCODED MULTIMODAL 1: AI / Doctored Image + Viral Claim ----------
const IMG_AI_EVENTS: ProgressEvent[] = [
  ev("image_forensics", "running", "Inspecting EXIF/C2PA metadata, ELA, noise residual & frequency spectrum", {}, 1),
  ev("image_forensics", "done", "880×560 JPEG · AI metadata: Stable Diffusion parameters · Editor: Photoshop · Forensic risk: high_metadata_ai", {}, 3),
  ev("vision", "running", "Inspecting image content, visual artifacts & claim consistency", {}, 4),
  ev("vision", "done", "Visual check: likely_ai_generated · Claim match: consistent (synthetic scene)", {}, 7),
  ev("image_provenance", "running", "Searching web & fact-checks for image origin and prior debunks", {}, 8),
  ev("image_provenance", "done", "3 provenance leads · debunked_ai (factcheck-desk.example, paris-fire-dept.example)", {}, 10),
  ev("claims", "running", "Extracting underlying real-world factual claims", {}, 11),
  ev("claims", "done", "1 checkworthy claim(s), 0 skipped (sensitive: violence · needs ≥ 3 domains)", {}, 12),
  ev("queries", "running", "Planning confirming & disconfirming searches", {}, 13),
  ev("queries", "done", "5 queries (3 seek disconfirming evidence)", { queries: ["Eiffel Tower fire explosion today", "Eiffel Tower fire hoax fact check", "Paris fire department Eiffel Tower statement"] }, 14),
  ev("search", "done", "14 candidate documents, 1 existing fact-check", {}, 16),
  ev("verify", "done", "False · 4 independent refuting domains · DeBERTa NLI agrees", {}, 19),
  ev("fuse", "done", "Image: Likely AI-Generated · Match: Consistent · Claim: False", {}, 20),
  ev("done", "done", "Overall: AI-Generated", {}, 21),
];

const IMG_AI_SCENARIO: Scenario = {
  id: "img-ai",
  name: "Image + Claim · AI Fake",
  tag: "Multimodal Featured",
  input: IMG_AI_CLAIM,
  result: DEMO_IMAGE_AI_RESULT,
  imageUrl: "/demo/eiffel-fire-fake.jpg",
  imageName: "eiffel-fire-fake.jpg",
  imageMeta: "JPEG · 880×560 · Ready for EXIF/ELA/noise + vision analysis",
  blurb: "A doctored/AI-tagged Eiffel Tower fire photo paired with a breaking-news hoax. Inspect real ELA heatmaps, vision anomalies, and the 3-pillar verdict.",
  captions: [
    ["Upload image + claim", "The user attaches a viral Eiffel Tower fire photo and enters the breaking-news claim."],
    ["Image forensics", "VeriFact validates magic bytes, scans EXIF/C2PA/AI metadata, and computes ELA, noise residual, and FFT spectra."],
    ["Vision & provenance", "Vision LLM flags synthetic smoke lighting while web provenance search finds photo debunks."],
    ["Claim verification", "The underlying factual claim is verified across wire, government, and fact-check sources with DeBERTa NLI cross-check."],
    ["3-Pillar Multimodal Verdict", "VeriFact reports separately: Image (Likely AI-Generated), Match (Consistent synthetic scene), and Claim (False)."],
    ["Forensics Lab & Evidence Board", "Toggle Original / ELA Heatmap / Noise Residual and hover sources on the Evidence Board."],
    ["Show the reasoning", "Full transparency: search queries, domain credibility weights, discarded quotes, and NLI scores."],
  ],
  beats: [
    ...homeBeats(2800, 1),
    { cap: 1, ms: 1200, set: { scene: "investigate", events: 2 } },
    { cap: 2, ms: 1600, set: { events: 6 } },
    { cap: 3, ms: 1800, set: { events: 12 } },
    { cap: 3, ms: 1400, set: { events: IMG_AI_EVENTS.length } },
    { cap: 4, ms: 3400, set: { scene: "result" } },
    { cap: 5, ms: 2800, scroll: "top:section[aria-label='Image authenticity and forensics']", say: "The Image Forensics Lab: switch between Original, ELA Heatmap, and Noise Residual alongside EXIF/AI metadata." },
    { cap: 5, ms: 2800, scroll: "end:div:has(> svg[role=img])", set: { hover: "factcheck-desk.example" }, target: node("factcheck-desk.example"), say: "The Evidence Board weighs independent domains; syndicated wire copies count once and unverified quotes are discarded." },
    ...reasoningBeats(6),
  ],
  investigate: (st) => <div className="pt-12"><Investigation events={IMG_AI_EVENTS.slice(0, st.events)} failed={false} /></div>,
};

// ---------- HARDCODED MULTIMODAL 2: Real Photo Used Out of Context ----------
const IMG_OOC_EVENTS: ProgressEvent[] = [
  ev("image_forensics", "done", "880×560 JPEG · EXIF: Canon EOS R6 (2021-07-15) · Forensic risk: low (no manipulation signals)", {}, 2),
  ev("vision", "done", "Visual check: likely_authentic · OCR: 'Cartridge World · SALE' · Claim match: mismatched_context", {}, 5),
  ev("image_provenance", "done", "2 provenance leads · debunked_out_of_context (older UK flood photo reused as Paris)", {}, 8),
  ev("claims", "done", "1 checkworthy claim(s), 0 skipped", {}, 9),
  ev("verify", "done", "False · 3 independent refuting domains (weather agency + fact-checker + wire)", {}, 13),
  ev("fuse", "done", "Image: Likely Authentic · Match: Mismatched / Out of Context · Claim: False", {}, 14),
  ev("done", "done", "Overall: False", {}, 15),
];

const IMG_OOC_SCENARIO: Scenario = {
  id: "img-ooc",
  name: "Image + Claim · Out of Context",
  tag: "Multimodal Featured",
  input: IMG_OOC_CLAIM,
  result: DEMO_IMAGE_OOC_RESULT,
  imageUrl: "/demo/flood-2021-real.jpg",
  imageName: "flood-2021-real.jpg",
  imageMeta: "JPEG · 880×560 · Canon EOS R6 EXIF · Ready for forensics + vision analysis",
  blurb: "A genuine photograph repurposed with a false location/date claim. See VeriFact distinguish an authentic image from a false out-of-context claim.",
  captions: [
    ["Upload image + claim", "An authentic flood photograph is paired with a false breaking claim about Paris today."],
    ["Forensics says real photo", "Canon EOS R6 EXIF (dated 2021) and uniform low ELA confirm the photo itself is unaltered."],
    ["Vision catches mismatch", "OCR reads English 'Cartridge World' & 'SALE' signage — proving the photo is NOT downtown Paris."],
    ["Claim verified False", "Weather bulletins and wire reports confirm no flash flooding in Paris today."],
    ["3-Pillar Verdict", "Image is Likely Authentic, but Image–Claim Match is Mismatched / Out of Context and Claim is False."],
    ["Full reasoning", "Inspect EXIF metadata, provenance leads, and the evidence board."],
  ],
  beats: [
    ...homeBeats(2800, 1),
    { cap: 1, ms: 1400, set: { scene: "investigate", events: 1 } },
    { cap: 2, ms: 1600, set: { events: 3 } },
    { cap: 3, ms: 1800, set: { events: IMG_OOC_EVENTS.length } },
    { cap: 4, ms: 3400, set: { scene: "result" } },
    { cap: 5, ms: 3000, scroll: "top:section[aria-label='Image authenticity and forensics']", say: "Notice: VeriFact honestly marks the image Likely Authentic while catching the out-of-context English shop signs and 2021 EXIF." },
    ...reasoningBeats(5),
  ],
  investigate: (st) => <div className="pt-12"><Investigation events={IMG_OOC_EVENTS.slice(0, st.events)} failed={false} /></div>,
};

// ---------- Text single claim ----------
const EVENTS: ProgressEvent[] = [
  ev("claims", "running", "Extracting atomic claims", {}, 1),
  ev("claims", "done", "1 checkworthy claim(s), 0 skipped", {}, 3),
  ev("queries", "running", `Planning searches: “${DEMO_CLAIM}”`, {}, 3),
  ev("queries", "done", `6 queries (${QUERIES.disconfirming.length} seek disconfirming evidence)`, { queries: [...QUERIES.supporting, ...QUERIES.disconfirming] }, 5),
  ev("search", "running", `Searching sources: “${DEMO_CLAIM}”`, {}, 5),
  ev("search", "done", "16 candidate documents, 2 existing fact-checks", {}, 8),
  ev("read", "running", "Reading 10 documents", {}, 8),
  ev("read", "done", "10 passages ranked · set aside: 1 syndicated copy, 1 satire outlet, 1 off-topic page", {}, 12),
  ev("verify", "running", "Classifying stance of each passage", {}, 12),
  ev("verify", "done", `False · supports ${S} vs refutes ${R} · p = ${P} · 5 independent refuting domains`, {}, 16),
  ev("done", "done", "Overall: False", {}, 16),
];

const SINGLE: Scenario = {
  id: "single", name: "Text · One claim", tag: "Text Pipeline", input: DEMO_CLAIM, result: DEMO_RESULT,
  blurb: `“${DEMO_CLAIM}” traced through retrieval, deduplication, and verbatim-quote stance checks.`,
  captions: [
    ["Paste a claim", "The user pastes a viral claim on the home page."],
    ["Extract & plan", "Claims are extracted and confirming + disconfirming queries are planned."],
    ["Retrieve & rank", "Pages are fetched, deduplicated across wire copies, and reranked."],
    ["Stance & verdict", "Verbatim-quote checks enforce grounding; deterministic rules weigh independent domains."],
    ["Verdict dashboard", "Inspect the Evidence Board and verbatim quotes."],
    ["Show the reasoning", "Queries, weights, discarded sources, and credibility breakdown."],
  ],
  beats: [
    ...homeBeats(2400, 1),
    { cap: 1, ms: 1600, set: { scene: "investigate", events: 4 } },
    { cap: 2, ms: 1800, set: { events: 8 } },
    { cap: 3, ms: 1800, set: { events: EVENTS.length } },
    { cap: 4, ms: 3000, set: { scene: "result" } },
    { cap: 4, ms: 2600, scroll: "end:div:has(> svg[role=img])", set: { hover: "factcheck-desk.example" }, target: node("factcheck-desk.example") },
    ...reasoningBeats(5),
  ],
  investigate: (st) => <div className="pt-12"><Investigation events={EVENTS.slice(0, st.events)} failed={false} /></div>,
};

// ---------- Multi-claim parallel ----------
const MULTI_CAPS = [
  ["Paste a post", "A real-world post mixes three claims and an opinion in one paragraph."],
  ["Fan out in parallel", "Each claim runs concurrently across search, ranking, and stance checks."],
  ["Combined result", "One true and two false claims produce Mixed; the opinion is labelled Not Checkworthy."],
  ["Show the reasoning", "Inspect queries, weights, and discarded sources for every claim."],
] as const;
const capForTick = (t: number) => (t < 3 ? 0 : t < 16 ? 1 : 1);
const MULTI: Scenario = {
  id: "multi", name: "Text · Several claims", tag: "Parallel Pipeline", input: MULTI_POST, result: MULTI_RESULT,
  blurb: "A post with three claims and an opinion verified side by side.",
  captions: MULTI_CAPS,
  beats: [
    ...homeBeats(3600, 1),
    { cap: 1, ms: 900, set: { scene: "investigate", tick: 0 } },
    ...Array.from({ length: LAST_TICK }, (_, k) => ({ cap: capForTick(k + 1), ms: k + 1 === LAST_TICK ? 2000 : TICK_MS, set: { tick: k + 1 }, ...(k + 1 === 3 ? { scroll: "top:#demo-lanes" } : {}) })),
    { cap: 2, ms: 3400, set: { scene: "result" }, say: "Overall: Mixed. One claim is true and two are false; the opinion is labelled, not checked." },
    ...reasoningBeats(3),
  ],
  investigate: (st) => <ParallelInvestigation tick={st.tick} />,
};

const SCENARIOS = [IMG_AI_SCENARIO, IMG_OOC_SCENARIO, SINGLE, MULTI];

const find = (t: string): Element | null => {
  if (t.startsWith("btn:")) return [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t.slice(4))) ?? null;
  if (t.startsWith("text:")) return [...document.querySelectorAll("p")].find((b) => b.textContent?.includes(t.slice(5))) ?? null;
  return document.querySelector(t);
};

export function Demo() {
  const [sc, setSc] = useState<Scenario | null>(null);
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [chars, setChars] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [clickKey, setClickKey] = useState(0);
  const [bare, setBare] = useState(false);
  const [defaultImgTab, setDefaultImgTab] = useState<"original" | "ela" | "noise">("original");
  const beats = sc?.beats ?? IMG_AI_SCENARIO.beats;
  const last = beats.length - 1;
  const b = beats[beat];
  const st = useMemo(() => Object.assign({ ...INITIAL }, ...beats.slice(0, beat + 1).map((x) => x.set ?? {})) as State, [beats, beat]);
  const typeBeat = beats.findIndex((x) => x.type);
  const input = sc?.input ?? "";
  const firstBeatOf = (cap: number) => beats.findIndex((x) => x.cap === cap);
  const prevHover = useRef<string | null>(null);

  // Support direct URL shortcuts: /demo?play=img-ai&view=result&tab=ela&bare=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const playId = params.get("play");
    const view = params.get("view");
    const tab = params.get("tab");
    if (params.get("bare") === "1") setBare(true);
    if (tab === "ela" || tab === "noise" || tab === "original") setDefaultImgTab(tab);
    if (playId) {
      const found = SCENARIOS.find((s) => s.id === playId);
      if (found) {
        setSc(found);
        if (view === "result") {
          const idx = found.beats.findIndex((x) => x.set?.scene === "result");
          setBeat(idx >= 0 ? idx : 0);
          setPlaying(false);
        } else if (view === "investigate") {
          const idxs = found.beats.map((x, i) => (x.set?.events || x.set?.scene === "investigate" ? i : -1)).filter((i) => i >= 0);
          setBeat(idxs.length ? idxs[idxs.length - 1] : 0);
          setPlaying(false);
        } else if (view === "hero") {
          const idx = found.beats.findIndex((x) => x.type);
          setBeat(idx >= 0 ? idx + 1 : 0);
          setPlaying(false);
        } else {
          setBeat(0);
          setPlaying(true);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!sc || !playing || beat >= last) return;
    const id = setTimeout(() => setBeat((n) => n + 1), beats[beat].ms);
    return () => clearTimeout(id);
  }, [sc, playing, beat, last, beats]);

  useEffect(() => {
    if (beat !== typeBeat) { setChars(beat > typeBeat ? input.length : 0); return; }
    setChars(0);
    const id = setInterval(() => setChars((c) => (c >= input.length ? c : c + 1)), (beats[beat].ms * 0.8) / Math.max(input.length, 1));
    return () => clearInterval(id);
  }, [beat, typeBeat, input, beats]);

  useEffect(() => {
    if (!bare) window.scrollTo({ top: 0, behavior: "smooth" });
    if (st.scene !== "result") prevHover.current = null;
  }, [st.scene, bare]);

  useEffect(() => {
    if (!sc || bare) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
    if (b.scroll) later(80, () => {
      const mode = b.scroll!.match(/^(end|top):/)?.[1], el = find(mode ? b.scroll!.slice(mode.length + 1) : b.scroll!);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (mode === "end") window.scrollTo({ top: window.scrollY + r.bottom - (window.innerHeight - 150), behavior: "smooth" });
      else if (mode === "top") window.scrollTo({ top: window.scrollY + r.top - 90, behavior: "smooth" });
      else el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const place = () => {
      const el = b.target ? find(b.target) : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCursor({ x: r.left + Math.min(r.width / 2, el.id === "claim" ? 140 : r.width / 2), y: r.top + Math.min(r.height / 2, 44) });
    };
    later(60, place); later(700, place);
    if (b.click) later(500, () => setClickKey((k) => k + 1));
    later(150, () => {
      if (prevHover.current !== st.hover) {
        if (prevHover.current) find(node(prevHover.current))?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
        if (st.hover) find(node(st.hover))?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        prevHover.current = st.hover;
      }
      const btn = find("btn:the reasoning") as HTMLButtonElement | null;
      if (btn && (btn.getAttribute("aria-pressed") === "true") !== st.reasoning) later(b.click ? 450 : 0, () => btn.click());
    });
    window.addEventListener("scroll", place, { passive: true });
    return () => { timers.forEach(clearTimeout); window.removeEventListener("scroll", place); };
  }, [beat, sc, b, st.hover, st.reasoning, bare]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!sc) return;
      const cap = beats[beat].cap;
      if (e.key === "ArrowRight") { setPlaying(false); setBeat(firstBeatOf(Math.min(cap + 1, sc.captions.length - 1))); }
      if (e.key === "ArrowLeft") { setPlaying(false); setBeat(firstBeatOf(Math.max(cap - 1, 0))); }
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const start = (s: Scenario, mode: "fullscreen" | "window" | "dashboard") => {
    if (mode === "fullscreen") document.documentElement.requestFullscreen?.().catch(() => {});
    setDefaultImgTab("original");
    setCursor(null);
    setSc(s);
    if (mode === "dashboard") {
      const idx = s.beats.findIndex((x) => x.set?.scene === "result");
      setBeat(idx >= 0 ? idx : 0);
      setPlaying(false);
    } else {
      setBeat(0);
      setPlaying(true);
    }
  };
  const jump = (cap: number) => { setPlaying(false); setBeat(firstBeatOf(cap)); };
  const [title, desc] = sc ? sc.captions[b.cap] : ["", ""];

  return (
    <>
      {st.scene === "home" && (
        <Hero
          demo={{
            value: input.slice(0, chars),
            pressed: st.pressed,
            imageUrl: sc?.imageUrl,
            imageName: sc?.imageName,
            imageMeta: sc?.imageMeta,
          }}
        />
      )}
      {sc && st.scene === "investigate" && sc.investigate(st)}
      {sc && st.scene === "result" && (
        <ResultView key={`${sc.id}-${defaultImgTab}`} result={sc.result} events={[]} defaultImageView={defaultImgTab} />
      )}
      {!bare && <div className="h-48" aria-hidden />}

      {sc && !bare && cursor && st.scene !== "investigate" && (
        <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[90]" animate={{ x: cursor.x, y: cursor.y }} transition={{ type: "spring", stiffness: 140, damping: 20 }}>
          <AnimatePresence>{clickKey > 0 && <motion.span key={clickKey} className="absolute -left-5 -top-5 h-10 w-10 rounded-full border-2 border-signal" initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 0.6 }} />}</AnimatePresence>
          <svg width="26" height="30" viewBox="0 0 26 30" className="drop-shadow-[0_2px_6px_rgba(0,0,0,.6)]"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 16 L21 16 Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </motion.div>
      )}

      {!sc && (
        <div className="fixed inset-0 z-[85] grid place-items-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-sm">
          <div className="glass my-6 w-full max-w-4xl rounded-2xl p-6 sm:p-8">
            <p className="label">Hardcoded Interactive Demo · Zero API Keys Required</p>
            <h1 className="mt-2 font-display text-4xl">Explore VeriFact Live</h1>
            <p className="mt-3 text-dim">
              Watch the full guided walkthrough on autopilot, or click <strong className="text-fg">Open Dashboard</strong> to jump straight into the interactive Image + Claim Forensics Lab and Evidence Board.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {SCENARIOS.map((s, n) => (
                <div key={s.id} className="flex flex-col rounded-xl border border-line bg-ink/40 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-signal">{s.tag}</span>
                    {s.imageUrl && <img src={s.imageUrl} alt="" className="h-10 w-16 rounded border border-line object-cover" />}
                  </div>
                  <p className="mt-2 font-display text-2xl">{s.name}</p>
                  <p className="mt-2 flex-1 text-sm text-dim">{s.blurb}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button autoFocus={n === 0} onClick={() => start(s, "dashboard")} className="rounded-lg bg-signal px-3.5 py-2 text-xs font-medium text-ink">
                      Open Dashboard
                    </button>
                    <button onClick={() => start(s, "window")} className="glass rounded-lg px-3.5 py-2 text-xs">
                      ▶ Guided Tour
                    </button>
                    <button onClick={() => start(s, "fullscreen")} className="glass rounded-lg px-3 py-2 text-xs text-dim hover:text-fg">
                      Fullscreen
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <p className="font-mono text-xs text-dim">Shortcuts: ← → jump steps · space pauses · Esc leaves fullscreen</p>
              <Link href="/" className="glass rounded-md px-3 py-1.5 text-xs text-signal">← Back to Live App</Link>
            </div>
          </div>
        </div>
      )}

      {sc && !bare && (
        <div className="fixed inset-x-0 bottom-0 z-[85] p-3 sm:p-4">
          <div className="glass mx-auto max-w-4xl overflow-hidden rounded-2xl shadow-2xl">
            <div className="flex gap-0.5">{sc.captions.map(([t], n) => (
              <button key={t} onClick={() => jump(n)} aria-label={`Step ${n + 1}: ${t}`} className={`h-1 flex-1 ${n <= b.cap ? "bg-signal" : "bg-line"}`} />
            ))}</div>
            <div className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="label">Step {b.cap + 1} / {sc.captions.length} · {sc.name} · hardcoded demo</p>
                <AnimatePresence mode="wait">
                  <motion.div key={`${b.cap}-${b.say ?? ""}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <p className="font-display text-xl">{title}</p>
                    <p className="text-sm text-dim">{b.say ?? desc}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button onClick={() => jump(Math.max(b.cap - 1, 0))} className="glass rounded-md px-3 py-2" aria-label="Previous step">←</button>
                <button onClick={() => { if (beat >= last) { setBeat(0); setPlaying(true); } else setPlaying((p) => !p); }} className="w-20 rounded-md bg-signal px-3 py-2 font-medium text-ink">
                  {beat >= last ? "Replay" : playing ? "Pause" : "Play"}
                </button>
                <button onClick={() => jump(Math.min(b.cap + 1, sc.captions.length - 1))} className="glass rounded-md px-3 py-2" aria-label="Next step">→</button>
                <button onClick={() => { setSc(null); setBeat(0); setCursor(null); window.scrollTo({ top: 0 }); }} className="glass rounded-md px-3 py-2">Demos</button>
                <Link href="/" className="glass rounded-md px-3 py-2" onClick={() => document.fullscreenElement && document.exitFullscreen().catch(() => {})}>Exit</Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
