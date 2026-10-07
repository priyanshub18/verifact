"""Job execution: Arq worker when REDIS_URL is set, otherwise in-process (dev). Events persist to the DB row."""
import asyncio
import uuid

import structlog

from app.config import get_settings
from app.db import CheckRow, sessionmaker
from app.llm.base import LLMNotConfigured
from app.llm.providers import build_llm
from app.pipeline.orchestrator import Pipeline

log = structlog.get_logger()


async def run_check(ctx, check_id: str) -> None:
    s = get_settings()
    sm = sessionmaker()

    async def emit(ev: dict):
        async with sm() as db:
            row = await db.get(CheckRow, check_id)
            row.events = [*row.events, ev]
            await db.commit()

    async with sm() as db:
        row = await db.get(CheckRow, check_id)
        row.status = "running"
        text, url, provider = row.input_text, row.input_url, row.provider
        await db.commit()
    try:
        llm = build_llm(s, provider)
        result = await Pipeline(s, llm, emit).run(check_id, text, url)
        status, payload = result.status, result.model_dump(mode="json")
    except LLMNotConfigured as e:
        status, payload = "failed", {"errors": [str(e)]}
    except Exception as e:  # noqa: BLE001 - surface to the user, never fabricate a result
        log.exception("check_failed", check_id=check_id)
        status, payload = "failed", {"errors": [f"Internal error: {type(e).__name__}"]}
        await emit({"step": "error", "status": "failed", "detail": payload["errors"][0], "data": {}})
    async with sm() as db:
        row = await db.get(CheckRow, check_id)
        row.status, row.result = status, payload
        await db.commit()


async def enqueue(request_app, check_id: str) -> None:
    pool = getattr(request_app.state, "arq", None)
    if pool:
        await pool.enqueue_job("run_check", check_id)
    else:
        request_app.state.tasks = {t for t in getattr(request_app.state, "tasks", set()) if not t.done()}
        t = asyncio.create_task(run_check({}, check_id))
        request_app.state.tasks.add(t)


def new_id() -> str:
    return uuid.uuid4().hex[:16]


class WorkerSettings:
    from arq.connections import RedisSettings
    functions = [run_check]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url or "redis://localhost:6379/0")
    job_timeout = 900
    max_jobs = 4
