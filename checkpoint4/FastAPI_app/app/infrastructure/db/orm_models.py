from __future__ import annotations
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Boolean, DateTime, Integer, Text, UniqueConstraint, Index
from datetime import datetime

class Base(DeclarativeBase):
    pass

class UserORM(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class TranslationRequestORM(Base):
    __tablename__ = "translation_requests"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id", name="uq_translation_user_request"),
        Index("ix_translation_user_created_at", "user_id", "created_at"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    request_id: Mapped[str] = mapped_column(String(64))
    source_text: Mapped[str] = mapped_column(Text)
    source_lang: Mapped[str] = mapped_column(String(10))
    target_lang: Mapped[str] = mapped_column(String(10))
    model_id: Mapped[str] = mapped_column(String(128))
    translated_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class RefreshSessionORM(Base):
    __tablename__ = "refresh_sessions"
    refresh_jti: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replaced_by_jti: Mapped[str | None] = mapped_column(String, nullable=True)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
