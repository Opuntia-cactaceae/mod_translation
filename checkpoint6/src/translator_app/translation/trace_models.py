"""Trace models for the Translation Trace / Live Debug Module.

Provides structured event, snapshot, and stats models used by
``TranslationTraceService`` and the trace API endpoints.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TraceEventSeverity(str, Enum):
    """Severity level for a trace event.

    Used by the runtime status log UI to colour warnings and errors.
    """
    INFO = "info"
    WARN = "warn"
    ERROR = "error"
    DEBUG = "debug"


class TraceEventType(str, Enum):
    """All recognised trace event types emitted by the translation pipeline."""

    JOB_STARTED = "job_started"
    BATCH_STARTED = "batch_started"
    PROMPT_BUILT = "prompt_built"
    RUNTIME_REQUEST_STARTED = "runtime_request_started"
    RUNTIME_RESPONSE_RECEIVED = "runtime_response_received"
    RESPONSE_PARSED = "response_parsed"
    BATCH_COMPLETED = "batch_completed"
    BATCH_FAILED = "batch_failed"
    RETRY_ATTEMPT = "retry_attempt"
    FALLBACK_STARTED = "fallback_started"
    FALLBACK_COMPLETED = "fallback_completed"
    UNIT_TRANSLATED = "unit_translated"
    UNIT_FAILED = "unit_failed"
    CACHE_HIT = "cache_hit"
    CACHE_MISS = "cache_miss"
    JOB_COMPLETED = "job_completed"
    JOB_FAILED = "job_failed"
    JOB_INTERRUPTED = "job_interrupted"


class TranslationTraceEvent(BaseModel):
    """A single trace event recording one step of the translation pipeline."""

    id: str = Field(default_factory=lambda: _generate_event_id())
    job_id: str = ""
    task_id: str = ""
    batch_index: int = 0
    unit_ids: List[str] = Field(default_factory=list)
    event_type: TraceEventType = TraceEventType.BATCH_STARTED
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    provider: str = ""
    model: str = ""
    src_lang: str = ""
    dst_lang: str = ""
    severity: TraceEventSeverity = TraceEventSeverity.INFO
    message: str = ""
    data: Optional[Dict[str, Any]] = None
    diagnostics: Optional[Dict[str, Any]] = None


class TranslationTraceSnapshot(BaseModel):
    """A point-in-time snapshot of a job's translation progress."""

    job_id: str = ""
    status: str = ""
    current_batch_index: int = 0
    total_batches: int = 0
    processed_units: int = 0
    total_units: int = 0
    current_units: List[str] = Field(default_factory=list)
    recent_events: List[TranslationTraceEvent] = Field(default_factory=list)
    stats: Optional[TranslationTraceStats] = None
    error_message: str = ""  # from job.error_message (P1-05)
    current_activity: str = ""  # human-readable: "Translating batch 14/83", "Validating JSON", etc.


class TranslationTraceStats(BaseModel):
    """Aggregated statistics for a translation job."""

    total_events: int = 0
    batches_started: int = 0
    batches_completed: int = 0
    retries: int = 0
    fallbacks: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    failed_units: int = 0
    avg_latency_ms: float = 0.0


class TraceUnitStatus(str, Enum):
    """Status of a single translation unit in the trace."""
    PENDING = "pending"
    SENT = "sent"
    TRANSLATED = "translated"
    FAILED = "failed"
    CACHED = "cached"


class TraceUnitEntry(BaseModel):
    """A single translation unit with source/translated text for live monitoring."""

    unit_id: str = ""
    job_id: str = ""
    file_path: str = ""
    key: str = ""
    source_text: str = ""
    translated_text: str = ""
    status: TraceUnitStatus = TraceUnitStatus.PENDING
    error_message: str = ""
    batch_index: int = 0
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_event_counter: int = 0


def _generate_event_id() -> str:
    """Generate a short unique event id based on a monotonic counter."""
    global _event_counter
    _event_counter += 1
    return f"evt-{_event_counter}"
