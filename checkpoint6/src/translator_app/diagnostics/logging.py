"""LoggingService — structured in-memory log store with sanitisation.

Provides:
    * In-memory LogEntry storage (MVP — no file I/O).
    * All log messages and context dicts pass through LogSanitizer.
    * Query helpers: get_recent, get_by_job, get_errors.
    * Level-specific helpers: debug / info / warning / error / critical.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from translator_app.diagnostics.models import LogEntry, LogLevel
from translator_app.diagnostics.sanitizer import LogSanitizer


class LoggingService:
    """Structured logging service with in-memory storage.

    All messages and context dicts are sanitised before storage to
    prevent leaking API keys or other secrets.

    Thread-safety: not required — all execution is synchronous.
    """

    def __init__(self, max_entries: int = 10000):
        self._entries: List[LogEntry] = []
        self._max_entries = max_entries
        self._sanitizer = LogSanitizer()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def log(
        self,
        level: LogLevel,
        module: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        job_id: Optional[str] = None,
        file_id: Optional[str] = None,
        unit_id: Optional[str] = None,
        known_keys: Optional[List[str]] = None,
    ) -> LogEntry:
        """Create and store a sanitised log entry."""
        # Sanitize message and context
        safe_message = self._sanitizer.sanitize(message, known_keys=known_keys)
        safe_context = self._sanitizer.sanitize_context(context, known_keys=known_keys)

        entry = LogEntry(
            timestamp=datetime.now(),
            level=level,
            module=module,
            message=safe_message,
            context=safe_context,
            job_id=job_id,
            file_id=file_id,
            unit_id=unit_id,
        )
        self._entries.append(entry)

        # Enforce max size
        if len(self._entries) > self._max_entries:
            self._entries = self._entries[-self._max_entries:]

        return entry

    # ------------------------------------------------------------------
    # Level-specific helpers
    # ------------------------------------------------------------------

    def debug(
        self,
        module: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        job_id: Optional[str] = None,
        file_id: Optional[str] = None,
        unit_id: Optional[str] = None,
    ) -> LogEntry:
        return self.log(LogLevel.DEBUG, module, message, context, job_id, file_id, unit_id)

    def info(
        self,
        module: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        job_id: Optional[str] = None,
        file_id: Optional[str] = None,
        unit_id: Optional[str] = None,
    ) -> LogEntry:
        return self.log(LogLevel.INFO, module, message, context, job_id, file_id, unit_id)

    def warning(
        self,
        module: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        job_id: Optional[str] = None,
        file_id: Optional[str] = None,
        unit_id: Optional[str] = None,
    ) -> LogEntry:
        return self.log(LogLevel.WARNING, module, message, context, job_id, file_id, unit_id)

    def error(
        self,
        module: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        job_id: Optional[str] = None,
        file_id: Optional[str] = None,
        unit_id: Optional[str] = None,
    ) -> LogEntry:
        return self.log(LogLevel.ERROR, module, message, context, job_id, file_id, unit_id)

    def critical(
        self,
        module: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        job_id: Optional[str] = None,
        file_id: Optional[str] = None,
        unit_id: Optional[str] = None,
    ) -> LogEntry:
        return self.log(LogLevel.CRITICAL, module, message, context, job_id, file_id, unit_id)

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_recent(self, limit: int = 50) -> List[LogEntry]:
        """Return the most recent *limit* log entries in reverse order."""
        return list(reversed(self._entries[-limit:]))

    def get_by_job(self, job_id: str) -> List[LogEntry]:
        """Return all log entries for a given job_id."""
        return [e for e in self._entries if e.job_id == job_id]

    def get_errors(self) -> List[LogEntry]:
        """Return all ERROR and CRITICAL log entries."""
        return [
            e for e in self._entries
            if e.level in (LogLevel.ERROR, LogLevel.CRITICAL)
        ]

    def clear(self) -> None:
        """Remove all stored log entries."""
        self._entries.clear()

    @property
    def size(self) -> int:
        return len(self._entries)

    # ------------------------------------------------------------------
    # Legacy backward compat (old stub methods)
    # ------------------------------------------------------------------

    def setup(self, level: Optional[str] = None) -> None:
        """Stub: kept for backward compatibility."""
        pass

    def get_logger(self, name: str) -> "LoggingService":
        """Stub: kept for backward compatibility."""
        return self
