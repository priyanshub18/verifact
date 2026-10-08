# API reference

Base URL (local): `http://localhost:8000`. JSON in/out. CORS is restricted to `CORS_ORIGINS`.

## Backend

### `GET /api/providers`
LLM providers and whether each is configured. `default` is the provider used when a request names none (`null` if none is configured).
```json
{"default":"groq","providers":[{"id":"groq","label":"Groq (free tier)","configured":true,"model":"llama-3.3-70b-versatile","how_to_enable":"…","free":true}]}
```

### `GET /api/capabilities`
Array of `{id, label, configured, needs[], how_to_enable}` for every feature (LLM, fact-check, web search, Wikipedia, scholarly, ClaimBuster, ml-service…). The UI renders "Not configured" states from this.

### `POST /api/checks`  → `202 {"id": "…"}`
Body: `{ "text"?: string (≤20000), "url"?: string, "private": true, "provider"?: "groq"|"anthropic"|"openai" }` — **exactly one** of `text`/`url`.
| Status | Meaning |
|---|---|
| 202 | queued |
| 422 | invalid body, or URL rejected by the SSRF policy |
| 503 `{"detail":{"code":"not_configured","feature":"llm",…}}` | no provider configured, or the explicitly requested provider has no key (never silently swapped) |

### `GET /api/checks/{id}`
`{id, status: queued|running|done|failed, created_at, events[], result|null}`. `result` follows `CheckResult` (`backend/app/schemas.py`): `input`, `overall_verdict`, `claims[]` (each: `claim`, `verdict`, `confidence`, `confidence_calibrated`, `confidence_explanation`, `queries`, `fact_checks`, `evidence[]`, `unknowns`, `how_to_verify`, `weights`), `errors`, `llm_usage`, `timings_ms`, `limitations`. A failed check carries `result.errors`.

Evidence item fields: `url, domain, title, publisher, published_at, retrieved_at, source_type, excerpt, stance, quote, rationale, rerank_score, rerank_method, credibility{score, domain_class, https, is_primary, recency_days, signals[]}, syndicate_group, counted, discard_reason, date_note`.

### `GET /api/checks/{id}/events` (Server-Sent Events)
Replays the persisted event log, then streams new events until completion.
- `event: progress` — `{step, status: running|done|failed, detail, data, ts}`; steps: `fetch, claims, queries, search, read, verify, done, error`.
- `event: complete` — `{"status": "done"|"failed"}`.

## ml-service (`:8100`)
| Endpoint | Body | Returns |
|---|---|---|
| `GET /health` | — | which models are installed/loaded, licences, sizes, last load error |
| `POST /rerank` | `{query, passages[≤64]}` | `{model, logits[], scores[]}` (sigmoid 0–1) |
| `POST /nli` | `{pairs:[{premise, hypothesis}]}` (≤32) | `{model, results:[{entailment, neutral, contradiction}]}` (labels from the model config) |
| `POST /forensics/ela` | multipart `file`, `quality` (50–98) | stats, base64 PNG heatmap, interpretation, **limitations** |
| `POST /forensics/noise` | multipart `file` | stats, heatmap, **limitations** |

`503` from `/rerank` or `/nli` means torch or the model weights are unavailable. Errors are explicit; no fallbacks produce fake scores. Uploads are validated by magic bytes (JPEG/PNG/WebP only), ≤15 MB, ≤40 MP; violations return `422`.
