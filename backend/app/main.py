import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import desc, select
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.db import CheckRow, init_db, sessionmaker
from app.jobs import enqueue, new_id
from app.pipeline.image_forensics import EXT_FOR_MIME, BadImage, sniff_image
from app.security import UnsafeURL, assert_public_url


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    s = get_settings()
    Path(s.upload_dir).mkdir(parents=True, exist_ok=True)
    if s.redis_url:
        from arq import create_pool
        from arq.connections import RedisSettings
        try:
            app.state.arq = await create_pool(RedisSettings.from_dsn(s.redis_url))
        except Exception:  # noqa: BLE001
            app.state.arq = None  # no Redis reachable: run jobs in-process
    yield


app = FastAPI(title="VeriFact API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins.split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class CheckRequest(BaseModel):
    text: str | None = Field(None, max_length=20000)
    url: str | None = Field(None, max_length=2000)
    private: bool = True
    provider: str | None = Field(None, description="groq | anthropic | openai")

    @model_validator(mode="after")
    def one_input(self):
        if bool(self.text and self.text.strip()) == bool(self.url):
            raise ValueError("Provide exactly one of 'text' or 'url'.")
        return self


@app.get("/api/capabilities")
async def capabilities():
    return [c.model_dump() for c in get_settings().capabilities()]


@app.get("/api/providers")
async def providers():
    s = get_settings()
    return {"default": s.resolve_provider(None), "providers": s.providers()}


@app.get("/api/checks")
async def list_checks(limit: int = 12):
    limit = max(1, min(50, limit))
    async with sessionmaker()() as db:
        rows = (await db.execute(select(CheckRow).order_by(desc(CheckRow.created_at)).limit(limit))).scalars().all()
    out = []
    for r in rows:
        res = r.result or {}
        ms = res.get("multimodal_summary") or {}
        out.append({
            "id": r.id,
            "status": r.status,
            "created_at": r.created_at,
            "has_image": bool(r.input_image_path),
            "image_name": r.input_image_name,
            "snippet": (r.input_text or r.input_url or r.input_image_name or "")[:120],
            "overall_verdict": res.get("overall_verdict"),
            "image_verdict": ms.get("image_verdict"),
            "claim_verdict": ms.get("claim_verdict"),
        })
    return out


@app.post("/api/checks", status_code=202)
async def create_check(req: CheckRequest):
    s = get_settings()
    provider = s.resolve_provider(req.provider)
    if not provider:
        msg = ("The selected provider has no API key configured." if req.provider
               else "No LLM API key configured. Add GROQ_API_KEY (free) to .env.")
        raise HTTPException(503, {"code": "not_configured", "feature": "llm", "message": msg})
    if req.url:
        try:
            await assert_public_url(req.url)
        except UnsafeURL as e:
            raise HTTPException(422, f"URL rejected: {e}") from e
    cid = new_id()
    async with sessionmaker()() as db:
        db.add(CheckRow(id=cid, input_text=req.text, input_url=req.url, is_private=req.private, provider=provider))
        await db.commit()
    await enqueue(app, cid)
    return {"id": cid}


@app.post("/api/checks/multimodal", status_code=202)
async def create_multimodal_check(
    image: UploadFile | None = File(None),
    claim: str | None = Form(None),
    url: str | None = Form(None),
    private: bool = Form(True),
    provider: str | None = Form(None),
):
    """Submit an image + claim (or image only, or claim/url only) for multimodal verification."""
    s = get_settings()
    resolved = s.resolve_provider(provider or None)
    if not resolved:
        msg = ("The selected provider has no API key configured." if provider
               else "No LLM API key configured. Add GROQ_API_KEY (free) to .env.")
        raise HTTPException(503, {"code": "not_configured", "feature": "llm", "message": msg})

    clean_claim = (claim or "").strip() or None
    clean_url = (url or "").strip() or None
    if clean_claim and len(clean_claim) > 20000:
        raise HTTPException(422, "Claim text exceeds 20,000 characters.")
    if clean_url:
        try:
            await assert_public_url(clean_url)
        except UnsafeURL as e:
            raise HTTPException(422, f"URL rejected: {e}") from e

    image_path_str: str | None = None
    image_mime: str | None = None
    image_name: str | None = None
    cid = new_id()

    if image is not None and image.filename:
        raw = await image.read(s.max_image_bytes + 1)
        try:
            image_mime = sniff_image(raw, max_bytes=s.max_image_bytes)
        except BadImage as e:
            raise HTTPException(422, str(e)) from e
        upload_dir = Path(s.upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        ext = EXT_FOR_MIME.get(image_mime, ".bin")
        dest = upload_dir / f"{cid}{ext}"
        dest.write_bytes(raw)
        image_path_str = str(dest)
        image_name = Path(image.filename).name[:180]

    if not image_path_str and not clean_claim and not clean_url:
        raise HTTPException(422, "Provide an image, a claim, a URL, or an image paired with a claim.")

    async with sessionmaker()() as db:
        db.add(CheckRow(
            id=cid,
            input_text=clean_claim,
            input_url=clean_url,
            input_image_path=image_path_str,
            input_image_mime=image_mime,
            input_image_name=image_name,
            is_private=private,
            provider=resolved,
        ))
        await db.commit()
    await enqueue(app, cid)
    return {"id": cid}


@app.get("/api/checks/{cid}")
async def get_check(cid: str):
    async with sessionmaker()() as db:
        row = await db.get(CheckRow, cid)
    if not row:
        raise HTTPException(404, "Not found")
    return {"id": row.id, "status": row.status, "created_at": row.created_at, "events": row.events,
            "result": row.result}


@app.get("/api/checks/{cid}/image")
async def get_check_image(cid: str):
    async with sessionmaker()() as db:
        row = await db.get(CheckRow, cid)
    if not row or not row.input_image_path:
        raise HTTPException(404, "No image for this check")
    p = Path(row.input_image_path)
    if not p.exists():
        raise HTTPException(404, "Image file no longer available")
    return FileResponse(p, media_type=row.input_image_mime or "application/octet-stream")


@app.get("/api/checks/{cid}/events")
async def stream_events(cid: str):
    async def gen():
        sent = 0
        while True:
            async with sessionmaker()() as db:
                row = await db.get(CheckRow, cid)
            if not row:
                yield {"event": "error", "data": "not found"}
                return
            for ev in row.events[sent:]:
                yield {"event": "progress", "data": json.dumps(ev)}
            sent = len(row.events)
            if row.status in ("done", "failed"):
                yield {"event": "complete", "data": json.dumps({"status": row.status})}
                return
            await asyncio.sleep(0.5)

    return EventSourceResponse(gen())
