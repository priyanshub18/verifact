from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin

import httpx
import trafilatura

from app.config import Settings
from app.security import UnsafeURL, assert_public_url

UA = "VeriFactBot/0.1 (+fact-checking research; respects robots via publisher access only)"


@dataclass
class FetchedPage:
    url: str
    final_url: str
    title: str | None
    author: str | None
    published_at: str | None
    text: str | None
    retrieved_at: datetime
    error: str | None = None  # human-readable failure reason (paywall, blocked, timeout...)


async def fetch_page(url: str, s: Settings, client: httpx.AsyncClient | None = None) -> FetchedPage:
    now = datetime.now(timezone.utc)
    own = client is None
    client = client or httpx.AsyncClient(timeout=s.fetch_timeout_seconds, follow_redirects=False,
                                         headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
    try:
        cur = url
        for _ in range(5):
            await assert_public_url(cur)
            async with client.stream("GET", cur) as r:
                if r.is_redirect:
                    cur = urljoin(cur, r.headers.get("location", ""))
                    continue
                if r.status_code in (401, 402, 403, 429):
                    return FetchedPage(url, cur, None, None, None, None, now,
                                       f"Publisher refused access (HTTP {r.status_code}); likely paywall or bot block.")
                if r.status_code >= 400:
                    return FetchedPage(url, cur, None, None, None, None, now, f"HTTP {r.status_code}")
                ctype = r.headers.get("content-type", "")
                if "html" not in ctype and "xml" not in ctype and "text" not in ctype:
                    return FetchedPage(url, cur, None, None, None, None, now, f"Unsupported content type: {ctype}")
                body = b""
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > s.fetch_max_bytes:
                        break
                html = body.decode(r.encoding or "utf-8", errors="replace")
            meta = trafilatura.extract_metadata(html, default_url=cur)
            text = trafilatura.extract(html, url=cur, include_comments=False, include_tables=False)
            if not text or len(text) < 200:
                return FetchedPage(url, cur, getattr(meta, "title", None), getattr(meta, "author", None),
                                   getattr(meta, "date", None), None, now,
                                   "Could not extract readable article text (possible paywall or JavaScript-only page).")
            return FetchedPage(url, cur, getattr(meta, "title", None), getattr(meta, "author", None),
                               getattr(meta, "date", None), text, now)
        return FetchedPage(url, cur, None, None, None, None, now, "Too many redirects")
    except UnsafeURL as e:
        return FetchedPage(url, url, None, None, None, None, now, f"Blocked: {e}")
    except httpx.TimeoutException:
        return FetchedPage(url, url, None, None, None, None, now, "Timed out fetching the page.")
    except httpx.HTTPError as e:
        return FetchedPage(url, url, None, None, None, None, now, f"Network error: {type(e).__name__}")
    finally:
        if own:
            await client.aclose()
