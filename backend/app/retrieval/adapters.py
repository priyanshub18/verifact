"""Thin async clients for real evidence sources. Each returns [] on failure and records a note,
never invented results."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from app.config import Settings
from app.schemas import ExistingFactCheck


@dataclass
class SearchHit:
    url: str
    title: str
    publisher: str
    published_at: str | None
    snippet: str
    source_type: str  # web | news | wikipedia | scholarly
    query: str = ""


@dataclass
class SourceNotes:
    notes: list[str] = field(default_factory=list)

    def add(self, msg: str) -> None:
        self.notes.append(msg)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def google_factcheck(c: httpx.AsyncClient, s: Settings, query: str, lang: str | None,
                           notes: SourceNotes) -> list[ExistingFactCheck]:
    if not s.google_factcheck_api_key:
        return []
    params = {"query": query, "key": s.google_factcheck_api_key, "pageSize": 10}
    if lang:
        params["languageCode"] = lang
    try:
        r = await c.get("https://factchecktools.googleapis.com/v1alpha1/claims:search", params=params)
        r.raise_for_status()
    except httpx.HTTPError as e:
        notes.add(f"Google Fact Check lookup failed: {type(e).__name__}")
        return []
    out = []
    for cl in r.json().get("claims", []):
        for rev in cl.get("claimReview", []):
            out.append(ExistingFactCheck(
                claim_text=cl.get("text", ""), claimant=cl.get("claimant"),
                publisher=rev.get("publisher", {}).get("name", ""), url=rev.get("url", ""),
                title=rev.get("title", ""), rating=rev.get("textualRating", ""),
                review_date=(rev.get("reviewDate") or "")[:10] or None, retrieved_at=_now()))
    return out


async def tavily(c: httpx.AsyncClient, s: Settings, query: str, notes: SourceNotes, news: bool = False) -> list[SearchHit]:
    try:
        r = await c.post("https://api.tavily.com/search", json={
            "api_key": s.tavily_api_key, "query": query, "max_results": 8,
            "topic": "news" if news else "general", "include_raw_content": False})
        r.raise_for_status()
    except httpx.HTTPError as e:
        notes.add(f"Tavily search failed: {type(e).__name__}")
        return []
    return [SearchHit(x["url"], x.get("title", ""), "", (x.get("published_date") or None), x.get("content", ""),
                      "news" if news else "web", query) for x in r.json().get("results", [])]


async def brave(c: httpx.AsyncClient, s: Settings, query: str, notes: SourceNotes) -> list[SearchHit]:
    try:
        r = await c.get("https://api.search.brave.com/res/v1/web/search", params={"q": query, "count": 8},
                        headers={"X-Subscription-Token": s.brave_api_key, "Accept": "application/json"})
        r.raise_for_status()
    except httpx.HTTPError as e:
        notes.add(f"Brave search failed: {type(e).__name__}")
        return []
    return [SearchHit(x["url"], x.get("title", ""), "", (x.get("page_age") or "")[:10] or None,
                      re.sub(r"<[^>]+>", "", x.get("description", "")), "web", query)
            for x in r.json().get("web", {}).get("results", [])]


async def wikipedia(c: httpx.AsyncClient, query: str, lang: str, notes: SourceNotes) -> list[SearchHit]:
    base = f"https://{lang}.wikipedia.org/w/api.php"
    try:
        r = await c.get(base, params={"action": "query", "list": "search", "srsearch": query, "srlimit": 3,
                                      "format": "json", "srprop": "snippet|timestamp"})
        r.raise_for_status()
        hits = r.json().get("query", {}).get("search", [])
        out = []
        for h in hits:
            ex = await c.get(base, params={"action": "query", "prop": "extracts", "explaintext": 1, "exintro": 0,
                                           "exchars": 2500, "pageids": h["pageid"], "format": "json"})
            ex.raise_for_status()
            text = ex.json()["query"]["pages"][str(h["pageid"])].get("extract", "")
            title = h["title"]
            out.append(SearchHit(f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}", title, "Wikipedia",
                                 (h.get("timestamp") or "")[:10] or None, text, "wikipedia", query))
        return out
    except (httpx.HTTPError, KeyError) as e:
        notes.add(f"Wikipedia lookup failed: {type(e).__name__}")
        return []


async def pubmed(c: httpx.AsyncClient, s: Settings, query: str, notes: SourceNotes) -> list[SearchHit]:
    p = {"db": "pubmed", "retmode": "json"}
    if s.ncbi_api_key:
        p["api_key"] = s.ncbi_api_key
    try:
        r = await c.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                        params={**p, "term": query, "retmax": 4, "sort": "relevance"})
        r.raise_for_status()
        ids = r.json()["esearchresult"]["idlist"]
        if not ids:
            return []
        f = await c.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
                        params={"db": "pubmed", "id": ",".join(ids), "retmode": "xml", **({"api_key": s.ncbi_api_key} if s.ncbi_api_key else {})})
        f.raise_for_status()
    except (httpx.HTTPError, KeyError) as e:
        notes.add(f"PubMed lookup failed: {type(e).__name__}")
        return []
    import xml.etree.ElementTree as ET
    out = []
    for art in ET.fromstring(f.text).iter("PubmedArticle"):
        pmid = art.findtext(".//PMID") or ""
        title = "".join(art.find(".//ArticleTitle").itertext()) if art.find(".//ArticleTitle") is not None else ""
        abstract = " ".join("".join(t.itertext()) for t in art.findall(".//AbstractText"))
        year = art.findtext(".//PubDate/Year")
        if abstract:
            out.append(SearchHit(f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", title,
                                 art.findtext(".//Journal/Title") or "PubMed", year, abstract, "scholarly", query))
    return out


async def crossref(c: httpx.AsyncClient, s: Settings, query: str, notes: SourceNotes) -> list[SearchHit]:
    params = {"query.bibliographic": query, "rows": 3, "select": "DOI,title,abstract,issued,container-title,URL"}
    if s.contact_email:
        params["mailto"] = s.contact_email
    try:
        r = await c.get("https://api.crossref.org/works", params=params)
        r.raise_for_status()
    except httpx.HTTPError as e:
        notes.add(f"Crossref lookup failed: {type(e).__name__}")
        return []
    out = []
    for it in r.json()["message"]["items"]:
        abstract = re.sub(r"<[^>]+>", " ", it.get("abstract", "") or "").strip()
        if not abstract:
            continue
        yr = (it.get("issued", {}).get("date-parts") or [[None]])[0][0]
        out.append(SearchHit(it["URL"], (it.get("title") or [""])[0], (it.get("container-title") or ["Crossref"])[0],
                             str(yr) if yr else None, abstract, "scholarly", query))
    return out


async def duckduckgo(query: str, notes: SourceNotes, max_results: int = 6) -> list[SearchHit]:
    """Free, keyless web search via the `ddgs` package (unofficial; may rate-limit)."""
    import asyncio

    def _run():
        from ddgs import DDGS
        last: Exception | None = None
        for backend in ("auto", "bing", "auto"):  # unofficial backends are flaky: fall through, then retry once
            try:
                res = list(DDGS().text(query, max_results=max_results, backend=backend))
                if res:
                    return res
            except Exception as e:  # noqa: BLE001
                last = e
        if last:
            raise last
        return []

    try:
        res = await asyncio.wait_for(asyncio.to_thread(_run), timeout=40)
    except Exception as e:  # noqa: BLE001 - library raises varied errors
        notes.add(f"Web search (DuckDuckGo/Bing) failed: {type(e).__name__}")
        return []
    return [SearchHit(x["href"], x.get("title", ""), "", None, x.get("body", ""), "web", query)
            for x in res if x.get("href")]


async def gdelt(c: httpx.AsyncClient, query: str, notes: SourceNotes) -> list[SearchHit]:
    """GDELT DOC 2.0 article list (free, keyless). Returns titles/URLs; page text is fetched later."""
    try:
        r = await c.get("https://api.gdeltproject.org/api/v2/doc/doc",
                        params={"query": query, "mode": "artlist", "format": "json", "maxrecords": 6, "sort": "hybridrel"})
        r.raise_for_status()
        arts = r.json().get("articles", [])
    except (httpx.HTTPError, ValueError) as e:
        notes.add(f"GDELT lookup failed: {type(e).__name__}")
        return []
    return [SearchHit(a["url"], a.get("title", ""), a.get("domain", ""),
                      (a.get("seendate") or "")[:8] and f"{a['seendate'][:4]}-{a['seendate'][4:6]}-{a['seendate'][6:8]}",
                      a.get("title", ""), "news", query) for a in arts if a.get("url")]
