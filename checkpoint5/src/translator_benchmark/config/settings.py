import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class AppSettings:
    benchmark_db_path: str
    log_dir: str
    legacy_code_path: Optional[str] = None
    default_timeout_sec: float = 30.0
    default_retry_delay_sec: float = 1.0
    groq_api_keys: Optional[str] = None


def load_settings() -> dict[str, object]:
    settings = AppSettings(
        benchmark_db_path=os.getenv("BENCHMARK_DB_PATH", "./benchmark.db"),
        log_dir=os.getenv("LOG_DIR", "./logs"),
        legacy_code_path=os.getenv("LEGACY_CODE_PATH"),
        default_timeout_sec=float(os.getenv("DEFAULT_TIMEOUT_SEC", "30.0")),
        default_retry_delay_sec=float(os.getenv("DEFAULT_RETRY_DELAY_SEC", "1.0")),
        groq_api_keys=os.getenv("GROQ_API_KEYS"),
    )
    return {
        "benchmark_db_path": settings.benchmark_db_path,
        "log_dir": settings.log_dir,
        "legacy_code_path": settings.legacy_code_path,
        "default_timeout_sec": settings.default_timeout_sec,
        "default_retry_delay_sec": settings.default_retry_delay_sec,
        "groq_api_keys": settings.groq_api_keys,
    }