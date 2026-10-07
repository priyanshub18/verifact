"""Control-flow tests for the pipeline. The LLM and HTTP here are scripted test doubles: they verify that
the orchestrator wires steps together, enforces quote verification and refuses to force a verdict.
They say NOTHING about accuracy; accuracy is measured in /eval against real benchmarks."""
import httpx
import pytest
import respx

from app.config import Settings
from app.llm.base import LLMClient
from app.pipeline.orchestrator import Pipeline
from app.schemas import Verdict

PASSAGE = ("The ministry of health announced on Tuesday that the vaccination campaign reached 4 million people in "
           "the first month, according to official figures released by the department.")


class ScriptedProvider:
    def __init__(self, quote):
        self.quote = quote

    async def complete_json(self, system, user, schema):
        props = schema["properties"]
        if "claims" in props:
            out = {"claims": [{"text": "The vaccination campaign reached 4 million people in its first month.",
                               "kind": "factual", "checkworthy": True, "topic_sensitivity": "none", "claim_date": None,
                               "language": "en", "original_span": "reached 4 million people"}]}
        elif "supporting" in props:
            out = {"supporting": ["vaccination campaign 4 million first month"], "disconfirming": ["vaccination campaign figures disputed"],
                   "en_queries": []}
        else:
            import re
            ids = [int(i) for i in re.findall(r"passage_id=(\d+)", user)]
            out = {"results": [{"passage_id": i, "stance": "supports", "quote": self.quote, "rationale": "r",
                                "evidence_date_note": None} for i in ids]}
        import json
        return json.dumps(out), 10, 5


@pytest.fixture(autouse=True)
def hermetic(monkeypatch):
    async def none(*a, **k):
        return []
    monkeypatch.setattr("app.retrieval.adapters.duckduckgo", none)
    monkeypatch.setattr("app.retrieval.adapters.gdelt", none)


@pytest.fixture
def settings():
    return Settings(tavily_api_key="x", anthropic_api_key="x", _env_file=None)


async def run(settings, quote, tmp_domains=("a.example.org", "b.example.net", "c.example.com")):
    events = []

    async def emit(e):
        events.append(e)

    with respx.mock(assert_all_called=False) as m:
        m.post("https://api.tavily.com/search").mock(return_value=httpx.Response(200, json={"results": [
            {"url": f"https://{d}/story", "title": "Story", "content": PASSAGE + f" Source {d}."} for d in tmp_domains]}))
        m.get(url__regex=r"https://.*wikipedia\.org/.*").mock(return_value=httpx.Response(200, json={"query": {"search": []}}))
        m.get(url__regex=r"https://api\.crossref\.org/.*").mock(return_value=httpx.Response(200, json={"message": {"items": []}}))
        p = Pipeline(settings, LLMClient(ScriptedProvider(quote)), emit)
        # pages themselves can't be fetched in this test -> snippet fallback path
        m.get(url__regex=r"https://(a|b|c)\.example.*").mock(return_value=httpx.Response(404))
        res = await p.run("t1", "The ministry said the campaign reached 4 million people in its first month.", None)
    return res, events


async def test_pipeline_emits_real_steps_and_cites(settings):
    res, events = await run(settings, "reached 4 million people in the first month")
    steps = [e["step"] for e in events]
    assert steps[:2] == ["claims", "claims"] and "search" in steps and steps[-1] == "done"
    claim = res.claims[0]
    assert claim.evidence and all(e.url.startswith("https://") for e in claim.evidence)
    assert claim.confidence_calibrated is False
    assert any("snippet used" in (e.discard_reason or "") for e in claim.evidence)


async def test_fabricated_quote_is_discarded_not_counted(settings):
    res, _ = await run(settings, "this sentence does not appear anywhere in the passage at all")
    claim = res.claims[0]
    assert claim.verdict == Verdict.unverifiable
    assert all(not e.counted for e in claim.evidence)
    assert any("quote not found" in (e.discard_reason or "") for e in claim.evidence)
