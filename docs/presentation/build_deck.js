// Builds VeriFact.pptx. Run: cd docs/presentation && npm install && node build_deck.js
// Content mirrors the app and docs: only built/tested things are claimed as built.
const pptxgen = require("pptxgenjs");
const path = require("path");

const SKILL = process.env.PPTX_SKILL_DIR || "";
const OUT = path.join(__dirname, "VeriFact.pptx");

const THEME = {
  name: "VeriFact Ink",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0B0D0C", lt1: "E8ECE4", dk2: "151917", lt2: "A4AEA6",
    accent1: "C6F432", accent2: "5ED6A0", accent3: "FF6B57", accent4: "FFB83C", accent5: "2E3531", accent6: "7E8A81",
    hlink: "C6F432", folHlink: "A4AEA6",
  },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
pres.title = "VeriFact: Evidence-Grounded Misinformation Detection";
pres.author = "VeriFact";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const MONO = "Courier New";
const MX = 0.7; // side margin
const CW = 13.333 - 2 * MX; // content width

// ---- layouts ----
pres.defineSlideMaster({
  title: "DARK", background: { color: C.text1 },
  objects: [
    { text: { text: "VeriFact · Evidence-grounded verification", options: { x: MX, y: 6.95, w: 7, h: 0.3, fontFace: MONO, fontSize: 11, color: C.accent6, margin: 0 } } },
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.95, w: CW, h: 0.85, fontSize: 36, bold: true, color: C.background1, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 11.6, y: 6.95, w: 1.03, h: 0.3, fontFace: MONO, fontSize: 11, color: C.accent6, align: "right" },
});
pres.defineSlideMaster({
  title: "COVER", background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 2.2, w: 9, h: 1.8, fontSize: 96, color: C.background1, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "LIME", background: { color: C.accent1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 1.7, w: 11.6, h: 2.6, fontSize: 60, color: C.text1, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 11.6, y: 6.95, w: 1.03, h: 0.3, fontFace: MONO, fontSize: 11, color: C.text1, align: "right" },
});
pres.defineSlideMaster({
  title: "LIGHT", background: { color: C.background1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 1.9, w: 11.6, h: 1.9, fontSize: 66, color: C.text1, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 11.6, y: 6.95, w: 1.03, h: 0.3, fontFace: MONO, fontSize: 11, color: C.text2, align: "right" },
});

// ---- helpers ----
function section(title) { pres.addSection({ title }); }
function newSlide(master, sectionTitle, notes) {
  const s = pres.addSlide({ masterName: master, sectionTitle });
  if (notes) s.addNotes(notes);
  return s;
}
function eyebrow(s, text, color = C.accent1, y = 0.55) {
  s.addText(text.toUpperCase(), { x: MX, y, w: 8, h: 0.3, fontFace: MONO, fontSize: 12, charSpacing: 3, color, margin: 0, isTextBox: true, objectName: "Eyebrow" });
}
function card(s, x, y, w, h, o = {}) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: C.text2 }, line: { color: o.accent ? C.accent1 : C.accent5, width: o.accent ? 2 : 1 }, objectName: o.name || "Card" });
}
function textBlock(s, x, y, w, h, runs, o = {}) {
  s.addText(runs, { x, y, w, h, margin: 0, valign: o.valign || "top", isTextBox: true, fontFace: o.fontFace, objectName: o.name || "Text" });
}
function cardWithText(s, x, y, w, h, title, body, o = {}) {
  card(s, x, y, w, h, o);
  const pad = 0.25;
  s.addText([
    { text: title, options: { fontSize: o.titleSize || 18, bold: true, color: o.titleColor || C.background1, breakLine: true } },
    { text: body, options: { fontSize: o.bodySize || 14, color: C.background2, paraSpaceBefore: 5 } },
  ], { x: x + pad, y: y + pad * 0.8, w: w - 2 * pad, h: h - pad * 1.6, margin: 0, valign: "top", isTextBox: true, objectName: "Card text" });
}
function line(s, x1, y1, x2, y2, color, width = 1.25) {
  s.addShape(pres.ShapeType.line, {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    flipV: (x2 - x1) * (y2 - y1) < 0, line: { color, width }, objectName: "Link",
  });
}

// =========================================================
// 1. Cover
section("Problem and idea");
{
  const s = newSlide("COVER", "Problem and idea",
    "Opening. VeriFact checks claims and links against real evidence instead of asking a chatbot to guess. Fill in the bracketed line with your name, course and date. Plan for about 12 to 15 minutes: problem, idea, architecture, how a verdict is computed, what is built, how it is evaluated, limitations, then a live demo.");
  s.addShape(pres.ShapeType.ellipse, { x: 10.6, y: 0.7, w: 2.0, h: 2.0, fill: { color: C.accent1 }, line: { type: "none" }, objectName: "Signal dot" });
  eyebrow(s, "Investigative verification lab", C.accent1, 1.6);
  s.addText("VeriFact", { placeholder: "title" });
  textBlock(s, MX, 4.1, 11, 0.7, [{ text: "Evidence-grounded misinformation detection", options: { fontSize: 30, color: C.background1, fontFace: THEME.headFontFace } }], { name: "Subtitle" });
  textBlock(s, MX, 4.95, 9.5, 0.9, [{ text: "Retrieval-first verification of claims and links, where every verdict traces back to the sources that produced it.", options: { fontSize: 18, color: C.background2 } }], { name: "Tagline" });
  textBlock(s, MX, 6.75, 10, 0.3, [{ text: "[Presenter name] · [Course] · [Date]", options: { fontSize: 12, color: C.accent6, fontFace: MONO } }], { name: "Presenter" });
}

// 2. Problem
{
  const s = newSlide("DARK", "Problem and idea",
    "Motivation. Three failure modes motivate the project. First, general chatbots answer from memory, so a confident answer has no checkable source. Second, human fact-checkers are accurate but cannot keep up with volume. Third, a single opaque score tells the reader nothing about the reasoning. VeriFact is designed around the opposite: show the work. Keep this slide to about a minute, and do not quote statistics unless you have a source for them.");
  eyebrow(s, "The problem");
  s.addText("Fluent is not the same as true", { placeholder: "title" });
  const items = [
    ["01", "Chatbots answer from memory", "Ask a language model whether something is true and it replies with confidence, but gives no source you can check."],
    ["02", "Human fact-checks do not scale", "Professional reviews are careful but slow, and a claim can travel widely before one is published."],
    ["03", "A bare score hides the work", "A label like \"87% fake\" does not show what was read, what was ignored, or how much each source counted."],
  ];
  const w = (CW - 2 * 0.3) / 3;
  items.forEach(([n, t, b], i) => {
    const x = MX + i * (w + 0.3);
    card(s, x, 2.1, w, 3.6);
    s.addText([
      { text: n, options: { fontFace: MONO, fontSize: 14, color: C.accent3, breakLine: true } },
      { text: t, options: { fontSize: 24, bold: true, color: C.background1, fontFace: THEME.headFontFace, breakLine: true, paraSpaceBefore: 10 } },
      { text: b, options: { fontSize: 18, color: C.background2, paraSpaceBefore: 12 } },
    ], { x: x + 0.3, y: 2.4, w: w - 0.6, h: 3.1, margin: 0, valign: "top", isTextBox: true, objectName: "Problem card text" });
  });
}

// 3. Core idea (lime statement)
{
  const s = newSlide("LIME", "Problem and idea",
    "The central design principle. The language model is used as a reader, not as a source of facts: it labels each retrieved passage as supporting, refuting or neutral, and must quote the passage. The verdict itself comes from explicit rules over weighted evidence, so it can be inspected and unit-tested. If evidence is thin or conflicting, the system says Unverifiable or Disputed instead of forcing True or False.");
  eyebrow(s, "The core idea", C.text1, 0.95);
  s.addText("Models read evidence. Rules decide.", { placeholder: "title" });
  textBlock(s, MX, 4.6, 10.4, 1.4, [{ text: "The language model never answers from memory. It only reads passages we retrieved, and a deterministic, testable rule turns that evidence into a verdict.", options: { fontSize: 22, color: C.text1 } }], { name: "Idea body" });
}

// 4. Architecture
section("How it works");
{
  const s = newSlide("DARK", "How it works",
    "Walk left to right. The browser posts a claim or URL to the FastAPI backend, which stores a row and enqueues a job in Redis. A worker runs the pipeline and calls three kinds of dependencies: an LLM provider for structured reasoning only, evidence sources for retrieval, and an optional ML service for neural reranking and image forensics. Progress events are written to PostgreSQL and streamed to the browser using server-sent events; because the log is persisted, refreshing the page replays it. For local development the same code runs with SQLite and in-process jobs. The full diagram is on the Architecture page of the app.");
  eyebrow(s, "System architecture");
  s.addText("Four layers, one audit trail", { placeholder: "title" });
  const top = [["Next.js UI", "live view · board", true], ["FastAPI", "REST + SSE", true], ["Redis queue", "Arq jobs", false], ["Worker", "pipeline", true]];
  const bw = 2.55, gap = (CW - 4 * bw) / 3;
  top.forEach(([t, sub, acc], i) => {
    const x = MX + i * (bw + gap);
    card(s, x, 2.1, bw, 1.15, { accent: acc });
    s.addText([
      { text: t, options: { fontSize: 18, bold: true, color: C.background1, breakLine: true } },
      { text: sub, options: { fontSize: 12, fontFace: MONO, color: C.background2, paraSpaceBefore: 4 } },
    ], { x: x + 0.2, y: 2.25, w: bw - 0.4, h: 0.85, margin: 0, valign: "middle", isTextBox: true, objectName: "Flow box text" });
    if (i < 3) s.addShape(pres.ShapeType.rightArrow, { x: x + bw + (gap - 0.4) / 2, y: 2.55, w: 0.4, h: 0.25, fill: { color: C.accent1 }, line: { type: "none" }, objectName: "Flow arrow" });
  });
  textBlock(s, MX, 3.55, 6, 0.3, [{ text: "THE WORKER CALLS", options: { fontFace: MONO, fontSize: 12, charSpacing: 3, color: C.accent6 } }], { name: "Section label" });
  const low = [["LLM providers", "Groq (free default), Anthropic, OpenAI. Structured JSON only."], ["Evidence sources", "DuckDuckGo/Bing, GDELT, Wikipedia, PubMed, Crossref, publisher pages."], ["ML service", "Cross-encoder rerank, NLI, image forensics. Optional."]];
  const lw = (CW - 2 * 0.3) / 3;
  low.forEach(([t, b], i) => cardWithText(s, MX + i * (lw + 0.3), 3.95, lw, 1.6, t, b, { bodySize: 15 }));
  textBlock(s, MX, 5.9, CW, 0.7, [{ text: "Every progress event is stored in the database and replayed over SSE, so a page refresh or worker restart loses nothing.", options: { fontSize: 16, color: C.background1 } }], { name: "Architecture note" });
}

// 5. Pipeline
{
  const s = newSlide("DARK", "How it works",
    "Step through the nine stages briefly; do not read every card. Highlights worth saying out loud: claims must quote a span of the input so they are tied to what the user wrote; queries deliberately include ones that look for refuting evidence, to reduce confirmation bias; syndicated copies of one wire story are clustered with a shingle-overlap test so one report is one vote; and stance is judged only against retrieved text. Steps 1 to 9 are implemented and tested for text and URL input. Image, audio and video are not yet part of this flow.");
  eyebrow(s, "The pipeline");
  s.addText("From input to verdict in nine steps", { placeholder: "title" });
  const steps = [
    ["01", "Ingest", "SSRF-safe fetch of text or a URL"], ["02", "Extract claims", "Atomic, checkworthy, tied to a source span"], ["03", "Plan queries", "Confirming and disconfirming searches"],
    ["04", "Retrieve", "Search, news, Wikipedia, PubMed, Crossref"], ["05", "Read and rank", "Best passage per page, BM25 then cross-encoder"], ["06", "Deduplicate", "A syndicated story counts only once"],
    ["07", "Judge stance", "Supports, refutes or neutral, with a verbatim quote"], ["08", "Weigh sources", "Transparent rule-based credibility prior"], ["09", "Aggregate", "Rule-based verdict, or Unverifiable"],
  ];
  const w = (CW - 2 * 0.25) / 3, h = 1.4;
  steps.forEach(([n, t, b], i) => {
    const x = MX + (i % 3) * (w + 0.25), y = 2.0 + Math.floor(i / 3) * (h + 0.2);
    card(s, x, y, w, h, { accent: i === 8 });
    s.addText([
      { text: n + "  ", options: { fontFace: MONO, fontSize: 13, color: C.accent1 } },
      { text: t, options: { fontSize: 19, bold: true, color: C.background1, breakLine: true } },
      { text: b, options: { fontSize: 14, color: C.background2, paraSpaceBefore: 6 } },
    ], { x: x + 0.25, y: y + 0.2, w: w - 0.5, h: h - 0.35, margin: 0, valign: "top", isTextBox: true, objectName: "Step text" });
  });
}

// 6. Guardrails
{
  const s = newSlide("DARK", "How it works",
    "These are behaviours of the code, each covered by a test, not just design intentions. The verbatim-quote rule is the most important: language models can invent plausible justifications, so any supports or refutes judgement whose quoted text is not actually found in the passage is thrown away and not counted. The stricter threshold for health, elections and violence reflects the higher cost of a wrong confident answer there. Mention that the quote check catches fabricated quotes but cannot catch a genuine misreading of a real quote.");
  eyebrow(s, "Trust and safety");
  s.addText("Guardrails enforced in code", { placeholder: "title" });
  const g = [
    ["No answers from memory", "The model only reads passages we retrieved."], ["Quotes must be real", "A stance is discarded unless its quote appears verbatim in the passage."],
    ["No forced verdicts", "Thin or conflicting evidence ends as Unverifiable or Disputed."], ["Stricter when it matters", "Health, election and violence claims need three independent domains."],
    ["Honest confidence", "Computed from agreement and source weight, and labelled uncalibrated."], ["Limits travel with results", "Every result lists what could not be verified."],
  ];
  const w = (CW - 0.3) / 2, h = 1.4;
  g.forEach(([t, b], i) => cardWithText(s, MX + (i % 2) * (w + 0.3), 2.0 + Math.floor(i / 2) * (h + 0.2), w, h, t, b, { titleColor: C.accent1, titleSize: 20, bodySize: 15 }));
}

// 7. Verdict computation
function styledTable(s, rows, o) {
  const cell = (t, i, j) => ({ text: t, options: {
    fontSize: o.fontSize || 15, bold: i === 0, color: i === 0 ? C.accent1 : C.background1, fill: { color: i === 0 ? C.text1 : C.text2 },
    border: [{ type: "none" }, { type: "none" }, { pt: 1, color: C.accent5 }, { type: "none" }], valign: "middle", margin: [0.06, 0.12, 0.06, 0.12], fontFace: j === 0 || !o.mono ? undefined : MONO } });
  s.addTable(rows.map((r, i) => r.map((t, j) => cell(t, i, j))), { x: o.x, y: o.y, w: o.w, colW: o.colW, rowH: o.rowH, objectName: o.name || "Table" });
}
{
  const s = newSlide("DARK", "How it works",
    "This is the exact logic in the aggregation module, with the same constants. Each counted source gets a weight from its credibility prior and its relevance to the claim, halved if the evidence describes a different time period. The share of weighted support p then maps to a verdict. Before that mapping, gates apply: enough independent domains, enough total weight, and a check for genuine conflict. The confidence number is an evidence-strength score that grows with agreement and total weight; it is labelled uncalibrated because it has not yet been fitted on held-out data. Be ready for the question of why these thresholds: they are reasoned defaults, not tuned on a benchmark yet, and tuning them is part of the evaluation milestone.");
  eyebrow(s, "Aggregation");
  s.addText("How a verdict is computed", { placeholder: "title" });
  card(s, MX, 2.0, 6.1, 2.2);
  s.addText([
    { text: "WEIGHT OF EACH SOURCE", options: { fontFace: MONO, fontSize: 12, color: C.accent6, breakLine: true } },
    { text: "credibility × (0.5 + 0.5 × relevance)", options: { fontFace: MONO, fontSize: 16, color: C.accent1, breakLine: true, paraSpaceBefore: 4 } },
    { text: "SHARE OF SUPPORT", options: { fontFace: MONO, fontSize: 12, color: C.accent6, breakLine: true, paraSpaceBefore: 16 } },
    { text: "p = support / (support + refute)", options: { fontFace: MONO, fontSize: 16, color: C.accent1, paraSpaceBefore: 4 } },
  ], { x: MX + 0.3, y: 2.25, w: 5.5, h: 1.8, margin: 0, valign: "top", isTextBox: true, objectName: "Formulas" });
  s.addText([
    { text: "At least 2 independent domains (3 for sensitive topics)", options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Total weight of at least 0.9", options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Strong disagreement gives Disputed, with no confidence number", options: { bullet: true } },
  ], { x: MX, y: 4.5, w: 6.1, h: 2.1, fontSize: 16, color: C.background1, margin: 0, valign: "top", isTextBox: true, objectName: "Gates" });
  styledTable(s, [["Support share p", "Verdict"], ["0.85 or more", "True"], ["0.65 to 0.85", "Mostly True"], ["0.35 to 0.65", "Mixed"], ["0.15 to 0.35", "Mostly False"], ["0.15 or less", "False"]],
    { x: 7.3, y: 2.0, w: 5.33, colW: [2.9, 2.43], rowH: 0.62, fontSize: 17, name: "Verdict table" });
}

// 8. Built
section("Status and honesty");
{
  const s = newSlide("DARK", "Status and honesty",
    "Numbers here come from real runs: 26 backend tests (plus one live test that skips without keys), 6 offline ml-service tests plus 2 that load real model weights, and 5 eval-metric tests, which is 39 in total. The two neural models are a MiniLM cross-encoder for reranking and a DeBERTa NLI model; the tests confirm the reranker prefers the relevant passage and the NLI model separates entailment from contradiction. The five keyless sources checked live are Wikipedia, PubMed, GDELT, DuckDuckGo/Bing and direct page fetch. Be clear that these tests show the components behave correctly, not that the whole system is accurate: accuracy is a separate question on the evaluation slide. Update the counts if you add tests before presenting.");
  eyebrow(s, "Implementation status");
  s.addText("What is built and tested", { placeholder: "title" });
  const stats = [["39", "automated tests passing across three codebases"], ["2", "neural models checked on real downloaded weights"], ["5", "keyless evidence sources checked against live services"], ["3", "LLM providers behind one interface, Groq free by default"]];
  const w = (CW - 3 * 0.3) / 4;
  stats.forEach(([n, l], i) => {
    const x = MX + i * (w + 0.3);
    s.addShape(pres.ShapeType.rect, { x, y: 2.0, w, h: 0.04, fill: { color: C.accent1 }, line: { type: "none" }, objectName: "Stat rule" });
    s.addText([
      { text: n, options: { fontFace: THEME.headFontFace, fontSize: 54, color: C.accent1, breakLine: true } },
      { text: l, options: { fontSize: 14, color: C.background2, paraSpaceBefore: 2 } },
    ], { x, y: 2.15, w, h: 1.8, margin: 0, valign: "top", isTextBox: true, objectName: "Stat" });
  });
  const cards = [["Backend", "Nine-stage pipeline, source adapters, SSRF-safe fetcher, schema-validated LLM layer, SSE progress."], ["ML service", "Cross-encoder reranker, DeBERTa NLI, and error-level and noise image forensics."], ["Eval harness", "Precision, recall, F1, AUROC and ECE, plus a runner that drives the real pipeline."]];
  const cw = (CW - 2 * 0.3) / 3;
  cards.forEach(([t, b], i) => cardWithText(s, MX + i * (cw + 0.3), 4.3, cw, 1.9, t, b, { bodySize: 16, titleSize: 20 }));
}

// 9. Interface
{
  const s = newSlide("DARK", "Status and honesty",
    "The sketch on the right shows how the Evidence Board encodes information: the claim sits in the centre; supporting sources are circles with a plus, refuting sources are diamonds with a minus, neutral sources are dashed circles, and node size reflects the credibility prior. Stance is carried by shape and symbol as well as colour, so it is readable for colour-blind users. In the live demo, hover a node to see the exact excerpt and click through to the source. The Show the reasoning toggle reveals the queries, the weights, and every discarded source with the reason it was discarded. This sketch is an illustration of the design, not a screenshot of a real result.");
  eyebrow(s, "The interface");
  s.addText("The reasoning is on screen", { placeholder: "title" });
  const items = [["Live investigation", "Real pipeline events, not timers."], ["Evidence Board", "Stance by shape, size by credibility, exact excerpt on hover."], ["Verdict card", "Evidence strength, plus what we could not verify."], ["Show the reasoning", "Queries run and sources discarded, with reasons."], ["Model toggle", "Free Groq, or paid Anthropic and OpenAI."]];
  items.forEach(([t, b], i) => {
    const y = 2.0 + i * 0.95;
    s.addShape(pres.ShapeType.rect, { x: MX, y, w: 0.05, h: 0.75, fill: { color: C.accent1 }, line: { type: "none" }, objectName: "Item marker" });
    s.addText([
      { text: t, options: { fontSize: 18, bold: true, color: C.background1, breakLine: true } },
      { text: b, options: { fontSize: 14, color: C.background2, paraSpaceBefore: 2 } },
    ], { x: MX + 0.25, y, w: 6.2, h: 0.78, margin: 0, valign: "middle", isTextBox: true, objectName: "Interface item" });
  });
  // evidence board sketch
  const cx = 10.2, cy = 4.35;
  [[1.0, 1.0], [2.15, 2.15]].forEach(([rx, ry]) => s.addShape(pres.ShapeType.ellipse, { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, fill: { type: "none" }, line: { color: C.accent5, width: 1, dashType: "dash" }, objectName: "Orbit" }));
  const nodes = [
    { x: cx, y: cy - 2.15, k: "sup", r: 0.3 }, { x: cx + 1.85, y: cy - 1.1, k: "sup", r: 0.25 }, { x: cx + 1.9, y: cy + 1.0, k: "ref", r: 0.28 },
    { x: cx, y: cy + 2.15, k: "ref", r: 0.28 }, { x: cx - 1.85, y: cy + 1.1, k: "sup", r: 0.27 }, { x: cx - 1.9, y: cy - 1.05, k: "neu", r: 0.22 },
  ];
  const col = { sup: C.accent2, ref: C.accent3, neu: C.background2 };
  nodes.forEach((n) => line(s, cx, cy, n.x, n.y, col[n.k]));
  s.addShape(pres.ShapeType.ellipse, { x: cx - 0.5, y: cy - 0.5, w: 1.0, h: 1.0, fill: { color: C.text2 }, line: { color: C.accent1, width: 2.5 }, objectName: "Claim node" });
  s.addText("CLAIM", { x: cx - 0.5, y: cy - 0.5, w: 1.0, h: 1.0, align: "center", valign: "middle", fontFace: MONO, fontSize: 11, charSpacing: 2, color: C.accent1, margin: 0, isTextBox: true, objectName: "Claim label" });
  nodes.forEach((n) => {
    const o = { x: n.x - n.r, y: n.y - n.r, w: 2 * n.r, h: 2 * n.r };
    if (n.k === "sup") { s.addShape(pres.ShapeType.ellipse, { ...o, fill: { color: C.accent2, transparency: 70 }, line: { color: C.accent2, width: 2 }, objectName: "Supporting source" }); s.addText("+", { ...o, align: "center", valign: "middle", fontSize: 18, bold: true, color: C.accent2, margin: 0, isTextBox: true, objectName: "Plus mark" }); }
    if (n.k === "ref") { s.addShape(pres.ShapeType.diamond, { ...o, fill: { color: C.accent3, transparency: 70 }, line: { color: C.accent3, width: 2 }, objectName: "Refuting source" }); s.addText("−", { ...o, align: "center", valign: "middle", fontSize: 18, bold: true, color: C.accent3, margin: 0, isTextBox: true, objectName: "Minus mark" }); }
    if (n.k === "neu") s.addShape(pres.ShapeType.ellipse, { ...o, fill: { type: "none" }, line: { color: C.background2, width: 1.5, dashType: "dash" }, objectName: "Neutral source" });
  });
}

// 10. Decisions
{
  const s = newSlide("DARK", "Status and honesty",
    "Each row is a trade-off the professor may probe. Rules versus an LLM judge: rules are transparent and testable but cannot weigh nuance. Free-first stack: the project must run with no spending, so it uses Groq's free tier and keyless sources, accepting rate limits and an unofficial DuckDuckGo endpoint that can fail; paid providers such as Anthropic and OpenAI remain in the code behind the model toggle. A separate ML service keeps torch and model weights out of the API image and the pipeline falls back to BM25 when it is absent. The quote check stops fabricated justifications but not misreadings. The BM25 anecdote is a real finding from testing: BM25Okapi produces non-positive IDF on tiny pools, so we switched to BM25Plus.");
  eyebrow(s, "Design decisions");
  s.addText("Choices and their costs", { placeholder: "title" });
  styledTable(s, [
    ["Decision", "Why", "Cost"],
    ["Rules decide the verdict", "Inspectable and unit-testable", "Less flexible than an LLM judge"],
    ["Free-first stack: Groq and keyless sources", "Reproducible with no budget", "Rate limits; unofficial search endpoint"],
    ["Separate ML service", "Heavy dependencies stay out of the API", "An extra container; BM25 fallback"],
    ["Verbatim-quote check", "Blocks invented justifications", "Cannot catch a real quote misread"],
  ], { x: MX, y: 2.0, w: CW, colW: [4.0, 4.1, 3.83], rowH: 0.62, fontSize: 16, name: "Decisions table" });
  textBlock(s, MX, 5.6, 11.3, 0.9, [{ text: "One bug found along the way: the standard BM25 variant gave zero scores on small candidate pools, so ranking was silently dead until a test exposed it.", options: { fontSize: 16, color: C.background2 } }], { name: "Bug note" });
}

// 11. Evaluation
{
  const s = newSlide("DARK", "Status and honesty",
    "This is the honest slide, and it is a strength to say it plainly. The evaluation tooling exists and is unit-tested against hand-computed values: per-class precision, recall and F1, macro-F1, AUROC, expected calibration error and reliability bins. The runner submits each labelled claim to the live API, so it measures the real system, and it treats Unverifiable, Disputed and failures as a separate no-verdict class so refusing to answer is measured rather than hidden. What has not happened is an actual benchmark run, so there is no accuracy to report. If you manage to run even a small LIAR sample before presenting, replace the banner with the real numbers and state the sample size and the caveats: LIAR labels are noisy, live web retrieval drifts over time and can leak answers, and the confidence score is still uncalibrated.");
  eyebrow(s, "Evaluation");
  s.addText("What we can and cannot claim", { placeholder: "title" });
  const w = (CW - 0.3) / 2;
  const bl = (arr) => arr.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < arr.length - 1, paraSpaceAfter: 6 } }));
  [["Ready", C.accent2, ["Precision, recall, macro-F1 and AUROC", "Calibration: ECE and reliability bins", "Runner that sends labelled claims through the real pipeline", "\"No verdict\" counted as its own class"]],
   ["Not yet done", C.accent4, ["A benchmark run (LIAR first, then FEVER)", "Calibrated confidence on a held-out split", "Media benchmarks for images, video and audio", "Threshold tuning against real results"]]].forEach(([t, c, arr], i) => {
    const x = MX + i * (w + 0.3);
    card(s, x, 2.0, w, 2.9);
    s.addText([{ text: t, options: { fontSize: 22, bold: true, color: c, breakLine: true, paraSpaceAfter: 8 } }, ...bl(arr).map((r) => ({ text: r.text, options: { ...r.options, fontSize: 16, color: C.background1 } }))],
      { x: x + 0.3, y: 2.2, w: w - 0.6, h: 2.5, margin: 0, valign: "top", isTextBox: true, objectName: t + " list" });
  });
  s.addShape(pres.ShapeType.roundRect, { x: MX, y: 5.3, w: CW, h: 0.9, rectRadius: 0.12, fill: { color: C.accent1 }, line: { type: "none" }, objectName: "Honesty banner" });
  s.addText("No accuracy numbers are quoted here, because none have been measured yet.", { x: MX + 0.3, y: 5.3, w: CW - 0.6, h: 0.9, fontSize: 20, bold: true, color: C.text1, valign: "middle", margin: 0, isTextBox: true, objectName: "Honesty banner text" });
}

// 12. Limitations
{
  const s = newSlide("DARK", "Status and honesty",
    "Present these directly; they are also listed in the app's Known limitations page. One more point worth making verbally: submitted text is sent to the chosen LLM provider and to search engines as queries, so confidential material should not be submitted. Unverifiable is a deliberate outcome for fresh or poorly covered events: it means the retrieved evidence was insufficient, not that the claim is false. The image forensics available in the ML service, error-level analysis and noise residuals, are indicators only and each result carries its own limitation text.");
  eyebrow(s, "Limitations");
  s.addText("Known weaknesses", { placeholder: "title" });
  const L = ["Confidence is a heuristic, not a probability.", "Credibility uses rule-based priors, not licensed ratings.", "Stance is judged by an LLM on short passages; free models are weaker.", "Free web search is unofficial and can fail or skew.", "Images, video and audio are not yet in the live flow.", "Live-web evaluation drifts over time and can leak answers."];
  const w = (CW - 0.3) / 2, h = 1.3;
  L.forEach((t, i) => {
    const x = MX + (i % 2) * (w + 0.3), y = 2.0 + Math.floor(i / 2) * (h + 0.2);
    card(s, x, y, w, h);
    s.addText([{ text: String(i + 1).padStart(2, "0") + "   ", options: { fontFace: MONO, fontSize: 14, color: C.accent4 } }, { text: t, options: { fontSize: 18, color: C.background1 } }],
      { x: x + 0.3, y, w: w - 0.6, h, margin: 0, valign: "middle", isTextBox: true, objectName: "Limitation" });
  });
}

// 13. Roadmap
section("Next");
{
  const s = newSlide("DARK", "Next",
    "The status words match the in-app Architecture page. Milestone 1 is built for text and URLs. For images, the ML service already has error-level analysis and noise-residual forensics with tests, but they are not yet wired into the upload flow, reverse image search, OCR or provenance checks. Audio, video, cross-modal fusion and calibration are future work. The immediate next steps are to run a first small benchmark, calibrate the confidence on a held-out split, and then build the end-to-end image flow.");
  eyebrow(s, "Roadmap");
  s.addText("Seven milestones, honestly staged", { placeholder: "title" });
  styledTable(s, [
    ["#", "Milestone", "Status"],
    ["1", "Text and URL pipeline with evidence UI", "● Built"],
    ["2", "Image pipeline", "◐ Partial: ELA and noise forensics"],
    ["3", "Audio and video", "○ Planned"],
    ["4", "Fusion and calibration", "○ Planned"],
    ["5", "Evaluation runs", "◐ Tooling built, runs pending"],
    ["6", "Interface polish", "◐ Partial"],
    ["7", "Hardening: rate limits, retention, auth", "○ Planned"],
  ], { x: MX, y: 2.0, w: CW, colW: [0.9, 6.4, 4.63], rowH: 0.52, fontSize: 17, name: "Roadmap table" });
}

// 14. Demo / closing
{
  const s = newSlide("LIGHT", "Next",
    "Switch to the running app. Suggested order: one well-debunked claim to show the live steps, the Evidence Board and the Show the reasoning panel; one obscure claim that should end Unverifiable, to show the system declining to guess; a health claim to show the stricter threshold; then flip the model toggle to a paid provider to show the not-configured state. Do a dry run beforehand and keep the saved result links as a fallback, because the free LLM tier is rate-limited. Then open the Architecture page and take questions.");
  eyebrow(s, "Live demo", C.text2, 1.2);
  s.addText("Claim in, evidence out.", { placeholder: "title" });
  textBlock(s, MX, 4.1, 10.5, 0.9, [{ text: "Watch the pipeline run, open the evidence, and read the reasoning behind the verdict.", options: { fontSize: 22, color: C.text2 } }], { name: "Demo body" });
  textBlock(s, MX, 5.3, 8, 0.8, [{ text: "Questions?", options: { fontSize: 36, color: C.text1, fontFace: THEME.headFontFace } }], { name: "Questions" });
  textBlock(s, MX, 6.75, 10, 0.3, [{ text: "[Repository link or contact]", options: { fontSize: 12, fontFace: MONO, color: C.text2 } }], { name: "Contact" });
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  const { applyTheme } = require(path.join(SKILL, "scripts", "apply_theme.js"));
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
