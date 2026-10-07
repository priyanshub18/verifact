import httpx
import respx

from app.config import Settings
from app.llm.base import LLMClient
from app.llm.providers import GroqProvider, build_llm
from app.schemas import QueryPlan

URL = GroqProvider.URL


async def test_groq_retries_on_429_then_validates(monkeypatch):
    async def nosleep(_): pass
    monkeypatch.setattr("asyncio.sleep", nosleep)
    good = {"choices": [{"message": {"content": '{"supporting":["a"],"disconfirming":["b"],"en_queries":[]}'}}],
            "usage": {"prompt_tokens": 7, "completion_tokens": 3}}
    with respx.mock() as m:
        route = m.post(URL).mock(side_effect=[httpx.Response(429, headers={"retry-after": "1"}), httpx.Response(200, json=good)])
        llm = LLMClient(GroqProvider("k", "llama-3.3-70b-versatile"))
        out = await llm.structured("sys", "user", QueryPlan)
    assert out.supporting == ["a"] and route.call_count == 2 and llm.usage.input_tokens == 7
    body = route.calls.last.request.content.decode()
    assert "json_object" in body and "disconfirming" in body  # schema is embedded in the prompt


async def test_invalid_json_is_retried_with_error_feedback():
    bad = {"choices": [{"message": {"content": '{"supporting": "not a list"}'}}], "usage": {}}
    good = {"choices": [{"message": {"content": '{"supporting":[],"disconfirming":[],"en_queries":[]}'}}], "usage": {}}
    with respx.mock() as m:
        r = m.post(URL).mock(side_effect=[httpx.Response(200, json=bad), httpx.Response(200, json=good)])
        await LLMClient(GroqProvider("k", "m")).structured("s", "u", QueryPlan)
    assert r.call_count == 2 and "failed schema validation" in r.calls.last.request.content.decode()


def test_explicit_unconfigured_provider_is_rejected_not_swapped():
    s = Settings(groq_api_key="g", _env_file=None)
    assert s.resolve_provider("anthropic") is None
    assert s.resolve_provider(None) == "groq"
    import pytest
    from app.llm.base import LLMNotConfigured
    with pytest.raises(LLMNotConfigured):
        build_llm(s, "anthropic")


async def test_ml_service_rerank_used_and_fallback_noted():
    from app.retrieval.mlclient import cross_encoder_scores
    with respx.mock() as m:
        m.post("http://ml:8100/rerank").mock(return_value=httpx.Response(200, json={"scores": [0.9, 0.1], "model": "ce"}))
        assert await cross_encoder_scores("http://ml:8100", "q", ["a", "b"]) == ([0.9, 0.1], "ce")
        m.post("http://ml:8100/rerank").mock(return_value=httpx.Response(503))
        assert await cross_encoder_scores("http://ml:8100", "q", ["a"]) is None
