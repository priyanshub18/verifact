"""Provider-agnostic structured-output LLM interface (text + vision).

The LLM is only ever asked to reason over text we retrieved or images the user uploaded.
It is never a source of external facts. Every call validates against a Pydantic schema and retries on validation error.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class LLMNotConfigured(RuntimeError):
    pass


class LLMError(RuntimeError):
    pass


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0

    def add(self, i: int, o: int) -> None:
        self.input_tokens += i
        self.output_tokens += o
        self.calls += 1

    def as_dict(self) -> dict[str, int]:
        return {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens, "calls": self.calls}


class RawProvider(Protocol):
    async def complete_json(self, system: str, user: str, schema: dict) -> tuple[str, int, int]: ...


def extract_json_payload(text: str) -> str:
    """Strip <think>...</think> blocks or markdown fences that some reasoning models emit around JSON."""
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, flags=re.S)
    if m:
        return m.group(1).strip()
    if not cleaned.startswith("{"):
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end > start:
            return cleaned[start:end + 1]
    return cleaned


@dataclass
class LLMClient:
    provider: RawProvider
    usage: Usage = field(default_factory=Usage)
    max_retries: int = 2

    async def structured(self, system: str, user: str, model: type[T]) -> T:
        schema = strict_schema(model.model_json_schema())
        prompt = user
        last_err = ""
        for _ in range(self.max_retries + 1):
            text, i, o = await self.provider.complete_json(system, prompt, schema)
            self.usage.add(i, o)
            try:
                return model.model_validate_json(extract_json_payload(text))
            except ValidationError as e:
                last_err = str(e)[:800]
                prompt = f"{user}\n\nYour previous reply failed schema validation:\n{last_err}\nReturn corrected JSON only."
        raise LLMError(f"LLM output failed validation after retries: {last_err}")

    async def structured_with_image(self, system: str, user: str, image_bytes: bytes, mime: str, model: type[T]) -> T:
        if not hasattr(self.provider, "complete_json_with_image"):
            raise LLMError("The selected LLM provider does not support image inspection.")
        schema = strict_schema(model.model_json_schema())
        prompt = user
        last_err = ""
        for _ in range(self.max_retries + 1):
            text, i, o = await self.provider.complete_json_with_image(system, prompt, image_bytes, mime, schema)
            self.usage.add(i, o)
            try:
                return model.model_validate_json(extract_json_payload(text))
            except ValidationError as e:
                last_err = str(e)[:800]
                prompt = f"{user}\n\nYour previous reply failed schema validation:\n{last_err}\nReturn corrected JSON only."
        raise LLMError(f"Vision LLM output failed validation after retries: {last_err}")


def strict_schema(schema: dict) -> dict:
    """Inline $refs, set additionalProperties:false and require every property (strict JSON-schema mode)."""
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(copy.deepcopy(defs[node["$ref"].split("/")[-1]]))
            node = {k: resolve(v) for k, v in node.items() if k not in ("title", "default")}
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}).keys())
            return node
        if isinstance(node, list):
            return [resolve(x) for x in node]
        return node

    return resolve(schema)
