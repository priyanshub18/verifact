# Setup & demo

## 1. Get a free key
Create a key at **console.groq.com** (free tier). Put it in `.env` at the repo root: `GROQ_API_KEY=gsk_...` (no quotes). `.env` is git-ignored.

> **Gotcha:** if your `.env` was copied from an older `.env.example` it may contain `DATABASE_URL=postgresql…localhost` and `REDIS_URL=redis://localhost…`. Those only work inside Docker Compose (which overrides them). For a local run, delete or comment out both lines.

## 2a. Local, no Docker (fastest)
```bash
# terminal 1: backend (SQLite + in-process jobs; nothing else to install)
cd backend && uv venv && uv pip install -e ".[dev]"
source .venv/bin/activate
uvicorn app.main:app --port 8000          # reads ../.env automatically

# terminal 2: frontend
cd frontend && npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev      # http://localhost:3000
```
If port 8000 is taken (another container), use `--port 8010` and set `NEXT_PUBLIC_API_URL` to match.

## 2b. Docker Compose (Postgres + Redis + Arq worker + API + UI)
```bash
docker compose -f infra/docker-compose.yml up --build
docker compose -f infra/docker-compose.yml --profile ml up --build   # adds the ml-service
```
**Rebuild after pulling code changes**, or you'll be running old images. With the `ml` profile also set `ML_SERVICE_URL=http://ml-service:8100` in `.env`; the first rerank downloads ~90 MB of weights.

## 3. Verify it works
1. Open the UI. The **Reasoning model** toggle should show Groq as selectable (green "Ready" chips below for DuckDuckGo, GDELT, Wikipedia, PubMed). If it says *not configured*, the key isn't being read: see the gotcha above.
2. `curl localhost:8000/api/providers` → `"configured": true` for groq.
3. Tests: `cd backend && pytest` (offline) · `cd ml-service && pytest` · `python -m pytest eval/tests`.

## 4. Demo script
Free Groq has rate limits (about 30 requests/min and a daily token cap) and a check makes roughly 5-10 LLM calls, so:
- **Do a dry run an hour before** and keep the permalinks (`/check/<id>`) as a fallback you can reopen instantly (results are stored).
- Run **one** check at a time; defaults are already trimmed (3 claims, 8 sources, concurrency 1).
- Suggested flow (try these beforehand and keep the ones that behave; results depend on live search and are not guaranteed):
  1. A well-debunked claim, e.g. *"Humans only use 10% of their brains."* Show the live steps, the Evidence Board (hover a node, read the excerpt), the verdict + "uncalibrated" label, and **Show the reasoning** (queries incl. disconfirming ones, discarded sources and why).
  2. A claim that should end **Unverifiable** (obscure or very recent). The point: the system declines to guess.
  3. A health claim to show the stricter 3-domain rule.
  4. A URL check, then a paywalled URL to show the graceful failure.
  5. Flip the toggle to Anthropic: shows "not configured" with how to enable it (paid, added later).
  6. Open **/architecture** for the honest built/partial/planned board.
- Say plainly: text and URL checking works; image/video/audio are not wired in yet; confidence is uncalibrated; no benchmark numbers yet.

## 5. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| UI says "Can't reach the VeriFact API" | backend not running, wrong `NEXT_PUBLIC_API_URL`, or CORS (`CORS_ORIGINS` must include the UI origin) |
| 503 not_configured | no key for the chosen provider |
| Check fails with "Groq rate limit…" | free-tier cap; wait a minute and retry |
| Few or no sources | DuckDuckGo/Bing is unofficial and can rate-limit; the result lists a note; retry |
| `Connection refused` at backend start | stale `DATABASE_URL`/`REDIS_URL` in `.env` (see gotcha) |
| Startup in Docker slow first time | image build + model download (ml profile) |
