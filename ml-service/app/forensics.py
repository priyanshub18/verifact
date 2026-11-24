"""Classical image-forensics & provenance signals.
Each result carries its own limitations: these are probabilistic indicators, never standalone proof of manipulation.
"""
from __future__ import annotations

import base64
import hashlib
import io
import re

import numpy as np
from PIL import ExifTags, Image, ImageFilter

MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png", b"RIFF": "image/webp"}
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

EXIF_TAGS = {v: k for k, v in ExifTags.TAGS.items()}


class BadImage(ValueError):
    pass


def sniff(data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise BadImage("File too large")
    for sig, mime in MAGIC.items():
        if data.startswith(sig) and (mime != "image/webp" or data[8:12] == b"WEBP"):
            return mime
    raise BadImage("Unsupported or spoofed file type (checked magic bytes): only JPEG, PNG, WebP")


def _open_raw(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise BadImage("Could not decode image") from e
    if img.width * img.height > 40_000_000:
        raise BadImage("Image dimensions too large")
    return img


def _load(data: bytes) -> Image.Image:
    return _open_raw(data).convert("RGB")


def _png_b64(arr: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _heat(gray: np.ndarray) -> np.ndarray:
    """0..1 float -> simple black->red->yellow ramp."""
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


def inspect_metadata(data: bytes) -> dict:
    """Inspect EXIF camera tags, PNG text chunks, XMP/header markers, C2PA provenance, and AI/editor signatures."""
    mime = sniff(data)
    img = _open_raw(data)
    sha256 = hashlib.sha256(data).hexdigest()
    dhash = _dhash(img)

    exif_map: dict[str, object] = {}
    try:
        exif = img.getexif()
        if exif:
            for k, v in exif.items():
                name = ExifTags.TAGS.get(k, str(k))
                exif_map[name] = v
            try:
                ifd = exif.get_ifd(0x8769)  # ExifOffset sub-IFD
                for k, v in (ifd or {}).items():
                    name = ExifTags.TAGS.get(k, str(k))
                    exif_map.setdefault(name, v)
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

    # Gather text blobs from image.info (PNG tEXt/iTXt/parameters, XMP, ICC/comment) + EXIF string fields
    text_blobs: list[str] = []
    for k, v in (img.info or {}).items():
        if isinstance(v, str):
            text_blobs.append(f"{k}: {v[:4000]}")
        elif isinstance(v, bytes) and len(v) < 200_000:
            text_blobs.append(f"{k}: {v.decode('latin1', errors='ignore')[:4000]}")
    for k in ("Software", "ImageDescription", "Artist", "Copyright", "UserComment", "XPComment", "Make", "Model"):
        if k in exif_map:
            text_blobs.append(f"{k}: {str(exif_map[k])[:1000]}")
    # Also scan first 256 KB & last 64 KB of raw bytes for XMP/C2PA/generator strings
    raw_head = data[:262_144] + data[-65_536:]
    text_blobs.append(raw_head.decode("latin1", errors="ignore"))
    combined_text = "\n".join(text_blobs)

    c2pa_signals: list[str] = []
    for marker, label in C2PA_MARKERS:
        if marker in data:
            c2pa_signals.append(label)

    ai_signals: list[str] = []
    for label, pat in AI_PATTERNS:
        if pat.search(combined_text):
            ai_signals.append(label)
    if any("trainedAlgorithmicMedia" in s or "compositeSynthetic" in s for s in c2pa_signals):
        ai_signals.append("C2PA synthetic media assertion")
    ai_signals = list(dict.fromkeys(ai_signals))

    editor_signals: list[str] = []
    for label, pat in EDITOR_PATTERNS:
        if pat.search(combined_text):
            editor_signals.append(label)
    editor_signals = list(dict.fromkeys(editor_signals))

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

    return {
        "mime": mime,
        "format": img.format or mime.split("/")[-1].upper(),
        "width": img.width,
        "height": img.height,
        "file_size_bytes": len(data),
        "sha256": sha256,
        "dhash": dhash,
        "has_exif": bool(exif_map),
        "exif_field_count": len(exif_map),
        "camera_make": camera_make,
        "camera_model": camera_model,
        "lens_model": lens_model,
        "software": software,
        "datetime_original": dt_orig,
        "datetime_modified": dt_mod,
        "has_gps": has_gps,
        "c2pa_detected": bool(c2pa_signals),
        "c2pa_signals": c2pa_signals,
        "ai_metadata_detected": bool(ai_signals),
        "ai_metadata_signals": ai_signals,
        "editing_software_detected": bool(editor_signals),
        "editing_software_signals": editor_signals,
        "notes": notes,
    }


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


def spectral_analysis(data: bytes) -> dict:
    """2D FFT high-frequency energy ratio & RGB noise correlation. Indicator of heavy smoothing, upscaling, or synthetic texture."""
    mime = sniff(data)
    img = _load(data)
    w, h = img.size
    if max(w, h) > 512:
        scale = 512 / max(w, h)
        img = img.resize((max(32, int(w * scale)), max(32, int(h * scale))), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.float32)
    gray = arr.mean(axis=2)
    gray = gray - gray.mean()
    fft = np.fft.fftshift(np.fft.fft2(gray))
    mag = np.log1p(np.abs(fft))
    gh, gw = mag.shape
    yy, xx = np.ogrid[:gh, :gw]
    cy, cx = gh / 2.0, gw / 2.0
    r = np.sqrt(((yy - cy) / max(cy, 1)) ** 2 + ((xx - cx) / max(cx, 1)) ** 2)
    mid = mag[(r >= 0.25) & (r < 0.6)]
    high = mag[(r >= 0.6) & (r <= 1.0)]
    hf_ratio = float(high.mean() / (mid.mean() + 1e-6)) if mid.size and high.size else 0.0

    # High-pass residual correlation across RGB channels
    hp = arr - np.asarray(img.filter(ImageFilter.BoxBlur(1)), dtype=np.float32)
    corrs = []
    for a, b in ((0, 1), (1, 2), (0, 2)):
        ca, cb = hp[:, :, a].ravel(), hp[:, :, b].ravel()
        if ca.std() > 1e-5 and cb.std() > 1e-5:
            corrs.append(float(np.corrcoef(ca, cb)[0, 1]))
    rgb_corr = float(np.mean(corrs)) if corrs else 0.0

    return {
        "signal": "spectral_analysis",
        "mime": mime,
        "stats": {
            "high_freq_ratio": round(hf_ratio, 3),
            "rgb_noise_corr": round(rgb_corr, 3),
        },
        "limitations": [
            "Spectral rolloff depends heavily on JPEG compression, resizing, and camera denoising.",
            "Indicator only; cannot prove or disprove AI generation on its own.",
        ],
    }


def analyze_all(data: bytes, ela_quality: int = 90) -> dict:
    """Run all deterministic forensic checks (metadata/EXIF/C2PA, ELA, noise residual, spectral) in one pass."""
    meta = inspect_metadata(data)
    ela_res = ela(data, quality=ela_quality)
    noise_res = noise_residual(data)
    spec_res = spectral_analysis(data)

    flags: list[str] = []
    if meta["ai_metadata_detected"]:
        flags.append(f"Explicit AI-generation metadata found: {', '.join(meta['ai_metadata_signals'])}")
    if meta["editing_software_detected"]:
        flags.append(f"Image editing software trace in metadata: {', '.join(meta['editing_software_signals'])}")
    if meta["mime"] == "image/jpeg" and ela_res["stats"]["block_error_cv"] >= 0.85 and ela_res["stats"]["p99_error"] >= 18:
        flags.append(f"Uneven JPEG error levels (ELA block CV {ela_res['stats']['block_error_cv']}, p99 {ela_res['stats']['p99_error']}); inspect heatmap for localized edits.")
    if noise_res["stats"]["block_noise_cv"] >= 0.95:
        flags.append(f"High regional noise variation (block noise CV {noise_res['stats']['block_noise_cv']}); can reflect splicing or strong bokeh/sky contrast.")
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
        "metadata": meta,
        "ela": ela_res,
        "noise": noise_res,
        "spectral": spec_res,
        "forensic_flags": flags,
        "forensic_risk": risk,
        "limitations": [
            "Classical forensics (ELA, noise, FFT) are probabilistic indicators, never standalone proof of manipulation.",
            "Social media platforms strip EXIF and recompress JPEGs, which masks real camera history and weakens ELA.",
            "Metadata tags (EXIF/software) can be stripped or forged; C2PA cryptographic signatures are only checked for marker presence here.",
        ],
    }
