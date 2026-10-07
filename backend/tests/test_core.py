from datetime import datetime, timezone

import pytest

from app.llm.base import strict_schema
from app.pipeline.aggregate import aggregate
from app.pipeline.evidence import chunk_text, quote_in_passage, rerank_best_passages, syndication_groups
from app.retrieval.credibility import classify_domain, score_source
from app.schemas import ClaimExtraction, EvidenceItem, Stance, Verdict
from app.security import UnsafeURL, assert_public_url


def ev(i, domain, stance, cred=0.85, rr=1.0, counted=True, date_note=None, url=None):
    c = score_source(url or f"https://{domain}/a", "2025-01-01", "web")
    c.score = cred
    return EvidenceItem(id=i, url=url or f"https://{domain}/a", domain=domain, title="t", publisher=domain,
                        published_at="2025-01-01", retrieved_at=datetime.now(timezone.utc), source_type="web",
                        excerpt="x", stance=stance, quote="q", rationale="r", rerank_score=rr, rerank_method="bm25",
                        credibility=c, counted=counted, date_note=date_note)


def test_strict_schema_inlines_refs_and_closes_objects():
    s = strict_schema(ClaimExtraction.model_json_schema())
    assert "$defs" not in s and "$ref" not in str(s)
    item = s["properties"]["claims"]["items"]
    assert item["additionalProperties"] is False
    assert set(item["required"]) == set(item["properties"])


def test_quote_must_appear_verbatim():
    p = "The agency reported that unemployment fell to 3.9 percent in March, the lowest in two years."
    assert quote_in_passage("unemployment fell to 3.9 percent in March", p)
    assert not quote_in_passage("unemployment rose to 5 percent", p)
    assert not quote_in_passage("fell", p)  # too short to be meaningful


def test_rerank_prefers_relevant_passage():
    docs = ["Cats are small carnivorous mammals often kept as pets in homes around the world.",
            "The Eiffel Tower in Paris was completed in 1889 and is 330 metres tall."]
    ps = rerank_best_passages("how tall is the Eiffel Tower in Paris", docs)
    assert ps[1].score > ps[0].score


def test_syndication_groups_dedupe_copies():
    a = "The central bank raised interest rates by a quarter point on Wednesday citing persistent inflation pressures across the economy"
    b = a + " officials said"
    c = "A completely different story about a football match that ended in a draw after extra time in the capital"
    g = syndication_groups([a, b, c])
    assert g[0] == g[1] != g[2]


def test_chunking_overlaps():
    t = " ".join(str(i) for i in range(300))
    ch = chunk_text(t, 100, 20)
    assert len(ch) >= 3 and ch[0].split()[-20:] == ch[1].split()[:20]


def test_domain_classes():
    assert classify_domain("https://www.cdc.gov/x") == "government"
    assert classify_domain("https://www.theonion.com/x") == "satire"
    assert classify_domain("https://www.reuters.com/x") == "wire"
    assert classify_domain("https://random-blog.example/x") == "unknown"


def test_aggregate_no_evidence_is_unverifiable():
    v, conf, *_ = aggregate([], "none")
    assert v == Verdict.unverifiable and conf is None


def test_aggregate_needs_independent_domains():
    one = [ev(0, "a.com", Stance.supports), ev(1, "a.com", Stance.supports), ev(2, "a.com", Stance.supports)]
    assert aggregate(one, "none")[0] == Verdict.unverifiable


def test_aggregate_true_and_false():
    sup = [ev(i, f"s{i}.com", Stance.supports) for i in range(3)]
    ref = [ev(i, f"r{i}.com", Stance.refutes) for i in range(3)]
    assert aggregate(sup, "none")[0] == Verdict.true
    assert aggregate(ref, "none")[0] == Verdict.false


def test_aggregate_conflict_is_disputed_without_confidence():
    items = [ev(0, "a.com", Stance.supports), ev(1, "b.com", Stance.supports),
             ev(2, "c.com", Stance.refutes), ev(3, "d.com", Stance.refutes)]
    v, conf, *_ = aggregate(items, "none")
    assert v == Verdict.disputed and conf is None


def test_sensitive_topics_need_more_sources():
    two = [ev(0, "a.com", Stance.supports), ev(1, "b.com", Stance.supports)]
    assert aggregate(two, "none")[0] != Verdict.unverifiable
    assert aggregate(two, "health")[0] == Verdict.unverifiable


def test_uncounted_evidence_ignored():
    items = [ev(i, f"s{i}.com", Stance.supports, counted=False) for i in range(4)]
    assert aggregate(items, "none")[0] == Verdict.unverifiable


@pytest.mark.parametrize("url", ["http://127.0.0.1/x", "http://localhost/x", "http://169.254.169.254/latest",
                                 "http://10.0.0.5/", "ftp://example.com/x", "http://[::1]/", "http://user:pw@example.com/"])
async def test_ssrf_blocked(url):
    with pytest.raises(UnsafeURL):
        await assert_public_url(url)
