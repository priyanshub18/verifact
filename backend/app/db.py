from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, String, Text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import get_settings


class Base(DeclarativeBase):
    pass


class CheckRow(Base):
    __tablename__ = "checks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    events: Mapped[list] = mapped_column(JSON, default=list)


_engine = None
_sm: async_sessionmaker[AsyncSession] | None = None


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _engine, _sm
    if _sm is None:
        _engine = create_async_engine(get_settings().database_url)
        _sm = async_sessionmaker(_engine, expire_on_commit=False)
    return _sm


async def init_db() -> None:
    sessionmaker()
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
