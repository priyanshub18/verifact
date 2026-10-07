# VeriFact

Evidence-grounded verification of claims and media. **Status: milestone 1 of 7 (text/URL claim pipeline + evidence UI).**
Everything not listed as working below is _not implemented_, and the UI says so rather than faking it.

## Architecture

```
Next.js UI ──REST + SSE──> FastAPI ──> Arq worker (Redis; in-process fallback for dev)
                              │              │
                         PostgreSQL     pipeline: extract claims → plan queries (confirming + disconfirming)
                    (SQLite for dev)           → search/fact-check lookup → fetch (SSRF-safe) → passage rerank
                                               → syndication dedupe → stance (LLM + verbatim-quote check)
                                               → credibility-weighted deterministic aggregation
```

The LLM only reads retrieved passages. Stance judgements whose quote is not found verbatim in the passage are discarded.

## Run

```bash
cp .env.example .env            # add at least ANTHROPIC_API_KEY (+ TAVILY_API_KEY or BRAVE_API_KEY)
docker compose -f infra/docker-compose.yml up --build      # UI :3000, API :8000
```

Without Docker: `cd backend && uv venv && uv pip install -e ".[dev]" && DATABASE_URL=sqlite+aiosqlite:///./dev.db REDIS_URL= uvicorn app.main:app`, and `cd frontend && npm i && npm run dev`.

## Tests

`cd backend && pytest` (21 offline tests + live tests, which skip without keys) · `pytest -m live` hits real services (key-gated).

## Feature availability

| Capability                                                                                                    | Needs                                   | State                                                    |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Claim extraction, stance                                                                                      | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | built                                                    |
| Web/news evidence                                                                                             | `TAVILY_API_KEY` or `BRAVE_API_KEY`     | built                                                    |
| Existing fact-checks                                                                                          | `GOOGLE_FACTCHECK_API_KEY`              | built                                                    |
| Wikipedia, PubMed, Crossref                                                                                   | none                                    | built (Crossref yields few records: most lack abstracts) |
| URL fetch + extraction                                                                                        | none                                    | built, paywalls reported as failures                     |
| ClaimBuster, GDELT, NewsAPI, WHOIS age, MBFC/NewsGuard                                                        | keys/licences                           | **not implemented**                                      |
| Neural reranker / NLI (ml-service)                                                                            | ML service                              | **not implemented** (BM25 used, labelled)                |
| Image, video, audio, bundles                                                                                  | ML service etc.                         | **not implemented** (milestones 2–3)                     |
| Calibration, fusion, /eval, user flag loop, multilingual retrieval tuning, PDF export, retention, rate limits | –                                       | **not implemented** (milestones 4–7)                     |

## Verification status (honest)

- Verified by running: 21 offline tests pass, plus the keyless live Wikipedia/PubMed test; real Wikipedia/PubMed/page-fetch/SSRF-block checked live; frontend typechecks and builds; API returns 503 "not configured" without keys.
- **Not verified:** the LLM paths (extraction, query planning, stance) and Tavily/Brave/Google Fact Check adapters have never run against the real APIs: no keys were available when this was built. The structured-output request shape follows the Anthropic docs but is untested live. No accuracy numbers exist yet; none are claimed.
- The Evidence Board and verdict UI have not been exercised with a real result.
- Confidence is an uncalibrated heuristic and is labelled so.
