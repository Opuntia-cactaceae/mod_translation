from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Purpose:
        Загрузка конфигурации приложения из переменных окружения (и .env локально).

    Notes:
        - Источник по приоритету: ENV > .env > значения по умолчанию.
    """

    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = Field(default="dev")

    database_url: str = Field(
        default="postgresql+asyncpg://user:pass@localhost:5432/app"
    )

    jwt_secret: str = Field(default="change-me")
    jwt_algorithm: str = Field(default="HS256")

    jwt_access_ttl_seconds: int = Field(default=900)
    jwt_refresh_ttl_seconds: int = Field(default=60 * 60 * 24 * 30)

    groq_models: str = Field(default="")
    groq_languages: str = Field(default="")

    groq_max_attempts: int = Field(default=5)
    groq_backoff_base_seconds: float = Field(default=0.7)
    groq_backoff_max_seconds: float = Field(default=20.0)
    groq_rate_limit_tps: float = Field(default=2.0)


settings = Settings()


def validate_production_settings() -> None:
    """
    Purpose:
        Проверка обязательных параметров для прода.

    Side Effects:
        Может выбросить RuntimeError, чтобы остановить запуск приложения.
    """
    if settings.env.lower() in {"prod", "production"}:
        if settings.jwt_secret in {"change-me", "", None}:
            raise RuntimeError("APP_JWT_SECRET must be set in production")
        if not settings.groq_models:
            raise RuntimeError("APP_GROQ_MODELS must be set in production")