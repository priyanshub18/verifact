# VeriFact

📚 **Docs:** [`docs/`](docs/README.md) (architecture, pipeline, API, ML service, evaluation, security, setup & demo). The same architecture and status board is in the app at `/architecture`.

Evidence-grounded verification of claims and media. **Status: milestone 1 of 7 (text/URL claim pipeline + evidence UI), plus real ml-service and eval tooling. Free-first: Groq + keyless sources by default; Anthropic/OpenAI/Tavily/Brave code is kept and switchable in the UI.**
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
cp .env.example .env            # add GROQ_API_KEY (free); nothing else required
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

- **Verified by running:** backend 26 offline tests (+1 skipped live test); ml-service 6 forensics tests and 2 model tests on real downloaded weights (reranker and NLI behave correctly); eval metric tests (5); live Wikipedia, PubMed, GDELT, DuckDuckGo/Bing and page fetch; SSRF blocks; frontend typecheck, production build and a screenshot of `/architecture`; API returns 503 `not_configured` for a provider without a key.
- **Not verified:** the LLM paths (claim extraction, query planning, stance) have **never run against a real Groq/Anthropic/OpenAI response** because no working key was loaded when this was built. The Groq request/retry logic is covered by mocked-HTTP tests only. Tavily/Brave/Google Fact Check adapters are likewise untested live. The Evidence Board and verdict UI have not been rendered with a real result.
- **No accuracy numbers exist.** The eval harness is built and tested, but no benchmark has been run.
- Confidence is an uncalibrated heuristic and is labelled so.
