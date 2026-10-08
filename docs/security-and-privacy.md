# Security & privacy

## Implemented
| Threat | Control | Where |
|---|---|---|
| SSRF via URL input | http/https only; ports 80/443/8080/8443; no URL credentials; DNS resolved and **all** addresses must be public; redirects followed manually and re-validated each hop; verified to block `127.0.0.1`, `localhost`, `169.254.169.254`, `10.x`, `[::1]`, `ftp://` | `backend/app/security.py`, `retrieval/fetch.py`, tests |
| Resource exhaustion | fetch timeout, 3 MB cap, input ≤20k chars, ≤3 claims, bounded candidates | `config.py` |
| Malicious uploads (ml-service) | magic-byte sniffing (not extensions), 15 MB / 40 MP caps, decode failures → 422 | `ml-service/app/forensics.py` |
| Fabricated model output | schema validation, retries, verbatim-quote verification | `llm/base.py`, `evidence.py` |
| XSS from fetched text | rendered as React text; no raw HTML injection; external links `noopener noreferrer` | frontend |
| Secrets | env only; `.env` git-ignored; `.env.example` has keys, no values | `.gitignore` |
| Cross-origin abuse | CORS allow-list, GET/POST only | `main.py` |
| Silent provider swap | an explicitly chosen provider without a key returns 503 | `config.resolve_provider` |

## Not yet implemented (be honest in demos)
Rate limiting; auth and per-user history; retention/deletion of media (media isn't stored yet); virus-scan hook; sandboxed media processing for video/audio; audit logging; error-tracking hooks; cost caps per user.

## Privacy
Checks are private by default. Text and URLs you submit are sent to the selected LLM provider (Groq/Anthropic/OpenAI) and to search engines as queries derived from your claim. Don't submit confidential material. No analytics, no training on user data by VeriFact. Face recognition/identification is out of scope by design.

## Responsible-AI rules in code
Sensitive topics (health, election, violence) need 3 independent domains and a confidence haircut; forensic signals carry limitation text; Unverifiable/Disputed are first-class outcomes; political balance relies on source diversity being visible (stated lean data is not integrated yet).
