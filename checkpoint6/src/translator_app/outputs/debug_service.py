"""Debug/observability service for translated output files.

Aggregates diagnostic information from multiple sources into a single
``OutputFileDebugSnapshot`` so operators can understand why a file is
in its current state.
"""

from __future__ import annotations

import json
import logging
from typing import List, Optional

from translator_app.outputs.debug_models import (
    AnalysisDebugInfo,
    AnalysisJobDebugInfo,
    IntegrityDebugInfo,
    ManifestDebugInfo,
    OutputFileDebugSnapshot,
    OutputScanEvent,
    ScannerDebugInfo,
    StaleReason,
)
from translator_app.outputs.models import TranslatedOutputFile
from translator_app.outputs.repository import TranslatedOutputFileRepository
from translator_app.outputs.scan_event_repository import ScanEventRepository

logger = logging.getLogger(__name__)


class OutputDebugService:
    """Aggregates debug information for output files.

    Depends on:
    - ``TranslatedOutputFileRepository`` for file metadata, hashes, analysis.
    - ``ScanEventRepository`` for scan history and job-file linkage.
    """

    def __init__(
        self,
        file_repository: TranslatedOutputFileRepository,
        scan_event_repo: ScanEventRepository,
    ):
        self._file_repo = file_repository
        self._scan_event_repo = scan_event_repo

    # ------------------------------------------------------------------
    # Stale reason derivation
    # ------------------------------------------------------------------

    def derive_stale_reason(self, file: TranslatedOutputFile) -> Optional[str]:
        """Derive the reason an output file's analysis is stale.

        Rules (applied in order):
        1. If ``analysis_stale`` is False → ``None``.
        2. No analysis ever → ``never_analyzed``.
        3. Hash mismatch between analysis and current → ``outdated_analysis``.
        4. File was recently edited (updated_at > last_analyzed_at) → ``edited``.
        5. Current translated hash differs from stored → ``external_modification``.
        6. Otherwise → ``unknown``.
        """
        if not file.analysis_stale:
            return None

        # No analysis at all
        if file.last_analyzed_at is None or file.latest_analysis is None:
            return StaleReason.NEVER_ANALYZED

        analysis = file.latest_analysis

        # Hash mismatch between analysis result and current file
        translated_mismatch = (
            analysis.translated_hash is not None
            and file.current_translated_hash is not None
            and analysis.translated_hash != file.current_translated_hash
        )
        source_mismatch = (
            analysis.source_hash is not None
            and file.current_source_hash is not None
            and analysis.source_hash != file.current_source_hash
        )

        if translated_mismatch or source_mismatch:
            return StaleReason.OUTDATED_ANALYSIS

        # File was updated after last analysis
        if file.updated_at and file.last_analyzed_at:
            if file.updated_at > file.last_analyzed_at:
                return StaleReason.EDITED

        return StaleReason.UNKNOWN

    # ------------------------------------------------------------------
    # Debug snapshot aggregation
    # ------------------------------------------------------------------

    def get_file_debug_snapshot(
        self,
        output_file_id: str,
    ) -> Optional[OutputFileDebugSnapshot]:
        """Build a complete debug snapshot for the given output file.

        Aggregates:
        - File metadata and current hashes
        - Latest analysis hashes and validity
        - Stale reason
        - Manifest info from scan events
        - Scanner diagnostics from latest scan
        - Recent analysis jobs touching this file

        Returns ``None`` if the file does not exist.
        """
        file = self._file_repo.get_by_id(output_file_id)
        if file is None:
            return None

        # --- Integrity info ---
        validity_state = self._file_repo.get_analysis_state(file)
        integrity = self._build_integrity_info(file)

        # --- Stale reason ---
        stale_reason = self.derive_stale_reason(file)

        # --- Latest scan events ---
        scan_events = self._scan_event_repo.list_events_for_file(
            output_file_id, limit=5
        )
        scanner_info = self._build_scanner_info(scan_events)
        manifest_info = self._build_manifest_info(scan_events)

        # --- Analysis info ---
        analysis_info = self._build_analysis_info(file)

        # --- Recent analysis jobs ---
        job_links = self._scan_event_repo.get_analysis_jobs_for_file(
            output_file_id, limit=10
        )
        recent_jobs = self._build_analysis_job_info(job_links)

        return OutputFileDebugSnapshot(
            file_id=file.id,
            job_id=file.job_id,
            file_name=file.file_name,
            relative_path=file.relative_translated_path,
            status=file.status,
            created_at=file.created_at,
            updated_at=file.updated_at,
            last_analyzed_at=file.last_analyzed_at,
            current_source_hash=file.current_source_hash,
            current_translated_hash=file.current_translated_hash,
            analysis_stale=file.analysis_stale,
            stale_reason=stale_reason,
            latest_analysis_state=validity_state,
            manifest=manifest_info,
            scanner=scanner_info,
            analysis=analysis_info,
            integrity=integrity,
            recent_analysis_jobs=recent_jobs,
        )

    # ------------------------------------------------------------------
    # Scan history for a file
    # ------------------------------------------------------------------

    def get_file_scan_history(
        self,
        output_file_id: str,
        limit: int = 20,
    ) -> List[OutputScanEvent]:
        """Get the scan event history for the job owning this file."""
        return self._scan_event_repo.list_events_for_file(
            output_file_id, limit=limit
        )

    # ------------------------------------------------------------------
    # Analysis job debug
    # ------------------------------------------------------------------

    def get_analysis_job_debug(
        self,
        analysis_job_id: str,
    ) -> dict:
        """Get debug info for an analysis job, including linked files."""
        job = None
        linked_files = self._scan_event_repo.get_linked_files_for_job(
            analysis_job_id
        )
        return {
            "analysis_job_id": analysis_job_id,
            "linked_file_count": len(linked_files),
            "linked_file_ids": linked_files[:100],
        }

    # ------------------------------------------------------------------
    # Internal builders
    # ------------------------------------------------------------------

    @staticmethod
    def _build_integrity_info(file: TranslatedOutputFile) -> IntegrityDebugInfo:
        analysis = file.latest_analysis
        analysis_source_hash = analysis.source_hash if analysis else None
        analysis_translated_hash = analysis.translated_hash if analysis else None

        hash_match = None
        if file.current_translated_hash is not None and analysis_translated_hash is not None:
            hash_match = file.current_translated_hash == analysis_translated_hash
        elif file.current_source_hash is not None and analysis_source_hash is not None:
            hash_match = file.current_source_hash == analysis_source_hash

        return IntegrityDebugInfo(
            current_source_hash=file.current_source_hash,
            current_translated_hash=file.current_translated_hash,
            analysis_source_hash=analysis_source_hash,
            analysis_translated_hash=analysis_translated_hash,
            hash_match=hash_match,
        )

    @staticmethod
    def _build_scanner_info(
        scan_events: List[OutputScanEvent],
    ) -> ScannerDebugInfo:
        if not scan_events:
            return ScannerDebugInfo()

        latest = scan_events[0]
        diagnostics = []
        try:
            diag_raw = json.loads(latest.diagnostics_json) if latest.diagnostics_json else []
            diagnostics = diag_raw if isinstance(diag_raw, list) else []
        except (json.JSONDecodeError, TypeError):
            diagnostics = []

        return ScannerDebugInfo(
            manifest_mode=latest.manifest_mode,
            manifest_found=latest.manifest_found,
            manifest_path=latest.output_root,
            scan_diagnostics=diagnostics,
            last_scan_event_id=latest.id,
            last_scan_at=latest.created_at,
        )

    @staticmethod
    def _build_manifest_info(
        scan_events: List[OutputScanEvent],
    ) -> ManifestDebugInfo:
        if not scan_events:
            return ManifestDebugInfo()

        latest = scan_events[0]
        integrity_info: dict = {}
        if latest.integrity_json:
            try:
                integrity_info = json.loads(latest.integrity_json) or {}
            except (json.JSONDecodeError, TypeError):
                integrity_info = {}

        return ManifestDebugInfo(
            manifest_path=latest.output_root,
            manifest_mode=latest.manifest_mode,
            is_complete=integrity_info.get("is_complete", True),
            missing_files=integrity_info.get("missing_files", []),
            undeclared_files=integrity_info.get("undeclared_files", []),
            files_declared=integrity_info.get("files_declared", 0),
            files_found=integrity_info.get("files_found", 0),
        )

    @staticmethod
    def _build_analysis_info(
        file: TranslatedOutputFile,
    ) -> AnalysisDebugInfo:
        analysis = file.latest_analysis
        if analysis is None:
            return AnalysisDebugInfo()

        return AnalysisDebugInfo(
            latest_analysis_id=analysis.id,
            latest_analysis_status=analysis.status,
            latest_analysis_at=analysis.created_at,
            analysis_source_hash=analysis.source_hash,
            analysis_translated_hash=analysis.translated_hash,
            validity_state=TranslatedOutputFileRepository.get_analysis_state(file),
        )

    @staticmethod
    def _build_analysis_job_info(
        links: list,
    ) -> List[AnalysisJobDebugInfo]:
        result: List[AnalysisJobDebugInfo] = []
        seen = set()
        for link in links:
            if link.analysis_job_id not in seen:
                seen.add(link.analysis_job_id)
                result.append(AnalysisJobDebugInfo(
                    job_id=link.analysis_job_id,
                    scope_type=link.scope_type,
                    status=link.job_status or link.result_status or "unknown",
                    total_count=link.total_count,
                    processed_count=link.processed_count,
                    created_at=link.job_created_at or link.created_at,
                    started_at=link.started_at,
                    finished_at=link.finished_at,
                    passed_count=link.passed_count,
                    warning_count=link.warning_count,
                    failed_count=link.failed_count,
                    error_count=link.error_count,
                ))
        return result
