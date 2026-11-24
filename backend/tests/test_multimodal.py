"""Tests for the multimodal Image + Claim verification pipeline, forensics, fusion, and API endpoints."""
from __future__ import annotations

import io
import json

import httpx
import numpy as np
import pytest
import respx
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin

from app.config import Settings
from app.llm.base import LLMClient, extract_json_payload
from app.pipeline import image_forensics
from app.pipeline.aggregate import evaluate_image_authenticity, fuse_multimodal
from app.pipeline.orchestrator import Pipeline
from app.schemas import ClaimImageAlignment, ImageAnalysis, Verdict, VisualAnalysis, VisualAuthAssessment


def _make_jpeg(size=(128, 128), color=(90, 140, 200), quality=90) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _make_ai_png() -> bytes:
    img = Image.new("RGB", (128, 128), (120, 60, 180))
    info = PngImagePlugin.PngInfo()
    info.add_text("parameters", "a dramatic flood in paris\nNegative prompt: blurry\nSteps: 30, Sampler: Euler a, CFG scale: 7")
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=info)
    return buf.getvalue()


def test_extract_json_payload_strips_think_and_fences():
    raw = '<think>reasoning here</think>\n```json\n{"ok": true}\n```'
    assert json.loads(extract_json_payload(raw)) == {"ok": True}


def test_local_forensics_detects_ai_png_metadata():
    res = image_forensics.analyze_local(_make_ai_png())
    assert res["metadata"]["ai_metadata_detected"] is True
    assert any("Stable Diffusion" in s for s in res["metadata"]["ai_metadata_signals"])
    assert res["forensic_risk"] == "high_metadata_ai"
    assert res["ela"]["heatmap_png_base64"]
    assert res["noise"]["heatmap_png_base64"]
    assert "high_freq_ratio" in res["spectral"]["stats"]


def test_sniff_image_rejects_spoofed_bytes():
    with pytest.raises(image_forensics.BadImage):
        image_forensics.sniff_image(b"<html>not an image</html>")


def test_fuse_multimodal_ai_image_flags_ai_generated():
    ia = ImageAnalysis(
        image_verdict="Likely AI-Generated",
        image_is_real=False,
        image_confidence=0.9,
        visual=VisualAnalysis(
            scene_description="Synthetic burning Eiffel Tower",
            authenticity_assessment=VisualAuthAssessment.likely_ai_generated,
            authenticity_rationale="AI metadata and warped geometry",
            claim_alignment=ClaimImageAlignment.consistent,
            alignment_explanation="Image depicts the scene claimed, but it is synthetic.",
        ),
    )
    verdict, ms = fuse_multimodal(ia, [], Verdict.false, has_user_claim=True)
    assert verdict == Verdict.ai_generated
    assert ms.image_is_real is False
    assert ms.claim_is_real is False


def test_fuse_multimodal_authentic_photo_contradicted_by_claim():
    ia = ImageAnalysis(
        image_verdict="Likely Authentic",
        image_is_real=True,
        image_confidence=0.72,
        visual=VisualAnalysis(
            scene_description="A golden retriever sitting on grass",
            authenticity_assessment=VisualAuthAssessment.likely_authentic,
            authenticity_rationale="Consistent optics and sensor noise",
            claim_alignment=ClaimImageAlignment.contradicts_image,
            alignment_explanation="Claim states this is a lion in London, but the image clearly shows a dog.",
        ),
    )
    verdict, ms = fuse_multimodal(ia, [], Verdict.unverifiable, has_user_claim=True)
    assert verdict == Verdict.false
    assert ms.image_is_real is True
    assert ms.claim_is_real is False
    assert ms.image_claim_match == "Contradicts Image"


def test_evaluate_image_authenticity_priority():
    v, real, conf = evaluate_image_authenticity(
        {"ai_metadata_detected": True, "has_exif": False},
        "high_metadata_ai",
        VisualAuthAssessment.likely_authentic,
        [],
        "inconclusive",
    )
    assert v == "Likely AI-Generated" and real is False and conf >= 0.85


class ScriptedMultimodalProvider:
    def __init__(self, alignment="consistent", auth="likely_authentic"):
        self.alignment = alignment
        self.auth = auth

    async def complete_json_with_image(self, system, user, image_bytes, mime, schema):
        out = {
            "scene_description": "The Eiffel Tower standing intact in Paris on a sunny day.",
            "visible_text": "",
            "visual_entities": ["Eiffel Tower", "Paris"],
            "authenticity_assessment": self.auth,
            "authenticity_rationale": "Natural lighting and consistent shadows.",
            "visual_anomalies": [],
            "watermarks_or_badges": [],
            "claim_alignment": self.alignment,
            "alignment_explanation": "The photo matches the Eiffel Tower in Paris.",
            "image_search_queries": ["Eiffel Tower Paris photo"],
            "embedded_claims": [],
        }
        return json.dumps(out), 50, 30

    async def complete_json(self, system, user, schema):
        props = schema["properties"]
        if "finding" in props:
            out = {"finding": "inconclusive", "summary": "No prior debunk found.", "supporting_urls": []}
        elif "claims" in props:
            out = {"claims": [{
                "text": "The Eiffel Tower is in Paris.",
                "kind": "factual", "checkworthy": True, "topic_sensitivity": "none",
                "claim_date": None, "language": "en", "original_span": "Eiffel Tower is in Paris",
            }]}
        elif "supporting" in props:
            out = {"supporting": ["Eiffel Tower Paris"], "disconfirming": ["Eiffel Tower location hoax"], "en_queries": []}
        else:
            import re
            ids = [int(i) for i in re.findall(r"passage_id=(\d+)", user)]
            results = []
            for i in ids:
                q = ("wrought-iron lattice tower located in Paris" if "wrought-iron" in user.split(f"passage_id={i}]")[1].split("[passage_id=")[0]
                     else "Paris landmark stands on the Champ de Mars")
                results.append({
                    "passage_id": i, "stance": "supports",
                    "quote": q,
                    "rationale": "Directly confirms location", "evidence_date_note": None,
                })
            out = {"results": results}
        return json.dumps(out), 20, 10


async def test_full_image_plus_claim_pipeline(monkeypatch):
    async def no_ddg(*a, **k): return []
    async def no_gdelt(*a, **k): return []
    monkeypatch.setattr("app.retrieval.adapters.duckduckgo", no_ddg)
    monkeypatch.setattr("app.retrieval.adapters.gdelt", no_gdelt)

    s = Settings(tavily_api_key="x", groq_api_key="x", _env_file=None)
    events = []
    async def emit(ev): events.append(ev)

    p1 = "The Eiffel Tower is a wrought-iron lattice tower located in Paris, France and was completed in 1889."
    p2 = "Built for the 1889 World Fair, the famous Paris landmark stands on the Champ de Mars near the Seine."
    with respx.mock(assert_all_called=False) as m:
        m.post("https://api.tavily.com/search").mock(return_value=httpx.Response(200, json={"results": [
            {"url": "https://reuters.com/eiffel", "title": "Eiffel Tower", "content": p1},
            {"url": "https://bbc.com/eiffel", "title": "Paris Monument", "content": p2},
        ]}))
        m.get(url__regex=r"https://.*wikipedia\.org/.*").mock(return_value=httpx.Response(200, json={"query": {"search": []}}))
        m.get(url__regex=r"https://api\.crossref\.org/.*").mock(return_value=httpx.Response(200, json={"message": {"items": []}}))
        m.get(url__regex=r"https://(reuters|bbc)\.com/.*").mock(return_value=httpx.Response(404))

        res = await Pipeline(s, LLMClient(ScriptedMultimodalProvider()), emit).run(
            "mm1", "This photo shows the Eiffel Tower is in Paris.", None,
            image_bytes=_make_jpeg(), image_mime="image/jpeg", image_name="eiffel.jpg",
        )

    assert res.status == "done"
    assert res.input.kind == "image+claim"
    assert res.image_analysis is not None
    assert res.image_analysis.image_verdict == "Likely Authentic"
    assert res.multimodal_summary is not None
    assert res.multimodal_summary.image_is_real is True
    assert res.multimodal_summary.claim_is_real is True
    assert res.overall_verdict == Verdict.true
    steps = [e["step"] for e in events]
    assert "image_forensics" in steps and "vision" in steps and "image_provenance" in steps and "fuse" in steps


def test_multimodal_api_rejects_bad_upload_and_accepts_valid(monkeypatch, tmp_path):
    from app import db as db_mod
    from app.config import get_settings
    from app.main import app

    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("REDIS_URL", "")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    get_settings.cache_clear()
    db_mod._sm = None
    db_mod._engine = None

    enqueued = []
    async def fake_enqueue(app_, cid):
        enqueued.append(cid)
    monkeypatch.setattr("app.main.enqueue", fake_enqueue)

    with TestClient(app) as client:
        bad = client.post(
            "/api/checks/multimodal",
            files={"image": ("fake.jpg", b"not-an-image", "image/jpeg")},
            data={"claim": "test claim"},
        )
        assert bad.status_code == 422

        ok = client.post(
            "/api/checks/multimodal",
            files={"image": ("photo.jpg", _make_jpeg(), "image/jpeg")},
            data={"claim": "This photo shows Paris"},
        )
        assert ok.status_code == 202
        cid = ok.json()["id"]
        assert cid in enqueued

        img_resp = client.get(f"/api/checks/{cid}/image")
        assert img_resp.status_code == 200
        assert img_resp.headers["content-type"] == "image/jpeg"

        listing = client.get("/api/checks")
        assert listing.status_code == 200
        assert any(r["id"] == cid and r["has_image"] for r in listing.json())

    get_settings.cache_clear()
    db_mod._sm = None
    db_mod._engine = None

