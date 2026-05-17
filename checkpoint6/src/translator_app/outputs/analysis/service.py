"""Output file analysis service.

Orchestrates the analysis of translated output files using registered
analyzers (placeholder, compilability, etc).  Implements single-file
and batch analysis flows.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from translator_app.backend.errors import APIError, NOT_FOUND
from translator_app.file_processing.service import FileProcessingService
from translator_app.outputs.analysis.models import (
    AnalysisCheckName,
    AnalysisContext,
    AnalysisDiagnostic,
    AnalysisStatus,
    BatchAnalysisRequest,
    BatchAnalysisResult,
    CheckResult,
    OutputFileAnalysisResult,
)
from translator_app.outputs.analysis.registry import AnalyzerRegistry
from translator_app.outputs.hash_utils import hash_content, read_and_hash
from translator_app.outputs.models import TranslatedOutputFile
from translator_app.outputs.repository import TranslatedOutputFileRepository

logger = logging.getLogger(__name__)

# Current analyzer version for the service bundle
ANALYZER_VERSION = "1.0.0"


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

    Orchestrates single-file and batch analysis using registered analyzers.
    Results are persisted to ``translated_output_file_analysis`` table.
    """

    def __init__(
        self,
        repository: TranslatedOutputFileRepository,
        registry: AnalyzerRegistry,
        file_processing: Optional[FileProcessingService] = None,
    ):
        self._repo = repository
        self._registry = registry
        self._file_processing = file_processing

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze_file(
        self,
        output_file_id: str,
        checks: Optional[List[str]] = None,
        save: bool = True,
    ) -> OutputFileAnalysisResult:
        """Analyze a single output file.

        Args:
            output_file_id: The file to analyze.
            checks: List of check names to run.  Defaults to all registered.
            save: If True, persist the result to DB and update file metadata.

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

        context = AnalysisContext(
            parser_id=file.parser_id,
            game_id=file.game_id,
            source_entries=source_entries,
            translated_entries=translated_entries,
        )

        # 4. Run requested analyzers
        analyzers = self._registry.get_for_checks(checks)
        check_results: List[CheckResult] = []

        for check_name, analyzer in analyzers.items():
            try:
                result = analyzer.analyze(
                    source_text=source_content or "",
                    translated_text=translated_content or "",
                    file=file,
                    context=context,
                )
                check_results.append(result)
            except Exception as exc:
                logger.exception("Analyzer '%s' failed for file %s", check_name, output_file_id)
                check_results.append(CheckResult(
                    check_name=check_name,
                    status=AnalysisStatus.ERROR,
                    score=None,
                    diagnostics=[
                        AnalysisDiagnostic(
                            severity="error",
                            code=f"{check_name.upper()}_ERROR",
                            message=f"Analyzer '{check_name}' failed: {exc}",
                            source=check_name,
                            details={"error": str(exc)},
                        )
                    ],
                ))

        # 5. Aggregate statuses/scores/diagnostics
        overall_status = _aggregate_status(check_results)

        all_diagnostics: List[AnalysisDiagnostic] = list(io_diagnostics)
        compilability_score: Optional[float] = None
        placeholders_score: Optional[float] = None

        for cr in check_results:
            all_diagnostics.extend(cr.diagnostics)
            if cr.check_name == AnalysisCheckName.COMPILABILITY.value:
                compilability_score = cr.score
            elif cr.check_name == AnalysisCheckName.PLACEHOLDERS.value:
                placeholders_score = cr.score

        errors_count = _count_severity(all_diagnostics, "error")
        warnings_count = _count_severity(all_diagnostics, "warning")

        # 6. Compute hashes
        source_hash = hash_content(source_content or "")
        translated_hash = hash_content(translated_content or "")

        # 7. Build result
        result = OutputFileAnalysisResult(
            id=str(uuid.uuid4()),
            output_file_id=output_file_id,
            job_id=file.job_id,
            analyzer_version=ANALYZER_VERSION,
            status=overall_status,
            compilability_score=compilability_score,
            placeholders_score=placeholders_score,
            errors_count=errors_count,
            warnings_count=warnings_count,
            source_hash=source_hash,
            translated_hash=translated_hash,
            diagnostics=all_diagnostics,
            created_at=_now(),
        )

        # 8. Save result and update file metadata
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

    @staticmethod
    def _row_to_full_result(row) -> OutputFileAnalysisResult:
        """Convert a DB row to an OutputFileAnalysisResult."""
        diagnostics: List[AnalysisDiagnostic] = []
        raw_json = row["diagnostics_json"]
        if raw_json:
            try:
                diag_list = json.loads(raw_json)
                for d in diag_list:
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
        )
