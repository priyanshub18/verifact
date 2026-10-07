"""Evaluation metrics: precision/recall/F1, macro-F1, AUROC, ECE and reliability-diagram bins. Pure Python."""
from __future__ import annotations

from collections import Counter


def prf(y_true: list[str], y_pred: list[str], labels: list[str]) -> dict:
    out = {}
    for l in labels:
        tp = sum(t == l and p == l for t, p in zip(y_true, y_pred))
        fp = sum(t != l and p == l for t, p in zip(y_true, y_pred))
        fn = sum(t == l and p != l for t, p in zip(y_true, y_pred))
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        out[l] = {"precision": pr, "recall": rc, "f1": 2 * pr * rc / (pr + rc) if pr + rc else 0.0,
                  "support": sum(t == l for t in y_true)}
    out["macro_f1"] = sum(out[l]["f1"] for l in labels) / len(labels)
    out["accuracy"] = sum(t == p for t, p in zip(y_true, y_pred)) / max(len(y_true), 1)
    return out


def auroc(y: list[int], score: list[float]) -> float | None:
    """Mann-Whitney U formulation with tie handling. None if only one class present."""
    pos = [s for t, s in zip(y, score) if t == 1]
    neg = [s for t, s in zip(y, score) if t == 0]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def reliability_bins(conf: list[float], correct: list[bool], n_bins: int = 10) -> list[dict]:
    bins = []
    for b in range(n_bins):
        lo, hi = b / n_bins, (b + 1) / n_bins
        idx = [i for i, c in enumerate(conf) if (lo <= c < hi) or (b == n_bins - 1 and c == 1.0)]
        if idx:
            bins.append({"lo": lo, "hi": hi, "n": len(idx), "mean_conf": sum(conf[i] for i in idx) / len(idx),
                         "accuracy": sum(correct[i] for i in idx) / len(idx)})
    return bins


def ece(conf: list[float], correct: list[bool], n_bins: int = 10) -> float:
    n = len(conf)
    return sum(b["n"] / n * abs(b["accuracy"] - b["mean_conf"]) for b in reliability_bins(conf, correct, n_bins)) if n else 0.0


def confusion(y_true: list[str], y_pred: list[str]) -> dict[str, dict[str, int]]:
    c: dict[str, Counter] = {}
    for t, p in zip(y_true, y_pred):
        c.setdefault(t, Counter())[p] += 1
    return {t: dict(v) for t, v in c.items()}
