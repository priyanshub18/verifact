"""Classical image-forensics signals. Each result carries its own limitations: these are probabilistic
indicators, never proof of manipulation."""
from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image, ImageFilter

MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png", b"RIFF": "image/webp"}
MAX_BYTES = 15 * 1024 * 1024


class BadImage(ValueError):
    pass


def sniff(data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise BadImage("File too large")
    for sig, mime in MAGIC.items():
        if data.startswith(sig) and (mime != "image/webp" or data[8:12] == b"WEBP"):
            return mime
    raise BadImage("Unsupported or spoofed file type (checked magic bytes): only JPEG, PNG, WebP")


def _load(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise BadImage("Could not decode image") from e
    if img.width * img.height > 40_000_000:
        raise BadImage("Image dimensions too large")
    return img.convert("RGB")


def _png_b64(arr: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _heat(gray: np.ndarray) -> np.ndarray:
    """0..1 float -> simple black→red→yellow ramp."""
    g = np.clip(gray, 0, 1)
    return np.stack([np.clip(g * 2, 0, 1), np.clip(g * 2 - 1, 0, 1), np.zeros_like(g)], axis=-1).__mul__(255).astype(np.uint8)


def ela(data: bytes, quality: int = 90, scale_to: float | None = None) -> dict:
    """Error Level Analysis: recompress as JPEG and amplify the difference. Regions edited after the last
    compression often differ in error level from their surroundings."""
    mime = sniff(data)
    img = _load(data)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    re = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    diff = np.abs(np.asarray(img, dtype=np.int16) - np.asarray(re, dtype=np.int16)).max(axis=2).astype(np.float32)
    top = float(scale_to or max(diff.max(), 1.0))
    norm = diff / top
    h, w = norm.shape
    # block statistics: how uneven is the error level across the image? (uniform = consistent history)
    bs = max(16, min(h, w) // 16)
    blocks = [norm[y:y + bs, x:x + bs].mean() for y in range(0, h - bs + 1, bs) for x in range(0, w - bs + 1, bs)]
    blocks = np.array(blocks) if blocks else np.array([norm.mean()])
    heat = _heat(np.clip(norm * 3, 0, 1))
    stats = {"mean_error": round(float(diff.mean()), 3), "max_error": round(float(diff.max()), 3),
             "p99_error": round(float(np.percentile(diff, 99)), 3),
             "block_error_cv": round(float(blocks.std() / (blocks.mean() + 1e-6)), 3),
             "hot_block_fraction": round(float((blocks > blocks.mean() + 2 * blocks.std()).mean()), 4)}
    return {"signal": "error_level_analysis", "mime": mime, "width": w, "height": h, "quality": quality, "stats": stats,
            "heatmap_png_base64": _png_b64(heat),
            "interpretation": "Look for regions whose brightness differs sharply from similar-looking neighbours. "
                              "block_error_cv summarises unevenness; it is not a manipulation probability.",
            "limitations": [
                "ELA is unreliable on images that were resized, re-saved or heavily compressed (typical of social media).",
                "PNG/WebP sources have no JPEG history, so results are weak for them.",
                "High-contrast edges and textured regions produce high error without any editing.",
                "Not a verdict. Treat as one indicator among several, alongside provenance and reverse search."]}


def noise_residual(data: bytes) -> dict:
    """High-pass residual (image minus median-filtered image). Inconsistent noise between regions can hint at splicing."""
    mime = sniff(data)
    img = _load(data)
    gray = img.convert("L")
    res = np.abs(np.asarray(gray, dtype=np.float32) - np.asarray(gray.filter(ImageFilter.MedianFilter(3)), dtype=np.float32))
    h, w = res.shape
    bs = max(16, min(h, w) // 8)
    sig = np.array([res[y:y + bs, x:x + bs].std() for y in range(0, h - bs + 1, bs) for x in range(0, w - bs + 1, bs)])
    sig = sig if sig.size else np.array([res.std()])
    return {"signal": "noise_residual", "mime": mime,
            "stats": {"residual_std": round(float(res.std()), 3), "block_noise_cv": round(float(sig.std() / (sig.mean() + 1e-6)), 3)},
            "heatmap_png_base64": _png_b64(_heat(np.clip(res / max(res.max(), 1.0) * 2, 0, 1))),
            "limitations": ["Noise varies naturally with content (sky vs. texture) and with denoising or compression.",
                            "Camera/scene dependent; no calibrated threshold is claimed.",
                            "Indicator only; not proof of splicing."]}
