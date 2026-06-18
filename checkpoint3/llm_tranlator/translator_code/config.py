# localization_translator/config.py
import os
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv


@dataclass
class Config:
    # API ключи
    api_keys: List[str]

    # модель и перевод
    model: str
    source_lang: str        # для промпта, напр. "English"
    target_lang: str        # для промпта, напр. "Russian"
    dry_run: bool
    max_tokens: int
    temperature: float
    rate_limit_tps: float
    batch_size: int
    cache_path: str
    model_fallbacks: List[str]

    # параметры для БД
    db_path: str            # путь к SQLite файлу
    db_source_lang: str     # значение поля texts.lang для исходных строк (например "en")
    db_target_lang: str     # значение поля для перевода (например "ru")


def load_config() -> Config:
    """
    Загружаем настройки из .env, поддерживаем:
    - GROQ_API_KEYS="k1,k2,k3"
    - GROQ_API_KEY=... (fallback)
    """
    load_dotenv()

    raw_keys = (os.getenv("GROQ_API_KEYS") or "").strip()
    api_keys: List[str] = []

    if raw_keys:
        api_keys = [k.strip() for k in raw_keys.split(",") if k.strip()]

    single_key = os.getenv("GROQ_API_KEY")
    if not api_keys:
        if not single_key:
            raise RuntimeError("Нужен либо GROQ_API_KEY, либо GROQ_API_KEYS в .env")
        api_keys = [single_key.strip()]

    model_fallbacks = [
        m.strip()
        for m in os.getenv("MODEL_FALLBACKS", "").split(",")
        if m.strip()
    ]

    return Config(
        api_keys=api_keys,
        model=os.getenv("MODEL", "llama-3.1-70b-versatile"),
        source_lang=os.getenv("SOURCE_LANG", "English"),
        target_lang=os.getenv("TARGET_LANG", "Russian"),
        dry_run=os.getenv("DRY_RUN", "false").lower() == "true",
        max_tokens=int(os.getenv("MAX_TOKENS", "2048")),
        temperature=float(os.getenv("TEMPERATURE", "0.2")),
        rate_limit_tps=float(os.getenv("RATE_LIMIT_TPS", "2")),
        batch_size=int(os.getenv("BATCH_SIZE", "16")),
        cache_path=os.getenv("CACHE_PATH", ".translation_cache.json"),
        model_fallbacks=model_fallbacks,
        db_path=os.getenv("DB_PATH", "localisation.db"),
        db_source_lang=os.getenv("DB_SOURCE_LANG", "en"),
        db_target_lang=os.getenv("DB_TARGET_LANG", "ru"),
    )