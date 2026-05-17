"""TranslationTraceService — structured event store for live debug / tracing.

Stores ``TranslationTraceEvent`` objects in-memory with an optional
``max_events`` cap to avoid unbounded memory growth.  All messages
and data dicts are sanitised via ``LogSanitizer`` before storage.

Can optionally accept a ``SecretsService`` to pass ``known_keys`` to the
sanitizer for deeper secret masking.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from translator_app.diagnostics.sanitizer import LogSanitizer
from translator_app.translation.trace_models import (
    TraceEventSeverity,
    TraceEventType,
    TraceUnitStatus,
    TraceUnitEntry,
    TranslationTraceEvent,
    TranslationTraceSnapshot,
    TranslationTraceStats,
)


_RUNTIME_EVENT_TYPES = frozenset({
    TraceEventType.RUNTIME_REQUEST_STARTED,
    TraceEventType.RUNTIME_RESPONSE_RECEIVED,
    TraceEventType.RETRY_ATTEMPT,
    TraceEventType.FALLBACK_STARTED,
    TraceEventType.FALLBACK_COMPLETED,
    TraceEventType.CACHE_HIT,
    TraceEventType.CACHE_MISS,
    TraceEventType.PROMPT_BUILT,
})


class TranslationTraceService:
    """In-memory trace event store with sanitization and max_events limit.

    Responsible for collecting structured trace events emitted by the
    translation pipeline (adapter, runtime, job execution) and providing
    query access for the live-debug API.
    """

    def __init__(
        self,
        max_events: int = 5000,
        max_units_per_job: int = 2000,
        secrets_service: Any = None,
        repo: Any = None,
    ):
        """
        Args:
            max_events: Maximum number of trace events to keep in memory.
                        Older events are dropped when the limit is exceeded.
            max_units_per_job: Maximum number of trace unit entries to keep
                               per job. Oldest entries are dropped when the
                               limit is exceeded.
            secrets_service: Optional SecretsService whose known key IDs
                             are passed to the LogSanitizer for deeper masking.
            repo: Optional TraceRepository for SQLite persistence (P0-06).
                  When provided, events and units are persisted and reloaded
                  on startup.
        """
        self._max_events = max_events
        self._max_units_per_job = max_units_per_job
        self._events: List[TranslationTraceEvent] = []
        self._trace_units: Dict[str, List[TraceUnitEntry]] = {}
        self._known_keys: List[str] = []
        self._repo = repo
        if secrets_service is not None:
            self._known_keys = list(getattr(secrets_service, "list_key_ids", lambda: [])())
        if self._repo is not None:
            self._load_from_db()

    # ------------------------------------------------------------------
    # Database persistence (P0-06)
    # ------------------------------------------------------------------

    def _load_from_db(self) -> None:
        """Load events and units from SQLite into the in-memory cache.

        Called on startup so that get_events / get_units return data
        from previous sessions.
        """
        if self._repo is None:
            return
        try:
            db_events = self._repo.get_all_events(limit=self._max_events)
            self._events = list(db_events)  # already ASC order
        except Exception:
            self._events = []

        try:
            for jid in self._repo.get_distinct_job_ids_with_units():
                units = self._repo.get_units_by_job(jid, limit=self._max_units_per_job)
                if units:
                    self._trace_units[jid] = units
        except Exception:
            self._trace_units = {}

    def _maybe_trim_db_events(self) -> None:
        """Trim oldest events in the DB beyond max_events limit."""
        if self._repo is None:
            return
        try:
            self._repo.trim_events(self._max_events)
        except Exception:
            pass

    def _maybe_trim_db_units(self, job_id: str) -> None:
        """Trim oldest units in the DB beyond max_units_per_job limit."""
        if self._repo is None:
            return
        try:
            self._repo.trim_units(job_id, self._max_units_per_job)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_event(
        self,
        event_type: TraceEventType,
        job_id: str = "",
        task_id: str = "",
        batch_index: int = 0,
        unit_ids: Optional[List[str]] = None,
        provider: str = "",
        model: str = "",
        src_lang: str = "",
        dst_lang: str = "",
        severity: TraceEventSeverity = TraceEventSeverity.INFO,
        message: str = "",
        data: Optional[Dict[str, Any]] = None,
        diagnostics: Optional[Dict[str, Any]] = None,
    ) -> TranslationTraceEvent:
        """Create, sanitise, store and return a new trace event.

        All string messages and data dicts are sanitised via
        ``LogSanitizer`` before being stored.
        """
        sanitised_message = LogSanitizer.sanitize(message, known_keys=self._known_keys)
        sanitised_data = LogSanitizer.sanitize_context(data, known_keys=self._known_keys) if data else None
        sanitised_diag = LogSanitizer.sanitize_context(diagnostics, known_keys=self._known_keys) if diagnostics else None

        event = TranslationTraceEvent(
            job_id=job_id,
            task_id=task_id,
            batch_index=batch_index,
            unit_ids=unit_ids or [],
            event_type=event_type,
            timestamp=datetime.utcnow(),
            provider=provider,
            model=model,
            src_lang=src_lang,
            dst_lang=dst_lang,
            severity=severity,
            message=sanitised_message,
            data=sanitised_data,
            diagnostics=sanitised_diag,
        )

        self._events.append(event)

        # P0-06: persist to SQLite if repo is available
        if self._repo is not None:
            try:
                self._repo.save_event(event)
            except Exception:
                pass

        # Trim oldest events when over limit
        if len(self._events) > self._max_events:
            self._events = self._events[-self._max_events:]
            self._maybe_trim_db_events()

        return event

    def get_events(
        self,
        job_id: str,
        limit: int = 100,
        event_type: Optional[TraceEventType] = None,
    ) -> List[TranslationTraceEvent]:
        """Return events for a job, optionally filtered by event type.

        Results are ordered newest-first.
        """
        filtered = [e for e in self._events if e.job_id == job_id]

        if event_type is not None:
            filtered = [e for e in filtered if e.event_type == event_type]

        # Newest first
        filtered.sort(key=lambda e: e.timestamp, reverse=True)
        return filtered[:limit]

    def get_runtime_events(
        self,
        job_id: str,
        limit: int = 100,
    ) -> List[TranslationTraceEvent]:
        """Return runtime-status-related events for a job, newest-first.

        Includes: RUNTIME_REQUEST_STARTED, RUNTIME_RESPONSE_RECEIVED,
        RETRY_ATTEMPT, FALLBACK_STARTED, FALLBACK_COMPLETED,
        CACHE_HIT, CACHE_MISS, PROMPT_BUILT.
        """
        filtered = [
            e for e in self._events
            if e.job_id == job_id and e.event_type in _RUNTIME_EVENT_TYPES
        ]
        filtered.sort(key=lambda e: e.timestamp, reverse=True)
        return filtered[:limit]

    def get_recent(self, limit: int = 100) -> List[TranslationTraceEvent]:
        """Return the most recent events across all jobs."""
        sorted_events = sorted(self._events, key=lambda e: e.timestamp, reverse=True)
        return sorted_events[:limit]

    def get_snapshot(self, job_id: str) -> TranslationTraceSnapshot:
        """Build a point-in-time snapshot for a job.

        Includes recent events, aggregated stats, and current batch info.
        """
        job_events = [e for e in self._events if e.job_id == job_id]
        job_events_sorted = sorted(job_events, key=lambda e: e.timestamp, reverse=True)

        # Determine current batch from the most recent batch_started event
        current_batch = 0
        for ev in job_events_sorted:
            if ev.event_type == TraceEventType.BATCH_STARTED:
                current_batch = ev.batch_index
                break

        # Count total batches from batch_completed + batch_failed events
        completed_batches = sum(
            1 for e in job_events
            if e.event_type in (TraceEventType.BATCH_COMPLETED, TraceEventType.BATCH_FAILED)
        )
        total_batches = max(completed_batches, current_batch)

        # Collect current unit IDs from the most recent batch_started
        current_units: List[str] = []
        for ev in job_events_sorted:
            if ev.event_type == TraceEventType.BATCH_STARTED and ev.unit_ids:
                current_units = ev.unit_ids
                break

        # Determine status
        status = "unknown"
        if any(e.event_type == TraceEventType.JOB_FAILED for e in job_events):
            status = "failed"
        elif any(e.event_type == TraceEventType.JOB_COMPLETED for e in job_events):
            status = "completed"
        elif any(e.event_type == TraceEventType.JOB_STARTED for e in job_events):
            status = "running"

        stats = self.get_stats(job_id)

        # Determine current activity from the most recent events
        current_activity = self._compute_current_activity(job_events_sorted, status, current_batch, total_batches)

        return TranslationTraceSnapshot(
            job_id=job_id,
            status=status,
            current_batch_index=current_batch,
            total_batches=total_batches,
            current_units=current_units,
            recent_events=job_events_sorted[:10],
            stats=stats,
            current_activity=current_activity,
        )

    def get_stats(self, job_id: str) -> TranslationTraceStats:
        """Compute aggregated statistics for a job."""
        job_events = [e for e in self._events if e.job_id == job_id]

        # Collect latencies from batch_completed diagnostics
        latencies: List[float] = []
        for ev in job_events:
            if ev.event_type == TraceEventType.BATCH_COMPLETED and ev.diagnostics:
                latency = ev.diagnostics.get("latency_ms")
                if latency is not None:
                    latencies.append(float(latency))

        avg_latency = (sum(latencies) / len(latencies)) if latencies else 0.0

        return TranslationTraceStats(
            total_events=len(job_events),
            batches_started=sum(
                1 for e in job_events if e.event_type == TraceEventType.BATCH_STARTED
            ),
            batches_completed=sum(
                1 for e in job_events if e.event_type == TraceEventType.BATCH_COMPLETED
            ),
            retries=sum(
                1 for e in job_events if e.event_type == TraceEventType.RETRY_ATTEMPT
            ),
            fallbacks=sum(
                1 for e in job_events
                if e.event_type in (TraceEventType.FALLBACK_STARTED, TraceEventType.FALLBACK_COMPLETED)
            ),
            cache_hits=sum(
                1 for e in job_events if e.event_type == TraceEventType.CACHE_HIT
            ),
            cache_misses=sum(
                1 for e in job_events if e.event_type == TraceEventType.CACHE_MISS
            ),
            failed_units=sum(
                1 for e in job_events if e.event_type == TraceEventType.UNIT_FAILED
            ),
            avg_latency_ms=avg_latency,
        )

    @staticmethod
    def _compute_current_activity(
        events_sorted: List[TranslationTraceEvent],
        status: str,
        current_batch: int,
        total_batches: int,
    ) -> str:
        """Build a human-readable current activity string from events."""
        if not events_sorted:
            return ""

        most_recent = events_sorted[0].event_type if events_sorted else None

        if status == "completed":
            return "Completed"
        if status == "failed":
            return "Failed"

        if most_recent in (TraceEventType.RETRY_ATTEMPT,):
            if current_batch and total_batches:
                return f"Retrying batch {current_batch}/{total_batches}"
            return "Retrying batch"

        if current_batch and total_batches:
            if most_recent in (TraceEventType.FALLBACK_STARTED, TraceEventType.FALLBACK_COMPLETED):
                return f"Falling back to single mode (batch {current_batch}/{total_batches})"
            return f"Translating batch {current_batch}/{total_batches}"

        if most_recent == TraceEventType.JOB_STARTED:
            return "Starting translation"

        return ""

    # ------------------------------------------------------------------
    # Trace unit management (live source/translation monitoring)
    # ------------------------------------------------------------------

    def add_unit(self, entry: TraceUnitEntry) -> None:
        """Store or update a trace unit entry for a job.

        Sanitizes source and translated text before storing.
        Respects max_units_per_job cap by trimming oldest entries.
        """
        sanitized_source = LogSanitizer.sanitize(entry.source_text, known_keys=self._known_keys)
        sanitized_translated = LogSanitizer.sanitize(entry.translated_text, known_keys=self._known_keys)
        sanitized_error = LogSanitizer.sanitize(entry.error_message, known_keys=self._known_keys)

        sanitized_entry = entry.model_copy(update={
            "source_text": sanitized_source,
            "translated_text": sanitized_translated,
            "error_message": sanitized_error,
            "updated_at": datetime.utcnow(),
        })

        job_units = self._trace_units.setdefault(entry.job_id, [])
        # Replace existing entry for the same unit_id, or append new one
        for i, existing in enumerate(job_units):
            if existing.unit_id == entry.unit_id:
                job_units[i] = sanitized_entry
                break
        else:
            job_units.append(sanitized_entry)

        # P0-06: persist to SQLite if repo is available
        if self._repo is not None:
            try:
                self._repo.save_unit(sanitized_entry)
            except Exception:
                pass

        # Trim oldest entries when over limit
        if len(job_units) > self._max_units_per_job:
            self._trace_units[entry.job_id] = job_units[-self._max_units_per_job:]
            self._maybe_trim_db_units(entry.job_id)

    def add_unit_batch(
        self,
        job_id: str,
        entries: List[TraceUnitEntry],
    ) -> None:
        """Store multiple trace unit entries for a job."""
        for entry in entries:
            entry.job_id = job_id
            self.add_unit(entry)

    def get_units(
        self,
        job_id: str,
        limit: int = 50,
    ) -> List[TraceUnitEntry]:
        """Return trace unit entries for a job, newest-first, capped by limit."""
        job_units = self._trace_units.get(job_id, [])
        # Return newest first
        sorted_units = sorted(job_units, key=lambda u: u.updated_at, reverse=True)
        return sorted_units[:limit]

    def get_units_by_batch(
        self,
        job_id: str,
        batch_index: int,
        limit: int = 500,
    ) -> List[TraceUnitEntry]:
        """Return trace unit entries for a specific batch, newest-first."""
        job_units = self._trace_units.get(job_id, [])
        filtered = [u for u in job_units if u.batch_index == batch_index]
        # Return newest first
        filtered.sort(key=lambda u: u.updated_at, reverse=True)
        return filtered[:limit]

    def clear(self, job_id: Optional[str] = None) -> None:
        """Clear events and trace units for a specific job or all.

        Also removes persisted data from SQLite if a repo is available.
        """
        if job_id is None:
            self._events.clear()
            self._trace_units.clear()
            if self._repo is not None:
                try:
                    self._repo.delete_all_events()
                    self._repo.delete_all_units()
                except Exception:
                    pass
        else:
            self._events = [e for e in self._events if e.job_id != job_id]
            self._trace_units.pop(job_id, None)
            if self._repo is not None:
                try:
                    self._repo.delete_events_by_job(job_id)
                    self._repo.delete_units_by_job(job_id)
                except Exception:
                    pass

    @property
    def event_count(self) -> int:
        """Total number of stored events."""
        return len(self._events)

    @property
    def max_events(self) -> int:
        """Maximum number of events allowed."""
        return self._max_events
