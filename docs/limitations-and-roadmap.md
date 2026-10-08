# Known limitations & roadmap

## Limitations (also shown in the app)
1. **Confidence is an evidence-strength heuristic, not a probability.** Labelled uncalibrated until fitted on held-out data.
2. **Source credibility is a rule-based prior** from small public category lists. It can misjudge any outlet; no MBFC/NewsGuard, no WHOIS age.
3. **Stance comes from an LLM reading ≤900-character passages.** The verbatim-quote check stops fabricated quotes, not misreadings. Smaller free models (Groq-hosted Llama) are weaker than frontier models on subtle claims.
4. **Retrieval quality depends on unofficial free search** (DuckDuckGo/Bing via `ddgs`) and can fail or skew; GDELT is rate-limited; Crossref rarely returns abstracts.
5. **Lexical ranking by default** (BM25) unless the ml-service is on. Non-English retrieval is weaker.
6. **Temporal reasoning is limited** to the LLM's `evidence_date_note` and a down-weight; "was true once" is flagged only when the model notices.
7. **No media in the live flow yet.** ELA/noise endpoints exist in the ml-service but are not wired to the UI/job flow. Forensic signals are indicators only.
8. **No benchmark results yet**, and live-web evaluation can leak answers and drift over time.
9. **Fresh events** have little coverage → Unverifiable (by design).
10. Privacy: submitted text goes to the selected LLM provider and to search engines.

## Status by milestone
| # | Milestone | State |
|---|---|---|
| 1 | Text/URL claim pipeline + evidence UI | built; **LLM path unverified against live Groq/Anthropic until a key is loaded** |
| 2 | Image pipeline | partial: ELA + noise in ml-service. Missing: upload flow, reverse search, OCR, EXIF/C2PA, copy-move, AI-image detectors, caption consistency |
| 3 | Audio/video | planned |
| 4 | Fusion + calibration | planned |
| 5 | Eval harness | tooling built; no runs |
| 6 | UI polish | partial: toggle, architecture page; missing history, comparison, PDF export, timeline views |
| 7 | Hardening + docs | docs written; rate limiting, retention, auth, e2e tests planned |

## Next steps, in order
1. Load the Groq key; run live suite and a real end-to-end check; fix whatever it finds.
2. Wire NLI (`/nli`) as a second stance signal and report disagreement with the LLM.
3. First LIAR run (50–100 claims) → publish real numbers with caveats.
4. Calibration on a held-out split → remove the "uncalibrated" label only when ECE supports it.
5. Image flow end-to-end (upload → MinIO → ELA/EXIF/C2PA/reverse search → fusion).
6. Rate limiting, retention, auth.
