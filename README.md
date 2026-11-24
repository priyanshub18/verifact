# VeriFact — Multimodal Fake Information Detector

Evidence-grounded verification of **images + claims**, text posts, and URLs.

Upload an image paired with a claim (or submit text/URLs) and VeriFact checks:
1. **Is the image real?** — EXIF/camera metadata, C2PA Content Credentials, AI-generator & editor signature scanning, Error Level Analysis (ELA) heatmap, median noise residual heatmap, 2D FFT spectral ratio, vision-model artifact inspection, and web provenance search.
2. **Does the image match the claim?** — Vision-model consistency check comparing what is visibly depicted (plus visible OCR text) against the submitted claim to catch miscaptioned or out-of-context photos.
3. **Is the claim factually real?** — Retrieval-first fact-checking: atomic claim extraction → confirming + disconfirming queries → parallel search (DuckDuckGo/Bing, GDELT, Wikipedia, PubMed, Crossref, optional Tavily/Brave & Google Fact Check) → SSRF-safe fetch → BM25 or neural cross-encoder rerank → syndication deduplication → verbatim-quote stance check (+ optional DeBERTa NLI cross-check) → credibility-weighted deterministic aggregation & multimodal fusion.

## Architecture

```
Next.js UI ──REST (JSON + Multipart) + SSE──> FastAPI ──> Arq worker (Redis; in-process fallback)
                                                 │              │
                                            PostgreSQL     1. Image forensics (ml-service or built-in local)
                                       (auto SQLite dev)   2. Vision inspection + image–claim alignment
                                                           3. Image provenance / photo fact-check search
                                                           4. Claim extraction → confirming + disconfirming search
                                                           5. Fetch (SSRF-safe) → rerank → syndication dedupe
                                                           6. Stance (verbatim quote + optional NLI) → multimodal fusion
```

## Quick Run (Local Dev — Zero Docker Needed)

1. Ensure `.env` has a valid `GROQ_API_KEY` (free tier, `GROQ_MODEL=qwen/qwen3.8-27b` supports both text & vision) or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
2. Start the backend API (auto-falls back to SQLite + in-process jobs if Postgres/Redis are not running):
   ```bash
   cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
   ```
3. *(Optional)* Start the ML service (neural cross-encoder reranker, DeBERTa NLI, isolated forensics):
   ```bash
   cd ml-service && .venv/bin/uvicorn app.main:app --port 8100
   ```
   and set `ML_SERVICE_URL=http://localhost:8100` in `.env`.
4. Start the Next.js frontend:
   ```bash
   cd frontend && npm run dev
   ```
   Open **http://localhost:3000**.

## Docker Compose

```bash
cp .env.example .env            # add GROQ_API_KEY (free)
docker compose -f infra/docker-compose.yml --profile ml up --build
```

## Tests

- Backend: `cd backend && .venv/bin/pytest`
- ML service: `cd ml-service && .venv/bin/pytest` (add `-m models` to test neural weights)
- Frontend: `cd frontend && npm run typecheck && npm run build`
