"""22. Translation Task Planner Module.

Transforms a list of files into a structured TaskPlan with batched
TranslationTask objects, applying filtering and cache lookup.

Flow:
    file_paths
      -> parse files (FileProcessingService)
      -> extract TranslationUnits
      -> filter translatable / non-empty
      -> check cache (TranslationCache)
      -> group into batches
      -> build TaskPlan
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.file_processing.service import FileProcessingService
from translator_app.translation.cache import TranslationCache
from translator_app.translation.config import TranslationConfig
from translator_app.translation.task_planner_models import (
    DiagnosticLevel,
    PlannerDiagnostic,
    TaskPlan,
    TaskStatus,
    TranslationTask,
    FILE_PARSE_FAILED,
    NO_TRANSLATABLE_UNITS,
    FILE_SKIPPED,
    EMPTY_FILE,
    ALL_UNITS_CACHED,
    TOO_MANY_UNITS,
)


class TaskPlanner:
    """Accepts files, extracts translation units, checks cache, and
    produces a structured TaskPlan with batched TranslationTasks."""

    def __init__(
        self,
        config: TranslationConfig,
        file_service: Optional[FileProcessingService] = None,
        cache: Optional[TranslationCache] = None,
        protection_fingerprint: Optional[str] = None,
    ):
        """Task planner for building ``TaskPlan`` from file paths.

        Args:
            config: Translation configuration.
            file_service: File processing service for parsing.
            cache: Translation cache for dedup.
            protection_fingerprint:
                Optional override for the cache strategy key.  When
                provided, it replaces the default
                ``",".join(rule_set_ids)`` strategy.  This is needed
                because custom protection rules are not tracked in the
                config but affect effective protection behaviour.
        """
        self.config = config
        self.file_service = file_service or FileProcessingService()
        self.cache = cache
        self._protection_fingerprint = protection_fingerprint

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_plan(self, file_paths: List[str], job_id: str = "") -> TaskPlan:
        """Build a complete TaskPlan from a list of file paths.

        Steps:
            1. Parse each file (detect + parse) via FileProcessingService
            2. Filter translatable, non-empty units
            3. Check cache for each unit
            4. Group uncached units into batches
            5. Build TranslationTasks from batches
            6. Return assembled TaskPlan
        """
        diagnostics: List[PlannerDiagnostic] = []
        all_units: List[TranslationUnit] = []

        # Step 1 & 2: Parse files and extract units
        for file_path in file_paths:
            units, file_diags = self._process_file(file_path)
            diagnostics.extend(file_diags)
            all_units.extend(units)

        if not all_units:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.WARNING,
                code=NO_TRANSLATABLE_UNITS,
                message="No translatable units found across all files",
            ))
            return self._empty_plan(job_id, diagnostics)

        # Step 3: Filter translatable
        filtered = self._filter_translatable(all_units)
        non_translatable_count = len(all_units) - len(filtered)
        skipped_count = len(all_units) - len(filtered)

        if not filtered:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.WARNING,
                code=NO_TRANSLATABLE_UNITS,
                message="All units were non-translatable or empty",
            ))
            return self._empty_plan(job_id, diagnostics)

        # Step 4: Apply cache
        cached_units, miss_units = self._apply_cache(filtered)

        # Step 5: Group into batches
        batch_size = self.config.batch_size
        try:
            batches = self._group_into_batches(miss_units, batch_size)
        except Exception as e:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.ERROR,
                code="BATCH_BUILD_FAILED",
                message=f"Failed to group units into batches: {e}",
            ))
            return self._empty_plan(job_id, diagnostics)

        # Step 6: Build TranslationTasks
        tasks: List[TranslationTask] = []
        for batch_idx, batch_units in enumerate(batches):
            task = self._build_task(batch_units, batch_idx, batch_size)
            tasks.append(task)

        # Step 7: Build cached tasks (one per cached unit for traceability)
        for cached_unit in cached_units:
            tasks.append(self._build_cached_task(cached_unit))

        total_tasks = len(tasks)
        cache_hits = len(cached_units)
        cache_misses = len(miss_units)

        # Store filtered units on the plan for downstream use
        plan_units = list(filtered)

        # Add warnings
        if cache_hits > 0 and cache_misses == 0:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.INFO,
                code=ALL_UNITS_CACHED,
                message="All units were found in cache; no translation needed",
            ))
        if skipped_count > 0:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.INFO,
                code="UNITS_SKIPPED",
                message=f"Skipped {skipped_count} non-translatable or empty units",
            ))

        plan = TaskPlan(
            plan_id=str(uuid.uuid4()),
            job_id=job_id,
            tasks=tasks,
            total_units=len(filtered),
            total_tasks=total_tasks,
            batch_size=batch_size,
            cache_hits=cache_hits,
            cache_misses=cache_misses,
            diagnostics=diagnostics,
            created_at=datetime.now(timezone.utc).isoformat(),
            units=plan_units,
        )

        return plan

    # ------------------------------------------------------------------
    # Internal steps
    # ------------------------------------------------------------------

    def _process_file(self, file_path: str) -> Tuple[List[TranslationUnit], List[PlannerDiagnostic]]:
        """Parse a file and extract translation units.

        Returns (units, diagnostics).
        If parsing fails, returns ([], [diagnostic]).
        """
        diagnostics: List[PlannerDiagnostic] = []

        # Detect + parse
        parsed: Optional[ParsedGameFile] = None
        try:
            parsed = self.file_service.parse_file(file_path)
        except Exception as e:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.ERROR,
                code=FILE_PARSE_FAILED,
                message=f"Failed to parse file: {e}",
                file_path=file_path,
                details=str(e),
            ))
            return [], diagnostics

        if parsed is None:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.ERROR,
                code=FILE_PARSE_FAILED,
                message="Parser returned None",
                file_path=file_path,
            ))
            return [], diagnostics

        # Extract translation units
        units = self.file_service.extract_translation_units(
            parsed,
            src_lang=self.config.src_lang,
            dst_lang=self.config.dst_lang,
        )

        if not units:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.WARNING,
                code=EMPTY_FILE,
                message="No translatable entries found in file",
                file_path=file_path,
            ))

        return units, diagnostics

    def _filter_translatable(self, units: List[TranslationUnit]) -> List[TranslationUnit]:
        """Filter to only translatable, non-empty units.

        Excludes:
          - units with empty source text
          - units with non-translatable status markers
        """
        filtered = []
        for unit in units:
            if not unit.source or not unit.source.strip():
                continue
            if unit.status == "skipped":
                continue
            filtered.append(unit)
        return filtered

    def _apply_cache(
        self,
        units: List[TranslationUnit],
    ) -> Tuple[List[TranslationUnit], List[TranslationUnit]]:
        """Check each unit against the cache.

        Returns (cached_units, miss_units).
        Cached units have their target and status updated.
        If no cache is configured, all units are misses.
        """
        if not self.cache or not self.config.use_cache:
            return [], list(units)

        cached: List[TranslationUnit] = []
        misses: List[TranslationUnit] = []

        # Use protection fingerprint if provided, else fall back to
        # rule_set_ids-based strategy for backward compatibility.
        if self._protection_fingerprint is not None:
            strategy = self._protection_fingerprint
        else:
            strategy = ",".join(self.config.protection.rule_set_ids) if self.config.protection.rule_set_ids else ""

        for unit in units:
            result = self.cache.lookup(
                unit.source,
                unit.src_lang or self.config.src_lang,
                unit.dst_lang or self.config.dst_lang,
                strategy,
            )
            if result.hit:
                unit.target = result.translated_text
                unit.from_cache = True
                unit.status = TaskStatus.CACHED.value
                cached.append(unit)
            else:
                misses.append(unit)

        return cached, misses

    def _group_into_batches(
        self,
        units: List[TranslationUnit],
        batch_size: int,
    ) -> List[List[TranslationUnit]]:
        """Split a list of units into batches of batch_size.

        Returns a list of batches. The last batch may be smaller.
        Preserves unit order within each batch.
        """
        if batch_size < 1:
            raise ValueError(f"batch_size must be >= 1, got {batch_size}")

        return [units[i:i + batch_size] for i in range(0, len(units), batch_size)]

    def _estimate_cost(self, units: List[TranslationUnit]) -> dict:
        """Rough token / cost estimate for a set of units.

        Uses a simple heuristic: ~1 token per 4 characters.
        Returns a dict with estimated_tokens and estimated_cost (USD).
        """
        total_chars = sum(len(u.source) for u in units)
        estimated_tokens = max(1, total_chars // 4)

        # Rough cost estimate: ~$0.15 per 1M tokens (typical for many models)
        estimated_cost = round(estimated_tokens * 0.15 / 1_000_000, 6)

        return {
            "estimated_tokens": estimated_tokens,
            "estimated_cost": estimated_cost,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_task(self, units: List[TranslationUnit], batch_index: int, batch_size: int) -> TranslationTask:
        """Create a TranslationTask from a batch of units."""
        file_ids = {u.file_id for u in units if u.file_id}
        first_unit = units[0] if units else TranslationUnit()

        return TranslationTask(
            task_id=str(uuid.uuid4()),
            file_id=next(iter(file_ids)) if file_ids else first_unit.file_path,
            unit_ids=[u.entry_id or u.id or u.key for u in units],
            batch_index=batch_index,
            batch_size=batch_size,
            src_lang=first_unit.src_lang or self.config.src_lang,
            dst_lang=first_unit.dst_lang or self.config.dst_lang,
            status=TaskStatus.PENDING.value,
            attempts=0,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    def _build_cached_task(self, unit: TranslationUnit) -> TranslationTask:
        """Create a TranslationTask for a single cached unit."""
        return TranslationTask(
            task_id=str(uuid.uuid4()),
            file_id=unit.file_id or unit.file_path,
            unit_ids=[unit.entry_id or unit.id or unit.key],
            batch_index=-1,  # cached tasks have no batch position
            batch_size=1,
            src_lang=unit.src_lang or self.config.src_lang,
            dst_lang=unit.dst_lang or self.config.dst_lang,
            status=TaskStatus.CACHED.value,
            attempts=0,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    def _empty_plan(self, job_id: str, diagnostics: List[PlannerDiagnostic]) -> TaskPlan:
        """Return an empty plan (no tasks)."""
        return TaskPlan(
            plan_id=str(uuid.uuid4()),
            job_id=job_id,
            tasks=[],
            total_units=0,
            total_tasks=0,
            batch_size=self.config.batch_size,
            cache_hits=0,
            cache_misses=0,
            diagnostics=diagnostics,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    # ------------------------------------------------------------------
    # Build plan from existing units (used by retry-failed)
    # ------------------------------------------------------------------

    def build_plan_from_units(
        self,
        units: List[TranslationUnit],
        file_paths: List[str],
        job_id: str = "",
    ) -> TaskPlan:
        """Build a TaskPlan from a pre-existing list of TranslationUnits.

        Unlike ``build_plan()``, this does NOT parse files — it accepts
        already-extracted units (e.g. failed units from a previous job).

        Steps:
            1. Filter translatable, non-empty units
            2. Check cache for each unit
            3. Group uncached units into batches
            4. Build TranslationTasks from batches
            5. Return assembled TaskPlan
        """
        diagnostics: List[PlannerDiagnostic] = []

        if not units:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.WARNING,
                code=NO_TRANSLATABLE_UNITS,
                message="No units provided to build plan from",
            ))
            return self._empty_plan(job_id, diagnostics)

        # Step 1: Filter translatable
        filtered = self._filter_translatable(units)
        skipped_count = len(units) - len(filtered)

        if not filtered:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.WARNING,
                code=NO_TRANSLATABLE_UNITS,
                message="All provided units were non-translatable or empty",
            ))
            return self._empty_plan(job_id, diagnostics)

        # Step 2: Apply cache
        cached_units, miss_units = self._apply_cache(filtered)

        # Step 3: Group into batches
        batch_size = self.config.batch_size
        batches = self._group_into_batches(miss_units, batch_size)

        # Step 4: Build TranslationTasks
        tasks: List[TranslationTask] = []
        for batch_idx, batch_units in enumerate(batches):
            task = self._build_task(batch_units, batch_idx, batch_size)
            tasks.append(task)

        # Step 5: Build cached tasks
        for cached_unit in cached_units:
            tasks.append(self._build_cached_task(cached_unit))

        total_tasks = len(tasks)
        cache_hits = len(cached_units)
        cache_misses = len(miss_units)

        plan_units = list(filtered)

        if cache_hits > 0 and cache_misses == 0:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.INFO,
                code=ALL_UNITS_CACHED,
                message="All units were found in cache; no translation needed",
            ))
        if skipped_count > 0:
            diagnostics.append(PlannerDiagnostic(
                level=DiagnosticLevel.INFO,
                code="UNITS_SKIPPED",
                message=f"Skipped {skipped_count} non-translatable or empty units",
            ))

        plan = TaskPlan(
            plan_id=str(uuid.uuid4()),
            job_id=job_id,
            tasks=tasks,
            total_units=len(filtered),
            total_tasks=total_tasks,
            batch_size=batch_size,
            cache_hits=cache_hits,
            cache_misses=cache_misses,
            diagnostics=diagnostics,
            created_at=datetime.now(timezone.utc).isoformat(),
            units=plan_units,
        )

        return plan

    @staticmethod
    def _cache_key(unit: TranslationUnit) -> str:
        """Generate a cache lookup key from a unit's source + languages."""
        return TranslationCache.make_key(
            unit.source, unit.src_lang or "", unit.dst_lang or "", "",
        )
