from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from app.config import Settings
from app.llm.base import LLMClient, LLMError
from app.pipeline import image_forensics, prompts
from app.pipeline.aggregate import (
    aggregate,
    evaluate_image_authenticity,
    fuse_multimodal,
    how_to_verify,
)
from app.pipeline.evidence import norm_ws, quote_in_passage, rerank_best_passages, syndication_groups
from app.retrieval import adapters
from app.retrieval.credibility import classify_domain, registered_domain, score_source
from app.retrieval.fetch import fetch_page
from app.retrieval.mlclient import analyze_image, cross_encoder_scores, nli_scores
from app.schemas import (
    CheckResult,
    ClaimExtraction,
    ClaimKind,
    ClaimResult,
    EvidenceItem,
    ExistingFactCheck,
    ExtractedClaim,
    ImageAnalysis,
    ImageProvenanceMatch,
    InputInfo,
    ProvenanceFinding,
    QueryPlan,
    Stance,
    StanceBatch,
    Verdict,
    VisualAnalysis,
)

Emit = Callable[[dict], Awaitable[None]]

LIMITATIONS = [
    "Verdicts reflect only the sources retrieved at the time shown; absence of evidence is reported as Unverifiable.",
    "Source credibility uses transparent rule-based priors, not licensed ratings; it can misjudge individual outlets.",
    "Stance labels come from an LLM reading short passages; each is checked to contain a verbatim quote but can still be wrong.",
    "Confidence is an uncalibrated evidence-strength score until calibrated on a held-out set.",
    "Reranking is lexical (BM25) unless the ml-service is configured; non-English retrieval quality is lower.",
]

IMAGE_LIMITATIONS = [
    "Image forensics (EXIF, ELA, noise residual, FFT spectral cues) and vision-model inspection are probabilistic indicators, never 100% proof.",
    "Social media re-uploads strip EXIF metadata and recompress JPEGs, which can hide both genuine camera history and subtle edits.",
    "Without Google Vision / SerpAPI keys, image provenance relies on visual-context web search rather than pixel-exact reverse image matching.",
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

    async def run(
        self,
        check_id: str,
        text: str | None,
        url: str | None,
        image_bytes: bytes | None = None,
        image_mime: str | None = None,
        image_name: str | None = None,
    ) -> CheckResult:
        created = datetime.now(timezone.utc)
        errors: list[str] = []
        t0 = time.monotonic()
        has_image = bool(image_bytes)
        clean_text = (text or "").strip()
        has_user_claim = bool(clean_text or url)

        if url:
            await self.step("fetch", "running", f"Fetching {url}")
            page = await fetch_page(url, self.s)
            if page.error or not page.text:
                await self.step("fetch", "failed", page.error or "No text")
                inp = InputInfo(kind="url", text="", url=url, fetch_note=page.error,
                                has_image=has_image, image_name=image_name, image_mime=image_mime)
                return CheckResult(id=check_id, status="failed", created_at=created, input=inp,
                                   errors=[page.error or "Could not read the page. Paste the text instead."],
                                   limitations=LIMITATIONS)
            clean_text = page.text
            inp = InputInfo(
                kind="image+claim" if has_image else "url",
                text=clean_text[:20000], url=url, title=page.title, author=page.author,
                published_at=page.published_at, domain=registered_domain(page.final_url),
                has_image=has_image, image_name=image_name, image_mime=image_mime,
            )
            await self.step("fetch", "done", f"Extracted {len(clean_text)} characters from {inp.domain}")
        else:
            kind = "image+claim" if (has_image and clean_text) else ("image" if has_image else "text")
            inp = InputInfo(kind=kind, text=clean_text, has_image=has_image,
                            image_name=image_name, image_mime=image_mime)

        satire_source = bool(url) and classify_domain(url) == "satire"

        # ---- Image Authenticity, Vision Inspection & Provenance (when an image is uploaded) ----
        image_analysis: ImageAnalysis | None = None
        if has_image and image_bytes:
            image_analysis = await self.analyze_uploaded_image(image_bytes, image_mime or "image/jpeg", image_name or "image", clean_text)
            self.timings["image"] = int((time.monotonic() - t0) * 1000)

        # Build the claim text to verify: user's claim, or embedded claims found inside the image
        claim_source_text = clean_text
        if not claim_source_text and image_analysis and image_analysis.visual and image_analysis.visual.embedded_claims:
            claim_source_text = " ".join(image_analysis.visual.embedded_claims)

        results: list[ClaimResult] = []
        if claim_source_text:
            t_claims = time.monotonic()
            await self.step("claims", "running", "Extracting atomic claims")
            try:
                ext = await self.llm.structured(
                    prompts.EXTRACT_SYSTEM.format(max_claims=self.s.max_claims),
                    f"TEXT:\n{claim_source_text[:12000]}", ClaimExtraction)
            except LLMError as e:
                await self.step("claims", "failed", str(e))
                return CheckResult(id=check_id, status="failed", created_at=created, input=inp,
                                   image_analysis=image_analysis, errors=[str(e)],
                                   limitations=LIMITATIONS + (IMAGE_LIMITATIONS if has_image else []))
            claims = [c for c in ext.claims if norm_ws(c.original_span) in norm_ws(claim_source_text)] or ext.claims
            factual = [c for c in claims if c.kind == ClaimKind.factual and c.checkworthy][: self.s.max_claims]
            skipped = [c for c in claims if c not in factual]
            await self.step("claims", "done", f"{len(factual)} checkworthy claim(s), {len(skipped)} skipped",
                            {"claims": [c.model_dump() for c in claims]})
            self.timings["claims"] = int((time.monotonic() - t_claims) * 1000)

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

        claim_overall = self.overall(results, satire_source)
        multimodal_summary = None
        if image_analysis is not None:
            await self.step("fuse", "running", "Fusing image authenticity, image–claim match, and claim evidence")
            overall, multimodal_summary = fuse_multimodal(
                image_analysis, results, claim_overall, has_user_claim=has_user_claim
            )
            await self.step("fuse", "done",
                            f"Image: {multimodal_summary.image_verdict} · Match: {multimodal_summary.image_claim_match} · Claim: {multimodal_summary.claim_verdict}")
        else:
            overall = claim_overall

        errors = list(dict.fromkeys(errors + self.notes.notes))
        lims = LIMITATIONS + (IMAGE_LIMITATIONS if has_image else [])
        await self.step("done", "done", f"Overall: {overall.value}")
        return CheckResult(
            id=check_id, status="done", created_at=created, input=inp,
            overall_verdict=overall, multimodal_summary=multimodal_summary,
            image_analysis=image_analysis, claims=results, errors=errors,
            llm_usage=self.llm.usage.as_dict(), timings_ms=self.timings, limitations=lims,
        )

    async def analyze_uploaded_image(
        self, image_bytes: bytes, image_mime: str, image_name: str, user_claim: str
    ) -> ImageAnalysis:
        # 1. Deterministic forensics (ml-service preferred; local built-in fallback)
        await self.step("image_forensics", "running", "Inspecting EXIF/C2PA metadata, ELA, noise residual & frequency spectrum")
        forensics_source = "local"
        forensics_data: dict | None = None
        if self.s.ml_service_url:
            forensics_data = await analyze_image(self.s.ml_service_url, image_bytes, image_name, image_mime)
            if forensics_data:
                forensics_source = "ml-service"
            else:
                self.notes.add("ml-service forensics unreachable; ran built-in local forensics instead.")
        if forensics_data is None:
            forensics_data = await asyncio.to_thread(image_forensics.analyze_local, image_bytes)

        meta = forensics_data.get("metadata", {})
        ela_d = forensics_data.get("ela", {})
        noise_d = forensics_data.get("noise", {})
        spec_d = forensics_data.get("spectral", {})
        flags = forensics_data.get("forensic_flags", [])
        risk = forensics_data.get("forensic_risk", "low")
        meta_summary = (f"{meta.get('width', '?')}×{meta.get('height', '?')} {meta.get('format', '')} · "
                        f"EXIF: {'yes' if meta.get('has_exif') else 'absent'} · "
                        f"Forensic risk: {risk} ({len(flags)} note(s))")
        await self.step("image_forensics", "done", meta_summary)

        # 2. Vision LLM inspection (scene, OCR, AI/editing cues, image-claim alignment)
        await self.step("vision", "running", "Inspecting image content, visual artifacts & claim consistency")
        visual: VisualAnalysis | None = None
        try:
            vision_bytes, vision_mime = await asyncio.to_thread(image_forensics.prepare_for_vision, image_bytes)
            compact_meta = {
                "format": meta.get("format"),
                "dimensions": f"{meta.get('width')}x{meta.get('height')}",
                "has_exif": meta.get("has_exif"),
                "camera": " ".join(p for p in (meta.get("camera_make"), meta.get("camera_model")) if p) or None,
                "software": meta.get("software"),
                "datetime_original": meta.get("datetime_original"),
                "ai_metadata_signals": meta.get("ai_metadata_signals", []),
                "editing_software_signals": meta.get("editing_software_signals", []),
                "c2pa_signals": meta.get("c2pa_signals", []),
                "forensic_flags": flags,
            }
            user_prompt = (
                f"USER CLAIM ABOUT THIS IMAGE: {user_claim if user_claim else '(No separate claim provided — inspect the image and any embedded text.)'}\n\n"
                f"TECHNICAL METADATA & FORENSICS SUMMARY:\n{json.dumps(compact_meta, indent=2)}"
            )
            visual = await self.llm.structured_with_image(
                prompts.VISION_SYSTEM, user_prompt, vision_bytes, vision_mime, VisualAnalysis
            )
            await self.step(
                "vision", "done",
                f"Visual check: {visual.authenticity_assessment.value} · Claim match: {visual.claim_alignment.value}",
                {"entities": visual.visual_entities, "alignment": visual.claim_alignment.value},
            )
        except Exception as e:  # noqa: BLE001
            self.notes.add(f"Vision inspection failed ({type(e).__name__}: {str(e)[:140]}); relying on technical forensics.")
            await self.step("vision", "failed", f"Vision inspection unavailable: {type(e).__name__}")

        # 3. Image Provenance & Reverse-Context Web Search
        await self.step("image_provenance", "running", "Searching web & fact-checks for image origin and prior debunks")
        prov_queries: list[str] = []
        if visual and visual.image_search_queries:
            prov_queries.extend(visual.image_search_queries[:3])
        if user_claim:
            prov_queries.append(f"{user_claim[:120]} photo fact check")
        prov_queries = list(dict.fromkeys(q.strip() for q in prov_queries if q.strip()))[:4]

        tasks = []
        if self.s.google_vision_api_key:
            tasks.append(adapters.google_vision_reverse(self.http, self.s, image_bytes, self.notes))
        for q in prov_queries[:3]:
            tasks.append(adapters.duckduckgo(q, self.notes, max_results=5))
            if self.s.tavily_api_key:
                tasks.append(adapters.tavily(self.http, self.s, q, self.notes))
            elif self.s.brave_api_key:
                tasks.append(adapters.brave(self.http, self.s, q, self.notes))
        if prov_queries:
            tasks.append(adapters.google_factcheck(self.http, self.s, prov_queries[0], "en", self.notes))

        prov_hits: list[adapters.SearchHit] = []
        if tasks:
            raw_out = await asyncio.gather(*tasks, return_exceptions=True)
            seen_urls: set[str] = set()
            for r in raw_out:
                if isinstance(r, Exception):
                    continue
                for item in r:
                    if isinstance(item, ExistingFactCheck):
                        if item.url and item.url not in seen_urls:
                            seen_urls.add(item.url)
                            prov_hits.append(adapters.SearchHit(
                                item.url, item.title or item.claim_text, item.publisher, item.review_date,
                                f"Fact-check ({item.publisher}) rating: {item.rating}. Claim: {item.claim_text}", "factcheck",
                            ))
                    elif item.url and item.url not in seen_urls:
                        seen_urls.add(item.url)
                        prov_hits.append(item)

        prov_matches = [
            ImageProvenanceMatch(
                url=h.url,
                domain=registered_domain(h.url),
                title=(h.title or h.url)[:180],
                snippet=(h.snippet or "")[:360],
                source_type=h.source_type,
                credibility_score=score_source(h.url, h.published_at, h.source_type).score,
            )
            for h in prov_hits[:10]
        ]
        prov_matches.sort(key=lambda m: -m.credibility_score)

        prov_finding = "inconclusive"
        prov_summary = "No decisive prior fact-checks or provenance records for this specific image were found."
        if prov_matches:
            try:
                snippets_text = "\n\n".join(
                    f"[{i}] ({m.domain}, cred={m.credibility_score}, type={m.source_type}) {m.title}\nURL: {m.url}\nSnippet: {m.snippet}"
                    for i, m in enumerate(prov_matches[:8])
                )
                pf = await self.llm.structured(
                    prompts.PROVENANCE_SYSTEM,
                    f"IMAGE DESCRIPTION: {visual.scene_description if visual else 'unavailable'}\n"
                    f"USER CLAIM: {user_claim or 'none'}\n\nRETRIEVED RESULTS:\n{snippets_text}",
                    ProvenanceFinding,
                )
                prov_finding = pf.finding
                prov_summary = pf.summary
            except LLMError:
                pass
        await self.step("image_provenance", "done", f"{len(prov_matches)} web/provenance lead(s) · {prov_finding}")

        img_verdict, img_real, img_conf = evaluate_image_authenticity(
            meta, risk, visual.authenticity_assessment if visual else None,
            visual.visual_anomalies if visual else [], prov_finding,
        )

        return ImageAnalysis(
            image_verdict=img_verdict,
            image_is_real=img_real,
            image_confidence=img_conf,
            forensics_source=forensics_source,
            metadata=meta,
            ela_stats=ela_d.get("stats", {}),
            ela_heatmap_png_base64=ela_d.get("heatmap_png_base64"),
            noise_stats=noise_d.get("stats", {}),
            noise_heatmap_png_base64=noise_d.get("heatmap_png_base64"),
            spectral_stats=spec_d.get("stats", {}),
            forensic_flags=flags,
            forensic_risk=risk,
            visual=visual,
            provenance_finding=prov_finding,
            provenance_summary=prov_summary,
            provenance_matches=prov_matches[:8],
            limitations=forensics_data.get("limitations", []) + IMAGE_LIMITATIONS,
        )

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
        nli_notes = await self.nli_crosscheck(claim, items)
        verdict, conf, expl, weights, unknowns = aggregate(items, claim.topic_sensitivity)
        unknowns.extend(nli_notes)
        await self.step("verify", "done", f"{verdict.value}")
        return ClaimResult(claim=claim, verdict=verdict, confidence=conf, confidence_calibrated=False,
                           confidence_explanation=expl, queries=queries, fact_checks=fcs, evidence=items,
                           unknowns=unknowns, how_to_verify=how_to_verify(claim.text, items, claim.topic_sensitivity),
                           weights=weights)

    async def nli_crosscheck(self, claim: ExtractedClaim, items: list[EvidenceItem]) -> list[str]:
        """Optional DeBERTa NLI second opinion via ml-service. Flags disagreements transparently."""
        if not self.s.ml_service_url:
            return []
        counted = [it for it in items if it.counted and it.stance != Stance.neutral]
        if not counted:
            return []
        res = await nli_scores(self.s.ml_service_url, [(it.excerpt[:self.s.stance_excerpt_chars], claim.text) for it in counted])
        if not res:
            return []
        scores_list, model_name = res
        disagreements = 0
        for it, probs in zip(counted, scores_list):
            if not probs:
                continue
            top_label, top_prob = max(probs.items(), key=lambda kv: kv[1])
            it.nli_label = top_label
            it.nli_score = round(float(top_prob), 3)
            if (it.stance == Stance.supports and top_label == "contradiction" and top_prob >= 0.7) or (
                it.stance == Stance.refutes and top_label == "entailment" and top_prob >= 0.7
            ):
                disagreements += 1
        if disagreements:
            return [f"NLI cross-check ({model_name}) disagreed with LLM stance on {disagreements} passage(s); inspect individual quotes."]
        return []

    async def gather(self, claim: ExtractedClaim, queries: list[str]):
        s, c, notes = self.s, self.http, self.notes
        tasks = [adapters.google_factcheck(c, s, claim.text, claim.language, notes)]
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
