import sqlite3
import hashlib
from typing import Optional

#вот совсем не уверен что он нормально фунциклирует
#но он правда и не особо нужен
def build_cache_key(
    text: str,
    src_lang: str,
    dst_lang: str,
    model_name: str,
    prompt_profile: str,
    protection_strategy: str,
) -> str:
    """
    Args:
        text: Source text.
        src_lang: Source language.
        dst_lang: Target language.
        model_name: Model name.
        prompt_profile: Prompt profile name.
        protection_strategy: Protection strategy name.

    Returns:
        SHA1 hex digest string.
    """
    key_string = f"{text}|{src_lang}|{dst_lang}|{model_name}|{prompt_profile}|{protection_strategy}"
    return hashlib.sha1(key_string.encode("utf-8")).hexdigest()


def load_cached_translation(db_path: str, cache_key: str) -> Optional[str]:
    """
    Args:
        db_path: Path to SQLite database.
        cache_key: Cache key.

    Returns:
        Cached translation text or None.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT translation FROM cache WHERE cache_key = ?",
            (cache_key,),
        )
        row = cursor.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def save_cached_translation(db_path: str, cache_key: str, translation: str) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        cache_key: Cache key.
        translation: Translation text.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO cache (cache_key, translation, created_at) VALUES (?, ?, datetime('now'))",
            (cache_key, translation),
        )
        conn.commit()
    finally:
        conn.close()