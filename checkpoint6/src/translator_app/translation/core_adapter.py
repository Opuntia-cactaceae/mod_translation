"""18. Translation Core Adapter Module — adapter between TranslationUnit/TaskPlan
and the translation runtime.

Contains:
    * ``MockRuntime`` — mock translator for testing (no real API calls).
    * ``TranslationCoreAdapter`` — the main adapter class that bridges
      File Processing Layer models with batch/single translation.
"""

import json
import time
import logging
from typing import Dict, List, Optional, Any

from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.translation.config import TranslationConfig
from translator_app.translation.adapter_models import (
    AdapterRow,
    AdapterBatch,
    AdapterBatchResult,
    AdapterRunResult,
    AdapterDiagnostic,
    AdapterStats,
    STATUS_PENDING,
    STATUS_TRANSLATED,
    STATUS_FAILED,
    STATUS_FALLBACK_TRANSLATED,
    BATCH_FAILED,
    TRANSLATION_COUNT_MISMATCH,
    EMPTY_TRANSLATION,
    CHATBOT_REPLY_DETECTED,
    INVALID_RESPONSE_FORMAT,
    PLACEHOLDER_RESTORE_FAILED,
)
from translator_app.translation.trace_models import TraceEventType
from translator_app.translation.runtime_adapter import detect_chatbot_reply
from translator_app.translation.validation import TranslationValidator
from translator_app.translation.placeholder_filter import PlaceholderOnlyFilter
from translator_app.translation.protection_context import RuntimeProtectionContext
from translator_app.protection.engine import PlaceholderLeakInfo
from translator_app.protection.metadata import ProtectionSnapshotBuilder
from translator_app.protection.metadata.models import (
    PlaceholderInfo,
    dataclass_to_dict,
)
from translator_app.protection.ranges import SourceRange

logger = logging.getLogger(__name__)


# ===================================================================
# MockRuntime — mock translator (no real LLM calls)
# ===================================================================


class MockRuntime:
    """Mock translation runtime that simulates batch/single translation
    without making any real LLM or API calls.

    Behaviour is controlled via constructor flags for testing fallback,
    error handling, and count mismatch scenarios.
    """

    def __init__(
        self,
        prefix: str = "[ru] ",
        simulate_batch_error: bool = False,
        simulate_mismatch: Optional[int] = None,
        simulate_single_empty: bool = False,
        simulate_raw_response: Optional[str] = None,
    ):
        """
        Args:
            prefix: String prepended to every translated text.
            simulate_batch_error: If True, raises RuntimeError on batch.
            simulate_mismatch: If set to N, batch returns N results instead
                               of the correct count (regardless of input size).
            simulate_single_empty: If True, single translation returns empty string.
            simulate_raw_response: Override the raw response for validator testing.
                                   If None, auto-generated from translated texts.
        """
        self._prefix = prefix
        self.simulate_batch_error = simulate_batch_error
        self.simulate_mismatch = simulate_mismatch
        self.simulate_single_empty = simulate_single_empty
        self.simulate_raw_response = simulate_raw_response

    # ------------------------------------------------------------------
    # Public API matching the runtime interface expected by the adapter
    # ------------------------------------------------------------------

    def translate_batch(self, texts: List[str]) -> tuple:  # -> Tuple[List[str], Optional[str]]
        """Translate a list of texts in batch mode.

        Args:
            texts: Source texts to translate.

        Returns:
            Translated texts with prefix.

        Raises:
            RuntimeError: If ``simulate_batch_error`` is True.
        """
        if self.simulate_batch_error:
            raise RuntimeError("Mock batch error (simulated)")

        result = [self._prefix + t for t in texts]

        if self.simulate_mismatch is not None:
            # Return wrong number of results
            result = result[:self.simulate_mismatch]

        if self.simulate_raw_response is not None:
            raw_response = self.simulate_raw_response
        else:
            raw_response = json.dumps(result)

        return result, raw_response

    def translate_single(self, text: str) -> str:
        """Translate a single text.

        Args:
            text: Source text to translate.

        Returns:
            Translated text with prefix, or empty string if
            ``simulate_single_empty`` is True.
        """
        if self.simulate_single_empty:
            return ""
        return self._prefix + text


# ===================================================================
# TranslationCoreAdapter
# ===================================================================


class TranslationCoreAdapter:
    """Adapts ``TranslationUnit`` / ``TaskPlan`` from the File Processing
    and Job Manager layers into batch/single translation calls.

    The adapter handles:
        * Batching units by ``config.batch_size``
        * Optional protection (protect/restore)
        * Batch translation via the injected runtime
        * Fallback to single translation on batch failure
        * Basic validation (count match, empty results)
        * Mapping results back to ``TranslationUnit``
        * Collecting stats and diagnostics
    """

    def __init__(
        self,
        runtime: Optional[Any] = None,
        protection_service: Optional[Any] = None,
        logging_service: Optional[Any] = None,
        diagnostics_service: Optional[Any] = None,
        secrets_service: Optional[Any] = None,
        trace_service: Optional[Any] = None,
        protection_snapshot_repo: Optional[Any] = None,
    ):
        """
        Args:
            runtime: Translation runtime. If None, resolved lazily from
                     config — ``MockRuntime`` for mock provider, otherwise
                     ``RealRuntime`` for real LLM providers.
            protection_service: Optional ``ProtectionService`` for rule-set-
                                driven token protect/restore.  If None,
                                protection is skipped (no-op).
            logging_service: Optional LoggingService instance for event logging.
            diagnostics_service: Optional DiagnosticsService instance.
            secrets_service: Optional SecretsService for resolving API keys
                             when using a real provider.
            trace_service: Optional TranslationTraceService for structured
                           trace event recording.
            protection_snapshot_repo: Optional ``ProtectionSnapshotRepository``
                                      for persisting full snapshots.  When
                                      provided, snapshots are saved to the
                                      database at creation time.  Save failures
                                      are logged but do not interrupt
                                      translation.
        """
        self._explicit_runtime = runtime
        self._runtime: Optional[Any] = runtime  # None = lazy init
        self._protection = protection_service
        self._log = logging_service
        self._diag = diagnostics_service
        self._secrets = secrets_service
        self._trace = trace_service
        self._snapshot_builder = ProtectionSnapshotBuilder()
        self._snapshot_repo = protection_snapshot_repo
        # Lazy-built: populated on first batch via _ensure_protection_snapshot().
        # None means "not yet built".  Reset per-translation-run so that
        # different jobs (with different configs) get correct snapshots.
        self._protection_snapshot_ctx: Optional[RuntimeProtectionContext] = None
        self._placeholder_filter = PlaceholderOnlyFilter()

    # ------------------------------------------------------------------
    # High-level API
    # ------------------------------------------------------------------

    def translate_units(
        self,
        units: List[TranslationUnit],
        config: TranslationConfig,
    ) -> AdapterRunResult:
        """Translate a list of ``TranslationUnit`` objects.

        Internally splits into batches, protects text, translates,
        falls back on failure, restores, and maps results back to units.

        Args:
            units: Source translation units.
            config: Translation configuration (batch_size, protection, etc.).

        Returns:
            ``AdapterRunResult`` with updated units, stats, and diagnostics.
        """
        result = AdapterRunResult()
        stats = AdapterStats(total_units=len(units))
        diagnostics: List[AdapterDiagnostic] = []

        self._reset_protection_snapshot()
        batches = self._split_into_batches(units, config.batch_size)

        all_done_units: List[TranslationUnit] = []

        for batch_idx, batch_units in enumerate(batches):
            batch_result = self._process_one_batch(batch_units, config, batch_idx)
            all_done_units.extend(batch_result.units)
            stats.translated_units += batch_result.stats.translated_units
            stats.failed_units += batch_result.stats.failed_units
            stats.fallback_count += batch_result.stats.fallback_count
            stats.batch_count += batch_result.stats.batch_count
            stats.total_latency_ms += batch_result.stats.total_latency_ms
            diagnostics.extend(batch_result.diagnostics)

        result.units = all_done_units
        result.stats = stats
        result.diagnostics = diagnostics
        return result

    def translate_batch(
        self,
        units: List[TranslationUnit],
        config: TranslationConfig,
        job_id: Optional[str] = None,
    ) -> AdapterRunResult:
        """Translate a single batch of units (same as one chunk of
        ``translate_units`` but without splitting into sub-batches).

        Args:
            units: Translation units to process.
            config: Translation configuration.
            job_id: Optional job ID.  When provided, the protection
                snapshot is persisted to the database and the
                ``PROTECTION_SNAPSHOT_CREATED`` trace event includes
                the correct ``job_id`` so that analysis can look it up.

        Useful when the caller has already grouped units.
        """
        self._reset_protection_snapshot()
        return self._process_one_batch(units, config, batch_idx=0, job_id=job_id)

    def translate_single(
        self,
        unit: TranslationUnit,
        config: TranslationConfig,
    ) -> str:
        """Translate a single unit and return the translated text.

        This bypasses batch grouping and fallback — it calls the runtime
        directly for one text.

        Args:
            unit: The unit to translate.
            config: Translation configuration.

        Returns:
            Translated text string.
        """
        text = unit.source_text
        self._reset_protection_snapshot()
        protected_text, protection_mapping, _ = self._protect(text, config)
        self._ensure_runtime(config)
        result_text = self._runtime.translate_single(protected_text)
        restored = self._restore(result_text, protection_mapping, config=config,
                                 row_id=getattr(unit, "entry_id", "") or "")
        return restored

    # ------------------------------------------------------------------
    # TaskPlan integration
    # ------------------------------------------------------------------

    def process_task(
        self,
        task: Any,  # TranslationTask
        all_units: List[TranslationUnit],
        config: TranslationConfig,
        job_id: Optional[str] = None,
    ) -> AdapterRunResult:
        """Process a single ``TranslationTask`` by filtering the units
        that belong to it, translating them, and returning the result.

        Only units whose ``entry_id`` is in ``task.unit_ids`` are processed.

        Args:
            task: A ``TranslationTask`` from a ``TaskPlan``.
            all_units: All available units (filtered internally by task).
            config: Translation configuration.

        Returns:
            ``AdapterRunResult`` for this task's units.
        """
        unit_ids = set(task.unit_ids)
        task_units = [u for u in all_units if u.entry_id in unit_ids]
        if not task_units:
            return AdapterRunResult(
                units=[],
                stats=AdapterStats(),
                diagnostics=[
                    AdapterDiagnostic(
                        level="warning",
                        code="NO_MATCHING_UNITS",
                        message=f"No units matched for task {getattr(task, 'task_id', '?')}",
                    )
                ],
            )
        return self._process_one_batch(task_units, config, task.batch_index, job_id=job_id)

    def process_plan(
        self,
        task_plan: Any,  # TaskPlan
        all_units: List[TranslationUnit],
        config: TranslationConfig,
    ) -> List[AdapterRunResult]:
        """Process all tasks in a ``TaskPlan``.

        Each task becomes a separate processing step.  Results are
        returned as a list of ``AdapterRunResult`` (one per task),
        so the caller (e.g. JobManager) can save partial results
        task by task.

        Args:
            task_plan: A ``TaskPlan`` from the TaskPlanner.
            all_units: All available translation units.
            config: Translation configuration.

        Returns:
            List of ``AdapterRunResult``, one per task.
        """
        results: List[AdapterRunResult] = []
        for task in task_plan.tasks:
            result = self.process_task(task, all_units, config)
            results.append(result)
        return results

    # ------------------------------------------------------------------
    # JobManager integration
    # ------------------------------------------------------------------

    def execute_next_batch(
        self,
        job: Any,  # TranslationJob
        all_units: List[TranslationUnit],
    ) -> Optional[Dict[str, Any]]:
        """Execute the next untranslated batch from a job's task plan.

        Designed to integrate with ``JobManager.save_partial_results()``:
        returns a dict compatible with that method.

        Args:
            job: A ``TranslationJob`` with an attached ``task_plan``.
            all_units: All available translation units.

        Returns:
            Dict with ``completed``, ``failed``, ``batch_index``, and
            ``translations`` keys, or ``None`` if all batches are done.
        """
        plan = getattr(job, "task_plan", None)
        if plan is None:
            return None

        tasks = getattr(plan, "tasks", [])
        current_idx = getattr(job, "current_batch_index", 0)

        if current_idx >= len(tasks):
            return None

        task = tasks[current_idx]
        config: Optional[TranslationConfig] = getattr(job, "config", None)
        if config is None:
            config = TranslationConfig()

        result = self.process_task(task, all_units, config, job_id=job.id)

        batch_result = {
            "completed": result.stats.translated_units,
            "failed": result.stats.failed_units,
            "batch_index": current_idx + 1,
            "translations": [
                {"entry_id": u.entry_id, "translated_text": u.translated_text}
                for u in result.units
            ],
        }
        return batch_result

    # ------------------------------------------------------------------
    # Internal: batch processing pipeline
    # ------------------------------------------------------------------

    def _process_one_batch(
        self,
        batch_units: List[TranslationUnit],
        config: TranslationConfig,
        batch_idx: int = 0,
        job_id: Optional[str] = None,
    ) -> AdapterRunResult:
        """Process one batch of units through the full pipeline:

        protect -> batch translate -> validate -> fallback? -> restore -> map back

        If *job_id* is provided and a ``ProtectionSnapshotRepository`` is
        configured, the protection snapshot is persisted to the database.
        """
        self._ensure_runtime(config)
        stats = AdapterStats(total_units=len(batch_units), batch_count=1)
        diagnostics: List[AdapterDiagnostic] = []

        unit_ids = [u.entry_id for u in batch_units if u.entry_id]

        # --- Ensure protection snapshot is built ---
        protection_ctx = self._ensure_protection_snapshot(config, batch_idx, unit_ids, job_id)

        # --- Trace: batch_started ---
        if self._trace is not None:
            batch_data = {"unit_ids": unit_ids}
            if config.prompt.log_prompts:
                batch_data["source_texts"] = [u.source_text for u in batch_units]
            # Attach protection snapshot metadata
            if protection_ctx.has_snapshot:
                batch_data["protection_snapshot_hash"] = protection_ctx.snapshot_hash
                batch_data["protection_strategy"] = protection_ctx.strategy_name
            self._trace.add_event(
                event_type=TraceEventType.BATCH_STARTED,
                batch_index=batch_idx,
                unit_ids=unit_ids,
                provider=config.runtime.provider,
                model=config.runtime.model,
                src_lang=config.src_lang,
                dst_lang=config.dst_lang,
                message=f"Batch {batch_idx} started ({len(batch_units)} units)",
                data=batch_data,
            )

        start_time = time.perf_counter()

        # --- Build adapter rows ---
        rows = self._units_to_rows(batch_units, config)

        # --- Protect ---
        for row in rows:
            protected, protection_mapping, source_ranges = self._protect(row.source_text, config)
            row.protected_text = protected
            # Store protection state for restore
            row.metadata["_protection_mapping"] = protection_mapping
            row.metadata["_protection_source_ranges"] = source_ranges
            row.metadata["_protection_strategy"] = "rule_set" if config.protection.enabled and config.protection.rule_set_ids else "none"

        # --- Build placeholder registry from all rows' mappings ---
        self._populate_placeholder_registry(protection_ctx, rows)

        # --- Trace: protected texts (debug only) ---
        if self._trace is not None and config.prompt.log_prompts:
            protected_info = {
                r.row_id: r.protected_text for r in rows if r.protected_text
            }
            self._trace.add_event(
                event_type=TraceEventType.BATCH_STARTED,
                batch_index=batch_idx,
                unit_ids=unit_ids,
                message="Texts protected",
                data={"protected_texts": protected_info},
            )

        # --- Placeholder-only filter ---
        filter_result = self._placeholder_filter.filter_rows(rows)

        if filter_result.skipped_items:
            if filter_result.translatable_items:
                # Partial: only send real-content rows to the translator
                batch_result = self._call_batch(
                    filter_result.translatable_items, config, batch_idx
                )
                if batch_result.success:
                    batch_result = self._placeholder_filter.merge_batch_result(
                        batch_result, rows, filter_result.skipped_items
                    )
                # Fallback path (if batch_result.success is False) will handle
                # all rows via _do_fallback, including placeholder-only rows.
                # Those are fixed up in the post-processing step below.
            else:
                # All rows are placeholder-only — skip LLM call entirely
                batch_result = (
                    self._placeholder_filter.make_placeholder_only_batch_result(rows)
                )
                # --- Trace: all skipped ---
                if self._trace is not None:
                    self._trace.add_event(
                        event_type=TraceEventType.RUNTIME_REQUEST_STARTED,
                        batch_index=batch_idx,
                        unit_ids=unit_ids,
                        provider=config.runtime.provider,
                        model=config.runtime.model,
                        message=f"All {len(rows)} units skipped (placeholder-only)",
                        data={"reason": "placeholder_only"},
                    )
                    for item in filter_result.skipped_items:
                        self._trace.add_event(
                            event_type=TraceEventType.UNIT_TRANSLATED,
                            batch_index=batch_idx,
                            unit_ids=[rows[item.original_index].row_id],
                            message=f"Unit skipped (placeholder-only)",
                            data={"skipped_reason": "placeholder_only"},
                        )
        else:
            # No placeholder-only rows — normal pipeline
            batch_result = self._call_batch(rows, config, batch_idx)

        if batch_result.success:
            # --- Trace: response_parsed ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.RESPONSE_PARSED,
                    batch_index=batch_idx,
                    unit_ids=unit_ids,
                    provider=config.runtime.provider,
                    model=config.runtime.model,
                    message=f"Batch response parsed ({len(batch_result.translated_texts)} texts)",
                    data={"translated_count": len(batch_result.translated_texts)},
                )

            # --- Validate output count ---
            is_valid, validation_diag = self._validate_batch_output(
                rows, batch_result
            )
            if validation_diag:
                diagnostics.append(validation_diag)

            if is_valid:
                # --- Chatbot reply check ---
                chatbot_detected = self._check_chatbot_replies(batch_result)
                if chatbot_detected:
                    diagnostics.append(AdapterDiagnostic(
                        level="warning",
                        code=CHATBOT_REPLY_DETECTED,
                        message=f"Chatbot/meta reply detected in batch response",
                    ))
                    # Fall back to single translation
                    fallback_diag = self._do_fallback(rows, config, diagnostics=diagnostics)
                    diagnostics.append(fallback_diag)
                    stats.fallback_count += len(rows)
                    stats.translated_units = sum(1 for r in rows if r.translated_text)
                    stats.failed_units = stats.total_units - stats.translated_units
                    self._log_fallback(fallback_diag)
                else:
                    # Restore texts first
                    for row, translated in zip(rows, batch_result.translated_texts):
                        mapping = row.metadata.get("_protection_mapping", {})
                        restored = self._restore(translated, mapping, config=config,
                                                 row_id=row.row_id)
                        row.translated_text = restored

                    # --- Leak detection (strategy-aware) ---
                    for row, translated in zip(rows, batch_result.translated_texts):
                        mapping = row.metadata.get("_protection_mapping", {})
                        self._detect_and_handle_restore_leaks(
                            translated, mapping, row, config, diagnostics,
                        )

                    # --- Content validator ---
                    is_content_valid, content_diag = self._run_content_validator(
                        rows, batch_result, config,
                    )
                    if content_diag:
                        diagnostics.append(content_diag)

                    if is_content_valid:
                        translated_count = sum(1 for r in rows if r.translated_text)
                        stats.translated_units += translated_count
                        stats.failed_units += len(rows) - translated_count
                        # --- Trace: unit_translated (one event per successfully restored row) ---
                        if self._trace is not None:
                            for row in rows:
                                if row.translated_text:
                                    self._trace.add_event(
                                        event_type=TraceEventType.UNIT_TRANSLATED,
                                        batch_index=batch_idx,
                                        unit_ids=[row.row_id],
                                        provider=config.runtime.provider,
                                        model=config.runtime.model,
                                        message=f"Unit {row.row_id} translated",
                                    )
                                else:
                                    self._trace.add_event(
                                        event_type=TraceEventType.UNIT_FAILED,
                                        batch_index=batch_idx,
                                        unit_ids=[row.row_id],
                                        message=f"Unit {row.row_id} failed (placeholder restore)",
                                    )
                    else:
                        # Content validation failed -> fallback to single
                        for row in rows:
                            row.translated_text = None
                        # --- Trace: fallback_started ---
                        if self._trace is not None:
                            self._trace.add_event(
                                event_type=TraceEventType.FALLBACK_STARTED,
                                batch_index=batch_idx,
                                unit_ids=unit_ids,
                                message="Content validation failed, falling back to single translation",
                                data={"reason": content_diag.message if content_diag else "validation_failed"},
                            )
                        fallback_diag = self._do_fallback(rows, config, diagnostics=diagnostics)
                        diagnostics.append(fallback_diag)
                        stats.fallback_count += len(rows)
                        stats.translated_units = sum(
                            1 for r in rows if r.translated_text
                        )
                        stats.failed_units = stats.total_units - stats.translated_units
                        self._log_fallback(fallback_diag)
                        # --- Trace: fallback_completed ---
                        if self._trace is not None:
                            self._trace.add_event(
                                event_type=TraceEventType.FALLBACK_COMPLETED,
                                batch_index=batch_idx,
                                unit_ids=unit_ids,
                                message=f"Fallback done: {stats.translated_units} ok, {stats.failed_units} failed",
                            )
            else:
                # Count mismatch -> fallback to single
                # --- Trace: fallback_started ---
                if self._trace is not None:
                    self._trace.add_event(
                        event_type=TraceEventType.FALLBACK_STARTED,
                        batch_index=batch_idx,
                        unit_ids=unit_ids,
                        message="Count mismatch, falling back to single translation",
                        data={"reason": validation_diag.message if validation_diag else "count_mismatch"},
                    )
                fallback_diag = self._do_fallback(rows, config, diagnostics=diagnostics)
                diagnostics.append(fallback_diag)
                stats.fallback_count += len(rows)
                # Count successes after fallback
                stats.translated_units = sum(
                    1 for r in rows if r.translated_text
                )
                stats.failed_units = stats.total_units - stats.translated_units
                self._log_fallback(fallback_diag)
                # --- Trace: fallback_completed ---
                if self._trace is not None:
                    self._trace.add_event(
                        event_type=TraceEventType.FALLBACK_COMPLETED,
                        batch_index=batch_idx,
                        unit_ids=unit_ids,
                        message=f"Fallback done: {stats.translated_units} ok, {stats.failed_units} failed",
                    )
        else:
            # Batch exception -> fallback
            batch_error = batch_result.error or "Batch translation failed"
            diagnostics.append(
                AdapterDiagnostic(
                    level="error",
                    code=BATCH_FAILED,
                    message=batch_error,
                )
            )
            self._log_batch_failed(batch_error)
            # --- Trace: batch_failed ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.BATCH_FAILED,
                    batch_index=batch_idx,
                    unit_ids=unit_ids,
                    provider=config.runtime.provider,
                    model=config.runtime.model,
                    message=batch_error,
                    diagnostics={"error": batch_error},
                )
            # --- Trace: fallback_started ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.FALLBACK_STARTED,
                    batch_index=batch_idx,
                    unit_ids=unit_ids,
                    message="Batch failed, falling back to single translation",
                    data={"error": batch_error},
                )
            fallback_diag = self._do_fallback(rows, config, diagnostics=diagnostics)
            diagnostics.append(fallback_diag)
            self._log_fallback(fallback_diag)
            stats.fallback_count += len(rows)
            stats.translated_units = sum(
                1 for r in rows if r.translated_text
            )
            stats.failed_units = stats.total_units - stats.translated_units
            # --- Trace: fallback_completed ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.FALLBACK_COMPLETED,
                    batch_index=batch_idx,
                    unit_ids=unit_ids,
                    message=f"Fallback done: {stats.translated_units} ok, {stats.failed_units} failed",
                )

        # --- Placeholder-only post-processing: ensure skipped rows have
        #     their protected text properly restored, even if a fallback
        #     path produced corrupted text for them. ---
        if filter_result.skipped_items:
            for item in filter_result.skipped_items:
                row = rows[item.original_index]
                row.translated_text = self._restore(
                    row.protected_text,
                    row.metadata.get("_protection_mapping", {}),
                    config=config,
                    row_id=row.row_id,
                )

        # --- Trace: unit_failed for rows that have no translated_text ---
        if self._trace is not None:
            for row in rows:
                if not row.translated_text:
                    self._trace.add_event(
                        event_type=TraceEventType.UNIT_FAILED,
                        batch_index=batch_idx,
                        unit_ids=[row.row_id],
                        message=f"Unit {row.row_id} failed",
                    )

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        stats.total_latency_ms = elapsed_ms

        # --- Trace: batch_completed ---
        if self._trace is not None:
            self._trace.add_event(
                event_type=TraceEventType.BATCH_COMPLETED,
                batch_index=batch_idx,
                unit_ids=unit_ids,
                provider=config.runtime.provider,
                model=config.runtime.model,
                message=f"Batch {batch_idx} completed in {elapsed_ms:.0f}ms",
                data={
                    "translated": stats.translated_units,
                    "failed": stats.failed_units,
                    "latency_ms": elapsed_ms,
                },
                diagnostics={"latency_ms": elapsed_ms},
            )

        # --- Map rows back to TranslationUnit ---
        updated_units = self._rows_to_units(rows, batch_units, stats)

        return AdapterRunResult(
            units=updated_units,
            stats=stats,
            diagnostics=diagnostics,
        )

    # ------------------------------------------------------------------
    # Internal: logging / diagnostics helpers
    # ------------------------------------------------------------------

    def _log_fallback(self, fallback_diag: AdapterDiagnostic) -> None:
        """Log a fallback event through logging and diagnostics services."""
        if self._log is not None:
            self._log.warning(
                module="adapter",
                message="fallback_triggered",
                context={"reason": fallback_diag.message},
            )
        if self._diag is not None:
            self._diag.add_warning(
                code="FALLBACK_USED",
                message=fallback_diag.message,
                entity_type="adapter",
            )

    def _log_batch_failed(self, error: str) -> None:
        """Log a batch failure event."""
        if self._log is not None:
            self._log.error(
                module="adapter",
                message="batch_failed",
                context={"error": error},
            )
        if self._diag is not None:
            self._diag.add_error(
                code="BATCH_FAILED",
                message=error,
                entity_type="adapter",
            )

    # ------------------------------------------------------------------
    # Internal: lazy runtime initialisation
    # ------------------------------------------------------------------

    def _ensure_runtime(self, config: TranslationConfig) -> None:
        """Lazily initialise the runtime if not already set.

        * If an explicit runtime was passed to the constructor → use it.
        * If config.runtime.provider is set and not ``"mock"`` →
          create a ``RealRuntime`` backed by translator_benchmark.
        * Otherwise → use ``MockRuntime``.

        This preserves backward compatibility: all existing callers that
        do not pass a runtime or config continue to get MockRuntime.
        """
        if self._runtime is not None:
            return  # Already initialised (explicit or lazy)

        provider = config.runtime.provider
        if provider and provider != "mock":
            from translator_app.translation.runtime_adapter import RealRuntime

            self._runtime = RealRuntime(
                config=config,
                secrets_service=self._secrets,
                logging_service=self._log,
                diagnostics_service=self._diag,
                trace_service=self._trace,
            )
        else:
            self._runtime = MockRuntime()

    # ------------------------------------------------------------------
    # Internal: lazy protection snapshot creation
    # ------------------------------------------------------------------

    def _ensure_protection_snapshot(
        self,
        config: TranslationConfig,
        batch_idx: int = 0,
        unit_ids: Optional[list[str]] = None,
        job_id: Optional[str] = None,
    ) -> RuntimeProtectionContext:
        """Lazily build and cache a ``RuntimeProtectionContext``.

        The snapshot is built once per translation run (reset when
        ``translate_units`` / ``translate_batch`` is called).  It
        captures:

        * The rule set IDs from ``config.protection.rule_set_ids``.
        * All enabled rules from the active rule sets.
        * The builtin token schema.

        If a ``ProtectionSnapshotRepository`` is available and a
        ``job_id`` is provided, the full snapshot is persisted to the
        database.  Save failures are logged but do not interrupt
        translation.

        If the snapshot build fails, a minimal fallback context is
        returned so that the caller never crashes.  A warning is logged.

        Returns:
            ``RuntimeProtectionContext`` — always valid, never ``None``.
        """
        # If already built for this run, return cached version.
        # The context is reset at the start of each translate_units/batch
        # call via ``_reset_protection_snapshot()``.
        if self._protection_snapshot_ctx is not None:
            return self._protection_snapshot_ctx

        rule_set_ids = config.protection.rule_set_ids
        protection_enabled = config.protection.enabled
        strategy_name = "rule_set" if protection_enabled and rule_set_ids else "none"

        # Collect active rules from rule sets via the ProtectionService
        active_rules: list = []

        # Build the ProtectionSnapshot via the builder
        try:
            snapshot = self._snapshot_builder.build(
                strategy_name=strategy_name,
                profile_id=None,  # No profile-id in current runtime config
                rules=None,  # Rules come from builtin schema now
                rule_set_ids=rule_set_ids if protection_enabled else None,
            )
        except Exception as exc:
            logger.warning(
                "Failed to build ProtectionSnapshot: strategy=%s, rule_set_ids=%s, error=%s",
                strategy_name, rule_set_ids, exc,
            )
            # Fallback context with minimal info
            ctx = RuntimeProtectionContext(
                snapshot=None,
                snapshot_hash="",
                strategy_name=strategy_name,
                applied_rule_count=0,
                custom_rules_enabled=protection_enabled,
            )
            self._protection_snapshot_ctx = ctx
            return ctx

        # Extract schema_hash from snapshot
        schema_hash = ""
        if snapshot.token_schema is not None:
            schema_hash = snapshot.token_schema.schema_hash or ""

        ctx = RuntimeProtectionContext(
            snapshot=snapshot,
            snapshot_hash=snapshot.snapshot_hash,
            strategy_name=snapshot.strategy_name,
            profile_id=snapshot.profile_id,
            applied_rule_count=len(snapshot.applied_rules),
            custom_rules_enabled=protection_enabled,
            schema_hash=schema_hash,
        )
        self._protection_snapshot_ctx = ctx

        # --- Persist full snapshot to database ---
        if self._snapshot_repo is not None and job_id:
            try:
                persisted = self._snapshot_repo.save_snapshot(
                    job_id=job_id,
                    snapshot=snapshot,
                )
                ctx.persisted = persisted
                if persisted:
                    logger.debug(
                        "ProtectionSnapshot %s persisted for job %s",
                        ctx.snapshot_hash[:12], job_id,
                    )
                else:
                    logger.debug(
                        "ProtectionSnapshot %s already exists (skipped duplicate)",
                        ctx.snapshot_hash[:12],
                    )
            except Exception as exc:
                logger.warning(
                    "Failed to persist protection snapshot for job %s: %s",
                    job_id, exc,
                )
                ctx.persisted = False

        # --- Structured logging ---
        logger.info(
            "ProtectionSnapshot created: strategy=%s hash=%s rules=%d custom=%s persisted=%s",
            ctx.strategy_name,
            ctx.snapshot_hash,
            ctx.applied_rule_count,
            ctx.custom_rules_enabled,
            ctx.persisted,
        )

        # --- Trace: PROTECTION_SNAPSHOT_CREATED ---
        if self._trace is not None:
            self._trace.add_event(
                event_type=TraceEventType.PROTECTION_SNAPSHOT_CREATED,
                job_id=job_id or "",
                batch_index=batch_idx,
                unit_ids=unit_ids or [],
                provider=getattr(config.runtime, "provider", ""),
                model=getattr(config.runtime, "model", ""),
                message=(
                    f"Protection snapshot created: strategy={ctx.strategy_name}, "
                    f"rules={ctx.applied_rule_count}, hash={ctx.snapshot_hash[:12]}..."
                ),
                data=ctx.to_trace_data(),
            )

        return ctx

    def _reset_protection_snapshot(self) -> None:
        """Reset the cached protection snapshot.

        Called at the start of each ``translate_units`` / ``translate_batch``
        / ``translate_single`` invocation so that a fresh snapshot is built
        for the current config.
        """
        self._protection_snapshot_ctx = None

    # ------------------------------------------------------------------
    # Internal: helpers
    # ------------------------------------------------------------------

    def _split_into_batches(
        self,
        units: List[TranslationUnit],
        batch_size: int,
    ) -> List[List[TranslationUnit]]:
        """Split units into chunks of *batch_size*."""
        if batch_size < 1:
            raise ValueError(f"batch_size must be >= 1, got {batch_size}")
        return [units[i:i + batch_size] for i in range(0, len(units), batch_size)]

    def _units_to_rows(
        self,
        units: List[TranslationUnit],
        config: TranslationConfig,
    ) -> List[AdapterRow]:
        """Convert TranslationUnit list to AdapterRow list."""
        return [
            AdapterRow(
                row_id=u.entry_id or str(i),
                source_text=u.source_text,
                metadata={"src_lang": u.src_lang or config.src_lang,
                          "dst_lang": u.dst_lang or config.dst_lang},
            )
            for i, u in enumerate(units)
        ]

    def _rows_to_units(
        self,
        rows: List[AdapterRow],
        original_units: List[TranslationUnit],
        stats: AdapterStats,
    ) -> List[TranslationUnit]:
        """Map AdapterRow results back onto the original TranslationUnit list,
        updating ``translated_text`` and ``status`` on each unit.
        """
        # Build a lookup by entry_id, then by position
        row_by_id = {r.row_id: r for r in rows}

        updated: List[TranslationUnit] = []
        for unit in original_units:
            row = row_by_id.get(unit.entry_id)
            if row is None and len(rows) == len(original_units):
                # Positional fallback if entry_id match fails
                idx = original_units.index(unit)
                if idx < len(rows):
                    row = rows[idx]

            if row is not None and row.translated_text:
                unit.translated_text = row.translated_text
                unit.status = STATUS_TRANSLATED
            elif row is not None and row.translated_text == "":
                unit.translated_text = ""
                unit.status = STATUS_FAILED
                unit.error_message = row.error_message
            elif row is not None and row.translated_text is None:
                unit.error_message = row.error_message
            # else: leave as-is (pending)

            updated.append(unit)
        return updated

    def _protect(self, text: str, config: TranslationConfig) -> tuple:
        """Protect text using the configured rule sets.

        Uses the ProtectionService with ``config.protection.rule_set_ids``.
        If protection is disabled or no rule sets are configured, returns
        the original text unchanged.

        Returns
        -------
        ``(protected_text, mapping, source_ranges)``
            Falls back to ``(text, {}, [])`` if no protection is configured.
            ``source_ranges`` is a list of ``SourceRange`` objects with
            per-placeholder metadata (rule_id, rule_kind, token_type,
            source positions).  Empty list when protection is disabled.
        """
        if not config.protection.enabled:
            return text, {}, []

        if self._protection is None:
            return text, {}, []

        rule_set_ids = config.protection.rule_set_ids

        try:
            protected, mapping, source_ranges, _ = self._protection.protect_with_details(
                text, rule_set_ids=rule_set_ids or None,
            )
            return protected, mapping, source_ranges
        except Exception as exc:
            logger.warning(
                "Protection protect() failed, using raw text: "
                "config_enabled=%s, text_len=%d, rule_set_ids=%s, error=%s",
                config.protection.enabled,
                len(text),
                config.protection.rule_set_ids,
                exc,
            )
            return text, {}, []

    def _restore(self, text: str, state: dict, config: TranslationConfig = None, row_id: str = "") -> str:
        """Restore protected tokens in translated text.

        Uses the unified ``ProtectionService.restore`` which handles all
        ``<PH id="r{N}"/>`` placeholders.

        Falls back to returning text unchanged if no protection services.
        """
        if self._protection is None:
            return text

        # Debug log: capture input for traceability
        if "<PH" in text:
            logger.debug(
                "Restore input for row=%s contains <PH tags: "
                "mapping_size=%d, text_preview=%r",
                row_id, len(state) if isinstance(state, dict) else 0,
                text[:150],
            )

        try:
            result = self._protection.restore(text, state)
        except Exception as exc:
            logger.warning(
                "Protection restore() failed, using raw text: "
                "mapping_size=%d, text_len=%d, row=%s, error=%s",
                len(state) if isinstance(state, dict) else 0,
                len(text), row_id, exc,
            )
            return text

        # --- Invariant warning (no hard-strip) ---
        if "<PH" in result:
            logger.error(
                "PLACEHOLDER_RESTORE_INVARIANT_VIOLATED: "
                "row=%s, mapping_size=%d, text_len=%d, "
                "source_preview=%r, "
                "result_preview=%r",
                row_id,
                len(state) if isinstance(state, dict) else 0,
                len(result),
                text[:120],
                result[:120],
            )

        return result

    @staticmethod
    def _resolve_strategy_name(config: TranslationConfig) -> str:
        """Resolve active protection strategy name from *config*.

        Returns ``"none"`` when protection is disabled.  Returns
        ``"rule_set"`` when protection is enabled (with or without
        rule sets — if no rule sets are configured, protection
        simply produces an empty mapping, but the strategy is still
        ``"rule_set"`` from the adapter's perspective).

        This method is the single point of strategy-name resolution
        for leak detection dispatch.  When new strategies are added,
        this is where the config→strategy mapping is updated.
        """
        if not config.protection.enabled:
            return "none"
        return "rule_set"

    def _detect_and_handle_restore_leaks(
        self,
        raw_model_output: str,
        mapping: dict,
        row: AdapterRow,
        config: TranslationConfig,
        diagnostics: List[AdapterDiagnostic],
    ) -> None:
        """Detect unrestored placeholders and fail the row if found.

        Uses ``ProtectionEngine.detect_unrestored_placeholders()`` with
        **strategy-aware dispatch**: the strategy name is resolved from
        *config* (``"rule_set"`` when protection is enabled with rule
        sets, ``"none"`` otherwise) and passed to the engine, which
        dispatches to the correct detector for that strategy.

        When leaks are detected:
        * ``row.translated_text`` is set to ``None`` (unit is failed).
        * A ``PLACEHOLDER_RESTORE_FAILED`` diagnostic is appended.
        * Debug info (leaked IDs, raw matches, model output) is stored
          in ``row.metadata["_restore_leak_info"]`` for traceability.
        """
        from translator_app.protection.engine import ProtectionEngine

        strategy_name = self._resolve_strategy_name(config)
        leaks = ProtectionEngine.detect_unrestored_placeholders(
            raw_model_output, mapping,
            strategy_name=strategy_name,
        )
        if not leaks:
            return

        leak_ids = [l.placeholder_id for l in leaks]
        raw_matches = [l.raw_match for l in leaks]

        diagnostics.append(AdapterDiagnostic(
            level="error",
            code=PLACEHOLDER_RESTORE_FAILED,
            message=(
                f"Placeholder restore failed for row '{row.row_id}': "
                f"{len(leaks)} unrestored placeholder(s): {leak_ids}. "
                f"Raw matches: {raw_matches}. "
                f"Mapping size: {len(mapping)}."
            ),
            unit_id=row.row_id,
        ))

        # Store debug info for observability
        row.metadata["_restore_leak_info"] = {
            "leaked_ids": leak_ids,
            "raw_matches": raw_matches,
            "mapping_size": len(mapping),
        }
        row.metadata["_restore_model_output"] = raw_model_output

        # Mark row as failed — corrupted text must not reach final output
        row.translated_text = None
        row.error_message = (
            f"PLACEHOLDER_RESTORE_FAILED: {len(leaks)} unrestored "
            f"placeholder(s): {', '.join(leak_ids)}"
        )

    @staticmethod
    def _populate_placeholder_registry(
        ctx: RuntimeProtectionContext,
        rows: List[AdapterRow],
    ) -> None:
        """Build placeholder registry from per-row protection mappings.

        Collects all ``_protection_mapping`` entries from every row and
        converts them into serialised ``PlaceholderInfo`` dicts stored
        on the runtime context's ``placeholder_registry``.

        When ``_protection_source_ranges`` is available (D3+), uses the
        per-placeholder metadata (rule_id, rule_kind, token_type, source
        positions) from the ProtectionEngine source ranges instead of the
        generic ``rule_set_token`` / ``rule_set`` fallback.

        Backward compatible: if source_ranges are absent, falls back to
        the old derivation (``rule_set_token`` / ``rule_set``).

        This method is idempotent — duplicate placeholder IDs (same key)
        produce a single entry.
        """
        registry: dict = {}

        for row in rows:
            mapping = row.metadata.get("_protection_mapping", {})
            if not isinstance(mapping, dict):
                continue

            # Build lookup from optional source_ranges
            source_ranges: List[SourceRange] = row.metadata.get("_protection_source_ranges", [])
            sr_by_ph_id: Dict[str, SourceRange] = {}
            if source_ranges:
                for sr in source_ranges:
                    if isinstance(sr, SourceRange) and sr.placeholder_id:
                        sr_by_ph_id[sr.placeholder_id] = sr

            for ph_id, original_text in mapping.items():
                if ph_id in registry:
                    continue  # already registered

                sr = sr_by_ph_id.get(ph_id)
                if sr is not None:
                    # Rich metadata from ProtectionEngine source ranges
                    token_type = sr.token_type
                    rule_id = sr.rule_id
                    source_start = sr.start
                    source_end = sr.end
                else:
                    # Fallback: use prefix-based derivation (old behaviour)
                    if ph_id.startswith("r"):
                        token_type = "rule_set_token"
                        rule_id = "rule_set"
                    else:
                        token_type = "unknown"
                        rule_id = "unknown"
                    source_start = None
                    source_end = None

                info = PlaceholderInfo(
                    placeholder_id=ph_id,
                    token_type=token_type,
                    original_text=str(original_text) if original_text is not None else "",
                    source_span_start=source_start,
                    source_span_end=source_end,
                    rule_id=rule_id,
                )
                registry[ph_id] = dataclass_to_dict(info)

        ctx.placeholder_registry = registry

    def _call_batch(
        self,
        rows: List[AdapterRow],
        config: TranslationConfig,
        batch_idx: int = 0,
    ) -> AdapterBatchResult:
        """Call the runtime's batch translation.

        Returns an ``AdapterBatchResult`` — success=True with texts,
        or success=False with error message on exception.
        """
        texts = [r.protected_text or r.source_text for r in rows]

        # --- Trace: runtime_request_started ---
        if self._trace is not None:
            self._trace.add_event(
                event_type=TraceEventType.RUNTIME_REQUEST_STARTED,
                batch_index=batch_idx,
                unit_ids=[r.row_id for r in rows],
                provider=config.runtime.provider,
                model=config.runtime.model,
                message=f"Runtime batch call ({len(texts)} texts)",
            )

        try:
            translated, raw_response = self._runtime.translate_batch(texts)

            # --- Trace: runtime_response_received ---
            if self._trace is not None:
                response_data: Dict[str, Any] = {
                    "count": len(translated),
                    "model": config.runtime.model,
                }
                if config.save_raw_responses:
                    response_data["raw_response"] = str(translated)
                self._trace.add_event(
                    event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                    batch_index=batch_idx,
                    unit_ids=[r.row_id for r in rows],
                    provider=config.runtime.provider,
                    model=config.runtime.model,
                    message=f"Runtime response received ({len(translated)} texts)",
                    data=response_data,
                )

            return AdapterBatchResult(
                translated_texts=translated,
                success=True,
                raw_response=raw_response,
            )
        except Exception as exc:
            # --- Trace: runtime_response_received (error) ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                    batch_index=batch_idx,
                    unit_ids=[r.row_id for r in rows],
                    provider=config.runtime.provider,
                    model=config.runtime.model,
                    message=f"Runtime call failed: {exc}",
                    data={"error": str(exc)},
                )

            return AdapterBatchResult(
                translated_texts=[],
                success=False,
                error=str(exc),
            )

    def _validate_batch_output(
        self,
        rows: List[AdapterRow],
        batch_result: AdapterBatchResult,
    ) -> tuple:
        """Validate batch output: check count match and empty texts.

        Returns (is_valid, optional_diagnostic).
        """
        expected = len(rows)
        got = batch_result.count

        if expected != got:
            return False, AdapterDiagnostic(
                level="error",
                code=TRANSLATION_COUNT_MISMATCH,
                message=(
                    f"Batch output count mismatch: expected {expected}, "
                    f"got {got}. Falling back to single translation."
                ),
            )

        # Check for empty translations
        empty_count = sum(1 for t in batch_result.translated_texts if not t)
        if empty_count > 0:
            return False, AdapterDiagnostic(
                level="warning",
                code=EMPTY_TRANSLATION,
                message=f"{empty_count} of {got} translations are empty.",
            )

        return True, AdapterDiagnostic(
            level="info",
            code="BATCH_OK",
            message=f"Batch translated {got} units successfully.",
        )

    def _run_content_validator(
        self,
        rows: List[AdapterRow],
        batch_result: AdapterBatchResult,
        config: TranslationConfig,
    ) -> tuple:
        """Run the configured TranslationValidator (if any) on batch output.

        Uses the raw LLM response for batch-level validation (composite, json_parse)
        and individual restored texts for per-row checks (placeholder_guard).

        Returns:
            (is_valid, optional_diagnostic).  diagnostic is None when
            no validator is configured or validation passes.
        """
        validator_name = config.validation.validator_name
        if not validator_name or validator_name == "none":
            return True, None

        validator = TranslationValidator(
            validator_name=validator_name,
            options=config.validation.options,
        )

        raw_response = batch_result.raw_response

        # Batch-level validation with raw response
        if raw_response and len(rows) > 1:
            source_texts = "\n".join(r.source_text for r in rows)
            result = validator.validate_translation(
                source=source_texts,
                target=raw_response,
                expected_count=len(rows),
            )
            if not result.is_valid:
                reasons = "; ".join(d.message for d in result.diagnostics)
                return False, AdapterDiagnostic(
                    level="error",
                    code=INVALID_RESPONSE_FORMAT,
                    message=(
                        f"TranslationValidator [{validator_name}] rejected batch: {reasons}"
                    ),
                )
            return True, None

        # Per-row validation (no raw response available)
        for row in rows:
            result = validator.validate_translation(
                source=row.source_text,
                target=row.translated_text or "",
                expected_count=1,
            )
            if not result.is_valid:
                reasons = "; ".join(d.message for d in result.diagnostics)
                return False, AdapterDiagnostic(
                    level="error",
                    code=INVALID_RESPONSE_FORMAT,
                    message=(
                        f"TranslationValidator [{validator_name}] rejected row "
                        f"'{row.row_id}': {reasons}"
                    ),
                )

        return True, None

    def _do_fallback(
        self,
        rows: List[AdapterRow],
        config: TranslationConfig,
        diagnostics: Optional[List[AdapterDiagnostic]] = None,
    ) -> AdapterDiagnostic:
        """Fallback: translate each row via single translation.

        Updates ``translated_text`` on each row in-place.
        Returns a diagnostic summarising the fallback.

        If *diagnostics* is provided, per-row ``PLACEHOLDER_RESTORE_FAILED``
        diagnostics are appended when leak detection fails.

        NOTE: Unlike the batch path, this method does NOT run
        ``_run_content_validator`` (which operates on protected-level
        ``<PH>`` tags).  Instead, it relies on leak detection
        (surviving ``<PH>`` tags) AND placeholder-preservation
        checking (missing original placeholder texts in restored output).
        """
        if diagnostics is None:
            diagnostics = []
        success_count = 0
        fail_count = 0

        for row in rows:
            try:
                text = row.protected_text or row.source_text
                translated = self._runtime.translate_single(text)
                # Chatbot reply guard: reject meta-replies
                if detect_chatbot_reply(translated):
                    row.translated_text = None
                    row.error_message = "Chatbot reply detected in fallback translation"
                    fail_count += 1
                    logger.warning("Chatbot reply detected in fallback for '%s'",
                                   row.source_text[:40])
                else:
                    mapping = row.metadata.get("_protection_mapping", {})
                    row.translated_text = self._restore(translated, mapping, config=config,
                                                        row_id=row.row_id)
                    if translated:
                        # Leak detection on the raw model output
                        self._detect_and_handle_restore_leaks(
                            translated, mapping, row, config, diagnostics,
                        )

                        # Check for lost placeholders in restored text
                        # (placeholders that the LLM dropped entirely, so
                        # restore() could not recover them).  This catches
                        # cases like trailing bracket placeholders that the
                        # LLM omits from the response.
                        if row.translated_text is not None:
                            lost = self._check_restored_placeholder_preservation(
                                row.translated_text, mapping,
                            )
                            if lost:
                                row.translated_text = None
                                row.error_message = (
                                    f"Lost {len(lost)} placeholder(s) "
                                    f"in fallback translation: {lost[:5]}"
                                )
                                fail_count += 1
                                diagnostics.append(AdapterDiagnostic(
                                    level="error",
                                    code=PLACEHOLDER_RESTORE_FAILED,
                                    message=(
                                        f"Fallback lost {len(lost)} placeholder(s) "
                                        f"for row '{row.row_id}': {lost[:5]}"
                                    ),
                                    unit_id=row.row_id,
                                ))
                            else:
                                success_count += 1
                        else:
                            # Row was already failed by leak detection
                            fail_count += 1
                    else:
                        row.error_message = "Fallback returned empty translation"
                        fail_count += 1
            except Exception as exc:
                row.translated_text = None
                row.error_message = str(exc)
                fail_count += 1
                logger.warning("Fallback single translation failed for '%s': %s",
                               row.source_text[:40], exc)

        return AdapterDiagnostic(
            level="warning",
            code="FALLBACK_USED",
            message=(
                f"Fallback from batch to single translation: "
                f"{success_count} succeeded, {fail_count} failed."
            ),
        )

    @staticmethod
    def _check_restored_placeholder_preservation(
        restored_text: str,
        mapping: Dict[str, str],
    ) -> List[str]:
        """Verify all original placeholder texts appear in restored text.

        Compares each original placeholder text from the protection mapping
        against the restored (post-restore) translation.  Any original text
        that is absent from the restored output was dropped by the LLM (the
        ``<PH>`` tag never reached restore).

        Args:
            restored_text:
                The restored translated text (with original game tokens).
            mapping:
                Protection mapping ``{ph_id: original_text, ...}``.

        Returns:
            List of missing original placeholder texts (empty = all present).
        """
        if not mapping or not restored_text:
            return []
        return [
            orig for orig in mapping.values()
            if orig not in restored_text
        ]

    # ------------------------------------------------------------------
    # Chatbot reply detection
    # ------------------------------------------------------------------

    def _check_chatbot_replies(self, batch_result: AdapterBatchResult) -> bool:
        """Check batch translations for chatbot/meta reply patterns.

        If ANY translation in the batch matches a known chatbot reply
        pattern, the entire batch is considered contaminated and should
        trigger a fallback to single translation.

        Returns:
            True if at least one chatbot reply was detected.
        """
        if not batch_result.translated_texts:
            return False
        for text in batch_result.translated_texts:
            if detect_chatbot_reply(text):
                return True
        return False
