"""Storage Layer — repository implementations for all MVP entities.

Provides:
    * JobRepository — job CRUD (already existed, enhanced)
    * SettingsRepository — key/value settings
    * ParsedFileRepository — parsed files + file entries
    * TranslationUnitRepository — translation units batch save/load/update
    * AttemptRepository — translation attempt tracking
    * DiagnosticsRepository — diagnostics storage
    * RunHistoryRepository — run history tracking
    * CacheRepository — adapter over TranslationCache
"""

import json
import logging
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from translator_app.storage.db import DatabaseService
from translator_app.jobs.models import TranslationJob, Job, JobStatus, JobPriority, JobDiagnostic
from translator_app.jobs.manager import _job_to_dict, _dict_to_job
from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.file_processing.models.entries import FileEntry
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel
from translator_app.translation.cache import TranslationCache, CacheEntry
from translator_app.translation.trace_models import (
    TraceEventType,
    TranslationTraceEvent,
    TraceUnitEntry,
)

logger = logging.getLogger(__name__)


# ======================================================================
# JobRepository
# ======================================================================


class JobRepository:
    """SQLite-backed repository for TranslationJob persistence.

    Implements the same interface as ``_InMemoryStore`` so it can be
    passed to ``JobManager(repository=...)`` directly.

    Thread-safe: all public operations are serialized via ``_lock``
    to prevent ``sqlite3.InterfaceError`` when the background
    execution thread and the API handler thread access the same
    connection concurrently.
    """

    def __init__(self, db: DatabaseService):
        self.db = db
        self._lock = threading.Lock()

    def save(self, job: TranslationJob) -> None:
        """Persist a TranslationJob to the jobs table."""
        with self._lock:
            data = _job_to_dict(job)
            conn = self.db.connect()
            conn.execute(
                """INSERT OR REPLACE INTO jobs
               (id, name, status, priority, file_paths,
                source_job_id,
                progress, total_units, completed_units, failed_units,
                cached_units, current_batch_index, total_batches,
                config, task_plan, diagnostics, result_summary,
                output_files, output_root_dir,
                error_message, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data["id"],
                data["name"],
                data["status"],
                data["priority"],
                json.dumps(data["file_paths"]),
                data.get("source_job_id"),
                data["progress"],
                data["total_units"],
                data["completed_units"],
                data["failed_units"],
                data["cached_units"],
                data["current_batch_index"],
                data["total_batches"],
                json.dumps(data["config"]) if data["config"] else None,
                json.dumps(data["task_plan"]) if data["task_plan"] else None,
                json.dumps(data["diagnostics"]) if data["diagnostics"] else None,
                json.dumps(data["result_summary"]) if data["result_summary"] else None,
                json.dumps(data["output_files"]),
                data["output_root_dir"],
                data["error_message"],
                data["created_at"],
                data["updated_at"],
            ),
        )
            conn.commit()

    def get(self, job_id: str) -> Optional[TranslationJob]:
        """Retrieve a TranslationJob by id."""
        with self._lock:
            conn = self.db.connect()
            row = conn.execute(
                "SELECT * FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if not row:
                return None
            return self._row_to_job(row)

    def delete(self, job_id: str) -> None:
        """Delete a job by id."""
        with self._lock:
            conn = self.db.connect()
            conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            conn.commit()

    def list_all(self) -> list:
        """Return all jobs."""
        with self._lock:
            conn = self.db.connect()
            rows = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
            return [self._row_to_job(r) for r in rows]

    def list_by_status(self, status: JobStatus) -> list:
        """Return jobs filtered by status."""
        with self._lock:
            conn = self.db.connect()
            rows = conn.execute(
                "SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC",
                (status.value,),
            ).fetchall()
            return [self._row_to_job(r) for r in rows]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_job(row) -> Optional[TranslationJob]:
        """Convert a sqlite3.Row to a TranslationJob."""
        try:
            raw_config = row["config"]
            config = json.loads(raw_config) if raw_config else None
        except (json.JSONDecodeError, TypeError, KeyError):
            config = None

        try:
            raw_plan = row["task_plan"]
            task_plan = json.loads(raw_plan) if raw_plan else None
        except (json.JSONDecodeError, TypeError, KeyError):
            task_plan = None

        try:
            raw_diags = row["diagnostics"]
            diags_raw = json.loads(raw_diags) if raw_diags else []
        except (json.JSONDecodeError, TypeError, KeyError):
            diags_raw = []

        try:
            raw_summary = row["result_summary"]
            result_summary = json.loads(raw_summary) if raw_summary else None
        except (json.JSONDecodeError, TypeError, KeyError):
            result_summary = None

        file_paths = []
        try:
            fp = row["file_paths"]
            if isinstance(fp, str):
                file_paths = json.loads(fp)
            elif isinstance(fp, (list, tuple)):
                file_paths = list(fp)
        except (json.JSONDecodeError, TypeError):
            file_paths = []

        # output_files / output_root_dir — may not exist in older schemas
        output_files = []
        try:
            of_raw = row["output_files"]
            if isinstance(of_raw, str):
                output_files = json.loads(of_raw) if of_raw else []
            elif isinstance(of_raw, (list, tuple)):
                output_files = list(of_raw)
        except (KeyError, json.JSONDecodeError, TypeError):
            output_files = []

        output_root_dir = None
        try:
            output_root_dir = row["output_root_dir"]
        except KeyError:
            output_root_dir = None

        data = {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "priority": row["priority"],
            "file_paths": file_paths,
            "source_job_id": row["source_job_id"] if "source_job_id" in row.keys() else None,
            "config": config,
            "task_plan": task_plan,
            "progress": row["progress"],
            "total_units": row["total_units"],
            "completed_units": row["completed_units"],
            "failed_units": row["failed_units"],
            "cached_units": row["cached_units"],
            "current_batch_index": row["current_batch_index"],
            "total_batches": row["total_batches"],
            "diagnostics": diags_raw,
            "result_summary": result_summary,
            "output_files": output_files,
            "output_root_dir": output_root_dir,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "error_message": row["error_message"],
        }
        job = _dict_to_job(data)
        # Rehydrate task_plan from dict -> TaskPlan if needed
        if task_plan and isinstance(task_plan, dict) and job is not None:
            from translator_app.translation.task_planner_models import (
                TaskPlan, TranslationTask, PlannerDiagnostic,
            )
            from translator_app.file_processing.models.translation_unit import (
                TranslationUnit,
            )
            try:
                unit_dicts = task_plan.get("units", [])
                plan_units = []
                for ud in unit_dicts:
                    if isinstance(ud, dict):
                        plan_units.append(TranslationUnit(**ud))
                    else:
                        plan_units.append(ud)
                task_dicts = task_plan.get("tasks", [])
                tasks = []
                for td in task_dicts:
                    if isinstance(td, dict):
                        tasks.append(TranslationTask(**td))
                    else:
                        tasks.append(td)
                diag_dicts = task_plan.get("diagnostics", [])
                diags = []
                for dd in diag_dicts:
                    if isinstance(dd, dict):
                        diags.append(PlannerDiagnostic(**dd))
                    else:
                        diags.append(dd)
                job.task_plan = TaskPlan(
                    plan_id=task_plan.get("plan_id", ""),
                    job_id=task_plan.get("job_id", ""),
                    tasks=tasks,
                    total_units=task_plan.get("total_units", 0),
                    total_tasks=task_plan.get("total_tasks", 0),
                    batch_size=task_plan.get("batch_size", 10),
                    cache_hits=task_plan.get("cache_hits", 0),
                    cache_misses=task_plan.get("cache_misses", 0),
                    diagnostics=diags,
                    created_at=task_plan.get("created_at", ""),
                    units=plan_units,
                )
                # Also restore units on the job
                if plan_units and not job.units:
                    job.units = list(plan_units)
            except Exception as exc:
                logger.warning(
                    "TaskPlan rehydration failed for job %s: %s",
                    data.get("id", "unknown"), exc,
                )
                if job is not None:
                    # Set FAILED status directly (repository layer must not
                    # use update_status() — the state machine may reject
                    # transitions for terminal statuses like COMPLETED).
                    job.status = JobStatus.FAILED
                    job.task_plan = None  # Don't leave a raw dict
                    job.units = []  # Clear units
                    if not job.error_message:
                        job.error_message = f"TaskPlan rehydration failed: {exc}"
                    if not any(
                        d.code == "TASK_PLAN_REHYDRATION_FAILED"
                        for d in (job.diagnostics or [])
                    ):
                        job.diagnostics.append(JobDiagnostic(
                            level="error",
                            code="TASK_PLAN_REHYDRATION_FAILED",
                            message=(
                                f"Failed to rehydrate task_plan for job "
                                f"{data.get('id', 'unknown')}: {exc}"
                            ),
                            details={"error": str(exc)},
                        ))
        return job


# ======================================================================
# SettingsRepository
# ======================================================================


class SettingsRepository:
    """Key/value settings storage."""

    def __init__(self, db: DatabaseService):
        self.db = db

    def get(self, key: str) -> Optional[str]:
        conn = self.db.connect()
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

    def set(self, key: str, value: str) -> None:
        conn = self.db.connect()
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) "
            "VALUES (?, ?, ?)",
            (key, value, datetime.now().isoformat()),
        )
        conn.commit()

    def delete(self, key: str) -> bool:
        conn = self.db.connect()
        cursor = conn.execute("DELETE FROM settings WHERE key = ?", (key,))
        conn.commit()
        return cursor.rowcount > 0

    def list_all(self) -> Dict[str, str]:
        conn = self.db.connect()
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}

    def get_int(self, key: str, default: int = 0) -> int:
        val = self.get(key)
        if val is None:
            return default
        try:
            return int(val)
        except (ValueError, TypeError):
            return default

    def get_bool(self, key: str, default: bool = False) -> bool:
        val = self.get(key)
        if val is None:
            return default
        return val.lower() in ("1", "true", "yes")


# ======================================================================
# ParsedFileRepository
# ======================================================================


class ParsedFileRepository:
    """Storage for parsed game files and their entries."""

    def __init__(self, db: DatabaseService):
        self.db = db

    def save(self, parsed_file: ParsedGameFile) -> None:
        """Save a ParsedGameFile and its entries."""
        file_id = parsed_file.id or str(uuid.uuid4())
        conn = self.db.connect()
        conn.execute(
            """INSERT OR REPLACE INTO parsed_files
               (id, path, file_type, language, metadata_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                file_id,
                parsed_file.source_path,
                parsed_file.file_type.value if hasattr(parsed_file.file_type, "value") else str(parsed_file.file_type),
                parsed_file.detected_language,
                json.dumps(parsed_file.metadata),
                datetime.now().isoformat(),
            ),
        )
        # Save entries
        for entry in parsed_file.entries:
            self._save_entry(conn, file_id, entry)
        conn.commit()
        parsed_file.id = file_id

    def get(self, file_id: str) -> Optional[ParsedGameFile]:
        conn = self.db.connect()
        row = conn.execute(
            "SELECT * FROM parsed_files WHERE id = ?", (file_id,)
        ).fetchone()
        if not row:
            return None
        return self._row_to_parsed_file(row, conn)

    def get_by_job(self, job_id: str) -> List[ParsedGameFile]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM parsed_files WHERE job_id = ?", (job_id,)
        ).fetchall()
        return [self._row_to_parsed_file(r, conn) for r in rows]

    def delete(self, file_id: str) -> None:
        conn = self.db.connect()
        conn.execute("DELETE FROM file_entries WHERE file_id = ?", (file_id,))
        conn.execute("DELETE FROM parsed_files WHERE id = ?", (file_id,))
        conn.commit()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _save_entry(self, conn, file_id: str, entry: FileEntry) -> None:
        entry_id = entry.id or str(uuid.uuid4())
        conn.execute(
            """INSERT OR REPLACE INTO file_entries
               (id, file_id, line_no, entry_type, key, value, raw_line)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                entry_id,
                file_id,
                entry.line_number,
                entry.entry_type,
                entry.key,
                entry.value,
                entry.raw,
            ),
        )
        entry.id = entry_id

    def _row_to_parsed_file(self, row, conn) -> ParsedGameFile:
        from translator_app.file_processing.models.file_type import FileType

        metadata = {}
        try:
            raw = row["metadata_json"]
            metadata = json.loads(raw) if raw else {}
        except (json.JSONDecodeError, TypeError, KeyError):
            metadata = {}

        try:
            file_type = FileType(row["file_type"])
        except (ValueError, TypeError):
            file_type = FileType.UNKNOWN if hasattr(FileType, "UNKNOWN") else FileType("unknown")

        parsed = ParsedGameFile(
            id=row["id"],
            source_path=row["path"],
            file_type=file_type,
            detected_language=row["language"] or "",
            metadata=metadata,
        )

        # Load entries
        entry_rows = conn.execute(
            "SELECT * FROM file_entries WHERE file_id = ? ORDER BY line_no",
            (row["id"],),
        ).fetchall()
        for er in entry_rows:
            entry = FileEntry(
                key=er["key"],
                value=er["value"],
                line_number=er["line_no"] or 0,
                raw=er["raw_line"] or "",
                id=er["id"],
                entry_type=er["entry_type"],
            )
            parsed.entries.append(entry)

        return parsed


# ======================================================================
# TranslationUnitRepository
# ======================================================================


class TranslationUnitRepository:
    """Repository for translation units with batch operations."""

    def __init__(self, db: DatabaseService):
        self.db = db

    def save_units(self, units: List[TranslationUnit], job_id: str) -> None:
        """Batch-save translation units for a job."""
        conn = self.db.connect()
        for unit in units:
            unit_id = unit.id or str(uuid.uuid4())
            conn.execute(
                """INSERT OR REPLACE INTO translation_units
                   (id, job_id, file_id, entry_id, key,
                    source_text, translated_text, target_text,
                    file_path, status, from_cache)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    unit_id,
                    job_id,
                    unit.file_id,
                    unit.entry_id,
                    unit.key,
                    unit.source,
                    unit.target,
                    unit.target,
                    unit.file_path,
                    unit.status or "pending",
                    1 if unit.from_cache else 0,
                ),
            )
            unit.id = unit_id
        conn.commit()

    def get_units_by_job(self, job_id: str) -> List[TranslationUnit]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM translation_units WHERE job_id = ? ORDER BY rowid",
            (job_id,),
        ).fetchall()
        return [self._row_to_unit(r) for r in rows]

    def get_units_by_file(self, file_id: str) -> List[TranslationUnit]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM translation_units WHERE file_id = ? ORDER BY rowid",
            (file_id,),
        ).fetchall()
        return [self._row_to_unit(r) for r in rows]

    def get_unit(self, unit_id: str) -> Optional[TranslationUnit]:
        conn = self.db.connect()
        row = conn.execute(
            "SELECT * FROM translation_units WHERE id = ?", (unit_id,)
        ).fetchone()
        return self._row_to_unit(row) if row else None

    def update_unit(self, unit: TranslationUnit) -> None:
        """Update a single translation unit."""
        conn = self.db.connect()
        conn.execute(
            """UPDATE translation_units SET
               translated_text = ?, target_text = ?,
               status = ?, from_cache = ?
               WHERE id = ?""",
            (
                unit.target,
                unit.target,
                unit.status or "pending",
                1 if unit.from_cache else 0,
                unit.id,
            ),
        )
        conn.commit()

    def update_units_batch(self, units: List[TranslationUnit]) -> None:
        """Batch-update multiple translation units."""
        conn = self.db.connect()
        for unit in units:
            conn.execute(
                """UPDATE translation_units SET
                   translated_text = ?, target_text = ?,
                   status = ?, from_cache = ?
                   WHERE id = ?""",
                (
                    unit.target,
                    unit.target,
                    unit.status or "pending",
                    1 if unit.from_cache else 0,
                    unit.id,
                ),
            )
        conn.commit()

    def delete_by_job(self, job_id: str) -> None:
        conn = self.db.connect()
        conn.execute("DELETE FROM translation_units WHERE job_id = ?", (job_id,))
        conn.commit()

    def get_failed_units_by_job(self, job_id: str) -> List[TranslationUnit]:
        """Return only the failed translation units for a job.

        Failed units have status 'failed' in the translation_units table.
        """
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM translation_units WHERE job_id = ? AND status = 'failed' ORDER BY rowid",
            (job_id,),
        ).fetchall()
        return [self._row_to_unit(r) for r in rows]

    def count_by_job(self, job_id: str) -> int:
        conn = self.db.connect()
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM translation_units WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        return row["cnt"] if row else 0

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_unit(row) -> TranslationUnit:
        return TranslationUnit(
            id=row["id"],
            source=row["source_text"],
            target=row["translated_text"] or row["target_text"],
            key=row["key"],
            file_path=row["file_path"],
            file_id=row["file_id"] or "",
            entry_id=row["entry_id"] or "",
            status=row["status"],
            from_cache=bool(row["from_cache"]),
        )


# ======================================================================
# AttemptRepository
# ======================================================================


class AttemptRepository:
    """Repository for translation attempt tracking."""

    def __init__(self, db: DatabaseService):
        self.db = db

    def add(self, unit_id: str, attempt_no: int, model: str,
            success: bool, latency_ms: float) -> str:
        attempt_id = str(uuid.uuid4())
        conn = self.db.connect()
        conn.execute(
            """INSERT INTO attempts
               (id, unit_id, attempt_no, model, success, latency_ms, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                attempt_id,
                unit_id,
                attempt_no,
                model,
                1 if success else 0,
                latency_ms,
                datetime.now().isoformat(),
            ),
        )
        conn.commit()
        return attempt_id

    def get_by_unit(self, unit_id: str) -> List[Dict[str, Any]]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM attempts WHERE unit_id = ? ORDER BY attempt_no",
            (unit_id,),
        ).fetchall()
        return [dict(r) for r in rows]


# ======================================================================
# DiagnosticsRepository
# ======================================================================


class DiagnosticsRepository:
    """Repository for storing and querying diagnostics."""

    def __init__(self, db: DatabaseService):
        self.db = db
        self._has_user_message_col = True  # optimistic

    def _resolve_entity_type(self, diagnostic: Diagnostic) -> str:
        """Resolve entity_type from diagnostic, with fallback."""
        if diagnostic.entity_type:
            return diagnostic.entity_type
        return diagnostic.__class__.__name__

    def _resolve_entity_id(self, diagnostic: Diagnostic) -> str:
        """Resolve entity_id from diagnostic, with fallback."""
        return diagnostic.entity_id or diagnostic.entry_id or ""

    def add(self, diagnostic: Diagnostic) -> int:
        """Add a diagnostic entry. Returns the auto-incremented id."""
        entity_type = self._resolve_entity_type(diagnostic)
        entity_id = self._resolve_entity_id(diagnostic)
        level = diagnostic.level.value if hasattr(diagnostic.level, "value") else str(diagnostic.level)
        details = diagnostic.details or "{}"

        conn = self.db.connect()
        if self._has_user_message_col:
            try:
                cursor = conn.execute(
                    """INSERT INTO diagnostics
                       (entity_type, entity_id, level, code, message, user_message, details_json, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        entity_type,
                        entity_id,
                        level,
                        diagnostic.code,
                        diagnostic.message,
                        diagnostic.user_message or "",
                        details,
                        datetime.now().isoformat(),
                    ),
                )
                conn.commit()
                return cursor.lastrowid or 0
            except Exception:
                self._has_user_message_col = False
                # Fall through to the legacy INSERT

        cursor = conn.execute(
            """INSERT INTO diagnostics
               (entity_type, entity_id, level, code, message, details_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                entity_type,
                entity_id,
                level,
                diagnostic.code,
                diagnostic.message,
                details,
                datetime.now().isoformat(),
            ),
        )
        conn.commit()
        return cursor.lastrowid or 0

    def add_raw(self, entity_type: str, entity_id: str, level: str,
                code: str, message: str, details: Optional[str] = None,
                user_message: Optional[str] = None) -> int:
        """Add a diagnostic by raw fields."""
        conn = self.db.connect()
        if self._has_user_message_col and user_message is not None:
            try:
                cursor = conn.execute(
                    """INSERT INTO diagnostics
                       (entity_type, entity_id, level, code, message, user_message, details_json, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        entity_type,
                        entity_id,
                        level,
                        code,
                        message,
                        user_message,
                        details or "{}",
                        datetime.now().isoformat(),
                    ),
                )
                conn.commit()
                return cursor.lastrowid or 0
            except Exception:
                self._has_user_message_col = False

        cursor = conn.execute(
            """INSERT INTO diagnostics
               (entity_type, entity_id, level, code, message, details_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                entity_type,
                entity_id,
                level,
                code,
                message,
                details or "{}",
                datetime.now().isoformat(),
            ),
        )
        conn.commit()
        return cursor.lastrowid or 0

    def list_by_entity(self, entity_id: str) -> List[Dict[str, Any]]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM diagnostics WHERE entity_id = ? ORDER BY id",
            (entity_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def list_all(self, limit: int = 100) -> List[Dict[str, Any]]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM diagnostics ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def clear(self) -> None:
        conn = self.db.connect()
        conn.execute("DELETE FROM diagnostics")
        conn.commit()


# ======================================================================
# RunHistoryRepository
# ======================================================================


class RunHistoryRepository:
    """Repository for tracking run history."""

    def __init__(self, db: DatabaseService):
        self.db = db

    def start_run(self, job_id: str) -> str:
        """Record a run start. Returns the run id."""
        run_id = str(uuid.uuid4())
        conn = self.db.connect()
        conn.execute(
            """INSERT INTO run_history (id, job_id, started_at, success)
               VALUES (?, ?, ?, 0)""",
            (run_id, job_id, datetime.now().isoformat()),
        )
        conn.commit()
        return run_id

    def finish_run(self, run_id: str, success: bool) -> None:
        conn = self.db.connect()
        conn.execute(
            "UPDATE run_history SET finished_at = ?, success = ? WHERE id = ?",
            (datetime.now().isoformat(), 1 if success else 0, run_id),
        )
        conn.commit()

    def get_by_job(self, job_id: str) -> List[Dict[str, Any]]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM run_history WHERE job_id = ? ORDER BY started_at DESC",
            (job_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def list_all(self, limit: int = 100) -> List[Dict[str, Any]]:
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM run_history ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


# ======================================================================
# CacheRepository — adapter over TranslationCache
# ======================================================================


class CacheRepository:
    """Repository-style adapter over TranslationCache.

    Provides a repository-like interface (get, set, clear, list)
    while delegating to the TranslationCache under the hood.
    """

    def __init__(self, cache: TranslationCache):
        self._cache = cache

    def get(self, key: str) -> Optional[str]:
        """Get translated text by key."""
        return self._cache.get(key)

    def set(self, key: str, protected_text: str, translated_text: str) -> None:
        """Store a translation by key."""
        self._cache.set(key, protected_text, translated_text)

    def lookup(self, protected_text: str, src_lang: str, dst_lang: str,
               strategy: str = "") -> Any:
        """Look up a translation by source text and language pair."""
        return self._cache.lookup(protected_text, src_lang, dst_lang, strategy)

    def save(self, protected_text: str, translated_text: str,
             src_lang: str, dst_lang: str, strategy: str = "",
             metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Save a translation result."""
        return self._cache.save(protected_text, translated_text,
                                src_lang, dst_lang, strategy, metadata)

    def clear(self, scope: Optional[Dict[str, Any]] = None) -> int:
        """Clear cache, optionally scoped."""
        return self._cache.clear(scope)

    def stats(self) -> Any:
        """Return cache statistics."""
        return self._cache.stats()


# ======================================================================
# TraceRepository — P0-06: trace persistence in SQLite
# ======================================================================


class TraceRepository:
    """SQLite-backed repository for trace events and trace units.

    Provides write-through persistence for the TranslationTraceService.
    All add/query/delete operations are thread-safe via the database
    connection lock.
    """

    def __init__(self, db: DatabaseService):
        self.db = db

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def save_event(self, event: TranslationTraceEvent) -> None:
        """Persist a single trace event.

        Note: ``severity`` is intentionally omitted from the DB schema.
        Severity is an ephemeral live-indicator used by the runtime status
        log UI.  It is only stored in-memory (via ``TranslationTraceService._events``)
        and is NOT persisted to SQLite.  Events reloaded from the DB will
        always default to ``TraceEventSeverity.INFO``.
        See ``_row_to_event`` for the read-side default.
        """
        conn = self.db.connect()
        conn.execute(
            """INSERT OR REPLACE INTO trace_events
               (id, job_id, event_type, batch_index, message,
                data_json, provider, model, src_lang, dst_lang, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event.id,
                event.job_id,
                event.event_type.value if hasattr(event.event_type, "value") else str(event.event_type),
                event.batch_index,
                event.message,
                json.dumps(event.data) if event.data is not None else None,
                event.provider,
                event.model,
                event.src_lang,
                event.dst_lang,
                event.timestamp.isoformat() if hasattr(event.timestamp, "isoformat") else str(event.timestamp),
            ),
        )
        conn.commit()

    def get_events_by_job(
        self,
        job_id: str,
        limit: int = 100,
        event_type: Optional[str] = None,
    ) -> List[TranslationTraceEvent]:
        """Return trace events for a job, newest-first, capped by limit."""
        conn = self.db.connect()
        if event_type:
            rows = conn.execute(
                """SELECT * FROM trace_events
                   WHERE job_id = ? AND event_type = ?
                   ORDER BY timestamp DESC LIMIT ?""",
                (job_id, event_type, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM trace_events
                   WHERE job_id = ?
                   ORDER BY timestamp DESC LIMIT ?""",
                (job_id, limit),
            ).fetchall()
        return [self._row_to_event(r) for r in rows]

    def get_all_events(self, limit: int = 5000) -> List[TranslationTraceEvent]:
        """Return all trace events, ordered by timestamp ascending."""
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM trace_events ORDER BY timestamp ASC LIMIT ?",
            (limit,),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    def get_recent_events(self, limit: int = 100) -> List[TranslationTraceEvent]:
        """Return most recent events across all jobs."""
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT * FROM trace_events ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    def delete_events_by_job(self, job_id: str) -> None:
        """Delete all trace events for a job."""
        conn = self.db.connect()
        conn.execute("DELETE FROM trace_events WHERE job_id = ?", (job_id,))
        conn.commit()

    def delete_all_events(self) -> None:
        """Delete all trace events."""
        conn = self.db.connect()
        conn.execute("DELETE FROM trace_events")
        conn.commit()

    def count_events(self) -> int:
        """Return total number of trace events."""
        conn = self.db.connect()
        row = conn.execute("SELECT COUNT(*) as cnt FROM trace_events").fetchone()
        return row["cnt"] if row else 0

    def trim_events(self, max_events: int) -> int:
        """Delete oldest events beyond max_events.

        Returns the number of deleted rows.
        """
        conn = self.db.connect()
        total = self.count_events()
        if total <= max_events:
            return 0
        to_delete = total - max_events
        # Delete oldest rows: use a subquery to find the cutoff id
        conn.execute(
            """DELETE FROM trace_events WHERE id IN (
                SELECT id FROM trace_events
                ORDER BY timestamp ASC
                LIMIT ?
            )""",
            (to_delete,),
        )
        conn.commit()
        return to_delete

    # ------------------------------------------------------------------
    # Units
    # ------------------------------------------------------------------

    def save_unit(self, entry: TraceUnitEntry) -> None:
        """Persist or update a trace unit entry.

        Uses upsert: if a row with the same job_id + unit_id exists,
        it is updated; otherwise a new row is inserted.
        """
        conn = self.db.connect()
        # Check if a row already exists for this job_id + unit_id
        existing = conn.execute(
            "SELECT id FROM trace_units WHERE job_id = ? AND unit_id = ?",
            (entry.job_id, entry.unit_id),
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE trace_units SET
                   file_path = ?, key = ?, source_text = ?,
                   translated_text = ?, status = ?, error_message = ?,
                   batch_index = ?, updated_at = ?
                   WHERE job_id = ? AND unit_id = ?""",
                (
                    entry.file_path,
                    entry.key,
                    entry.source_text,
                    entry.translated_text,
                    entry.status.value if hasattr(entry.status, "value") else str(entry.status),
                    entry.error_message,
                    entry.batch_index,
                    entry.updated_at.isoformat() if hasattr(entry.updated_at, "isoformat") else str(entry.updated_at),
                    entry.job_id,
                    entry.unit_id,
                ),
            )
        else:
            conn.execute(
                """INSERT INTO trace_units
                   (job_id, unit_id, file_path, key,
                    source_text, translated_text, status,
                    error_message, batch_index, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    entry.job_id,
                    entry.unit_id,
                    entry.file_path,
                    entry.key,
                    entry.source_text,
                    entry.translated_text,
                    entry.status.value if hasattr(entry.status, "value") else str(entry.status),
                    entry.error_message,
                    entry.batch_index,
                    entry.updated_at.isoformat() if hasattr(entry.updated_at, "isoformat") else str(entry.updated_at),
                ),
            )
        conn.commit()

    def get_units_by_job(
        self,
        job_id: str,
        limit: int = 50,
    ) -> List[TraceUnitEntry]:
        """Return trace unit entries for a job, newest-first, capped by limit."""
        conn = self.db.connect()
        rows = conn.execute(
            """SELECT * FROM trace_units
               WHERE job_id = ?
               ORDER BY updated_at DESC LIMIT ?""",
            (job_id, limit),
        ).fetchall()
        return [self._row_to_unit(r) for r in rows]

    def get_all_units_by_job(self, job_id: str) -> List[TraceUnitEntry]:
        """Return all trace unit entries for a job (oldest-first, for rebuild)."""
        conn = self.db.connect()
        rows = conn.execute(
            """SELECT * FROM trace_units
               WHERE job_id = ?
               ORDER BY updated_at ASC""",
            (job_id,),
        ).fetchall()
        return [self._row_to_unit(r) for r in rows]

    def get_units_by_job_and_batch(
        self,
        job_id: str,
        batch_index: int,
        limit: int = 500,
    ) -> List[TraceUnitEntry]:
        """Return trace unit entries for a specific job+batch, newest-first."""
        conn = self.db.connect()
        rows = conn.execute(
            """SELECT * FROM trace_units
               WHERE job_id = ? AND batch_index = ?
               ORDER BY updated_at DESC LIMIT ?""",
            (job_id, batch_index, limit),
        ).fetchall()
        return [self._row_to_unit(r) for r in rows]

    def get_distinct_job_ids_with_units(self) -> List[str]:
        """Return all job IDs that have trace units."""
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT DISTINCT job_id FROM trace_units"
        ).fetchall()
        return [r["job_id"] for r in rows]

    def delete_units_by_job(self, job_id: str) -> None:
        """Delete all trace units for a job."""
        conn = self.db.connect()
        conn.execute("DELETE FROM trace_units WHERE job_id = ?", (job_id,))
        conn.commit()

    def delete_all_units(self) -> None:
        """Delete all trace units."""
        conn = self.db.connect()
        conn.execute("DELETE FROM trace_units")
        conn.commit()

    def trim_units(self, job_id: str, max_units: int) -> int:
        """Delete oldest trace units for a job beyond max_units.

        Returns the number of deleted rows.
        """
        conn = self.db.connect()
        total = conn.execute(
            "SELECT COUNT(*) as cnt FROM trace_units WHERE job_id = ?",
            (job_id,),
        ).fetchone()["cnt"]
        if total <= max_units:
            return 0
        to_delete = total - max_units
        conn.execute(
            """DELETE FROM trace_units WHERE rowid IN (
                SELECT rowid FROM trace_units
                WHERE job_id = ?
                ORDER BY updated_at ASC
                LIMIT ?
            )""",
            (job_id, to_delete),
        )
        conn.commit()
        return to_delete

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_event(row) -> TranslationTraceEvent:
        """Convert a sqlite3.Row to a TranslationTraceEvent.

        Note: ``severity`` is intentionally absent from the DB schema;
        the model default ``TraceEventSeverity.INFO`` applies.
        See ``save_event`` for the write-side rationale.
        """
        try:
            raw = row["data_json"]
            data = json.loads(raw) if raw else None
        except (json.JSONDecodeError, TypeError, KeyError):
            data = None

        return TranslationTraceEvent(
            id=row["id"],
            job_id=row["job_id"],
            event_type=TraceEventType(row["event_type"]) if row["event_type"] else TraceEventType.JOB_STARTED,
            batch_index=row["batch_index"] or 0,
            message=row["message"] or "",
            data=data,
            provider=row["provider"] or "",
            model=row["model"] or "",
            src_lang=row["src_lang"] or "",
            dst_lang=row["dst_lang"] or "",
            timestamp=_parse_timestamp(row["timestamp"]) if row["timestamp"] else datetime.utcnow(),
        )

    @staticmethod
    def _row_to_unit(row) -> TraceUnitEntry:
        """Convert a sqlite3.Row to a TraceUnitEntry."""
        from translator_app.translation.trace_models import TraceUnitStatus

        status_val = row["status"] or "pending"
        try:
            status = TraceUnitStatus(status_val)
        except ValueError:
            status = TraceUnitStatus.PENDING

        return TraceUnitEntry(
            unit_id=row["unit_id"] or "",
            job_id=row["job_id"] or "",
            file_path=row["file_path"] or "",
            key=row["key"] or "",
            source_text=row["source_text"] or "",
            translated_text=row["translated_text"] or "",
            status=status,
            error_message=row["error_message"] or "",
            batch_index=row["batch_index"] or 0,
            updated_at=_parse_timestamp(row["updated_at"]) if row["updated_at"] else datetime.utcnow(),
        )


def _parse_timestamp(value: str) -> datetime:
    """Parse an ISO datetime string, returning now() on failure."""
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return datetime.utcnow()
