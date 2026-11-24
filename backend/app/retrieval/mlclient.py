"""Client for the optional ml-service. Failures return None so callers fall back gracefully and visibly."""
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


async def nli_scores(base_url: str, pairs: list[tuple[str, str]]) -> tuple[list[dict[str, float]], str] | None:
    """Premise = evidence passage, hypothesis = claim. Returns per-pair label probabilities + model name."""
    if not pairs:
        return [], ""
    try:
        payload = {"pairs": [{"premise": p[:4000], "hypothesis": h[:1000]} for p, h in pairs[:32]]}
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{base_url.rstrip('/')}/nli", json=payload)
            r.raise_for_status()
            j = r.json()
        return j["results"], j["model"]
    except (httpx.HTTPError, KeyError, ValueError):
        return None


async def analyze_image(base_url: str, data: bytes, filename: str, mime: str) -> dict | None:
    """Run full image forensics (EXIF/C2PA, ELA, noise, spectral) inside the isolated ml-service."""
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"{base_url.rstrip('/')}/forensics/analyze",
                files={"file": (filename or "upload.jpg", data, mime or "application/octet-stream")},
            )
            r.raise_for_status()
            return r.json()
    except (httpx.HTTPError, ValueError):
        return None
