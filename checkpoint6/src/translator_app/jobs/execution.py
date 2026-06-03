"""Job Execution Service — orchestrates batch-by-batch translation execution.

Connects JobManager + TranslationCoreAdapter + FileProcessingService
into a minimal synchronous execution pipeline.

Methods:
    execute_next_batch(job_id)           — process one task batch
    execute_until_paused_or_done(job_id) — loop over batches
    execute_job_sync(job_id)             — execute all batches synchronously
    get_translated_units(job_id)         — retrieve translated units
    serialize_translated_file(...)       — write translated output file
"""

import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.file_processing.service import FileProcessingService
from translator_app.jobs.models import JobStatus, JobDiagnostic, TranslationJob
from translator_app.jobs.manager import JobManager, JobManagerError
from translator_app.diagnostics.models import DiagnosticLevel
from translator_app.translation.cache import TranslationCache
from translator_app.translation.config import TranslationConfig, config_from_dict
from translator_app.translation.core_adapter import TranslationCoreAdapter
from translator_app.translation.output_paths import resolve_output_path
from translator_app.output.naming import OutputNamingService
from translator_app.jobs.output_serialization import (
    OutputSerializationResult,
    OutputSerializationService,
)
from translator_app.translation.runtime_raw_log import current_job_id
from translator_app.translation.task_planner_models import (
    TaskStatus,
    TranslationTask,
)
from translator_app.translation.trace_models import (
    TraceEventType,
    TraceUnitEntry,
    TraceUnitStatus,
)

logger = logging.getLogger(__name__)


class JobExecutionError(Exception):
    """Raised when job execution encounters an unrecoverable error."""


class JobExecutionService:
    """Orchestrates batch-by-batch execution of a translation job.

    Owns references to the JobManager (state/persistence), the
    TranslationCoreAdapter (translation), and the FileProcessingService
    (file I/O). All execution is synchronous — no threads, no async.
    """

    def __init__(
        self,
        job_manager: JobManager,
        adapter: TranslationCoreAdapter,
        file_service: Optional[FileProcessingService] = None,
        cache: Optional[TranslationCache] = None,
        unit_repo: Optional[Any] = None,
        diagnostics_repo: Optional[Any] = None,
        logging_service: Optional[Any] = None,
        diagnostics_service: Optional[Any] = None,
        trace_service: Optional[Any] = None,
        output_scanner_callback: Optional[Callable[[str], None]] = None,
        output_persistence: Optional[Any] = None,
    ):
        self.jm = job_manager
        self.adapter = adapter
        self.file_service = file_service or FileProcessingService()
        self.cache = cache
        self.unit_repo = unit_repo
        self.diagnostics_repo = diagnostics_repo
        self._log = logging_service
        self._diag = diagnostics_service
        self._trace = trace_service
        self._output_scanner_cb = output_scanner_callback

        # Cooperative cancellation: per-job threading.Event signaled from
        # the API layer (cancel_job endpoint).  Checked at key points
        # during batch execution to ensure no results are saved after cancel.
        self._cancel_events: Dict[str, threading.Event] = {}
        self._cancel_lock = threading.Lock()

        # OutputPersistenceService: unified write + manifest registration.
        # Created lazily if not provided.
        self._output_persistence = output_persistence
        self._own_persistence = output_persistence is None

        # OutputSerializationService: serializes translated units into files.
        # Created lazily if not provided.
        self._output_serialization: Optional[OutputSerializationService] = None

    def _get_persistence(self) -> Any:
        """Lazy-init and return the OutputPersistenceService."""
        if self._output_persistence is None:
            from translator_app.outputs.persistence import OutputPersistenceService
            self._output_persistence = OutputPersistenceService()
            self._own_persistence = True
        return self._output_persistence

    def _get_serialization(self) -> OutputSerializationService:
        """Lazy-init and return the OutputSerializationService."""
        if self._output_serialization is None:
            self._output_serialization = OutputSerializationService(
                file_service=self.file_service,
                output_persistence=self._get_persistence(),
            )
        return self._output_serialization

    def _set_persistence_context(self, job: Any) -> None:
        """Ensure persistence service has job context set."""
        pers = self._get_persistence()
        if pers.has_collector(job.id):
            return
        config = self._get_job_config(job)

        # If context was already set (e.g. from API endpoint with mod info),
        # preserve existing mod_id/mod_name and only update source/output roots.
        if pers.has_job_context(job.id):
            source_root = ""
            if config and hasattr(config, 'output') and config.output and hasattr(config.output, 'root_dir') and config.output.root_dir:
                source_root = str(Path(config.output.root_dir).resolve())
            elif job.file_paths:
                source_root = str(Path(job.file_paths[0]).resolve().parent)

            output_root = ""
            if job.output_root_dir:
                output_root = str(Path(job.output_root_dir).resolve())
            elif config and hasattr(config, 'output') and config.output and config.output.output_dir:
                output_root = str(Path(config.output.output_dir).resolve())

            game_id = getattr(config, "game", "") if config else ""

            pers.set_job_context(
                job_id=job.id,
                job_name=job.name,
                source_root=source_root,
                output_root=output_root,
                game_id=game_id,
                # Preserve existing mod context (passed originally from API)
                mod_id=pers._job_mod_ids.get(job.id, ""),
                mod_name=pers._job_mod_names.get(job.id, ""),
            )
            return
        source_root = ""
        if config and hasattr(config, 'output') and config.output and hasattr(config.output, 'root_dir') and config.output.root_dir:
            source_root = str(Path(config.output.root_dir).resolve())
        elif job.file_paths:
            source_root = str(Path(job.file_paths[0]).resolve().parent)

        output_root = ""
        if job.output_root_dir:
            output_root = str(Path(job.output_root_dir).resolve())
        elif config and hasattr(config, 'output') and config.output and config.output.output_dir:
            output_root = str(Path(config.output.output_dir).resolve())

        game_id = getattr(config, "game", "") if config else ""

        pers.set_job_context(
            job_id=job.id,
            job_name=job.name,
            source_root=source_root,
            output_root=output_root,
            game_id=game_id,
        )

    def _auto_scan_outputs(self, job_id: str) -> None:
        """Run the output scanner callback after job completion.

        Errors from the scanner are logged but never propagated — they
        must not break an already-completed job.
        """
        if self._output_scanner_cb is None:
            return
        try:
            self._output_scanner_cb(job_id)
        except Exception as exc:
            logger.warning(
                "Output scan after completion failed for job %s: %s",
                job_id, exc,
            )

    def _write_output_manifest(self, job: TranslationJob) -> None:
        """Write ``.output_manifest.json`` for a completed job.

        Uses the ``OutputPersistenceService`` to pop the job's manifest
        collector and write the final manifest to disk.

        If the collector is empty (no files were registered via the
        persistence service), the manifest is still written with job-level
        metadata but no file entries.

        Falls back to ``result_summary["output_files"]`` →
        ``job.file_paths`` / ``job.output_files`` for backward compatibility
        with completed jobs that ran before the persistence service existed.

        Errors are logged but never propagated — they must not break
        an already-completed job.
        """
        if not job.output_root_dir:
            return

        try:
            from translator_app.outputs.manifest import (
                MANIFEST_FILENAME,
                OutputManifestWriter,
            )

            output_root_path = Path(job.output_root_dir).resolve()

            # --- Primary path: use persistence service collector ---
            pers = self._get_persistence()
            collector = pers.pop_collector(job.id)
            if collector is not None and collector.file_count() > 0:
                collector.write(output_root_path)
                logger.info(
                    "Wrote output manifest for job %s to %s "
                    "(%d file entries from collector)",
                    job.id, output_root_path / MANIFEST_FILENAME,
                    collector.file_count(),
                )
                return

            # --- Fallback path: build from result_summary / file paths ---
            from translator_app.outputs.manifest import OutputManifestBuilder

            config = self._get_job_config(job)
            source_root_path = Path(".")
            if config and hasattr(config, 'output') and config.output and hasattr(config.output, 'root_dir') and config.output.root_dir:
                source_root_path = Path(config.output.root_dir).resolve()
            elif job.file_paths:
                source_root_path = Path(job.file_paths[0]).resolve().parent

            source_root = str(source_root_path)
            game_id = getattr(config, "game", "") if config else ""

            builder = OutputManifestBuilder()
            builder.set_job_info(
                job_id=job.id,
                job_name=job.name,
                source_root=source_root,
                output_root=str(output_root_path),
                game_id=game_id,
            )

            output_meta = (job.result_summary or {}).get("output_files", [])
            if output_meta:
                for meta in output_meta:
                    source_path = meta.get("source_path", "")
                    output_path = meta.get("output_path", "")
                    units_count = meta.get("units", 0)
                    self._add_manifest_entry(
                        builder, source_path, output_path,
                        units_count, source_root_path, output_root_path,
                    )
            elif job.file_paths and job.output_files:
                for source_path, output_path in zip(
                    job.file_paths, job.output_files
                ):
                    self._add_manifest_entry(
                        builder, source_path, output_path,
                        0, source_root_path, output_root_path,
                    )

            manifest = builder.build()
            manifest_path = output_root_path / MANIFEST_FILENAME
            OutputManifestWriter.write(manifest, manifest_path)
            logger.info(
                "Wrote output manifest for job %s to %s (fallback, %d mods)",
                job.id, manifest_path, len(manifest.mods),
            )
        except Exception as exc:
            logger.warning(
                "Failed to write output manifest for job %s: %s",
                job.id, exc,
            )

    def _register_file_with_collector(
        self,
        job: TranslationJob,
        source_path: str,
        output_path: str,
        parsed_file: Any = None,
        file_units: Optional[List[Any]] = None,
    ) -> None:
        """Register a single written translated file with the manifest collector.

        Delegates to ``OutputPersistenceService.write_translated_file()``
        which both writes the file and registers the manifest entry.
        Since the file has already been written by the caller, we only
        register the existing file.

        Computes relative paths, extracts parser info from the parsed file,
        and records entry counts from the file units.
        """
        # Ensure job context is set on persistence service
        self._set_persistence_context(job)
        pers = self._get_persistence()

        # Extract metadata
        parser_id = ""
        entries_count = len(file_units) if file_units else 0

        if parsed_file is not None:
            try:
                ft = parsed_file.file_type
                if ft is not None:
                    cat = ft.category
                    if cat is not None and hasattr(cat, "value"):
                        parser_id = cat.value
            except Exception:
                pass

        # Register via persistence service (use method that just registers
        # an already-written file)
        from translator_app.outputs.persistence import _compute_relative
        from translator_app.outputs.manifest import OutputManifestWarning
        from pathlib import Path

        out = Path(output_path).resolve() if output_path else Path()
        src = Path(source_path).resolve() if source_path else Path()

        collector = pers.get_collector(job.id)
        if collector is None:
            return

        output_root_path = Path(collector.output_root).resolve() if collector.output_root else Path()
        source_root_path = Path(collector.source_root).resolve() if collector.source_root else Path()

        rel_translated = _compute_relative(out, output_root_path)
        rel_source = _compute_relative(src, source_root_path)

        file_ext = out.suffix.lstrip(".") if out.suffix else ""

        collector.register_file(
            source_file_path=str(src) if src.exists() else source_path,
            translated_file_path=str(out) if out.exists() else output_path,
            relative_source_path=rel_source,
            relative_translated_path=rel_translated,
            file_name=out.name,
            file_ext=file_ext,
            parser_id=parser_id,
            entries_count=entries_count,
            translated_entries_count=entries_count,
            mod_id=pers._job_mod_ids.get(job.id, ""),
            mod_name=pers._job_mod_names.get(job.id, ""),
        )

    @staticmethod
    def _get_job_config(job: TranslationJob) -> Optional[Any]:
        """Return the job's config, defaulting to ``None``."""
        return job.config if job.config is not None else None

    @staticmethod
    def _add_manifest_entry(
        builder: Any,
        source_path: str,
        output_path: str,
        units_count: int,
        source_root: Path,
        output_root: Path,
    ) -> None:
        """Add a single file entry to the manifest builder."""
        src = Path(source_path).resolve() if source_path else Path()
        out = Path(output_path).resolve() if output_path else Path()

        # Relative source path
        rel_source = ""
        if src.is_absolute() and source_root:
            try:
                rel_source = src.relative_to(source_root).as_posix()
            except (ValueError, OSError):
                rel_source = src.name
        else:
            rel_source = src.name if src else ""

        # Relative translated path
        rel_translated = out.name if out else ""
        if out.is_absolute() and output_root:
            try:
                rel_translated = out.relative_to(output_root).as_posix()
            except (ValueError, OSError):
                rel_translated = out.name

        builder.add_file(
            mod_id="",
            mod_name="",
            source_file_path=str(src) if src.exists() else source_path,
            translated_file_path=str(out) if out.exists() else output_path,
            relative_source_path=rel_source,
            relative_translated_path=rel_translated,
            file_name=out.name if out else "",
            file_ext=out.suffix.lstrip(".") if out and out.suffix else "",
            entries_count=units_count,
            translated_entries_count=units_count,
        )

    def _register_file_with_collector(
        self,
        job: TranslationJob,
        source_path: str,
        output_path: str,
        parsed_file: Any = None,
        file_units: Optional[List[Any]] = None,
    ) -> None:
        """Register a single written translated file with the manifest collector.

        Computes relative paths, extracts parser info from the parsed file,
        and records entry counts from the file units.
        """
        collector = self._get_or_create_collector(job)

        # Compute relative paths using the collector's roots
        output_root = (
            Path(collector.output_root).resolve()
            if collector.output_root else Path()
        )
        source_root = (
            Path(collector.source_root).resolve()
            if collector.source_root else Path()
        )

        src = Path(source_path).resolve() if source_path else Path()
        out = Path(output_path).resolve() if output_path else Path()

        # Relative source path
        rel_source = ""
        if src.is_absolute() and source_root:
            try:
                rel_source = src.relative_to(source_root).as_posix()
            except (ValueError, OSError):
                rel_source = src.name
        else:
            rel_source = src.name

        # Relative translated path
        rel_translated = out.name
        if out.is_absolute() and output_root:
            try:
                rel_translated = out.relative_to(output_root).as_posix()
            except (ValueError, OSError):
                rel_translated = out.name

        # Extract parser info and file category from parsed_file
        parser_id = ""
        file_ext = out.suffix.lstrip(".") if out.suffix else ""
        entries_count = len(file_units) if file_units else 0

        if parsed_file is not None:
            try:
                ft = parsed_file.file_type
                if ft is not None:
                    parser_id = ft.category.value if ft.category else ""
                    if not file_ext and ft.extensions:
                        file_ext = ft.extensions[0].lstrip(".")
            except Exception:
                pass

        collector.register_file(
            source_file_path=str(src) if src.exists() else source_path,
            translated_file_path=str(out) if out.exists() else output_path,
            relative_source_path=rel_source,
            relative_translated_path=rel_translated,
            file_name=out.name,
            file_ext=file_ext,
            parser_id=parser_id,
            entries_count=entries_count,
            translated_entries_count=entries_count,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def execute_next_batch(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Execute the next pending task from the job's task plan.

        Steps:
            1. Look up the job; reject if not RUNNING or PAUSING.
            2. Find the first pending (non-cached) task.
            3. Collect the :class:`TranslationUnit` objects for that task.
            4. Call ``adapter.translate_batch()`` — the mock runtime
               returns prefixed text without any real LLM call.
            5. Apply translated text back onto each unit.
            6. Mark the task as done.
            7. Call ``job_manager.save_partial_results()`` to persist
               progress counters.
            8. If the job status is ``PAUSING``, transition to ``PAUSED``.
            9. If all tasks are done, set status to ``COMPLETED`` and
               populate ``result_summary``.

        Returns:
            Dict with ``completed``, ``failed`` counts, or ``None`` when
            there is nothing to execute (all tasks done / cancelled / etc.).
        """
        job = self.jm.get_job(job_id)
        if job is None:
            raise JobManagerError("JOB_NOT_FOUND", f"Job not found: {job_id}", 404)

        # Guard: reject jobs with a broken task_plan (rehydration failed
        # or raw dict that wasn't properly rehydrated).
        if self._has_broken_task_plan(job):
            job.status = JobStatus.FAILED
            job.task_plan = None
            job.units = []
            if not job.error_message:
                job.error_message = (
                    f"Cannot execute job {job_id}: task_plan is corrupted"
                )
            if not any(
                d.code == "TASK_PLAN_REHYDRATION_FAILED"
                for d in (job.diagnostics or [])
            ):
                job.diagnostics.append(JobDiagnostic(
                    level="error",
                    code="TASK_PLAN_REHYDRATION_FAILED",
                    message=(
                        f"Cannot execute job {job_id}: "
                        f"task_plan is corrupted"
                    ),
                ))
            self.jm._repo.save(job)
            return None

        # Only proceed if the job is running or in the process of pausing
        if job.status not in (JobStatus.RUNNING, JobStatus.PAUSING):
            return None

        plan = job.task_plan
        if plan is None:
            return None

        # --- Log batch started ---
        if self._log is not None:
            self._log.info(
                module="job.execution",
                message="batch_started",
                context={"job_id": job_id},
                job_id=job_id,
            )

        # --- Persist units to DB on first execution (if unit_repo is available) ---
        if self.unit_repo is not None and self.unit_repo.count_by_job(job_id) == 0:
            self.unit_repo.save_units(list(job.units), job_id)

        pending_idx, pending_task = self._find_next_pending(plan)
        if pending_task is None:
            # No pending tasks — check if everything is done and auto-complete
            if self._all_tasks_done(plan) and job.status == JobStatus.RUNNING:
                try:
                    job.update_status(JobStatus.COMPLETED)
                except ValueError as exc:
                    logger.warning(
                        "Invalid transition for job %s: %s -> COMPLETED: %s",
                        job_id, job.status.value, exc,
                    )
                    job.diagnostics.append(JobDiagnostic(
                        level="warning",
                        code="INVALID_STATUS_TRANSITION",
                        message=(
                            f"Invalid status transition: {job.status.value} -> "
                            f"completed for job {job_id}: {exc}"
                        ),
                        details={
                            "from_status": job.status.value,
                            "to_status": "completed",
                            "job_id": job_id,
                        },
                    ))
                # P1-14: Finalize batch index and sync progress when all tasks are done.
                # When the job has no runtime tasks (all cached), total_batches is 0
                # so current_batch_index stays 0 — batch display is suppressed in UI.
                job.current_batch_index = job.total_batches
                job._sync_progress_percent()
                job.result_summary = {
                    "completed": job.completed_units,
                    "failed": job.failed_units,
                    "cached": job.cached_units,
                }
                # Serialize output files via OutputSerializationService
                # (correctly dispatches by file category for all game types)
                merged_units = self._get_merged_units_for_retry(job)
                ser_result = self._get_serialization().serialize_job_outputs(
                    job, merged_units=merged_units,
                )
                if ser_result.output_files:
                    job.result_summary["output_files"] = [
                        {
                            "source_path": sf.source_file_path,
                            "output_path": sf.output_path,
                            "units": sf.entries_count,
                        }
                        for sf in ser_result.serialized_files
                    ]
                    job.output_files = ser_result.output_files
                if ser_result.output_root_dir:
                    job.output_root_dir = ser_result.output_root_dir
                if ser_result.warnings:
                    for w in ser_result.warnings:
                        logger.warning("Output serialization warning: %s", w)
                # --- Trace: job_completed ---
                if self._trace is not None:
                    self._trace.add_event(
                        event_type=TraceEventType.JOB_COMPLETED,
                        job_id=job_id,
                        message=f"Job {job_id} completed (all tasks done)",
                        data={
                            "completed": job.completed_units,
                            "failed": job.failed_units,
                            "cached": job.cached_units,
                        },
                    )
                # Persist COMPLETED status (save_partial_results no longer does this — P1-02)
                self.jm._repo.save(job)
                # Write output manifest before auto-scan
                self._write_output_manifest(job)
                # Auto-scan output files after completion (best-effort)
                self._auto_scan_outputs(job_id)
            return None

        # --- Collect units for this task ---
        task_units = self._get_task_units(job, pending_task)
        if not task_units and self.unit_repo is not None:
            # fallback: load units from DB when job.units is empty
            db_units = self.unit_repo.get_units_by_job(job_id)
            if db_units:
                job.units = db_units
                task_units = self._get_task_units(job, pending_task)
        if not task_units:
            pending_task.status = TaskStatus.FAILED.value
            self.jm.save_partial_results(job_id, {
                "completed": 0,
                "failed": 0,
                "batch_index": pending_idx + 1,
            })
            return {"completed": 0, "failed": 0}

        # --- Trace: batch_started ---
        if self._trace is not None:
            config = job.config if job.config is not None else TranslationConfig()
            provider = ""
            model = ""
            if isinstance(config, dict):
                runtime = config.get("runtime", {})
                provider = runtime.get("provider", "") if isinstance(runtime, dict) else ""
                model = runtime.get("model", "") if isinstance(runtime, dict) else ""
            else:
                provider = getattr(getattr(config, "runtime", None), "provider", "") or ""
                model = getattr(getattr(config, "runtime", None), "model", "") or ""
            self._trace.add_event(
                event_type=TraceEventType.BATCH_STARTED,
                job_id=job_id,
                batch_index=pending_idx + 1,
                unit_ids=[u.entry_id for u in task_units if u.entry_id],
                provider=provider,
                model=model,
                message=f"Batch {pending_idx + 1} started via JobExecution",
            )

        # --- Trace units: mark as sent ---
        if self._trace is not None and task_units:
            trace_entries = []
            for unit in task_units:
                entry = TraceUnitEntry(
                    unit_id=unit.entry_id or unit.id or unit.key or "",
                    file_path=unit.file_path or "",
                    key=unit.key or "",
                    source_text=unit.source_text or unit.source or "",
                    translated_text="",
                    status=TraceUnitStatus.SENT,
                    batch_index=pending_idx + 1,
                )
                trace_entries.append(entry)
            self._trace.add_unit_batch(job_id, trace_entries)

        # --- Translate via the adapter ---
        config = job.config if job.config is not None else TranslationConfig()
        if isinstance(config, dict):
            config = config_from_dict(config) or TranslationConfig()

        # P1-03: check cancellation before starting the runtime call
        if self._is_cancelled(job_id):
            return None

        result = self.adapter.translate_batch(task_units, config, job_id=job_id)

        # P1-03: check cancellation after runtime call, before saving results.
        # If cancelled during the batch, the batch result is discarded so that
        # completed_units do not grow after a CANCELLED transition.
        if self._is_cancelled(job_id):
            return None

        # --- Apply translations to the job's unit objects ---
        for unit in task_units:
            matching = [u for u in job.units if u.entry_id == unit.entry_id]
            if matching:
                matching[0].translated_text = unit.translated_text
                matching[0].status = unit.status

        # --- Trace units: update with translation results ---
        # IMPORTANT: job_id MUST be set on the entry, otherwise add_unit()
        # stores it under job_id="" instead of the actual job_id, making
        # it impossible for the UI to find and replace the SENT entry.
        if self._trace is not None and task_units:
            for unit in task_units:
                status = TraceUnitStatus.FAILED
                translated_text = ""
                error_message = unit.error_message or ""
                if unit.status in ("translated", "fallback_translated"):
                    status = TraceUnitStatus.TRANSLATED
                    translated_text = unit.translated_text or unit.target or ""
                elif unit.status in ("failed",):
                    status = TraceUnitStatus.FAILED
                elif unit.translated_text:
                    status = TraceUnitStatus.TRANSLATED
                    translated_text = unit.translated_text
                entry = TraceUnitEntry(
                    unit_id=unit.entry_id or unit.id or unit.key or "",
                    job_id=job_id,
                    file_path=unit.file_path or "",
                    key=unit.key or "",
                    source_text=unit.source_text or unit.source or "",
                    translated_text=translated_text,
                    status=status,
                    error_message=error_message,
                    batch_index=pending_idx + 1,
                )
                self._trace.add_unit(entry)

        # --- Persist units through repository if available ---
        if self.unit_repo is not None:
            translated_units = [u for u in task_units
                                if u.translated_text and u.translated_text.strip()]
            self.unit_repo.update_units_batch(translated_units)

        # --- Save successful translations to cache ---
        if self.cache and getattr(config, 'use_cache', False):
            strategy = ",".join(config.protection.rule_set_ids) if config.protection.rule_set_ids else ""
            for unit in task_units:
                if unit.translated_text and unit.translated_text.strip() \
                        and unit.status not in ("failed",):
                    self.cache.save(
                        unit.source,
                        unit.translated_text,
                        unit.src_lang or config.src_lang,
                        unit.dst_lang or config.dst_lang,
                        strategy,
                    )

        # --- Mark task as done ---
        pending_task.status = TaskStatus.DONE.value

        # --- Persist progress ---
        # NOTE: Passing ``job`` to save_partial_results is CRITICAL.
        # Without it, save_partial_results re-fetches the job from the
        # repository, which returns a NEW object whose task.status is
        # still PENDING (the DONE change on the previous object is lost).
        # This causes the same task to be selected every iteration,
        # producing repeated Batch 1 and double-counted units.
        if self._log is not None:
            self._log.info(
                module="job.execution",
                message="save_partial_results",
                context={
                    "job_id": job_id,
                    "batch_index": pending_idx + 1,
                    "completed_delta": result.stats.translated_units,
                    "failed_delta": result.stats.failed_units,
                    "completed_before": job.completed_units,
                    "failed_before": job.failed_units,
                    "total_units": job.total_units,
                },
                job_id=job_id,
            )
        self.jm.save_partial_results(job_id, {
            "completed": result.stats.translated_units,
            "failed": result.stats.failed_units,
            "batch_index": pending_idx + 1,
        }, job=job)

        # --- Handle pausing ---
        if job.status == JobStatus.PAUSING:
            try:
                job.update_status(JobStatus.PAUSED)
            except ValueError as exc:
                logger.warning(
                    "Invalid transition for job %s: PAUSING -> PAUSED: %s",
                    job_id, exc,
                )
                job.diagnostics.append(JobDiagnostic(
                    level="warning",
                    code="INVALID_STATUS_TRANSITION",
                    message=(
                        f"Invalid status transition: pausing -> paused "
                        f"for job {job_id}: {exc}"
                    ),
                    details={
                        "from_status": "pausing",
                        "to_status": "paused",
                        "job_id": job_id,
                    },
                ))

        # P1-03: check cancellation before handling completion or pausing.
        # If the job was cancelled during save_partial_results, do not
        # transition to COMPLETED or PAUSED — let the CANCELLED status
        # from the state machine stand.
        if self._is_cancelled(job_id):
            self._cleanup_cancel_event(job_id)
            return None

        # --- Handle completion ---
        if self._all_tasks_done(plan):
            if job.status == JobStatus.RUNNING:
                try:
                    job.update_status(JobStatus.COMPLETED)
                except ValueError as exc:
                    logger.warning(
                        "Invalid transition for job %s: %s -> COMPLETED: %s",
                        job_id, job.status.value, exc,
                    )
                    job.diagnostics.append(JobDiagnostic(
                        level="warning",
                        code="INVALID_STATUS_TRANSITION",
                        message=(
                            f"Invalid status transition: {job.status.value} -> "
                            f"completed for job {job_id}: {exc}"
                        ),
                        details={
                            "from_status": job.status.value,
                            "to_status": "completed",
                            "job_id": job_id,
                        },
                    ))
                # P1-14: Finalize batch index when all tasks are done (including cached-only batches)
                job.current_batch_index = job.total_batches
                # Re-sync progress to restore 100.0% after COUNTERS_SATURATED capping
                job._sync_progress_percent()
            job.result_summary = {
                "completed": job.completed_units,
                "failed": job.failed_units,
                "cached": job.cached_units,
            }
            # Serialize output files via OutputSerializationService
            # (correctly dispatches by file category for all game types)
            merged_units = self._get_merged_units_for_retry(job)
            ser_result = self._get_serialization().serialize_job_outputs(
                job, merged_units=merged_units,
            )
            if ser_result.output_files:
                job.result_summary["output_files"] = [
                    {
                        "source_path": sf.source_file_path,
                        "output_path": sf.output_path,
                        "units": sf.entries_count,
                    }
                    for sf in ser_result.serialized_files
                ]
                job.output_files = ser_result.output_files
            if ser_result.output_root_dir:
                job.output_root_dir = ser_result.output_root_dir
            if ser_result.warnings:
                for w in ser_result.warnings:
                    logger.warning("Output serialization warning: %s", w)
            if self._log is not None:
                self._log.info(
                    module="job.execution",
                    message="job_completed",
                    context={"completed": job.completed_units, "failed": job.failed_units, "cached": job.cached_units},
                    job_id=job_id,
                )
            if self._diag is not None:
                self._diag.add_diagnostic(
                    level=DiagnosticLevel.INFO,
                    code="JOB_COMPLETED",
                    message=f"Job {job_id} completed",
                    entity_type="job",
                    entity_id=job_id,
                )
            # --- Trace: job_completed ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.JOB_COMPLETED,
                    job_id=job_id,
                    message=f"Job {job_id} completed",
                    data={
                        "completed": job.completed_units,
                        "failed": job.failed_units,
                        "cached": job.cached_units,
                    },
                )
            # Persist COMPLETED status (save_partial_results no longer does this — P1-02)
            self.jm._repo.save(job)
            # Write output manifest before auto-scan
            self._write_output_manifest(job)
            # Auto-scan output files after completion (best-effort)
            self._auto_scan_outputs(job_id)

        if self._log is not None:
            self._log.info(
                module="job.execution",
                message="batch_completed",
                context={
                    "batch_index": pending_idx + 1,
                    "completed": result.stats.translated_units,
                    "failed": result.stats.failed_units,
                },
                job_id=job_id,
            )

        # --- Trace: batch_completed ---
        if self._trace is not None:
            self._trace.add_event(
                event_type=TraceEventType.BATCH_COMPLETED,
                job_id=job_id,
                batch_index=pending_idx + 1,
                message=f"Batch {pending_idx + 1} completed",
                data={
                    "completed": result.stats.translated_units,
                    "failed": result.stats.failed_units,
                },
            )

        return {
            "completed": result.stats.translated_units,
            "failed": result.stats.failed_units,
            "batch_index": pending_idx + 1,
        }

    def execute_until_paused_or_done(self, job_id: str) -> None:
        """Execute batches one at a time until the job is paused or all
        tasks are done.

        This is the loop that a background worker would call.  Each
        iteration checks the job status and the cancellation event —
        if either has been set to CANCELLED externally, the loop
        terminates before starting a new batch.
        """
        # Set the contextvar so httpx log lines are bound to this job
        token = current_job_id.set(job_id)
        try:
            # Ensure a cancel event exists for this job
            with self._cancel_lock:
                if job_id not in self._cancel_events:
                    self._cancel_events[job_id] = threading.Event()

            try:
                while True:
                    job = self.jm.get_job(job_id)
                    if job is None:
                        raise JobExecutionError(f"Job {job_id} disappeared during execution")
                    if job.status in (JobStatus.CANCELLED, JobStatus.COMPLETED,
                                      JobStatus.FAILED, JobStatus.PAUSED):
                        break
                    if self._is_cancelled(job_id):
                        break
                    result = self.execute_next_batch(job_id)
                    if result is None:
                        break
            finally:
                self._cleanup_cancel_event(job_id)
        finally:
            current_job_id.reset(token)

    def execute_job_sync(self, job_id: str) -> None:
        """Execute all batches of a job synchronously.

        Sets the job to RUNNING (if PENDING), processes all tasks,
        and transitions to COMPLETED when finished.
        """
        job = self.jm.get_job(job_id)
        if job is None:
            raise JobManagerError("JOB_NOT_FOUND", f"Job not found: {job_id}", 404)

        # Start the job if it's pending
        if job.status == JobStatus.PENDING:
            self.jm.start_job(job_id)

        if self._log is not None:
            self._log.info(
                module="job.execution",
                message="job_started",
                context={"job_id": job_id},
                job_id=job_id,
            )

        # --- Trace: job_started ---
        if self._trace is not None:
            plan = getattr(job, "task_plan", None)
            total_batches = len(plan.tasks) if plan and hasattr(plan, "tasks") else 0
            self._trace.add_event(
                event_type=TraceEventType.JOB_STARTED,
                job_id=job_id,
                message=f"Job {job_id} started",
                data={
                    "file_paths": list(job.file_paths) if job.file_paths else [],
                    "total_batches": total_batches,
                    "provider": getattr(job.config, "runtime", None) and job.config.runtime.provider or "",
                    "model": getattr(job.config, "runtime", None) and job.config.runtime.model or "",
                },
            )

        # Execute until done or paused
        self.execute_until_paused_or_done(job_id)

    # ------------------------------------------------------------------
    # Cooperative cancellation
    # ------------------------------------------------------------------

    def cancel_execution(self, job_id: str) -> None:
        """Signal cancellation for a running job.

        This is called from the API layer so the background execution
        thread can detect the cancel event *before* attempting to save
        results after a batch completes.  The actual status transition
        to CANCELLED is handled by ``JobManager.cancel_job()``.
        """
        with self._cancel_lock:
            event = self._cancel_events.get(job_id)
            if event is not None:
                event.set()

    def _is_cancelled(self, job_id: str) -> bool:
        """Check whether a cancellation has been signaled for *job_id*."""
        with self._cancel_lock:
            event = self._cancel_events.get(job_id)
            if event is None:
                return False
            return event.is_set()

    def _cleanup_cancel_event(self, job_id: str) -> None:
        """Remove the cancel event for *job_id* (called when execution ends)."""
        with self._cancel_lock:
            self._cancel_events.pop(job_id, None)

    # ------------------------------------------------------------------
    # Translation result access
    # ------------------------------------------------------------------

    def get_translated_units(self, job_id: str) -> List[TranslationUnit]:
        """Return all units for a job with their translated text.

        If a ``unit_repo`` was provided, loads units from persistent storage.
        Otherwise returns units from the in-memory job object.

        Units are returned in the same order they were extracted from the
        source file(s).  Each unit will have ``translated_text`` populated
        (via the ``target`` property) if it was processed.
        """
        if self.unit_repo is not None:
            return self.unit_repo.get_units_by_job(job_id)
        job = self.jm.get_job(job_id)
        if job is None:
            raise JobManagerError("JOB_NOT_FOUND", f"Job not found: {job_id}", 404)
        return list(job.units) if job.units else []

    def serialize_translated_file(
        self,
        job_id: str,
        output_path: Optional[str] = None,
    ) -> str:
        """Serialize the translated output for a single-file job.

        Re-parses the source file, applies translations from the
        completed job, and writes the result via the file processing
        layer.

        This is a compatibility wrapper around the ``OutputSerializationService``.
        For new code, prefer calling ``OutputSerializationService.serialize_job_outputs()``
        directly.

        Args:
            job_id:  The completed/paused job.
            output_path:  Destination path.  If ``None``, the file
                is placed in the job's output directory with naming
                handled by ``OutputNamingService``.

        Returns:
            The absolute path to the written output file.
        """
        job = self.jm.get_job(job_id)
        if job is None:
            raise JobManagerError("JOB_NOT_FOUND", f"Job not found: {job_id}", 404)

        if not job.file_paths:
            raise JobExecutionError("Job has no source files")

        source_path = job.file_paths[0]

        # When an explicit output_path is provided, use the direct
        # parse → serialize → write path for backward compatibility.
        if output_path is not None:
            return self._serialize_with_explicit_path(
                job, job_id, source_path, output_path,
            )

        # When no explicit path, delegate fully to OutputSerializationService.
        config = job.config
        output_dir = (
            config.output.output_dir
            if config and config.output and config.output.output_dir
            else os.path.dirname(source_path)
        )
        dst_lang = getattr(config, "dst_lang", "ru") or "ru"
        naming = OutputNamingService()
        naming_result = naming.generate_name(
            source_path=source_path,
            src_lang="en",
            dst_lang=dst_lang,
            output_dir=output_dir,
        )
        output_path = naming_result.output_path

        merged_units = self._get_merged_units_for_retry(job)
        ser_result = self._get_serialization().serialize_job_outputs(
            job, merged_units=merged_units,
        )
        if not ser_result.output_files:
            raise JobExecutionError(
                f"OutputSerializationService did not produce any output files "
                f"for job {job_id}"
            )

        if ser_result.output_root_dir:
            job.output_root_dir = ser_result.output_root_dir
        for out_path in ser_result.output_files:
            if out_path not in job.output_files:
                job.output_files.append(out_path)

        return ser_result.output_files[0]

    def _serialize_with_explicit_path(
        self,
        job: TranslationJob,
        job_id: str,
        source_path: str,
        explicit_output_path: str,
    ) -> str:
        """Direct parse → serialize → write using an explicit output path.

        Bypasses ``OutputSerializationService`` path resolution. Used when
        a caller (typically a test) provides a specific output path.
        """
        translated_units = self.get_translated_units(job_id)
        parsed = self.file_service.parse_file(source_path)

        if hasattr(self.file_service, 'adapter') and self.file_service.adapter is not None:
            serialized = self.file_service.serialize_file(
                parsed, output_path=explicit_output_path,
                translations=translated_units,
            )
        else:
            parsed = self.file_service.apply_translations(parsed, translated_units)
            serialized = self.file_service.serialize_file(
                parsed, output_path=explicit_output_path,
            )

        if not serialized.output_path:
            raise JobExecutionError("Serializer did not produce an output path")

        self._set_persistence_context(job)
        pers = self._get_persistence()
        pers.write_translated_file(
            job_id=job_id,
            output_path=serialized.output_path,
            content=serialized.content,
            source_path=source_path,
            parsed_file=parsed,
            file_units=translated_units,
            encoding=serialized.encoding or 'utf-8',
        )

        if serialized.output_path not in job.output_files:
            job.output_files.append(serialized.output_path)
        if job.output_root_dir is None:
            job.output_root_dir = os.path.dirname(serialized.output_path)

        return serialized.output_path

    def _get_merged_units_for_retry(
        self,
        job: TranslationJob,
    ) -> List[TranslationUnit]:
        """Merge retry job's translations with parent job's successful/cached units.

        When *job* is a retry job (has ``source_job_id``), this method:
        1. Gets the retry job's own translated units
        2. Gets the parent job's successful/cached units
        3. Merges them, giving precedence to retry results for the same unit
        4. Returns the combined list for complete output file generation

        For non-retry jobs, returns ``get_translated_units(job.id)`` unchanged.
        """
        retry_units = self.get_translated_units(job.id)

        if not job.source_job_id:
            return retry_units

        # Get parent job's successful/cached units
        try:
            parent_job = self.jm.get_job(job.source_job_id)
        except JobManagerError:
            return retry_units

        if parent_job is None:
            return retry_units

        parent_units = self.get_translated_units(job.source_job_id)

        # Build a set of (file_path, key) for units present in the retry set
        retry_keys: set[tuple[str, str]] = set()
        for u in retry_units:
            retry_keys.add((u.file_path or "", u.key or ""))

        # Include parent units that are NOT in the retry set
        merged = list(retry_units)
        seen_keys = set(retry_keys)
        for u in parent_units:
            unit_key = (u.file_path or "", u.key or "")
            if unit_key not in seen_keys:
                merged.append(u)
                seen_keys.add(unit_key)

        return merged

    def _serialize_generic_output_files(
        self,
        job: TranslationJob,
    ) -> List[Dict[str, Any]]:
        """Serialize all translated files for a completed job.

        Resolves output paths using game-appropriate logic and records
        each written file in a dict list suitable for ``result_summary``.
        For generic games, uses ``resolve_output_path``. For Stellaris and
        other non-generic games, uses the ``OutputNamingService`` to replace
        the source language suffix in the file name (e.g. ``l_english`` →
        ``l_russian``).

        For retry jobs (with ``source_job_id``), this method automatically
        merges successful/cached translations from the parent job so that
        output files contain all units, not just the retried subset.

        Returns:
            List of dicts with keys ``source_path``, ``output_path``,
            and ``units`` (count of translated units for that file).
        """
        config = job.config
        if config is None:
            return []

        output_files: List[Dict[str, Any]] = []
        all_units = self._get_merged_units_for_retry(job)
        game = getattr(config, "game", "") if config else ""

        for source_path in job.file_paths:
            try:
                # Resolve output path using game-appropriate method
                if game == "generic":
                    output_path = resolve_output_path(source_path, config)
                else:
                    # For Stellaris and other non-generic games, use
                    # OutputNamingService to replace language suffix
                    output_dir = (
                        config.output.output_dir
                        if config and config.output and config.output.output_dir
                        else os.path.dirname(source_path)
                    )
                    dst_lang = getattr(config, "dst_lang", "ru") or "ru"
                    naming = OutputNamingService()
                    naming_result = naming.generate_name(
                        source_path=source_path,
                        src_lang="en",
                        dst_lang=dst_lang,
                        output_dir=output_dir,
                    )
                    output_path = naming_result.output_path

                # Re-parse source file
                parsed = self.file_service.parse_file(source_path)

                # Filter units belonging to this file
                file_units = [u for u in all_units
                              if self._unit_belongs_to_file(u, source_path)]

                # Serialize with translations
                if hasattr(self.file_service, 'adapter') and self.file_service.adapter is not None:
                    serialized = self.file_service.serialize_file(
                        parsed, output_path=output_path, translations=file_units,
                    )
                else:
                    parsed = self.file_service.apply_translations(parsed, file_units)
                    serialized = self.file_service.serialize_file(parsed, output_path=output_path)

                if serialized.output_path:
                    # Write via persistence service (write + manifest register)
                    self._set_persistence_context(job)
                    pers = self._get_persistence()
                    pers.write_translated_file(
                        job_id=job.id,
                        output_path=serialized.output_path,
                        content=serialized.content,
                        source_path=source_path,
                        parsed_file=parsed,
                        file_units=file_units,
                        encoding=serialized.encoding or 'utf-8',
                    )

                    output_files.append({
                        "source_path": source_path,
                        "output_path": serialized.output_path,
                        "units": len(file_units),
                    })
                    # Track on the job
                    if serialized.output_path not in job.output_files:
                        job.output_files.append(serialized.output_path)
                    if job.output_root_dir is None:
                        job.output_root_dir = os.path.dirname(serialized.output_path)
            except Exception as exc:
                logger.warning("Failed to serialize generic file %s: %s",
                               source_path, exc)

        return output_files

    @staticmethod
    def _unit_belongs_to_file(unit: TranslationUnit, file_path: str) -> bool:
        """Check if a translation unit belongs to the given source file."""
        if unit.file_path:
            return unit.file_path == file_path
        if unit.file_id and file_path:
            return unit.file_id in file_path
        return True  # single-file fallback: include all units

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _has_broken_task_plan(job: TranslationJob) -> bool:
        """Return True if the job's task_plan is broken and must not be executed.

        Checks:
        1. Job has ``TASK_PLAN_REHYDRATION_FAILED`` diagnostic.
        2. ``task_plan`` is a raw ``dict`` (failed rehydration).
        """
        has_diag = any(
            d.code == "TASK_PLAN_REHYDRATION_FAILED"
            for d in (job.diagnostics or [])
        )
        if has_diag:
            return True
        if isinstance(job.task_plan, dict):
            return True
        return False

    @staticmethod
    def _find_next_pending(
        plan: Any,
    ) -> tuple:
        """Return (index, task) for the first pending task, or (None, None)."""
        for idx, task in enumerate(plan.tasks):
            if task.status in (TaskStatus.PENDING.value,):
                return idx, task
        return None, None

    @staticmethod
    def _get_task_units(
        job: TranslationJob,
        task: TranslationTask,
    ) -> List[TranslationUnit]:
        """Return the units belonging to *task* from the job's unit list.

        Uses the **same** matching logic as the planner's ``_build_task``
        (``u.entry_id or u.id or u.key``) to ensure consistency.

        Removed the old ``unit.entry_id in task_ids`` secondary condition
        which caused overmatching when ``entry_id`` was ``None`` and a
        task had ``None`` in its ``unit_ids`` (units from *other* tasks
        whose ``id``/``key`` were also falsy would wrongly match).
        """
        task_ids = set(uid for uid in task.unit_ids if uid is not None)
        matched: List[TranslationUnit] = []
        for unit in job.units:
            uid = unit.entry_id or unit.id or unit.key
            if uid and uid in task_ids:
                matched.append(unit)
        return matched

    @staticmethod
    def _all_tasks_done(plan: Any) -> bool:
        """Return True when every task in the plan is done or cached."""
        if not plan.tasks:
            return True
        done_statuses = {TaskStatus.DONE.value, TaskStatus.CACHED.value,
                         TaskStatus.FAILED.value}
        return all(t.status in done_statuses for t in plan.tasks)
