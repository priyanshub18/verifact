"""Built-in image forensics & validation for the backend.
Used directly for upload magic-byte verification, vision-API image preparation, and as a zero-config
local fallback when ML_SERVICE_URL is not configured or unreachable.
"""
from __future__ import annotations

import base64
import hashlib
import io
import re

import numpy as np
from PIL import ExifTags, Image, ImageFilter

MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png", b"RIFF": "image/webp"}
EXT_FOR_MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_BYTES = 15 * 1024 * 1024

AI_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Stable Diffusion parameters", re.compile(r"(negative prompt:|steps:\s*\d+.*sampler:|cfg scale:\s*[\d.]+)", re.I)),
    ("ComfyUI workflow", re.compile(r'("class_type"\s*:\s*"KSampler"|comfyui)', re.I)),
    ("Midjourney", re.compile(r"\bmidjourney\b", re.I)),
    ("DALL-E / OpenAI image", re.compile(r"(dall[·\- ]?e|openai.*(image|gpt-image|chatgpt)|trainedAlgorithmicMedia.*openai)", re.I)),
    ("Google AI / Imagen", re.compile(r"(made with google ai|google\s+imagen|synthid)", re.I)),
    ("Adobe Firefly", re.compile(r"(adobe\s+firefly|firefly\s+generative)", re.I)),
    ("AI generator tag", re.compile(r"(novelai|ideogram|leonardo\.ai|bing image creator|flux\.\d|invokeai|automatic1111|civitai)", re.I)),
]

EDITOR_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Adobe Photoshop", re.compile(r"adobe\s+photoshop", re.I)),
    ("Adobe Lightroom", re.compile(r"adobe\s+(photoshop\s+)?lightroom", re.I)),
    ("GIMP", re.compile(r"\bgimp\b", re.I)),
    ("Affinity Photo", re.compile(r"affinity\s+photo", re.I)),
    ("Canva", re.compile(r"\bcanva\b", re.I)),
    ("Photopea / Pixlr / Picsart", re.compile(r"\b(photopea|pixlr|picsart|snapseed|faceapp|remini|capcut)\b", re.I)),
]

C2PA_MARKERS = [
    (b"c2pa", "C2PA manifest marker"),
    (b"jumb", "JUMBF provenance container"),
    (b"trainedAlgorithmicMedia", "C2PA digitalSourceType: trainedAlgorithmicMedia (AI-generated)"),
    (b"compositeSynthetic", "C2PA digitalSourceType: compositeSynthetic (AI/edited composite)"),
    (b"digitalCapture", "C2PA digitalSourceType: digitalCapture (camera capture)"),
]


class BadImage(ValueError):
    pass


def sniff_image(data: bytes, max_bytes: int = MAX_BYTES) -> str:
    if not data:
        raise BadImage("Empty image file")
    if len(data) > max_bytes:
        raise BadImage(f"Image exceeds {max_bytes // (1024 * 1024)} MB limit")
    for sig, mime in MAGIC.items():
        if data.startswith(sig) and (mime != "image/webp" or data[8:12] == b"WEBP"):
            return mime
    raise BadImage("Unsupported or spoofed image type (checked magic bytes): only JPEG, PNG, and WebP are accepted.")


def prepare_for_vision(data: bytes, max_dim: int = 1280) -> tuple[bytes, str]:
    """Safely decode and downscale an image to a compact JPEG suitable for vision LLM APIs."""
    sniff_image(data)
    img = _open_raw(data).convert("RGB")
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue(), "image/jpeg"


def _open_raw(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise BadImage("Could not decode image") from e
    if img.width * img.height > 40_000_000:
        raise BadImage("Image dimensions exceed 40 megapixels")
    return img


def _png_b64(arr: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _heat(gray: np.ndarray) -> np.ndarray:
    g = np.clip(gray, 0, 1)
    return np.stack([np.clip(g * 2, 0, 1), np.clip(g * 2 - 1, 0, 1), np.zeros_like(g)], axis=-1).__mul__(255).astype(np.uint8)


def _dhash(img: Image.Image) -> str:
    small = img.convert("L").resize((9, 8), Image.Resampling.BILINEAR)
    arr = np.asarray(small, dtype=np.int16)
    bits = (arr[:, 1:] > arr[:, :-1]).flatten()
    val = 0
    for b in bits:
        val = (val << 1) | int(b)
    return f"{val:016x}"


def _clean_str(v: object) -> str | None:
    if v is None:
        return None
    s = str(v).replace("\x00", "").strip()
    return s[:200] if s else None


def analyze_local(data: bytes, ela_quality: int = 90) -> dict:
    """Run EXIF/C2PA/AI-tag inspection, ELA, noise residual, and spectral analysis locally."""
    mime = sniff_image(data)
    raw = _open_raw(data)
    img = raw.convert("RGB")
    sha256 = hashlib.sha256(data).hexdigest()
    dhash = _dhash(img)

    exif_map: dict[str, object] = {}
    try:
        exif = raw.getexif()
        if exif:
            for k, v in exif.items():
                exif_map[ExifTags.TAGS.get(k, str(k))] = v
            try:
                for k, v in (exif.get_ifd(0x8769) or {}).items():
                    exif_map.setdefault(ExifTags.TAGS.get(k, str(k)), v)
            except Exception:  # noqa: BLE001
                pass
    except Exception:  # noqa: BLE001
        pass

    camera_make = _clean_str(exif_map.get("Make"))
    camera_model = _clean_str(exif_map.get("Model"))
    lens_model = _clean_str(exif_map.get("LensModel"))
    software = _clean_str(exif_map.get("Software"))
    dt_orig = _clean_str(exif_map.get("DateTimeOriginal") or exif_map.get("DateTimeDigitized"))
    dt_mod = _clean_str(exif_map.get("DateTime"))
    has_gps = "GPSInfo" in exif_map

    text_blobs: list[str] = []
    for k, v in (raw.info or {}).items():
        if isinstance(v, str):
            text_blobs.append(f"{k}: {v[:4000]}")
        elif isinstance(v, bytes) and len(v) < 200_000:
            text_blobs.append(f"{k}: {v.decode('latin1', errors='ignore')[:4000]}")
    for k in ("Software", "ImageDescription", "Artist", "Copyright", "UserComment", "XPComment", "Make", "Model"):
        if k in exif_map:
            text_blobs.append(f"{k}: {str(exif_map[k])[:1000]}")
    raw_head = data[:262_144] + data[-65_536:]
    text_blobs.append(raw_head.decode("latin1", errors="ignore"))
    combined_text = "\n".join(text_blobs)

    c2pa_signals = [label for marker, label in C2PA_MARKERS if marker in data]
    ai_signals = [label for label, pat in AI_PATTERNS if pat.search(combined_text)]
    if any("trainedAlgorithmicMedia" in s or "compositeSynthetic" in s for s in c2pa_signals):
        ai_signals.append("C2PA synthetic media assertion")
    ai_signals = list(dict.fromkeys(ai_signals))
    editor_signals = list(dict.fromkeys(label for label, pat in EDITOR_PATTERNS if pat.search(combined_text)))

    notes: list[str] = []
    if not exif_map:
        notes.append("No EXIF metadata found (common in social-media reposts, screenshots, and AI-generated images).")
    else:
        cam = " ".join(p for p in (camera_make, camera_model) if p)
        if cam:
            notes.append(f"Camera EXIF recorded: {cam}.")
        if dt_orig:
            notes.append(f"Original capture timestamp in EXIF: {dt_orig} (note: EXIF timestamps can be edited).")
        if has_gps:
            notes.append("GPS location tag present in EXIF (coordinates omitted for privacy).")
    if ai_signals:
        notes.append(f"AI-generation metadata marker(s) detected: {', '.join(ai_signals)}.")
    if editor_signals:
        notes.append(f"Image editing software trace found: {', '.join(editor_signals)}.")
    if c2pa_signals:
        notes.append(f"C2PA / Content Credentials marker(s) found: {', '.join(c2pa_signals)}.")

    meta = {
        "mime": mime, "format": raw.format or mime.split("/")[-1].upper(),
        "width": img.width, "height": img.height, "file_size_bytes": len(data),
        "sha256": sha256, "dhash": dhash,
        "has_exif": bool(exif_map), "exif_field_count": len(exif_map),
        "camera_make": camera_make, "camera_model": camera_model, "lens_model": lens_model,
        "software": software, "datetime_original": dt_orig, "datetime_modified": dt_mod, "has_gps": has_gps,
        "c2pa_detected": bool(c2pa_signals), "c2pa_signals": c2pa_signals,
        "ai_metadata_detected": bool(ai_signals), "ai_metadata_signals": ai_signals,
        "editing_software_detected": bool(editor_signals), "editing_software_signals": editor_signals,
        "notes": notes,
    }

    # ELA (cap visualization size to 1024px max edge for fast JSON payload)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=ela_quality)
    re_img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    diff = np.abs(np.asarray(img, dtype=np.int16) - np.asarray(re_img, dtype=np.int16)).max(axis=2).astype(np.float32)
    norm = diff / float(max(diff.max(), 1.0))
    h, w = norm.shape
    bs = max(16, min(h, w) // 16)
    blocks = np.array([norm[y:y + bs, x:x + bs].mean() for y in range(0, h - bs + 1, bs) for x in range(0, w - bs + 1, bs)] or [norm.mean()])
    ela_heat_img = Image.fromarray(_heat(np.clip(norm * 3, 0, 1)))
    if max(w, h) > 900:
        ela_heat_img.thumbnail((900, 900))
    ela_stats = {
        "mean_error": round(float(diff.mean()), 3), "max_error": round(float(diff.max()), 3),
        "p99_error": round(float(np.percentile(diff, 99)), 3),
        "block_error_cv": round(float(blocks.std() / (blocks.mean() + 1e-6)), 3),
        "hot_block_fraction": round(float((blocks > blocks.mean() + 2 * blocks.std()).mean()), 4),
    }
    ela_res = {
        "signal": "error_level_analysis", "mime": mime, "width": w, "height": h, "quality": ela_quality,
        "stats": ela_stats, "heatmap_png_base64": _png_b64(np.asarray(ela_heat_img)),
        "interpretation": "Bright pockets that differ sharply from similar-looking neighbours can suggest post-compression edits.",
        "limitations": ["ELA weakens after social-media resizing or recompression.", "Not standalone proof of manipulation."],
    }

    # Noise residual
    gray = img.convert("L")
    res = np.abs(np.asarray(gray, dtype=np.float32) - np.asarray(gray.filter(ImageFilter.MedianFilter(3)), dtype=np.float32))
    nbs = max(16, min(h, w) // 8)
    sig = np.array([res[y:y + nbs, x:x + nbs].std() for y in range(0, h - nbs + 1, nbs) for x in range(0, w - nbs + 1, nbs)] or [res.std()])
    noise_heat_img = Image.fromarray(_heat(np.clip(res / max(res.max(), 1.0) * 2, 0, 1)))
    if max(w, h) > 900:
        noise_heat_img.thumbnail((900, 900))
    noise_stats = {"residual_std": round(float(res.std()), 3), "block_noise_cv": round(float(sig.std() / (sig.mean() + 1e-6)), 3)}
    noise_res = {
        "signal": "noise_residual", "mime": mime, "stats": noise_stats,
        "heatmap_png_base64": _png_b64(np.asarray(noise_heat_img)),
        "limitations": ["Noise varies naturally between smooth sky and fine texture.", "Indicator only; not proof of splicing."],
    }

    # Spectral analysis
    spec_img = img
    if max(w, h) > 512:
        sc = 512 / max(w, h)
        spec_img = img.resize((max(32, int(w * sc)), max(32, int(h * sc))), Image.Resampling.BILINEAR)
    sarr = np.asarray(spec_img, dtype=np.float32)
    sgray = sarr.mean(axis=2) - sarr.mean()
    mag = np.log1p(np.abs(np.fft.fftshift(np.fft.fft2(sgray))))
    gh, gw = mag.shape
    yy, xx = np.ogrid[:gh, :gw]
    r = np.sqrt(((yy - gh / 2.0) / max(gh / 2.0, 1)) ** 2 + ((xx - gw / 2.0) / max(gw / 2.0, 1)) ** 2)
    mid, high = mag[(r >= 0.25) & (r < 0.6)], mag[(r >= 0.6) & (r <= 1.0)]
    hf_ratio = float(high.mean() / (mid.mean() + 1e-6)) if mid.size and high.size else 0.0
    hp = sarr - np.asarray(spec_img.filter(ImageFilter.BoxBlur(1)), dtype=np.float32)
    corrs = [float(np.corrcoef(hp[:, :, a].ravel(), hp[:, :, b].ravel())[0, 1])
             for a, b in ((0, 1), (1, 2), (0, 2))
             if hp[:, :, a].std() > 1e-5 and hp[:, :, b].std() > 1e-5]
    spec_res = {
        "signal": "spectral_analysis", "mime": mime,
        "stats": {"high_freq_ratio": round(hf_ratio, 3), "rgb_noise_corr": round(float(np.mean(corrs)) if corrs else 0.0, 3)},
        "limitations": ["Spectral rolloff varies with resizing, compression, and camera denoising."],
    }

    flags: list[str] = []
    if meta["ai_metadata_detected"]:
        flags.append(f"Explicit AI-generation metadata found: {', '.join(meta['ai_metadata_signals'])}")
    if meta["editing_software_detected"]:
        flags.append(f"Image editing software trace in metadata: {', '.join(meta['editing_software_signals'])}")
    if mime == "image/jpeg" and ela_stats["block_error_cv"] >= 0.85 and ela_stats["p99_error"] >= 18:
        flags.append(f"Uneven JPEG error levels (ELA block CV {ela_stats['block_error_cv']}, p99 {ela_stats['p99_error']}); inspect heatmap.")
    if noise_stats["block_noise_cv"] >= 0.95:
        flags.append(f"High regional noise variation (block noise CV {noise_stats['block_noise_cv']}); can reflect splicing or bokeh.")
    if not meta["has_exif"]:
        flags.append("EXIF camera metadata is absent or stripped (common on social media, screenshots, and AI images).")

    if meta["ai_metadata_detected"]:
        risk = "high_metadata_ai"
    elif meta["editing_software_detected"] and len(flags) >= 2:
        risk = "elevated"
    elif len([f for f in flags if not f.startswith("EXIF camera")]) >= 1:
        risk = "moderate"
    else:
        risk = "low"

    return {
        "metadata": meta, "ela": ela_res, "noise": noise_res, "spectral": spec_res,
        "forensic_flags": flags, "forensic_risk": risk,
        "limitations": [
            "Classical forensics (ELA, noise, FFT) are probabilistic indicators, never standalone proof of manipulation.",
            "Social media platforms strip EXIF and recompress JPEGs, which masks real camera history and weakens ELA.",
            "Metadata tags can be stripped or forged; C2PA is checked for marker presence rather than full PKI signature validation.",
        ],
    }
