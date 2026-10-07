"""Heuristic source credibility.

This is a transparent rule-based prior, NOT a ground-truth rating. The lists below are small, public,
hand-curated category lists (wire services, IFCN fact-checkers, government TLDs, known satire sites).
Plug licensed data (Media Bias/Fact Check, NewsGuard) in via `extra_ratings` when you have access.
Domain age (WHOIS) is not implemented yet and is reported as such.
"""
from __future__ import annotations

from datetime import date, datetime

import tldextract

from app.schemas import CredibilityBreakdown

_extract = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)  # offline: bundled snapshot only

WIRE = {"reuters.com", "apnews.com", "afp.com", "bbc.com", "bbc.co.uk", "npr.org", "pbs.org"}
FACTCHECKERS = {"snopes.com", "politifact.com", "factcheck.org", "fullfact.org", "factcheck.afp.com",
                "altnews.in", "boomlive.in", "leadstories.com", "checkyourfact.com", "africacheck.org",
                "maldita.es", "newtral.es", "factcheckni.org", "euvsdisinfo.eu"}
INTERGOV = {"who.int", "un.org", "worldbank.org", "imf.org", "oecd.org", "europa.eu", "ec.europa.eu"}
SCHOLARLY = {"pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "nature.com", "science.org", "thelancet.com",
             "nejm.org", "bmj.com", "arxiv.org", "doi.org", "springer.com", "sciencedirect.com", "jamanetwork.com"}
REFERENCE = {"wikipedia.org", "wikidata.org", "britannica.com"}
SATIRE = {"theonion.com", "babylonbee.com", "clickhole.com", "thebeaverton.com", "waterfordwhispersnews.com",
          "newsthump.com", "thedailymash.co.uk", "duffelblog.com"}
USER_GENERATED = {"reddit.com", "facebook.com", "x.com", "twitter.com", "tiktok.com", "instagram.com",
                  "medium.com", "substack.com", "quora.com", "youtube.com", "blogspot.com", "wordpress.com"}

BASE = {"wire": 0.85, "factchecker": 0.85, "government": 0.85, "intergov": 0.88, "scholarly": 0.85,
        "reference": 0.6, "edu": 0.75, "news": 0.55, "satire": 0.05, "ugc": 0.25, "unknown": 0.4}


def registered_domain(url_or_host: str) -> str:
    ext = _extract(url_or_host)
    return ext.top_domain_under_public_suffix or ext.domain or url_or_host


def classify_domain(url: str, extra_ratings: dict[str, str] | None = None) -> str:
    ext = _extract(url)
    rd, suffix = ext.top_domain_under_public_suffix, ext.suffix
    host = ".".join(p for p in (ext.subdomain, rd) if p)
    if extra_ratings and rd in extra_ratings:
        return extra_ratings[rd]
    if rd in SATIRE:
        return "satire"
    if rd in FACTCHECKERS:
        return "factchecker"
    if rd in WIRE:
        return "wire"
    if rd in INTERGOV:
        return "intergov"
    if rd in SCHOLARLY or host in SCHOLARLY:
        return "scholarly"
    if rd in REFERENCE:
        return "reference"
    if rd in USER_GENERATED:
        return "ugc"
    if suffix == "gov" or suffix.endswith(".gov") or suffix.startswith("gov.") or ".gov." in f".{suffix}.":
        return "government"
    if suffix == "edu" or suffix.startswith("ac.") or suffix.endswith(".edu"):
        return "edu"
    return "unknown"


def _days_since(published: str | None, today: date) -> int | None:
    if not published:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y"):
        try:
            return (today - datetime.strptime(published[: len(datetime.now().strftime(fmt))], fmt).date()).days
        except ValueError:
            continue
    try:
        return (today - datetime.fromisoformat(published.replace("Z", "+00:00")).date()).days
    except ValueError:
        return None


def score_source(url: str, published_at: str | None, source_type: str, today: date | None = None,
                 extra_ratings: dict[str, str] | None = None) -> CredibilityBreakdown:
    today = today or date.today()
    cls = classify_domain(url, extra_ratings)
    if cls == "unknown" and source_type == "news":
        cls = "news"
    score = BASE.get(cls, 0.4)
    signals = [f"Domain category: {cls} (rule-based prior {BASE.get(cls, 0.4):.2f})"]
    https = url.startswith("https://")
    if not https:
        score -= 0.08
        signals.append("Not served over HTTPS (-0.08)")
    primary = cls in ("government", "intergov", "scholarly", "wire")
    if primary:
        signals.append("Primary / institutional source")
    age = _days_since(published_at, today)
    if age is None:
        signals.append("Publication date unknown")
    elif age > 365 * 3:
        signals.append(f"Published {age // 365} years ago; may be outdated")
    if cls == "satire":
        signals.append("Known satire outlet: content is not factual reporting")
    signals.append("Domain age (WHOIS): not implemented")
    return CredibilityBreakdown(score=round(max(0.0, min(1.0, score)), 2), domain_class=cls, https=https,
                                is_primary=primary, recency_days=age, signals=signals)
