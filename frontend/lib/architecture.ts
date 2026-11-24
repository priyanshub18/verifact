export type Status = "built" | "partial" | "planned";

export const STATUS_LABEL: Record<Status, { glyph: string; text: string; cls: string }> = {
  built: { glyph: "●", text: "Built & tested", cls: "text-sup border-sup" },
  partial: { glyph: "◐", text: "Partial", cls: "text-amber border-amber" },
  planned: { glyph: "○", text: "Planned", cls: "text-dim border-line" },
};

export const PIPELINE: { n: string; title: string; does: string; where: string; status: Status; note?: string }[] = [
  { n: "01", title: "Ingest (Image, Claim & URL)", does: "Accept an uploaded image paired with a claim, image-only, text, or a URL. Images are magic-byte validated (JPEG/PNG/WebP, 15 MB & 40 MP caps); URLs use an SSRF-safe client with hop-by-hop redirect checks.", where: "backend/app/main.py · pipeline/image_forensics.py · retrieval/fetch.py", status: "built", note: "Paywalls are reported as failures, never bypassed." },
  { n: "02", title: "Image Forensics & Metadata", does: "Inspect EXIF camera tags, PNG text chunks, C2PA markers, AI-generator & editor signatures, SHA-256/dHash, Error Level Analysis (ELA) heatmap, median noise residual heatmap, and 2D FFT spectral ratio.", where: "ml-service/app/forensics.py · backend/app/pipeline/image_forensics.py", status: "built", note: "Runs in isolated ml-service when ML_SERVICE_URL is set, with built-in local fallback." },
  { n: "03", title: "Vision Inspection & Image–Claim Match", does: "Vision LLM inspects the image for scene content, visible OCR text, watermarks, visual anomalies, and checks whether the image visibly matches or contradicts the submitted claim.", where: "backend/app/pipeline/orchestrator.py · prompts.py · llm/providers.py", status: "built" },
  { n: "04", title: "Image Provenance & Reverse Context", does: "Searches web & fact-checks using visual descriptors, OCR text, and claim terms (plus optional Google Vision Web Detection) to spot prior debunks or out-of-context reuse.", where: "backend/app/pipeline/orchestrator.py · retrieval/adapters.py", status: "built" },
  { n: "05", title: "Extract claims", does: "LLM with a strict JSON schema splits input (or text embedded inside an image) into atomic, decontextualised claims, labelling opinions and predictions as not checkworthy.", where: "pipeline/orchestrator.py · prompts.py", status: "built" },
  { n: "06", title: "Plan queries & Retrieve", does: "Generates confirming and disconfirming queries and searches DuckDuckGo/Bing, GDELT, Wikipedia, PubMed, Crossref (plus optional Tavily/Brave & Google Fact Check) in parallel.", where: "pipeline/prompts.py · retrieval/adapters.py", status: "built" },
  { n: "07", title: "Read, Rank & Deduplicate", does: "Fetches pages, chunks into ~110-word passages, ranks with BM25-Plus or ml-service cross-encoder, and collapses syndicated copies (shingle Jaccard ≥ 0.5) so one wire story gets one vote.", where: "pipeline/evidence.py · retrieval/mlclient.py", status: "built" },
  { n: "08", title: "Judge stance & NLI cross-check", does: "LLM reads only the retrieved passage → supports / refutes / neutral + verbatim quote (unverified quotes discarded). Optional DeBERTa NLI model from ml-service cross-checks each passage and flags disagreements.", where: "orchestrator.py · retrieval/mlclient.py", status: "built" },
  { n: "09", title: "Weigh credibility & Aggregate", does: "Transparent rule-based domain prior + deterministic aggregation requiring independent domains (stricter on health/election/violence). Conflicts become Disputed/Mixed.", where: "retrieval/credibility.py · pipeline/aggregate.py", status: "built", note: "Confidence is an uncalibrated heuristic and labelled so." },
  { n: "10", title: "Multimodal Verdict Fusion", does: "Deterministically fuses Image Authenticity + Image–Claim Match + Claim Factuality into a 3-pillar summary and overall verdict.", where: "backend/app/pipeline/aggregate.py", status: "built", note: "Calibrated probabilities on held-out benchmarks remain planned." },
];

export const MODULES: { area: string; item: string; status: Status; detail: string }[] = [
  { area: "Inputs", item: "Image + Claim (multimodal)", status: "built", detail: "JPEG/PNG/WebP upload (drag-drop, paste, browse) + claim text" },
  { area: "Inputs", item: "Text / claim / post", status: "built", detail: "20k character limit" },
  { area: "Inputs", item: "URL", status: "built", detail: "SSRF-safe, paywall-aware" },
  { area: "Inputs", item: "Video / audio", status: "planned", detail: "Whisper, keyframes, deepfake & anti-spoof detectors" },
  { area: "Image Forensics", item: "EXIF / C2PA / AI-generator & editor metadata", status: "built", detail: "Camera tags, Stable Diffusion/ComfyUI/Midjourney/DALL-E/Firefly/Photoshop/C2PA markers" },
  { area: "Image Forensics", item: "ELA, noise residual & FFT spectral heatmaps", status: "built", detail: "Interactive Original / ELA / Noise switcher in the Result View" },
  { area: "Image Forensics", item: "Vision inspection & Image–Claim alignment", status: "built", detail: "Groq Qwen3.8 Vision, OpenAI GPT-4.1, Anthropic Claude" },
  { area: "LLM", item: "Groq (free · text + vision)", status: "built", detail: "qwen/qwen3.8-27b JSON + vision mode, Pydantic validation + retry, 429 back-off" },
  { area: "LLM", item: "Anthropic / OpenAI (text + vision)", status: "partial", detail: "Code present for text + vision; enabled when API key is set" },
  { area: "Evidence", item: "DuckDuckGo/Bing, GDELT, Wikipedia, PubMed, Crossref", status: "built", detail: "Keyless; verified against live services" },
  { area: "Evidence", item: "Tavily, Brave, Google Fact Check, Google Vision Reverse", status: "partial", detail: "Code present; enabled when keys are configured" },
  { area: "ML service", item: "Cross-encoder rerank & DeBERTa NLI", status: "built", detail: "Wired into backend when ML_SERVICE_URL is set" },
  { area: "ML service", item: "Unified /forensics/analyze endpoint", status: "built", detail: "EXIF/C2PA + ELA + noise + FFT; backend also includes built-in local fallback" },
  { area: "Platform", item: "Job queue + SSE progress + check history", status: "built", detail: "Arq/Redis or in-process; Postgres with automatic SQLite dev fallback" },
  { area: "Platform", item: "Rate limiting, retention, virus-scan hook", status: "planned", detail: "" },
  { area: "Quality", item: "Eval harness (P/R/F1, AUROC, ECE)", status: "partial", detail: "Metrics and runner tested; calibration on held-out splits planned" },
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
