"""Client for the optional ml-service. Failures return None so callers fall back to lexical ranking visibly."""
from __future__ import annotations

import httpx


async def cross_encoder_scores(base_url: str, query: str, passages: list[str]) -> tuple[list[float], str] | None:
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{base_url.rstrip('/')}/rerank", json={"query": query, "passages": passages[:64]})
            r.raise_for_status()
            j = r.json()
        return j["scores"], j["model"]
    except (httpx.HTTPError, KeyError, ValueError):
        return None
