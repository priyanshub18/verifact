from datetime import datetime, timezone

import structlog
from sqlalchemy import JSON, Boolean, DateTime, String, Text, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import get_settings

log = structlog.get_logger()


class Base(DeclarativeBase):
    pass


class CheckRow(Base):
    __tablename__ = "checks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_image_mime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_image_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    events: Mapped[list] = mapped_column(JSON, default=list)


_engine = None
_sm: async_sessionmaker[AsyncSession] | None = None
_active_db_url: str | None = None

SQLITE_FALLBACK = "sqlite+aiosqlite:///./verifact.db"


def _set_engine(url: str) -> None:
    global _engine, _sm, _active_db_url
    _engine = create_async_engine(url)
    _sm = async_sessionmaker(_engine, expire_on_commit=False)
    _active_db_url = url


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sm
    if _sm is None:
        _set_engine(get_settings().database_url)
    return _sm


def _migrate_columns(sync_conn) -> None:
    insp = inspect(sync_conn)
    if "checks" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("checks")}
    additions = [
        ("input_image_path", "TEXT"),
        ("input_image_mime", "VARCHAR(64)"),
        ("input_image_name", "VARCHAR(255)"),
    ]
    for col, col_type in additions:
        if col not in cols:
            sync_conn.execute(text(f"ALTER TABLE checks ADD COLUMN {col} {col_type}"))


async def init_db() -> None:
    sessionmaker()
    try:
        async with _engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(_migrate_columns)
    except Exception as e:  # noqa: BLE001
        if _active_db_url and not _active_db_url.startswith("sqlite"):
            log.warning("postgres_unreachable_falling_back_to_sqlite", error=str(e))
            _set_engine(SQLITE_FALLBACK)
            async with _engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                await conn.run_sync(_migrate_columns)
        else:
            raise
