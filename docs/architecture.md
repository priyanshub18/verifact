# Architecture

VeriFact is a **retrieval-first** verification system. Language models read evidence we fetched; deterministic code decides what that evidence adds up to.

```
 Browser (Next.js)
   │  POST /api/checks {text|url, provider}          ▲ SSE /api/checks/{id}/events
   ▼                                                  │
 FastAPI ──insert row──> PostgreSQL (SQLite in dev) ──┘  (events are replayed from the DB)
   │ enqueue
   ▼
 Redis ──> Arq worker (or in-process task when no Redis)
              │  run_check → Pipeline.run
              ├─> LLM provider (Groq | Anthropic | OpenAI): structured JSON only
              ├─> Evidence sources: DuckDuckGo/Bing, GDELT, Wikipedia, PubMed, Crossref (+ Tavily/Brave/Google Fact Check if keyed)
              ├─> Publisher pages via SSRF-safe fetcher
              └─> ml-service (optional): cross-encoder rerank, NLI, image forensics
```

## Components

| Component | Path | Responsibility |
|---|---|---|
| Frontend | `frontend/` | Input hero, provider toggle, live investigation view, Evidence Board (SVG), verdict card, reasoning panel, architecture page |
| API | `backend/app/main.py` | Validation, persistence, job enqueue, SSE stream, capability reporting |
| Jobs | `backend/app/jobs.py` | Arq worker entry; falls back to `asyncio.create_task` when Redis is unreachable |
| Pipeline | `backend/app/pipeline/` | `orchestrator.py` (flow), `evidence.py` (chunk/rank/dedupe/quote check), `aggregate.py` (verdict rules), `prompts.py` |
| Retrieval | `backend/app/retrieval/` | `adapters.py` (sources), `fetch.py` (SSRF-safe fetch + extraction), `credibility.py`, `mlclient.py` |
| LLM layer | `backend/app/llm/` | `base.py` (Pydantic validation + retry, strict-schema helper), `providers.py` (Groq/Anthropic/OpenAI) |
| ML service | `ml-service/` | Lazy-loaded cross-encoders and classical forensics |
| Eval | `eval/` | Metrics, runner against the live API, LIAR converter |

## Request lifecycle
1. `POST /api/checks` validates exactly one of `text`/`url`, resolves the provider (an explicitly chosen provider without a key is **rejected**, never silently swapped), checks the URL against the SSRF policy, stores a `checks` row and enqueues `run_check`.
2. The worker sets `status=running`, builds the chosen LLM client and runs the pipeline. Each step calls `emit()`, which appends to `checks.events` in the database.
3. The SSE endpoint polls that row every 500 ms and forwards new events, so a page refresh or worker restart never loses progress, and there is no pub/sub message to drop.
4. On completion `checks.result` holds one JSON document: input info, per-claim verdicts, queries, evidence (with timestamps, excerpts, quotes, scores, credibility breakdown, discard reasons), unknowns, limitations, token usage. The UI permalink `/check/{id}` renders it.

## Data model
Single table `checks`: `id, status, created_at, input_text, input_url, provider, is_private, events (JSON list), result (JSON)`. Evidence is nested in `result` so a permalink is a self-contained audit trail. Normalised evidence/embedding tables with pgvector are planned together with media and history comparison.

## Design decisions and trade-offs
- **Event log in the DB, polled SSE** instead of Redis pub/sub: slightly higher latency (≤0.5 s), but durable and trivially correct across restarts.
- **Groq JSON-mode + schema in prompt** instead of strict schema enforcement: works across Groq models; correctness comes from Pydantic validation with error-feedback retries. Anthropic uses `output_config.format` JSON schema.
- **Rules, not an LLM, produce the verdict.** Less flexible, but inspectable and testable. The LLM only labels stance per passage.
- **BM25-Plus** (not Okapi) for the lexical fallback: Okapi gives non-positive IDF on the tiny per-claim candidate pools, which silently zeroed all scores.
- **Single JSON `result`** over normalised tables: fast to evolve while the schema is still moving; cost is no cross-check querying yet.
- **In-process job fallback**: one codepath for laptop demos and production; production should run the Arq worker.
- **Separate ml-service**: heavy dependencies (torch, weights) never enter the API image; the API degrades visibly to BM25 when it is absent.
