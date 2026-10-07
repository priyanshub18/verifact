from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from app.config import Settings
from app.llm.base import LLMClient, LLMError
from app.pipeline import prompts
from app.pipeline.aggregate import aggregate, how_to_verify
from app.pipeline.evidence import Passage, norm_ws, quote_in_passage, rerank_best_passages, syndication_groups
from app.retrieval import adapters
from app.retrieval.credibility import classify_domain, registered_domain, score_source
from app.retrieval.fetch import fetch_page
from app.retrieval.mlclient import cross_encoder_scores
from app.schemas import (CheckResult, ClaimExtraction, ClaimKind, ClaimResult, EvidenceItem, ExistingFactCheck,
                         ExtractedClaim, InputInfo, QueryPlan, Stance, StanceBatch, Verdict)

Emit = Callable[[dict], Awaitable[None]]

LIMITATIONS = [
    "Verdicts reflect only the sources retrieved at the time shown; absence of evidence is reported as Unverifiable.",
    "Source credibility uses transparent rule-based priors, not licensed ratings; it can misjudge individual outlets.",
    "Stance labels come from an LLM reading short passages; each is checked to contain a verbatim quote but can still be wrong.",
    "Confidence is an uncalibrated evidence-strength score until calibrated on a held-out set.",
    "Reranking is lexical (BM25) unless the ml-service is configured; non-English retrieval quality is lower.",
]


class Pipeline:
    def __init__(self, s: Settings, llm: LLMClient, emit: Emit, http: httpx.AsyncClient | None = None):
        self.s, self.llm, self.emit = s, llm, emit
        self.http = http or httpx.AsyncClient(timeout=20, headers={"User-Agent": "VeriFactBot/0.1"})
        self.timings: dict[str, int] = {}
        self.notes = adapters.SourceNotes()

    async def step(self, name: str, status: str, detail: str = "", data: dict | None = None):
        await self.emit({"step": name, "status": status, "detail": detail, "data": data or {},
                         "ts": datetime.now(timezone.utc).isoformat()})

    async def run(self, check_id: str, text: str | None, url: str | None) -> CheckResult:
        created = datetime.now(timezone.utc)
        errors: list[str] = []
        t0 = time.monotonic()
        if url:
            await self.step("fetch", "running", f"Fetching {url}")
            page = await fetch_page(url, self.s)
            if page.error or not page.text:
                await self.step("fetch", "failed", page.error or "No text")
                inp = InputInfo(kind="url", text="", url=url, fetch_note=page.error)
                return CheckResult(id=check_id, status="failed", created_at=created, input=inp,
                                   errors=[page.error or "Could not read the page. Paste the text instead."],
                                   limitations=LIMITATIONS)
            text = page.text
            inp = InputInfo(kind="url", text=text[:20000], url=url, title=page.title, author=page.author,
                            published_at=page.published_at, domain=registered_domain(page.final_url))
            await self.step("fetch", "done", f"Extracted {len(text)} characters from {inp.domain}")
        else:
            inp = InputInfo(kind="text", text=text or "")

        satire_source = bool(url) and classify_domain(url) == "satire"
        await self.step("claims", "running", "Extracting atomic claims")
        try:
            ext = await self.llm.structured(
                prompts.EXTRACT_SYSTEM.format(max_claims=self.s.max_claims),
                f"TEXT:\n{(text or '')[:12000]}", ClaimExtraction)
        except LLMError as e:
            await self.step("claims", "failed", str(e))
            return CheckResult(id=check_id, status="failed", created_at=created, input=inp, errors=[str(e)],
                               limitations=LIMITATIONS)
        # keep only verbatim spans so the claim is demonstrably tied to the input
        claims = [c for c in ext.claims if norm_ws(c.original_span) in norm_ws(text or "")] or ext.claims
        factual = [c for c in claims if c.kind == ClaimKind.factual and c.checkworthy][: self.s.max_claims]
        skipped = [c for c in claims if c not in factual]
        await self.step("claims", "done", f"{len(factual)} checkworthy claim(s), {len(skipped)} skipped",
                        {"claims": [c.model_dump() for c in claims]})
        self.timings["claims"] = int((time.monotonic() - t0) * 1000)

        sem = asyncio.Semaphore(max(1, self.s.llm_concurrency))

        async def guarded(c):
            async with sem:
                return await self.check_claim(c, inp)

        results = list(await asyncio.gather(*[guarded(c) for c in factual]))
        for c in skipped:
            results.append(ClaimResult(claim=c, verdict=Verdict.not_checkworthy, confidence=None,
                                       confidence_calibrated=False,
                                       confidence_explanation=f"Labelled as {c.kind.value}; not a verifiable factual claim.",
                                       queries=[], fact_checks=[], evidence=[], unknowns=[], how_to_verify=[], weights={}))
        overall = self.overall(results, satire_source)
        errors += self.notes.notes
        await self.step("done", "done", f"Overall: {overall.value}")
        return CheckResult(id=check_id, status="done", created_at=created, input=inp, overall_verdict=overall,
                           claims=results, errors=errors, llm_usage=self.llm.usage.as_dict(),
                           timings_ms=self.timings, limitations=LIMITATIONS)

    @staticmethod
    def overall(results: list[ClaimResult], satire_source: bool) -> Verdict:
        if satire_source:
            return Verdict.satire
        checked = [r for r in results if r.verdict != Verdict.not_checkworthy]
        if not checked:
            return Verdict.not_checkworthy
        vs = {r.verdict for r in checked}
        if len(vs) == 1:
            return next(iter(vs))
        falsy = {Verdict.false, Verdict.mostly_false}
        truthy = {Verdict.true, Verdict.mostly_true}
        if vs & falsy and vs & truthy:
            return Verdict.mixed
        if vs <= falsy | {Verdict.unverifiable}:
            return Verdict.mostly_false
        if vs <= truthy | {Verdict.unverifiable}:
            return Verdict.mostly_true
        return Verdict.mixed

    # ------------------------------------------------------------------
    async def check_claim(self, claim: ExtractedClaim, inp: InputInfo) -> ClaimResult:
        tag = claim.text[:60]
        await self.step("queries", "running", f"Planning searches: {tag}")
        plan = await self.llm.structured(prompts.PLAN_SYSTEM, f"CLAIM: {claim.text}\nCLAIM_DATE: {claim.claim_date}\n"
                                         f"LANGUAGE: {claim.language}", QueryPlan)
        queries = list(dict.fromkeys(plan.supporting + plan.disconfirming + plan.en_queries))[:7]
        await self.step("queries", "done", f"{len(queries)} queries ({len(plan.disconfirming)} seek disconfirming evidence)",
                        {"queries": queries})

        await self.step("search", "running", f"Searching sources: {tag}")
        hits, fcs = await self.gather(claim, queries)
        await self.step("search", "done", f"{len(hits)} candidate documents, {len(fcs)} existing fact-checks")

        await self.step("read", "running", f"Reading {min(len(hits) + len(fcs), 14)} documents")
        items = await self.read_and_rank(claim, queries, hits, fcs)
        await self.step("read", "done", f"{len(items)} passages ranked")

        await self.step("verify", "running", "Classifying stance of each passage")
        items = await self.stances(claim, items)
        verdict, conf, expl, weights, unknowns = aggregate(items, claim.topic_sensitivity)
        await self.step("verify", "done", f"{verdict.value}")
        return ClaimResult(claim=claim, verdict=verdict, confidence=conf, confidence_calibrated=False,
                           confidence_explanation=expl, queries=queries, fact_checks=fcs, evidence=items,
                           unknowns=unknowns, how_to_verify=how_to_verify(claim.text, items, claim.topic_sensitivity),
                           weights=weights)

    async def gather(self, claim: ExtractedClaim, queries: list[str]):
        s, c, notes = self.s, self.http, self.notes
        tasks = [adapters.google_factcheck(c, s, claim.text, claim.language, notes)]
        # free sources always on; paid ones (code kept) only when their key is present
        for q in queries[:4]:
            tasks.append(adapters.duckduckgo(q, notes))
        tasks.append(adapters.gdelt(c, queries[0], notes))
        if s.tavily_api_key or s.brave_api_key:
            for q in queries:
                tasks.append(adapters.tavily(c, s, q, notes) if s.tavily_api_key else adapters.brave(c, s, q, notes))
            if s.tavily_api_key:
                tasks.append(adapters.tavily(c, s, queries[0], notes, news=True))
        tasks.append(adapters.wikipedia(c, claim.text[:250], claim.language if len(claim.language) == 2 else "en", notes))
        if claim.language != "en":
            tasks.append(adapters.wikipedia(c, claim.text[:250], "en", notes))
        if claim.topic_sensitivity == "health":
            tasks.append(adapters.pubmed(c, s, queries[0], notes))
        tasks.append(adapters.crossref(c, s, claim.text[:250], notes))
        out = await asyncio.gather(*tasks, return_exceptions=True)
        hits, fcs = [], []
        for r in out:
            if isinstance(r, Exception):
                notes.add(f"A source adapter crashed: {type(r).__name__}")
            elif r and isinstance(r[0], ExistingFactCheck):
                fcs += r
            else:
                hits += r
        seen, uniq = set(), []
        for h in hits:
            if h.url not in seen:
                seen.add(h.url)
                uniq.append(h)
        return uniq, fcs

    async def read_and_rank(self, claim, queries, hits, fcs) -> list[EvidenceItem]:
        # existing fact-checks join the pool as documents (their rating/title is the snippet)
        cands = [(h.url, h.title, h.publisher, h.published_at, h.snippet, h.source_type, h.source_type == "web" or h.source_type == "news")
                 for h in hits]
        for f in fcs[:6]:
            cands.append((f.url, f.title, f.publisher, f.review_date, f"{f.publisher} rating: {f.rating}. Reviewed claim: {f.claim_text}",
                          "factcheck", True))
        cands = cands[:14]

        async def load(cand):
            url, title, pub, date, snippet, st, needs_fetch = cand
            retrieved = datetime.now(timezone.utc)
            if needs_fetch:
                pg = await fetch_page(url, self.s)
                if pg.text:
                    return title or pg.title or url, pub, date or pg.published_at, pg.text, retrieved, None
                return title or url, pub, date, snippet, retrieved, f"Full text unavailable ({pg.error}); search snippet used"
            return title, pub, date, snippet, retrieved, None

        loaded = await asyncio.gather(*[load(c) for c in cands])
        texts = [l[3] or "" for l in loaded]
        passages = rerank_best_passages(" ".join([claim.text] + queries[:3]), texts)
        groups = syndication_groups(texts)
        if self.s.ml_service_url:
            idx = [i for i, ps in enumerate(passages) if ps]
            ce = await cross_encoder_scores(self.s.ml_service_url, claim.text, [passages[i].text for i in idx])
            if ce:
                for i, sc in zip(idx, ce[0]):
                    passages[i].score, passages[i].method = round(float(sc), 3), f"cross-encoder:{ce[1]}"
            else:
                self.notes.add("ml-service reranker unreachable or models not installed; used lexical BM25 ranking instead.")
        items: list[EvidenceItem] = []
        for i, (cand, ld, ps) in enumerate(zip(cands, loaded, passages)):
            if ps is None:
                continue
            url, _, _, _, _, st, _ = cand
            title, pub, date, _, retrieved, note = ld
            host = urlparse(url).hostname or ""
            cred = score_source(url, date, st)
            items.append(EvidenceItem(
                id=len(items), url=url, domain=registered_domain(url), title=title[:200], publisher=pub or host,
                published_at=date, retrieved_at=retrieved, source_type=st, excerpt=ps.text, stance=Stance.neutral,
                quote="", rationale="", rerank_score=ps.score, rerank_method=ps.method, credibility=cred,
                syndicate_group=f"g{groups[i]}", discard_reason=note))
        # one vote per syndicated story: keep the most credible copy counted
        best: dict[str, EvidenceItem] = {}
        for it in items:
            g = it.syndicate_group
            if g not in best or it.credibility.score > best[g].credibility.score:
                best[g] = it
        for it in items:
            if best[it.syndicate_group] is not it:
                it.counted = False
                it.discard_reason = "Near-duplicate of another source (syndicated copy); counted once"
            elif it.credibility.domain_class == "satire":
                it.counted = False
                it.discard_reason = "Satire outlet; not factual reporting"
            elif it.rerank_score < 0.15:
                it.counted = False
                it.discard_reason = "Low relevance to the claim"
        items.sort(key=lambda x: (-int(x.counted), -x.rerank_score * x.credibility.score))
        items = items[: self.s.max_sources_per_claim + 6]
        for n, it in enumerate(items):
            it.id = n
        return items

    async def stances(self, claim: ExtractedClaim, items: list[EvidenceItem]) -> list[EvidenceItem]:
        todo = [it for it in items if it.counted]
        for k in range(0, len(todo), 6):
            batch = todo[k:k + 6]
            body = "\n\n".join(f"[passage_id={it.id}] source={it.domain} published={it.published_at}\n{it.excerpt[:self.s.stance_excerpt_chars]}" for it in batch)
            res = await self.llm.structured(
                prompts.STANCE_SYSTEM,
                f"CLAIM: {claim.text}\nCLAIM_DATE: {claim.claim_date or 'unspecified'}\n\nPASSAGES:\n{body}", StanceBatch)
            by_id = {r.passage_id: r for r in res.results}
            for it in batch:
                r = by_id.get(it.id)
                if not r:
                    it.counted, it.discard_reason = False, "Stance classifier returned no result"
                    continue
                if r.stance != Stance.neutral and not quote_in_passage(r.quote, it.excerpt[:self.s.stance_excerpt_chars]):
                    it.stance, it.counted = Stance.neutral, False
                    it.discard_reason = "Stance discarded: cited quote not found verbatim in the passage"
                    it.rationale = r.rationale
                    continue
                it.stance, it.quote, it.rationale, it.date_note = r.stance, r.quote, r.rationale, r.evidence_date_note
        return items
