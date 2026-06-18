"""In-memory ring buffer for raw runtime log lines (ephemeral, no DB).

The ``RuntimeRawLogCollector`` stores raw log lines (e.g. "HTTP Request: POST …"
from httpx, openai, groq SDKs) in per-job thread-safe deques.  Lines are
**never persisted** to SQLite and are **lost on backend restart**.

A ``ContextVar`` (``current_job_id``) is used to bind raw log lines to the
currently-executing job without threading the job_id through every SDK call.

Usage (backend wiring)::

    from translator_app.translation.runtime_raw_log import (
        get_collector, current_job_id, RuntimeRawLogHandler,
    )

    # Add handler to the httpx logger once at startup
    logging.getLogger("httpx").addHandler(RuntimeRawLogHandler(get_collector()))
    logging.getLogger("httpx").setLevel(logging.INFO)

    # In job execution, wrap the call with:
    token = current_job_id.set(job_id)
    try:
        # … run translation …
    finally:
        current_job_id.reset(token)
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Dict, List


# ---------------------------------------------------------------------------
# ContextVar — holds the current job_id so logging handlers can associate
# raw log lines without explicit threading through every SDK call.
# ---------------------------------------------------------------------------

current_job_id: ContextVar[str] = ContextVar("current_job_id", default="")


# ---------------------------------------------------------------------------
# In-memory ring buffer collector
# ---------------------------------------------------------------------------


class RuntimeRawLogCollector:
    """Thread-safe in-memory ring buffer for raw runtime log lines.

    Stores lines per ``job_id`` in a deque with a fixed ``maxlen``.
    All operations are protected by a ``threading.Lock``.

    Lines are simple dicts::

        {"ts": "2025-01-01T12:00:00Z", "level": "INFO", "message": "HTTP Request: POST …"}
    """

    def __init__(self, max_lines_per_job: int = 500) -> None:
        self._max = max_lines_per_job
        self._lock = threading.Lock()
        self._buffers: Dict[str, deque] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def append(self, job_id: str, level: str, message: str) -> None:
        """Append a raw log line to the job's ring buffer."""
        line = {
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": level,
            "message": message,
        }
        with self._lock:
            buf = self._buffers.get(job_id)
            if buf is None:
                buf = deque(maxlen=self._max)
                self._buffers[job_id] = buf
            buf.append(line)

    def get_lines(self, job_id: str) -> List[dict]:
        """Return all buffered lines for a job (oldest first)."""
        with self._lock:
            buf = self._buffers.get(job_id)
            if buf is None:
                return []
            return list(buf)

    def count(self, job_id: str) -> int:
        """Number of buffered lines for a job."""
        with self._lock:
            buf = self._buffers.get(job_id)
            return len(buf) if buf else 0

    def clear(self, job_id: str) -> None:
        """Remove all buffered lines for a job."""
        with self._lock:
            self._buffers.pop(job_id, None)

    def clear_all(self) -> None:
        """Remove all buffered lines for all jobs."""
        with self._lock:
            self._buffers.clear()

    @property
    def max_lines_per_job(self) -> int:
        return self._max


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_collector: RuntimeRawLogCollector | None = None


def get_collector() -> RuntimeRawLogCollector:
    """Return the global ``RuntimeRawLogCollector`` singleton."""
    global _collector
    if _collector is None:
        _collector = RuntimeRawLogCollector()
    return _collector


def reset_collector() -> None:
    """Reset the collector singleton (useful for testing)."""
    global _collector
    _collector = None


# ---------------------------------------------------------------------------
# Logging handler — captures ``httpx`` log records and feeds the collector
# ---------------------------------------------------------------------------


class RuntimeRawLogHandler(logging.Handler):
    """A ``logging.Handler`` that forwards log records to the collector.

    Only forwards records when ``current_job_id`` is set (i.e. inside a
    job execution context).  Records without a job context are silently
    dropped to avoid collecting noise from non-job HTTP traffic.
    """

    def __init__(self, collector: RuntimeRawLogCollector | None = None) -> None:
        super().__init__()
        self._collector = collector or get_collector()

    def emit(self, record: logging.LogRecord) -> None:
        job_id = current_job_id.get()
        if not job_id:
            return
        try:
            msg = record.getMessage()
            self._collector.append(job_id, record.levelname, msg)
        except Exception:
            self.handleError(record)
