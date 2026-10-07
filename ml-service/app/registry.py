"""Lazy model registry. Weights are downloaded and loaded on first use, never at import or startup,
so the service boots fast and reports honestly which models are available."""
from __future__ import annotations

import importlib.util
import os
import threading
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSpec:
    key: str
    env: str
    default: str
    task: str
    license: str
    approx_size: str


SPECS = {
    "rerank": ModelSpec("rerank", "RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2", "passage reranking", "Apache-2.0", "~90 MB"),
    "nli": ModelSpec("nli", "NLI_MODEL", "cross-encoder/nli-deberta-v3-xsmall", "entailment / contradiction / neutral", "Apache-2.0", "~280 MB"),
}

_lock = threading.Lock()
_loaded: dict[str, object] = {}
_errors: dict[str, str] = {}


def torch_available() -> bool:
    return importlib.util.find_spec("torch") is not None and importlib.util.find_spec("sentence_transformers") is not None


def model_name(key: str) -> str:
    return os.getenv(SPECS[key].env, SPECS[key].default)


class ModelUnavailable(RuntimeError):
    pass


def get_cross_encoder(key: str):
    if key in _loaded:
        return _loaded[key]
    if not torch_available():
        raise ModelUnavailable("torch/sentence-transformers not installed. Install with: pip install '.[models]'")
    with _lock:
        if key in _loaded:
            return _loaded[key]
        try:
            from sentence_transformers import CrossEncoder
            _loaded[key] = CrossEncoder(model_name(key), device="cpu")
            _errors.pop(key, None)
        except Exception as e:  # noqa: BLE001 - network/disk/etc.; surfaced via /health, never faked
            _errors[key] = f"{type(e).__name__}: {e}"[:300]
            raise ModelUnavailable(f"Could not load {model_name(key)}: {_errors[key]}") from e
    return _loaded[key]


def status() -> dict:
    return {"torch_installed": torch_available(),
            "models": {k: {"name": model_name(k), "task": s.task, "license": s.license, "size": s.approx_size,
                           "loaded": k in _loaded, "last_error": _errors.get(k)} for k, s in SPECS.items()}}
