# Text & URL pipeline

All numbers below are the actual constants in code.

## 0. Ingest (`retrieval/fetch.py`, `security.py`)
URL → `assert_public_url` (http/https only, ports 80/443/8080/8443, no embedded credentials, DNS resolved and **every** address must be public) → manual redirect loop (≤5 hops, each re-validated) → size cap (`FETCH_MAX_BYTES`, 3 MB) → `trafilatura` extraction of text, title, author, date. HTTP 401/402/403/429 are reported as *"likely paywall or bot block"*; pages with <200 extractable characters are reported as unreadable. Nothing is bypassed. A URL on a known satire domain makes the overall verdict **Satire**.

## 1. Claim extraction
LLM with a strict `ClaimExtraction` schema: atomic, decontextualised claims with `kind` (factual / opinion / prediction / question / other), `checkworthy`, `topic_sensitivity` (none/health/election/violence/finance), optional `claim_date`, `language`, and `original_span` (verbatim from the input). At most `MAX_CLAIMS` (default 3) checkworthy factual claims are verified; the rest are shown as **Not Checkworthy** with their kind.

## 2. Query planning
`QueryPlan`: supporting queries **and separate disconfirming queries** (debunks, corrections, official data), plus English queries for non-English claims. Up to 7 distinct queries are kept.

## 3. Retrieval (`retrieval/adapters.py`)
Run concurrently; each failure appends a note shown to the user and returns `[]`.
| Source | Key | Notes |
|---|---|---|
| DuckDuckGo/Bing via `ddgs` | none | unofficial, backends tried in turn (`auto`, `bing`, `auto`) |
| GDELT DOC 2.0 | none | titles + URLs; text fetched later |
| Wikipedia (claim language and English) | none | plain-text extracts |
| PubMed (health claims) | optional `NCBI_API_KEY` | abstracts only |
| Crossref | optional `CONTACT_EMAIL` | only works with abstracts; low yield |
| Tavily / Brave | key | optional, code kept |
| Google Fact Check (ClaimReview) | key | existing fact-checks join the evidence pool as documents |

## 4. Read & rank (`pipeline/evidence.py`)
Up to 14 candidate documents; web/news/fact-check pages are fetched (if the page can't be read, the search snippet is used and flagged). Text is chunked (110 words, 30 overlap). BM25-Plus over all chunks picks each document's best passage; scores are normalised by the pool maximum. If `ML_SERVICE_URL` is set, those passages are re-scored by the cross-encoder (sigmoid 0–1) and `rerank_method` records which was used; if the service fails, BM25 is used and a note says so.

## 5. Deduplicate & filter
5-word shingle Jaccard ≥ 0.5 ⇒ same syndication group; only the highest-credibility copy is counted. Also not counted: satire outlets, passages with relevance < 0.15. Every discard stores a human-readable `discard_reason` (visible under *Show the reasoning*).

## 6. Stance
Counted passages go to the LLM in batches of 6 (each trimmed to `STANCE_EXCERPT_CHARS`, 900). Output per passage: `supports | refutes | neutral`, verbatim `quote`, one-sentence rationale, optional `evidence_date_note` (evidence concerns a different period than the claim). **If a supports/refutes quote is not found verbatim (whitespace/case-normalised, ≥12 chars) in the passage, the judgement is discarded and the passage is not counted.**

## 7. Source credibility (`retrieval/credibility.py`)
Rule-based prior by domain class: intergovernmental .88, wire/fact-checker/government/scholarly .85, edu .75, reference (Wikipedia) .60, news .55, unknown .40, user-generated .25, satire .05; −0.08 if not HTTPS. Primary-source flag, recency, and each signal are returned in a breakdown. **This is a transparent prior, not an accuracy rating**; MBFC/NewsGuard and WHOIS domain age are not integrated.

## 8. Aggregation (`pipeline/aggregate.py`)
Weight per counted, non-neutral item: `credibility × (0.5 + 0.5 × relevance)`, halved when `date_note` is set. `S`, `R` = summed weights of supporting/refuting items; `p = S/(S+R)`.
1. No counted evidence → **Unverifiable**.
2. `S+R < 0.9` → **Unverifiable**.
3. Both sides substantial (`min(S,R) ≥ 0.6` and ≥35 % of total) with `0.35 < p < 0.65` → **Disputed** (≥2 domains each side) or **Mixed**; confidence is `null` (a single number would mislead).
4. Otherwise the leading side needs ≥ **2** independent domains (≥ **3** for health, election, violence), else **Unverifiable**.
5. Verdict by `p`: ≥0.85 True · ≥0.65 Mostly True · >0.35 Mixed · >0.15 Mostly False · else False.
6. Evidence strength = `|p−0.5|·2·(1−e^(−(S+R)/2.5))`, ×0.85 on sensitive topics, capped at 0.95. **Flagged `confidence_calibrated=false`** until fitted on held-out data.

## 9. Overall verdict
One distinct claim verdict → that verdict. Mix of true-ish and false-ish → Mixed. Otherwise the conservative combination; non-checkworthy claims don't count. Satire source overrides.

## Failure behaviour
LLM unreachable/invalid after retries → check `failed` with the reason. Search source down → note on the result. No keys → 503 "not configured". Nothing is ever substituted with invented content.
