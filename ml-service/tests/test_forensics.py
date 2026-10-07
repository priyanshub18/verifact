import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import forensics
from app.main import app

client = TestClient(app)


def _jpeg(img, q):
    b = io.BytesIO(); img.save(b, "JPEG", quality=q); return b.getvalue()


def _scene(seed=0, size=256):
    """Smooth photo-like gradient + mild texture."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size]
    base = np.stack([128 + 80 * np.sin(x / 40), 128 + 80 * np.cos(y / 50), 128 + 60 * np.sin((x + y) / 70)], -1)
    return Image.fromarray(np.clip(base + rng.normal(0, 4, base.shape), 0, 255).astype(np.uint8))


def test_magic_bytes_reject_spoofed_files():
    with pytest.raises(forensics.BadImage):
        forensics.sniff(b"<?php echo 1; ?>" + b"0" * 100)
    with pytest.raises(forensics.BadImage):
        forensics.sniff(b"RIFF\x00\x00\x00\x00WAVEfmt ")  # RIFF but not WebP


def test_ela_flags_spliced_region_more_than_control():
    # control: one compression history throughout
    control = Image.open(io.BytesIO(_jpeg(_scene(), 75))).convert("RGB")
    control_bytes = _jpeg(control, 95)
    # edited: paste a never-compressed, differently textured patch, then save once
    edited = control.copy()
    rng = np.random.default_rng(1)
    patch = Image.fromarray(rng.integers(60, 200, (64, 64, 3), dtype=np.uint8))
    edited.paste(patch, (96, 96))
    edited_bytes = _jpeg(edited, 95)
    c = forensics.ela(control_bytes)["stats"]
    e = forensics.ela(edited_bytes)["stats"]
    assert e["block_error_cv"] > c["block_error_cv"]
    assert e["p99_error"] > c["p99_error"]


def test_ela_result_always_states_limitations():
    r = forensics.ela(_jpeg(_scene(), 80))
    assert r["limitations"] and "Not a verdict" in " ".join(r["limitations"])
    assert r["heatmap_png_base64"]


def test_api_ela_and_bad_upload():
    ok = client.post("/forensics/ela", files={"file": ("a.jpg", _jpeg(_scene(), 85), "image/jpeg")})
    assert ok.status_code == 200 and ok.json()["signal"] == "error_level_analysis"
    bad = client.post("/forensics/ela", files={"file": ("a.jpg", b"not an image at all", "image/jpeg")})
    assert bad.status_code == 422


def test_noise_endpoint():
    r = client.post("/forensics/noise", files={"file": ("a.png", (lambda b: (_scene().save(b, "PNG"), b.getvalue())[1])(io.BytesIO()), "image/png")})
    assert r.status_code == 200 and r.json()["limitations"]


def test_health_reports_model_state_honestly():
    h = client.get("/health").json()
    assert set(h["models"]) == {"rerank", "nli"} and all(m["loaded"] is False for m in h["models"].values())
