"""Database engine, session factory and ORM models.

Supabase Postgres in deployment, SQLite locally. Render's own free Postgres
expires after 30 days, which would take the project down before it is graded —
so it is deliberately not used.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import get_settings

settings = get_settings()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[str] = mapped_column(String(32), default="clinician")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    studies: Mapped[list["Study"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Study(Base):
    """One uploaded radiograph and everything the system concluded about it."""

    __tablename__ = "studies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    # Pseudonymous patient handle supplied by the uploader. Groups studies into
    # timelines for the recurrent branch. Never a real patient identifier.
    patient_ref: Mapped[str] = mapped_column(String(64), index=True, default="")
    follow_up_index: Mapped[int] = mapped_column(Integer, default=0)

    image_url: Mapped[str] = mapped_column(Text, default="")
    thumbnail_url: Mapped[str] = mapped_column(Text, default="")
    original_filename: Mapped[str] = mapped_column(String(255), default="")

    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    mode: Mapped[str] = mapped_column(String(16), default="full")  # full | reduced

    # Inference outputs
    probabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    uncertainty: Mapped[dict] = mapped_column(JSON, default=dict)
    conformal: Mapped[dict] = mapped_column(JSON, default=dict)
    gradcam: Mapped[dict] = mapped_column(JSON, default=dict)
    progression: Mapped[dict] = mapped_column(JSON, default=dict)

    # Gating and triage
    ood_score: Mapped[float] = mapped_column(Float, default=0.0)
    is_ood: Mapped[bool] = mapped_column(Boolean, default=False)
    abstained: Mapped[bool] = mapped_column(Boolean, default=False)
    abstain_reason: Mapped[str] = mapped_column(Text, default="")
    triage_score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    triage_priority: Mapped[str] = mapped_column(String(16), default="ROUTINE", index=True)
    triage_rationale: Mapped[str] = mapped_column(Text, default="")

    # Reporting
    report_text: Mapped[str] = mapped_column(Text, default="")
    report_source: Mapped[str] = mapped_column(String(32), default="")  # gemini | template

    # Human-in-the-loop
    reviewed_by: Mapped[str] = mapped_column(String(255), default="")
    review_note: Mapped[str] = mapped_column(Text, default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )

    owner: Mapped["User"] = relationship(back_populates="studies")

    __table_args__ = (
        Index("ix_studies_patient_timeline", "owner_id", "patient_ref", "follow_up_index"),
    )


class AuditEntry(Base):
    """Append-only trail. A clinical system must be able to say what it did.

    Written for every analysis, abstention, OOD rejection, human review, and
    every rejected LLM response. Never updated, never deleted.
    """

    __tablename__ = "audit_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True, default="")
    study_id: Mapped[str] = mapped_column(String(36), index=True, default="")
    action: Mapped[str] = mapped_column(String(64), index=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


# `check_same_thread` is a SQLite-only argument and errors on Postgres.
_connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
