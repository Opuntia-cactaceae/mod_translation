"""23. Translation Cache Module — store and reuse translations.

Provides:
    * CacheEntry — in-memory representation of a cached translation.
    * CacheLookupResult — result of a cache lookup (hit/miss).
    * CacheStats — aggregate hit/miss/size statistics.
    * TranslationCache — main cache API with SQLite persistence
      (via DatabaseService) and in-memory fallback.

Flow:
    1. TaskPlanner calls ``lookup()`` before creating batches.
    2. On hit: unit is marked as cached; no LLM call needed.
    3. On miss: unit goes into a batch for translation.
    4. After successful batch, JobExecutionService calls ``save()``.
    5. Failed / empty translations are never cached.
"""

import hashlib
import json
import logging
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Error codes
# ---------------------------------------------------------------------------

CACHE_READ_FAILED = "CACHE_READ_FAILED"
CACHE_WRITE_FAILED = "CACHE_WRITE_FAILED"
INVALID_CACHE_KEY = "INVALID_CACHE_KEY"
IMPORT_FAILED = "IMPORT_FAILED"
EXPORT_FAILED = "EXPORT_FAILED"

# ---------------------------------------------------------------------------
# Merge strategies
# ---------------------------------------------------------------------------

MERGE_SKIP_EXISTING = "skip_existing"
MERGE_OVERWRITE_EXISTING = "overwrite_existing"
MERGE_KEEP_NEWER = "keep_newer"

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


@dataclass
class CacheEntry:
    """Internal representation of a single cached translation row."""
    key: str = ""
    protected_text: str = ""
    translated_text: str = ""
    src_lang: str = ""
    dst_lang: str = ""
    strategy: str = ""
    created_at: str = ""
    updated_at: str = ""
    usage_count: int = 0
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["metadata"] = json.dumps(self.metadata, ensure_ascii=False)
        return d

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "CacheEntry":
        metadata = {}
        raw = row.get("metadata_json") or row.get("metadata", "{}")
        if isinstance(raw, str):
            try:
                metadata = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                metadata = {}
        elif isinstance(raw, dict):
            metadata = raw
        return cls(
            key=row.get("key", row.get("source_hash", "")),
            protected_text=row.get("protected_text", row.get("source_text", "")),
            translated_text=row.get("translated_text", row.get("target_text", "")),
            src_lang=row.get("src_lang", ""),
            dst_lang=row.get("dst_lang", ""),
            strategy=row.get("strategy", ""),
            created_at=row.get("created_at", ""),
            updated_at=row.get("updated_at", ""),
            usage_count=row.get("usage_count", 0) or 0,
            metadata=metadata,
        )


@dataclass
class CacheLookupResult:
    """Result of a cache lookup operation."""
    hit: bool = False
    translated_text: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class CacheStats:
    """Aggregated cache statistics."""
    total_requests: int = 0
    hits: int = 0
    misses: int = 0
    size: int = 0

    @property
    def hit_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return round(self.hits / self.total_requests, 4)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_requests": self.total_requests,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": self.hit_rate,
            "size": self.size,
        }


# ---------------------------------------------------------------------------
# TranslationCache
# ---------------------------------------------------------------------------


class TranslationCache:
    """Translation cache with SQLite persistence and in-memory fallback.

    Two storage modes:
        * SQLite (preferred) — when ``DatabaseService`` is provided.
        * In-memory dict — when no database service is provided.

    Thread-safe: a reentrant lock serialises all SQLite operations.
    """

    def __init__(
        self,
        db_service: Optional[Any] = None,
    ):
        self._db = db_service
        # In-memory fallback dict: key -> CacheEntry
        self._cache: Dict[str, CacheEntry] = {}
        self._stats = CacheStats()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @staticmethod
    def make_key(
        protected_text: str,
        src_lang: str,
        dst_lang: str,
        strategy: str = "",
    ) -> str:
        """Compute a deterministic cache key.

        The key is ``sha256(protected_text | src_lang | dst_lang | strategy)``.
        When strategy is empty, it is omitted from the hash for backward
        compatibility with legacy cache keys.

        Using protected_text (rather than raw text) ensures that token
        differences do not break cache matches.
        """
        if strategy:
            raw = f"{protected_text}|{src_lang}|{dst_lang}|{strategy}"
        else:
            raw = f"{protected_text}|{src_lang}|{dst_lang}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def lookup(
        self,
        protected_text: str,
        src_lang: str,
        dst_lang: str,
        strategy: str = "",
    ) -> CacheLookupResult:
        """Look up a translation in the cache.

        On hit: increments ``usage_count`` and returns the translated text.
        On miss: returns a ``CacheLookupResult`` with ``hit=False``.
        """
        self._stats.total_requests += 1
        key = self.make_key(protected_text, src_lang, dst_lang, strategy)
        entry = self._get_entry(key)
        if entry is not None:
            self._stats.hits += 1
            entry.usage_count += 1
            entry.updated_at = _now()
            self._save_entry(entry)
            return CacheLookupResult(
                hit=True,
                translated_text=entry.translated_text,
                metadata=entry.metadata,
            )
        self._stats.misses += 1
        return CacheLookupResult(hit=False)

    def save(
        self,
        protected_text: str,
        translated_text: str,
        src_lang: str,
        dst_lang: str,
        strategy: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Save a translation result to the cache.

        Returns ``True`` on success, ``False`` on failure.
        Empty / failed translations are NOT cached.
        """
        if not translated_text or not translated_text.strip():
            logger.debug("Skipping cache save for empty translation")
            return False

        key = self.make_key(protected_text, src_lang, dst_lang, strategy)
        now = _now()
        entry = self._get_entry(key)
        if entry is None:
            entry = CacheEntry(
                key=key,
                protected_text=protected_text,
                translated_text=translated_text,
                src_lang=src_lang,
                dst_lang=dst_lang,
                strategy=strategy,
                created_at=now,
                updated_at=now,
                usage_count=0,
                metadata=metadata or {},
            )
        else:
            entry.translated_text = translated_text
            entry.updated_at = now
            if metadata:
                entry.metadata.update(metadata)
        return self._save_entry(entry)

    def get(self, key: str) -> Optional[str]:
        """Legacy: get translated text by raw key.

        Returns ``translated_text`` or ``None`` if not found.
        This method exists for backward compatibility.
        """
        entry = self._get_entry(key)
        if entry is not None:
            self._stats.total_requests += 1
            self._stats.hits += 1
            entry.usage_count += 1
            entry.updated_at = _now()
            self._save_entry(entry)
            return entry.translated_text
        self._stats.total_requests += 1
        self._stats.misses += 1
        return None

    def set(self, key: str, protected_text: str, translated_text: str) -> None:
        """Legacy: store a translation by raw key.

        This method exists for backward compatibility with existing tests.
        Prefer ``save()`` for new code.
        """
        now = _now()
        entry = self._get_entry(key)
        if entry is None:
            entry = CacheEntry(
                key=key,
                protected_text=protected_text,
                translated_text=translated_text,
                created_at=now,
                updated_at=now,
                usage_count=0,
            )
        else:
            entry.translated_text = translated_text
            entry.updated_at = now
        self._save_entry(entry)

    def clear(self, scope: Optional[Dict[str, Any]] = None) -> int:
        """Clear cache entries matching an optional scope.

        Args:
            scope: Optional dict with any of:
                - ``src_lang`` — clear by source language.
                - ``dst_lang`` — clear by target language.
                - ``strategy`` — clear by strategy.
                If ``None`` or empty, clears the entire cache.

        Returns:
            Number of entries removed.
        """
        if not scope:
            # Full clear
            removed = self._stats.size
            self._cache.clear()
            self._clear_db()
            self._stats = CacheStats()
            return removed

        # Scoped clear
        removed = 0
        if self._db:
            removed = self._scoped_db_clear(scope)
        else:
            removed = self._scoped_memory_clear(scope)

        # Recompute size
        self._stats.size = len(self._cache) if not self._db else self._db_size()
        return removed

    def stats(self) -> CacheStats:
        """Return current cache statistics (snapshot)."""
        self._stats.size = self._db_size() if self._db else len(self._cache)
        return self._stats

    def export_cache(self) -> List[Dict[str, Any]]:
        """Export all cache entries as a list of dicts.

        Returns:
            JSON-serialisable list of cache entries.
        """
        entries = []
        if self._db:
            with self._lock:
                try:
                    conn = self._db.connect()
                    rows = conn.execute(
                        "SELECT key, protected_text, translated_text, "
                        "src_lang, dst_lang, strategy, created_at, updated_at, "
                        "usage_count, metadata_json FROM translation_cache"
                    ).fetchall()
                    for row in rows:
                        entries.append(dict(row))
                except Exception as exc:
                    logger.error("Cache export failed: %s", exc)
                    raise RuntimeError(f"{EXPORT_FAILED}: {exc}") from exc
        else:
            for entry in self._cache.values():
                entries.append(entry.to_dict())

        # Normalise metadata_json to dict in output
        for e in entries:
            if isinstance(e.get("metadata_json"), str):
                try:
                    e["metadata"] = json.loads(e["metadata_json"])
                except (json.JSONDecodeError, TypeError):
                    e["metadata"] = {}
                del e["metadata_json"]
            elif "metadata" not in e:
                e["metadata"] = {}
        return entries

    def import_cache(
        self,
        data: List[Dict[str, Any]],
        merge_strategy: str = MERGE_SKIP_EXISTING,
    ) -> int:
        """Import cache entries from a list of dicts.

        Args:
            data: List of entry dicts (as produced by ``export_cache()``).
            merge_strategy: One of ``skip_existing``, ``overwrite_existing``,
                ``keep_newer``.

        Returns:
            Number of entries imported.

        Raises:
            ValueError: On invalid merge strategy or data structure.
        """
        if not isinstance(data, list):
            raise ValueError(f"{IMPORT_FAILED}: expected a list, got {type(data).__name__}")

        if merge_strategy not in (MERGE_SKIP_EXISTING, MERGE_OVERWRITE_EXISTING,
                                  MERGE_KEEP_NEWER):
            raise ValueError(f"{IMPORT_FAILED}: unknown merge strategy '{merge_strategy}'")

        imported = 0
        for item in data:
            if not isinstance(item, dict) or "key" not in item:
                logger.warning("Skipping invalid cache entry during import: %s", item)
                continue

            key = item.get("key", "")
            if not key:
                continue

            existing = self._get_entry(key)
            should_import = True

            if existing:
                if merge_strategy == MERGE_SKIP_EXISTING:
                    should_import = False
                elif merge_strategy == MERGE_KEEP_NEWER:
                    existing_ts = existing.updated_at or existing.created_at
                    incoming_ts = item.get("updated_at", item.get("created_at", ""))
                    if existing_ts >= incoming_ts:
                        should_import = False

            if should_import:
                entry = CacheEntry.from_row(item)
                self._save_entry(entry)
                imported += 1

        return imported

    # ------------------------------------------------------------------
    # Backward-compatible properties
    # ------------------------------------------------------------------

    @property
    def size(self) -> int:
        """Return approximate number of entries in the cache."""
        if self._db:
            with self._lock:
                try:
                    conn = self._db.connect()
                    row = conn.execute(
                        "SELECT COUNT(*) as cnt FROM translation_cache"
                    ).fetchone()
                    return row["cnt"] if row else 0
                except Exception:
                    return 0
        return len(self._cache)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_entry(self, key: str) -> Optional[CacheEntry]:
        """Retrieve a cache entry by key (SQLite or memory)."""
        if self._db:
            with self._lock:
                try:
                    conn = self._db.connect()
                    row = conn.execute(
                        "SELECT key, protected_text, translated_text, "
                        "src_lang, dst_lang, strategy, created_at, updated_at, "
                        "usage_count, metadata_json FROM translation_cache WHERE key = ?",
                        (key,),
                    ).fetchone()
                    return CacheEntry.from_row(dict(row)) if row else None
                except Exception as exc:
                    logger.error("Cache read failed for key %s: %s", key[:16], exc)
                    return None
        return self._cache.get(key)

    def _save_entry(self, entry: CacheEntry) -> bool:
        """Persist a cache entry (SQLite or memory)."""
        if self._db:
            with self._lock:
                try:
                    conn = self._db.connect()
                    conn.execute(
                        """INSERT OR REPLACE INTO translation_cache
                           (key, protected_text, translated_text, src_lang, dst_lang,
                            strategy, created_at, updated_at, usage_count, metadata_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            entry.key,
                            entry.protected_text,
                            entry.translated_text,
                            entry.src_lang,
                            entry.dst_lang,
                            entry.strategy,
                            entry.created_at,
                            entry.updated_at,
                            entry.usage_count,
                            json.dumps(entry.metadata, ensure_ascii=False),
                        ),
                    )
                    conn.commit()
                    return True
                except Exception as exc:
                    logger.error("Cache write failed for key %s: %s", entry.key[:16], exc)
                    return False
        self._cache[entry.key] = entry
        return True

    def _clear_db(self) -> None:
        """Delete all entries from the database."""
        if not self._db:
            return
        with self._lock:
            try:
                conn = self._db.connect()
                conn.execute("DELETE FROM translation_cache")
                conn.commit()
            except Exception as exc:
                logger.error("Cache clear failed: %s", exc)

    def _scoped_db_clear(self, scope: Dict[str, Any]) -> int:
        """Delete entries matching scope from database."""
        clauses = []
        params = []
        for field in ("src_lang", "dst_lang", "strategy"):
            val = scope.get(field)
            if val is not None:
                clauses.append(f"{field} = ?")
                params.append(val)
        if not clauses:
            return 0
        with self._lock:
            try:
                conn = self._db.connect()
                where = " AND ".join(clauses)
                # Get count first
                count_row = conn.execute(
                    f"SELECT COUNT(*) as cnt FROM translation_cache WHERE {where}", params
                ).fetchone()
                removed = count_row["cnt"] if count_row else 0
                conn.execute(f"DELETE FROM translation_cache WHERE {where}", params)
                conn.commit()
                return removed
            except Exception as exc:
                logger.error("Scoped cache clear failed: %s", exc)
                return 0

    def _scoped_memory_clear(self, scope: Dict[str, Any]) -> int:
        """Delete entries matching scope from in-memory cache."""
        keys_to_remove = []
        for key, entry in self._cache.items():
            match = True
            for field in ("src_lang", "dst_lang", "strategy"):
                val = scope.get(field)
                if val is not None and getattr(entry, field, None) != val:
                    match = False
                    break
            if match:
                keys_to_remove.append(key)
        for k in keys_to_remove:
            del self._cache[k]
        return len(keys_to_remove)

    def _db_size(self) -> int:
        """Return number of entries in the database."""
        if not self._db:
            return 0
        with self._lock:
            try:
                conn = self._db.connect()
                row = conn.execute(
                    "SELECT COUNT(*) as cnt FROM translation_cache"
                ).fetchone()
                return row["cnt"] if row else 0
            except Exception:
                return 0


def _now() -> str:
    """Return current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()
