"""Output file analysis service.

Orchestrates the analysis of translated output files using the
snapshot-authoritative engine (``SnapshotAuthoritativeEvaluator``).
The engine derives scores and diagnostics from protection-snapshot token
integrity — no regex heuristics, no legacy code path.

If snapshot analysis is unavailable the service returns a deterministic
error diagnostic (``SNAPSHOT_UNAVAILABLE``) — it never falls back.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from translator_app.backend.errors import APIError, NOT_FOUND
from translator_app.file_processing.service import FileProcessingService
from translator_app.outputs.analysis.divergence import (
    AnalysisDivergenceTracker,
)
from translator_app.outputs.analysis.divergence_repository import (
    AnalysisDivergenceRepository,
)
from translator_app.outputs.analysis.models import (
    AnalysisCheckName,
    AnalysisContext,
    AnalysisDiagnostic,
    AnalysisDivergence,
    AnalysisStatus,
    BatchAnalysisRequest,
    BatchAnalysisResult,
    CheckResult,
    OutputAnalysisOptions,
    OutputFileAnalysisResult,
    SnapshotAnalysisResult,
    DivergenceType,
)
from translator_app.outputs.analysis.protection_metadata import (
    ProtectionMetadataResolver,
)
from translator_app.outputs.analysis.registry import AnalyzerRegistry
from translator_app.outputs.analysis.snapshot_analyzer import (
    SnapshotAwareAnalyzer,
)
from translator_app.outputs.analysis.snapshot_evaluator import (
    SnapshotAuthoritativeEvaluator,
    SnapshotAuthoritativeScores,
)
from translator_app.outputs.analysis.snapshot_resolver import (
    AnalysisProtectionSnapshotResolver,
)
from translator_app.outputs.hash_utils import hash_content, read_and_hash
from translator_app.outputs.models import TranslatedOutputFile
from translator_app.outputs.repository import TranslatedOutputFileRepository
from translator_app.protection.metadata.versioning import (
    check_snapshot_version,
)

logger = logging.getLogger(__name__)

# Current analyzer version for the service bundle
ANALYZER_VERSION = "2.0.0"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_file(path: str) -> Optional[str]:
    """Read file content as UTF-8 text.

    Returns None if the file does not exist or cannot be read.
    """
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, RuntimeError):
        return None


def _aggregate_status(results: List[CheckResult]) -> AnalysisStatus:
    """Aggregate multiple check results into a single overall status.

    Priority: error > failed > warning > passed
    """
    has_error = any(r.status == AnalysisStatus.ERROR for r in results)
    has_failed = any(r.status == AnalysisStatus.FAILED for r in results)
    has_warning = any(r.status == AnalysisStatus.WARNING for r in results)

    if has_error:
        return AnalysisStatus.ERROR
    if has_failed:
        return AnalysisStatus.FAILED
    if has_warning:
        return AnalysisStatus.WARNING
    return AnalysisStatus.PASSED


def _count_severity(diagnostics: List[AnalysisDiagnostic], severity: str) -> int:
    return sum(1 for d in diagnostics if d.severity == severity)


def _try_parse_entries(
    file_processing: Optional[FileProcessingService],
    source_path: str,
    translated_path: str,
) -> tuple:
    """Try to parse source and translated files into entry lists.

    Returns (source_entries, translated_entries) — each is a list of dicts
    or None if parsing failed.
    """
    source_entries: Optional[List[Dict]] = None
    translated_entries: Optional[List[Dict]] = None

    if file_processing is None:
        return source_entries, translated_entries

    try:
        if Path(source_path).exists():
            parsed_source = file_processing.parse(source_path)
            if parsed_source:
                source_entries = [
                    {
                        "key": e.key or "",
                        "source_text": e.value,
                        "source_line": e.line_number,
                        "entry_type": "translation_entry" if e.is_translatable else "raw_unknown",
                        "translatable": e.is_translatable,
                    }
                    for e in parsed_source.translatable_entries
                ]
    except Exception:
        logger.debug("Failed to parse source file: %s", source_path, exc_info=True)

    try:
        if Path(translated_path).exists():
            parsed_translated = file_processing.parse(translated_path)
            if parsed_translated:
                translated_entries = [
                    {
                        "key": e.key or "",
                        "translated_text": e.translated or e.value,
                        "translated_line": e.line_number,
                        "entry_type": "translation_entry" if e.is_translatable else "raw_unknown",
                        "translatable": e.is_translatable,
                    }
                    for e in parsed_translated.translatable_entries
                ]
    except Exception:
        logger.debug("Failed to parse translated file: %s", translated_path, exc_info=True)

    return source_entries, translated_entries


class OutputAnalysisService:
    """Service for analyzing translated output files.

    Orchestrates single-file and batch analysis using the snapshot-authoritative
    engine.  Scores and diagnostics are derived from protection-snapshot token
    integrity — no legacy code path.
    """

    def __init__(
        self,
        repository: TranslatedOutputFileRepository,
        registry: AnalyzerRegistry,
        file_processing: Optional[FileProcessingService] = None,
        protection_metadata_resolver: Optional[ProtectionMetadataResolver] = None,
        divergence_repository: Optional[AnalysisDivergenceRepository] = None,
        analysis_options_resolver: Optional[AnalysisProtectionSnapshotResolver] = None,
    ):
        self._repo = repository
        self._registry = registry
        self._file_processing = file_processing
        self._protection_metadata_resolver = protection_metadata_resolver
        self._divergence_repo = divergence_repository
        self._analysis_options_resolver = analysis_options_resolver

        # Authoritative snapshot-aware analyzer (Phase 7).
        # The snapshot analysis is now the source of truth for scoring.
        self._snapshot_analyzer = SnapshotAwareAnalyzer()
        self._snapshot_results: Dict[str, SnapshotAnalysisResult] = {}

        # Authoritative evaluator: converts TokenIntegrityResult into
        # authoritative scores, status, and diagnostics.
        self._authoritative_evaluator = SnapshotAuthoritativeEvaluator()

        # Legacy vs. snapshot divergence tracking (Phase 6D, deprecated in Phase 7).
        # Stored for historical/informational purposes only.
        self._divergence_tracker = AnalysisDivergenceTracker()
        self._divergence_results: Dict[str, AnalysisDivergence] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze_file(
        self,
        output_file_id: str,
        checks: Optional[List[str]] = None,
        save: bool = True,
        options: Optional[OutputAnalysisOptions] = None,
    ) -> OutputFileAnalysisResult:
        """Analyze a single output file.

        Args:
            output_file_id: The file to analyze.
            checks: Ignored in Phase 7 — analysis is always snapshot-driven.
            save: If True, persist the result to DB and update file metadata.
            options: Optional ``OutputAnalysisOptions`` controlling how the
                protection snapshot is resolved.  When ``None`` or when
                ``protection_profile_id`` is ``None``, the original
                translation snapshot is used (default behaviour).

        Returns:
            The analysis result.

        Raises:
            APIError (404): If the file is not found.
        """
        # 1. Load file
        file = self._repo.get_by_id(output_file_id)
        if not file:
            raise APIError(
                code=NOT_FOUND,
                message=f"Output file not found: {output_file_id}",
                status_code=404,
            )

        # 2. Validate source/translated existence
        source_path = file.source_file_path
        translated_path = file.translated_file_path

        io_diagnostics: List[AnalysisDiagnostic] = []
        io_error = False

        source_content = _read_file(source_path)
        if source_content is None:
            io_diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="SOURCE_FILE_MISSING",
                message=f"Source file not found or unreadable: {source_path}",
                source="io",
            ))
            io_error = True

        translated_content = _read_file(translated_path)
        if translated_content is None:
            io_diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="TRANSLATED_FILE_MISSING",
                message=f"Translated file not found or unreadable: {translated_path}",
                source="io",
            ))
            io_error = True

        # If either file is missing, return error result (do not run checks)
        if io_error:
            result = OutputFileAnalysisResult(
                id=str(uuid.uuid4()),
                output_file_id=output_file_id,
                job_id=file.job_id,
                analyzer_version=ANALYZER_VERSION,
                status=AnalysisStatus.ERROR,
                compilability_score=None,
                placeholders_score=None,
                errors_count=len([d for d in io_diagnostics if d.severity == "error"]),
                warnings_count=len([d for d in io_diagnostics if d.severity == "warning"]),
                source_hash=None,
                translated_hash=None,
                diagnostics=io_diagnostics,
                created_at=_now(),
            )
            if save:
                self._save_and_mark(file, result)
            return result

        # 3. Build analysis context
        source_entries, translated_entries = _try_parse_entries(
            self._file_processing, source_path, translated_path
        )

        protection_metadata = None
        protection_snapshot = None
        analysis_metadata: Optional[Dict[str, Any]] = None

        # Use the options resolver (Phase 8D) when available; fall back
        # to the legacy metadata resolver for backward compatibility.
        profile_id = options.protection_profile_id if options else None

        snapshot_resolve_reason: Optional[str] = None
        snapshot_resolve_details: Optional[Dict[str, Any]] = None

        if self._analysis_options_resolver is not None:
            try:
                resolved = self._analysis_options_resolver.resolve(
                    file.job_id,
                    protection_profile_id=profile_id,
                )
                if resolved is not None:
                    protection_metadata = resolved.get("metadata")
                    protection_snapshot = resolved.get("snapshot")
                    snapshot_resolve_reason = resolved.get("resolution_reason")
                    # When metadata exists but full snapshot is not available,
                    # the resolution_reason is None (metadata lookup succeeded)
                    # but we still cannot perform token integrity analysis.
                    # Detect this case and set a specific reason.
                    if protection_metadata is not None and protection_snapshot is None and snapshot_resolve_reason is None:
                        snapshot_resolve_reason = "snapshot_not_in_repository"
                    # Build analysis_metadata from the resolved metadata
                    if protection_metadata:
                        analysis_metadata = {
                            "analysis_profile_id": profile_id,
                            "analysis_profile_fingerprint": (
                                protection_metadata.get("profile_fingerprint")
                            ),
                            "analysis_snapshot_hash": protection_metadata.get("snapshot_hash"),
                            "analysis_snapshot_source": (
                                protection_metadata.get("snapshot_source")
                                or "translation_snapshot"
                            ),
                        }
            except Exception:
                logger.debug(
                    "Failed to resolve protection snapshot via options resolver "
                    "for job %s (profile_id=%s)",
                    file.job_id, profile_id, exc_info=True,
                )
                snapshot_resolve_reason = "resolver_exception"
        elif self._protection_metadata_resolver is not None:
            try:
                resolved = self._protection_metadata_resolver.resolve(
                    file.job_id,
                )
                if resolved is not None:
                    protection_metadata = resolved.get("metadata")
                    protection_snapshot = resolved.get("snapshot")
                    snapshot_resolve_reason = resolved.get("resolution_reason")
                    # Same detection: metadata found but full snapshot missing
                    if protection_metadata is not None and protection_snapshot is None and snapshot_resolve_reason is None:
                        snapshot_resolve_reason = "snapshot_not_in_repository"
            except Exception:
                logger.debug(
                    "Failed to resolve protection metadata for job %s",
                    file.job_id, exc_info=True,
                )
                snapshot_resolve_reason = "metadata_resolver_exception"

        context = AnalysisContext(
            parser_id=file.parser_id,
            game_id=file.game_id,
            source_entries=source_entries,
            translated_entries=translated_entries,
            protection_metadata=protection_metadata,
            protection_snapshot=protection_snapshot,
        )

        # 4. Run snapshot analysis (authoritative path).
        #    Supplementary analyzers registered in the registry emit
        #    non-authoritative diagnostics only.
        snapshot_result = self._run_snapshot_analysis(
            output_file_id,
            protection_metadata,
            protection_snapshot,
            source_text=source_content,
            translated_text=translated_content,
        )

        # 5. Version check (Phase 8C) — run against the snapshot dict before
        #    passing to the evaluator.  When version is unsupported the
        #    evaluator returns a controlled error without inspecting integrity.
        version_check = None
        if protection_snapshot:
            try:
                version_check = check_snapshot_version(protection_snapshot)
            except Exception:
                logger.debug(
                    "Version check failed for snapshot of file %s",
                    output_file_id, exc_info=True,
                )

        # 6. Extract TokenIntegrityResult and PlaceholderIntegrityResult,
        #    then run authoritative evaluator
        integrity_result = snapshot_result.integrity_result if snapshot_result else None
        placeholder_result = (
            snapshot_result.placeholder_integrity_result
            if snapshot_result else None
        )
        scores, overall_status, snapshot_diagnostics = (
            self._authoritative_evaluator.evaluate(
                integrity_result,
                placeholder_result=placeholder_result,
                version_check=version_check,
                snapshot_unavailable_reason=snapshot_resolve_reason,
                snapshot_unavailable_details=snapshot_resolve_details,
            )
        )

        # 7. Aggregate all diagnostics
        all_diagnostics: List[AnalysisDiagnostic] = list(io_diagnostics)
        all_diagnostics.extend(snapshot_diagnostics)

        # 7. Run supplementary check-only analyzers for non-authoritative diagnostics.
        #    When SNAPSHOT_UNAVAILABLE is the authoritative result, supplementary
        #    analyzers still run but their diagnostics are separated in the error
        #    count below (only SNAPSHOT_UNAVAILABLE counts as an error).
        if checks is not None:
            analyzers = self._registry.get_for_checks(checks)
            for check_name, analyzer in analyzers.items():
                try:
                    cr = analyzer.analyze(
                        source_text=source_content or "",
                        translated_text=translated_content or "",
                        file=file,
                        context=context,
                    )
                    all_diagnostics.extend(cr.diagnostics)
                except Exception as exc:
                    logger.exception(
                        "Supplementary analyzer '%s' failed for file %s",
                        check_name, output_file_id,
                    )
                    all_diagnostics.append(AnalysisDiagnostic(
                        severity="warning",
                        code=f"{check_name.upper()}_SUPPLEMENTARY_ERROR",
                        message=f"Supplementary analyzer '{check_name}' failed: {exc}",
                        source=check_name,
                    ))

        # When the authoritative evaluator returned SNAPSHOT_UNAVAILABLE,
        # count only the SNAPSHOT_UNAVAILABLE diagnostic as errors.
        # Supplementary analyzer results are still included in the
        # diagnostics list for display, but their errors do NOT inflate
        # the summary error count — the root cause is the missing snapshot,
        # not per-entry translation issues.
        if any(
            d.code == "SNAPSHOT_UNAVAILABLE" and d.severity == "error"
            for d in snapshot_diagnostics
        ):
            errors_count = sum(
                1 for d in all_diagnostics
                if d.severity == "error" and d.code == "SNAPSHOT_UNAVAILABLE"
            )
            warnings_count = _count_severity(all_diagnostics, "warning")
        else:
            errors_count = _count_severity(all_diagnostics, "error")
            warnings_count = _count_severity(all_diagnostics, "warning")

        # 8. Compute hashes
        source_hash = hash_content(source_content or "")
        translated_hash = hash_content(translated_content or "")

        # 9. Build result with backward-compatible field aliases.
        #    - compilability_score = overall_score (snapshot-authoritative)
        #    - placeholders_score  = placeholder_integrity_score
        #      (snapshot-authoritative from registry-driven analysis)
        #    These are kept as API compatibility aliases for existing
        #    consumers.  The source of truth for placeholder semantics
        #    is now ``placeholder_integrity_score`` (Phase 8B).
        result = OutputFileAnalysisResult(
            id=str(uuid.uuid4()),
            output_file_id=output_file_id,
            job_id=file.job_id,
            analyzer_version=ANALYZER_VERSION,
            status=overall_status,
            compilability_score=scores.overall_score,
            placeholders_score=scores.placeholder_integrity_score,
            errors_count=errors_count,
            warnings_count=warnings_count,
            source_hash=source_hash,
            translated_hash=translated_hash,
            diagnostics=all_diagnostics,
            created_at=_now(),
            analysis_metadata=analysis_metadata,
        )

        # 10. Compute divergence for historical tracking only.
        self._compute_divergence(output_file_id, result)

        # 11. Save result and update file metadata
        if save:
            self._save_and_mark(file, result)

        return result

    def analyze_batch(self, request: BatchAnalysisRequest) -> BatchAnalysisResult:
        """Analyze multiple output files.

        Selection logic:
        - If ``output_file_ids`` provided, analyse exactly those files.
        - Otherwise select files through repository filters
          (``job_id`` / ``mod_id`` / ``group_key``).
        - If ``only_stale`` is True, analyse only files where
          ``analysis_stale = 1`` or that have no latest analysis.
        - Skip missing/invalid files with diagnostics, do not crash.
        """
        # Resolve files to analyse
        if request.output_file_ids:
            # Exact file list
            files: List[TranslatedOutputFile] = []
            for fid in request.output_file_ids:
                f = self._repo.get_by_id(fid)
                if f:
                    files.append(f)
        else:
            # Filter-based selection
            db_files = self._repo.list_files(
                job_id=request.job_id,
                mod_id=request.mod_id,
                group_key=request.group_key,
                limit=10000,
            )
            files = list(db_files)

        requested_count = len(files)
        batch_diagnostics: List[AnalysisDiagnostic] = []

        # Filter stale if requested
        if request.only_stale:
            stale_files: List[TranslatedOutputFile] = []
            for f in files:
                if f.analysis_stale or f.latest_analysis is None:
                    stale_files.append(f)
            skipped_count = requested_count - len(stale_files)
            files = stale_files
        else:
            skipped_count = 0

        # Analyse each file
        results: List[OutputFileAnalysisResult] = []
        analyzed_count = 0
        passed_count = 0
        warning_count = 0
        failed_count = 0
        error_count = 0

        for f in files:
            try:
                result = self.analyze_file(
                    output_file_id=f.id,
                    checks=request.checks,
                    save=request.save,
                    options=(
                        OutputAnalysisOptions(
                            protection_profile_id=request.protection_profile_id,
                        )
                        if request.protection_profile_id else None
                    ),
                )
                results.append(result)
                analyzed_count += 1

                if result.status == AnalysisStatus.PASSED:
                    passed_count += 1
                elif result.status == AnalysisStatus.WARNING:
                    warning_count += 1
                elif result.status == AnalysisStatus.FAILED:
                    failed_count += 1
                elif result.status == AnalysisStatus.ERROR:
                    error_count += 1

                # Collect IO-level diagnostics from this result
                for d in result.diagnostics:
                    if d.source == "io":
                        batch_diagnostics.append(d)
            except APIError as exc:
                batch_diagnostics.append(AnalysisDiagnostic(
                    severity="error",
                    code="FILE_SKIPPED",
                    message=f"Skipped file {f.id}: {exc.message}",
                    source="io",
                ))
                skipped_count += 1
            except Exception as exc:
                logger.exception("Batch analysis failed for file %s", f.id)
                batch_diagnostics.append(AnalysisDiagnostic(
                    severity="error",
                    code="BATCH_ANALYSIS_ERROR",
                    message=f"Analysis failed for file {f.id}: {exc}",
                    source="io",
                ))
                skipped_count += 1

        return BatchAnalysisResult(
            requested_count=requested_count,
            analyzed_count=analyzed_count,
            skipped_count=skipped_count,
            passed_count=passed_count,
            warning_count=warning_count,
            failed_count=failed_count,
            error_count=error_count,
            results=results,
            diagnostics=batch_diagnostics,
        )

    def get_latest(self, output_file_id: str) -> Optional[OutputFileAnalysisResult]:
        """Get the most recent analysis result for a file.

        Returns None if no analysis exists.
        """
        summary = self._repo.get_latest_analysis(output_file_id)
        if summary is None:
            return None

        # Fetch the full analysis row for diagnostics
        conn = self._repo.db.connect()
        row = conn.execute(
            """SELECT * FROM translated_output_file_analysis
               WHERE id = ?""",
            (summary.id,),
        ).fetchone()
        if row is None:
            return None

        return self._row_to_full_result(row)

    def get_history(
        self, output_file_id: str, limit: int = 20, offset: int = 0
    ) -> List[OutputFileAnalysisResult]:
        """Get analysis history for a file, newest first."""
        conn = self._repo.db.connect()
        rows = conn.execute(
            """SELECT * FROM translated_output_file_analysis
               WHERE output_file_id = ?
               ORDER BY created_at DESC
               LIMIT ? OFFSET ?""",
            (output_file_id, limit, offset),
        ).fetchall()
        return [self._row_to_full_result(r) for r in rows]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _save_and_mark(
        self,
        file: TranslatedOutputFile,
        result: OutputFileAnalysisResult,
    ) -> None:
        """Persist analysis result and update file metadata with race-safe semantics.

        Policy:
            1. Always save the historical result row.
            2. Re-read current file content from disk and update
               ``current_source_hash`` / ``current_translated_hash``
               to reflect what is actually on disk right now.
            3. Mark analysis complete (clear stale) **only** if the
               current content hashes still match the hashes the
               analysis was computed against.
            4. If hashes differ (file changed during analysis), the
               result is stored in history but does **not** become
               the latest valid analysis (stale flag preserved).
        """
        try:
            self._repo.save_analysis(result)
        except Exception as exc:
            logger.exception("Failed to save analysis result for file %s", file.id)
            raise

        # Re-read current file content to detect races
        current_source_hash = read_and_hash(file.source_file_path) if Path(file.source_file_path).exists() else None
        current_translated_hash = read_and_hash(file.translated_file_path) if Path(file.translated_file_path).exists() else None

        # Update current hashes in DB (always — reflects on-disk state)
        self._repo.update_current_hashes(
            output_file_id=file.id,
            current_source_hash=current_source_hash,
            current_translated_hash=current_translated_hash,
        )

        # Only clear stale if hashes still match what was analyzed
        if result.source_hash is not None or result.translated_hash is not None:
            source_match = (result.source_hash is None
                            or result.source_hash == current_source_hash)
            translated_match = (result.translated_hash is None
                                or result.translated_hash == current_translated_hash)
            hashes_match = source_match and translated_match
        else:
            hashes_match = True

        if hashes_match:
            try:
                self._repo.mark_analysis_complete(
                    output_file_id=file.id,
                    analyzed_at=result.created_at,
                )
            except Exception as exc:
                logger.exception("Failed to mark analysis complete for file %s", file.id)
        else:
            # File changed during analysis — log and keep stale flag
            logger.warning(
                "File %s changed during analysis; result stored in history "
                "but not set as latest valid "
                "(source_hash match=%s, translated_hash match=%s)",
                file.id, source_match, translated_match,
            )

    # ------------------------------------------------------------------
    # Snapshot-authoritative analysis (Phase 7)
    # ------------------------------------------------------------------

    def get_snapshot_analysis(
        self,
        output_file_id: str,
    ) -> Optional[SnapshotAnalysisResult]:
        """Return the latest snapshot analysis for *output_file_id*.

        Returns ``None`` if no snapshot analysis has been run yet for
        this file (e.g. the file has never been analyzed).
        """
        return self._snapshot_results.get(output_file_id)

    def get_divergence(
        self,
        output_file_id: str,
    ) -> Optional[AnalysisDivergence]:
        """Return the latest divergence for *output_file_id*.

        Retained for historical observability of persisted analysis data.
        Returns ``None`` if no analysis has been performed for this file yet.
        """
        return self._divergence_results.get(output_file_id)

    def _run_snapshot_analysis(
        self,
        output_file_id: str,
        protection_metadata: Optional[Dict],
        protection_snapshot: Optional[Dict] = None,
        source_text: Optional[str] = None,
        translated_text: Optional[str] = None,
    ) -> Optional[SnapshotAnalysisResult]:
        """Run the snapshot-aware analyzer and cache its result.

        The analyzer validates protection snapshot metadata consistency,
        runs the unified tokenizer, and performs token integrity comparison
        between source and translated text.

        The returned ``SnapshotAnalysisResult`` carries the full
        ``TokenIntegrityResult`` for authoritative scoring.

        Exceptions are swallowed and logged — the analyzer must never
        interrupt the main analysis flow.
        """
        try:
            result = self._snapshot_analyzer.analyze(
                protection_metadata,
                protection_snapshot=protection_snapshot,
                source_text=source_text,
                translated_text=translated_text,
            )
            self._snapshot_results[output_file_id] = result
            return result
        except Exception:
            logger.exception(
                "Snapshot-aware analyzer failed for file %s", output_file_id,
            )
            return None

    def _compute_divergence(
        self,
        output_file_id: str,
        authoritative_result: OutputFileAnalysisResult,
    ) -> None:
        """Compute divergence for historical tracking.

        The divergence is recorded as ``SNAPSHOT_AUTHORITATIVE_NO_LEGACY``
        since the legacy path has been removed and no comparison is possible.

        This is **purely informational** — exceptions are swallowed
        and logged; they must never interrupt the main analysis flow.
        """
        try:
            snapshot_result = self._snapshot_results.get(output_file_id)

            divergence = AnalysisDivergence(
                divergence_type=DivergenceType.SNAPSHOT_AUTHORITATIVE_NO_LEGACY,
                legacy_status=None,
                snapshot_status=(
                    snapshot_result.status.value
                    if snapshot_result and snapshot_result.status
                    else None
                ),
                legacy_failed=False,
                snapshot_failed=(
                    authoritative_result.status in (
                        AnalysisStatus.FAILED, AnalysisStatus.ERROR,
                    )
                ),
                legacy_issue_codes=[],
                snapshot_issue_codes=(
                    list({d.code for d in authoritative_result.diagnostics})
                    if authoritative_result.diagnostics
                    else []
                ),
                details={
                    "note": "Legacy path removed; no comparison possible",
                },
            )
            self._divergence_results[output_file_id] = divergence

            if self._divergence_repo is not None:
                self._divergence_repo.save(
                    job_id=authoritative_result.job_id,
                    output_file_id=output_file_id,
                    divergence=divergence,
                )
        except Exception:
            logger.debug(
                "Divergence computation failed for file %s",
                output_file_id, exc_info=True,
            )

    @staticmethod
    def _row_to_full_result(row) -> OutputFileAnalysisResult:
        """Convert a DB row to an OutputFileAnalysisResult."""
        diagnostics: List[AnalysisDiagnostic] = []
        analysis_metadata: Optional[Dict[str, Any]] = None
        raw_json = row["diagnostics_json"]
        if raw_json:
            try:
                diag_list = json.loads(raw_json)
                for d in diag_list:
                    # Extract embedded analysis_metadata (Phase 8D) and
                    # skip the metadata entry that was appended during
                    # ``save_analysis``.
                    if isinstance(d, dict) and d.get("code") == "__analysis_metadata__":
                        analysis_metadata = d.get("details", {})
                        continue
                    diagnostics.append(AnalysisDiagnostic(
                        severity=d.get("severity", "info"),
                        code=d.get("code", ""),
                        message=d.get("message", ""),
                        source=d.get("source", "unknown"),
                        line=d.get("line"),
                        column=d.get("column"),
                        key=d.get("key"),
                        details=d.get("details", {}),
                    ))
            except (json.JSONDecodeError, TypeError):
                pass

        return OutputFileAnalysisResult(
            id=row["id"],
            output_file_id=row["output_file_id"],
            job_id=row["job_id"],
            analyzer_version=row["analyzer_version"],
            status=AnalysisStatus(row["status"]),
            compilability_score=row["compilability_score"],
            placeholders_score=row["placeholders_score"],
            errors_count=row["errors_count"] or 0,
            warnings_count=row["warnings_count"] or 0,
            source_hash=row["source_hash"],
            translated_hash=row["translated_hash"],
            diagnostics=diagnostics,
            created_at=row["created_at"],
            analysis_metadata=analysis_metadata,
        )
