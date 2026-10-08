export type Status = "built" | "partial" | "planned";

export const STATUS_LABEL: Record<Status, { glyph: string; text: string; cls: string }> = {
  built: { glyph: "●", text: "Built & tested", cls: "text-sup border-sup" },
  partial: { glyph: "◐", text: "Partial", cls: "text-amber border-amber" },
  planned: { glyph: "○", text: "Planned", cls: "text-dim border-line" },
};

export const PIPELINE: { n: string; title: string; does: string; where: string; status: Status; note?: string }[] = [
  { n: "01", title: "Ingest", does: "Accept text or a URL. URLs are fetched through an SSRF-safe client (public IPs only, every redirect re-validated, size/time caps) and reduced to article text with author and date.", where: "backend/app/retrieval/fetch.py · security.py", status: "built", note: "Paywalls are reported as failures, never bypassed." },
  { n: "02", title: "Extract claims", does: "LLM with a strict JSON schema splits input into atomic, decontextualised claims, labelling opinions and predictions as not checkworthy. Each claim must quote a span of the input.", where: "pipeline/orchestrator.py · prompts.py", status: "built" },
  { n: "03", title: "Plan queries", does: "For every claim, confirming queries and separate disconfirming queries (debunks, corrections, official data). Non-English claims also get English queries.", where: "pipeline/prompts.py", status: "built" },
  { n: "04", title: "Retrieve", does: "Fan-out in parallel: DuckDuckGo/Bing, GDELT, Wikipedia, PubMed, Crossref always; Tavily/Brave and Google Fact Check when keys exist. Failures are recorded as notes, never papered over.", where: "retrieval/adapters.py", status: "built" },
  { n: "05", title: "Read & rank", does: "Fetch pages, chunk into ~110-word passages, pick the best passage per document (BM25-Plus), optionally re-scored by a cross-encoder from the ml-service.", where: "pipeline/evidence.py · retrieval/mlclient.py", status: "built", note: "Cross-encoder verified against real weights; BM25 is the fallback and is labelled in the UI." },
  { n: "06", title: "Deduplicate", does: "Near-duplicate texts (shingle Jaccard ≥ 0.5) form a syndication group; only the most credible copy counts, so one wire story is one vote.", where: "pipeline/evidence.py", status: "built" },
  { n: "07", title: "Judge stance", does: "LLM reads only the retrieved passage → supports / refutes / neutral + a verbatim quote. If the quote is not found in the passage, the judgement is discarded.", where: "orchestrator.py · evidence.quote_in_passage", status: "built", note: "A dedicated NLI model (DeBERTa) is served by the ml-service but not yet wired into the verdict." },
  { n: "08", title: "Weigh credibility", does: "Transparent rule-based prior per domain (wire, fact-checker, government, scholarly, satire…), HTTPS, recency, primary-source flag. Full breakdown shown per source.", where: "retrieval/credibility.py", status: "partial", note: "No MBFC/NewsGuard data, no WHOIS domain age." },
  { n: "09", title: "Aggregate", does: "Deterministic rules over weighted evidence. Needs several independent domains (more for health/election/violence) or the result is Unverifiable. Conflict → Disputed/Mixed with no single confidence.", where: "pipeline/aggregate.py", status: "built", note: "Confidence is an uncalibrated heuristic and labelled so." },
  { n: "10", title: "Fuse & calibrate", does: "Combine text verdicts with media forensics and provenance; fit temperature/Platt/isotonic on a held-out set.", where: "—", status: "planned" },
];

export const MODULES: { area: string; item: string; status: Status; detail: string }[] = [
  { area: "Inputs", item: "Text / claim / post", status: "built", detail: "20k character limit" },
  { area: "Inputs", item: "URL", status: "built", detail: "SSRF-safe, paywall-aware" },
  { area: "Inputs", item: "Image upload", status: "partial", detail: "ELA + noise residual endpoints exist in the ml-service; not yet wired into the UI/job flow" },
  { area: "Inputs", item: "Video / audio", status: "planned", detail: "Whisper, keyframes, deepfake & anti-spoof detectors" },
  { area: "LLM", item: "Groq (free)", status: "built", detail: "JSON mode + schema in prompt, Pydantic validation + retry, 429 back-off" },
  { area: "LLM", item: "Anthropic / OpenAI", status: "partial", detail: "Code present; never run live (no key yet)" },
  { area: "Evidence", item: "DuckDuckGo/Bing, GDELT, Wikipedia, PubMed, Crossref", status: "built", detail: "Keyless; verified against live services" },
  { area: "Evidence", item: "Tavily, Brave, Google Fact Check", status: "partial", detail: "Code present; untested live (keys needed)" },
  { area: "ML service", item: "Cross-encoder rerank", status: "built", detail: "ms-marco-MiniLM-L-6-v2, Apache-2.0, ~90 MB, test passes on real weights" },
  { area: "ML service", item: "NLI endpoint", status: "built", detail: "nli-deberta-v3-xsmall, Apache-2.0, ~280 MB, entailment/contradiction verified" },
  { area: "ML service", item: "ELA / noise forensics", status: "built", detail: "Deterministic; each result carries limitations" },
  { area: "ML service", item: "AI-image / deepfake / anti-spoof models", status: "planned", detail: "" },
  { area: "Platform", item: "Job queue + SSE progress", status: "built", detail: "Arq/Redis, in-process fallback; events persisted per check" },
  { area: "Platform", item: "PostgreSQL / pgvector / MinIO", status: "partial", detail: "Postgres schema used; pgvector & MinIO arrive with media" },
  { area: "Platform", item: "Rate limiting, retention, virus-scan hook", status: "planned", detail: "" },
  { area: "Quality", item: "Eval harness (P/R/F1, AUROC, ECE)", status: "partial", detail: "Metrics and runner tested; no benchmark results yet" },
  { area: "Quality", item: "Calibration, user feedback loop", status: "planned", detail: "" },
];

export const TRUST_RULES = [
  ["The LLM is never a source of facts", "It only reads passages we retrieved. Every verdict links to those passages with retrieval timestamps."],
  ["Quotes must be real", "A supports/refutes judgement is thrown away unless its quote appears verbatim in the passage."],
  ["No forced verdicts", "Too few independent domains, too little weight, or conflict → Unverifiable / Disputed."],
  ["Stricter on sensitive topics", "Health, elections and violence need 3 independent domains and get a confidence haircut."],
  ["Confidence is not LLM-reported", "It is computed from agreement and total source weight, and flagged uncalibrated until fitted on held-out data."],
  ["Limitations travel with results", "Every result lists what could not be verified; forensic signals state they are indicators, never proof."],
];

export const SECURITY = [
  ["SSRF", "Only http(s) to public IPs; DNS resolved and checked, redirects re-validated hop by hop, odd ports and URL credentials rejected."],
  ["Uploads", "Magic-byte sniffing (not file extensions), size and pixel limits, decode inside the isolated ml-service."],
  ["Secrets", "Environment only; `.env` is git-ignored; keys never sent to the browser."],
  ["Rendering", "Fetched text is rendered as text by React (no raw HTML injection); external links use rel=noopener noreferrer."],
  ["Browser", "Strict CORS allow-list; API accepts only GET/POST with JSON."],
  ["Privacy", "Checks are private by default. Retention window and deletion are planned for media."],
];

export const DATA_MODEL = [
  { table: "checks", cols: ["id (pk)", "status", "created_at", "input_text | input_url", "provider", "is_private", "events (json, ordered progress log)", "result (json: claims → evidence → credibility)"] },
];

export const STACK = [
  ["Frontend", "Next.js 15 (App Router), TypeScript, Tailwind, Framer Motion, hand-written SVG", "Evidence Board is custom SVG: tiny bundle, accessible, no WebGL needed yet."],
  ["API", "FastAPI, Pydantic v2, async SQLAlchemy, SSE", "SSE over a DB-polled event log: survives worker restarts, no pub/sub to lose messages."],
  ["Jobs", "Arq + Redis (in-process fallback)", "Same code path on a laptop and in Docker."],
  ["Storage", "PostgreSQL (SQLite for dev), MinIO planned", "JSON columns keep the evolving result schema flexible."],
  ["ML service", "FastAPI + sentence-transformers (CPU), lazy-loaded", "Separate container so heavy deps and weights never touch the API image."],
  ["LLM", "Groq (default, free) · Anthropic · OpenAI", "Provider-agnostic interface; toggle per check in the UI."],
];
