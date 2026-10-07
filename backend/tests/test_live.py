"""Live suite: hits real services. Skipped unless the relevant keys are present.  Run: pytest -m live"""
import os

import httpx
import pytest

from app.config import Settings
from app.retrieval import adapters

pytestmark = pytest.mark.live


async def test_wikipedia_and_pubmed_live():
    n = adapters.SourceNotes()
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "VeriFactBot/0.1"}) as c:
        assert await adapters.wikipedia(c, "Eiffel Tower", "en", n)
        assert await adapters.pubmed(c, Settings(_env_file=None), "measles vaccine effectiveness", n)


@pytest.mark.skipif(not os.getenv("ANTHROPIC_API_KEY") or not os.getenv("TAVILY_API_KEY"), reason="needs LLM + search keys")
async def test_full_pipeline_live():
    from app.llm.providers import build_llm
    from app.pipeline.orchestrator import Pipeline
    s = Settings(_env_file=None)
    events = []

    async def emit(e): events.append(e)

    res = await Pipeline(s, build_llm(s), emit).run("live1", "The Eiffel Tower is located in Paris, France.", None)
    assert res.status == "done" and res.claims
    assert all(e.url.startswith("http") for c in res.claims for e in c.evidence)
