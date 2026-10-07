from app.config import Settings
from app.llm.base import LLMClient, LLMError, LLMNotConfigured


class AnthropicProvider:
    def __init__(self, api_key: str, model: str):
        import anthropic

        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = model

    async def complete_json(self, system: str, user: str, schema: dict):
        import anthropic

        try:
            r = await self.client.messages.create(
                model=self.model,
                max_tokens=8000,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={"format": {"type": "json_schema", "schema": schema}},
            )
        except anthropic.APIError as e:
            raise LLMError(f"Anthropic API error: {e}") from e
        if r.stop_reason == "refusal":
            raise LLMError("The model declined this request (safety refusal).")
        text = next((b.text for b in r.content if b.type == "text"), "")
        return text, r.usage.input_tokens, r.usage.output_tokens


class OpenAIProvider:
    def __init__(self, api_key: str, model: str):
        import openai

        self.client = openai.AsyncOpenAI(api_key=api_key)
        self.model = model

    async def complete_json(self, system: str, user: str, schema: dict):
        import openai

        try:
            r = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_schema",
                                 "json_schema": {"name": "out", "strict": True, "schema": schema}},
            )
        except openai.OpenAIError as e:
            raise LLMError(f"OpenAI API error: {e}") from e
        u = r.usage
        return r.choices[0].message.content or "", u.prompt_tokens, u.completion_tokens


class GroqProvider:
    """Groq's OpenAI-compatible endpoint. JSON mode + the schema in the prompt; output is validated by Pydantic
    (and retried) in LLMClient, so we don't depend on per-model strict-schema support. Free-tier 429s are retried."""
    URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str, model: str):
        self.key, self.model = api_key, model

    async def complete_json(self, system: str, user: str, schema: dict):
        import asyncio
        import json

        import httpx

        sys_prompt = (f"{system}\n\nRespond with ONE JSON object only, matching exactly this JSON Schema "
                      f"(no prose, no markdown):\n{json.dumps(schema)}")
        body = {"model": self.model, "temperature": 0, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user}]}
        async with httpx.AsyncClient(timeout=90) as c:
            for attempt in range(5):
                r = await c.post(self.URL, json=body, headers={"Authorization": f"Bearer {self.key}"})
                if r.status_code == 429:
                    wait = min(float(r.headers.get("retry-after", 2 ** attempt * 2)), 30)
                    await asyncio.sleep(wait)
                    continue
                if r.status_code >= 400:
                    raise LLMError(f"Groq API error {r.status_code}: {r.text[:300]}")
                j = r.json()
                u = j.get("usage", {})
                return j["choices"][0]["message"]["content"] or "", u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
        raise LLMError("Groq rate limit (free tier) still exceeded after retries; wait a minute and retry.")


def build_llm(s: Settings, provider: str | None = None) -> LLMClient:
    provider = s.resolve_provider(provider)
    if not provider:
        raise LLMNotConfigured("The selected LLM provider has no API key configured.")
    key, model = s.provider_key(provider), s.provider_model(provider)
    cls = {"groq": GroqProvider, "anthropic": AnthropicProvider, "openai": OpenAIProvider}[provider]
    return LLMClient(cls(key, model))
