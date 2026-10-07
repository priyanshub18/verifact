from __future__ import annotations

import re
from dataclasses import dataclass

from rank_bm25 import BM25Plus

_tok = re.compile(r"\w+", re.UNICODE)


def tokenize(t: str) -> list[str]:
    return [w.lower() for w in _tok.findall(t)]


def chunk_text(text: str, size: int = 110, overlap: int = 30) -> list[str]:
    words = text.split()
    if len(words) <= size:
        return [text.strip()] if text.strip() else []
    step = size - overlap
    return [" ".join(words[i:i + size]) for i in range(0, len(words) - overlap, step)]


@dataclass
class Passage:
    doc_index: int
    text: str
    score: float  # normalised 0..1 within the claim's candidate pool
    method: str = "bm25-lexical"


def rerank_best_passages(claim_terms: str, docs: list[str]) -> list[Passage | None]:
    """For each doc return its best-matching chunk (BM25). Lexical only: documented as such in the UI.
    A cross-encoder from ml-service replaces this when ML_SERVICE_URL is set (milestone 2+)."""
    all_chunks: list[tuple[int, str]] = []
    for i, d in enumerate(docs):
        for ch in chunk_text(d):
            all_chunks.append((i, ch))
    if not all_chunks:
        return [None] * len(docs)
    bm = BM25Plus([tokenize(c) or ["_"] for _, c in all_chunks])
    scores = bm.get_scores(tokenize(claim_terms) or ["_"])
    top = max(float(max(scores)), 1e-9)
    best: dict[int, Passage] = {}
    for (i, ch), sc in zip(all_chunks, scores):
        n = max(0.0, float(sc)) / top
        if i not in best or n > best[i].score:
            best[i] = Passage(i, ch, round(n, 3))
    return [best.get(i) for i in range(len(docs))]


def _shingles(t: str, k: int = 5) -> set[str]:
    w = tokenize(t)
    return {" ".join(w[i:i + k]) for i in range(max(1, len(w) - k + 1))}


def syndication_groups(texts: list[str], threshold: float = 0.5) -> list[int]:
    """Cluster near-duplicate texts (wire copies). Returns group id per text."""
    sh = [_shingles(t) for t in texts]
    group = list(range(len(texts)))

    def find(x):
        while group[x] != x:
            group[x] = group[group[x]]
            x = group[x]
        return x

    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            if not sh[i] or not sh[j]:
                continue
            jac = len(sh[i] & sh[j]) / len(sh[i] | sh[j])
            if jac >= threshold:
                group[find(j)] = find(i)
    return [find(i) for i in range(len(texts))]


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def quote_in_passage(quote: str, passage: str) -> bool:
    q = norm_ws(quote).strip(" .\"'“”…")
    return len(q) >= 12 and q in norm_ws(passage)
