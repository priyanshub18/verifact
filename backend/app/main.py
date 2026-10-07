import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.db import CheckRow, init_db, sessionmaker
from app.jobs import enqueue, new_id
from app.security import UnsafeURL, assert_public_url


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    s = get_settings()
    if s.redis_url:
        from arq import create_pool
        from arq.connections import RedisSettings
        try:
            app.state.arq = await create_pool(RedisSettings.from_dsn(s.redis_url))
        except Exception:  # noqa: BLE001
            app.state.arq = None  # no Redis reachable: run jobs in-process
    yield


app = FastAPI(title="VeriFact API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","),
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


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


@app.get("/api/checks/{cid}")
async def get_check(cid: str):
    async with sessionmaker()() as db:
        row = await db.get(CheckRow, cid)
    if not row:
        raise HTTPException(404, "Not found")
    return {"id": row.id, "status": row.status, "created_at": row.created_at, "events": row.events,
            "result": row.result}


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
