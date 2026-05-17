"""Debug/observability models for translated output files.

Provides snapshot models that aggregate all diagnostic information about
a single output file into one structure, so operators can understand
*why* a file is in its current state without querying multiple tables.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Stale reasons
# ---------------------------------------------------------------------------


class StaleReason:
    """Well-known reasons an output file's analysis may be stale.

    These are computed (not stored) — the debug snapshot derives one
    from the current file state.
    """

    EDITED = "edited"
    """User edited the translated file via the editor UI."""

    EXTERNAL_MODIFICATION = "external_modification"
    """File content changed on disk between scans (hash mismatch)."""

    MANIFEST_MISMATCH = "manifest_mismatch"
    """File was re-indexed from a different manifest state."""

    NEVER_ANALYZED = "never_analyzed"
    """No analysis has ever been run for this file."""

    OUTDATED_ANALYSIS = "outdated_analysis"
    """Analysis exists but content hashes no longer match current file."""

    SCANNER_RESYNC = "scanner_resync"
    """Scanner re-indexed the file; stale flag reset by scan process."""

    UNKNOWN = "unknown"
    """Stale flag is set but the reason could not be determined."""


STALE_REASON_VALUES = frozenset({
    StaleReason.EDITED,
    StaleReason.EXTERNAL_MODIFICATION,
    StaleReason.MANIFEST_MISMATCH,
    StaleReason.NEVER_ANALYZED,
    StaleReason.OUTDATED_ANALYSIS,
    StaleReason.SCANNER_RESYNC,
    StaleReason.UNKNOWN,
})


# ---------------------------------------------------------------------------
# Scan event persistence
# ---------------------------------------------------------------------------


@dataclass
class OutputScanEvent:
    """A persisted scan/reindex event for a job's output directory.

    Created every time the scanner runs for a job, storing the manifest
    mode, file counts, and full diagnostics snapshot.
    """

    id: str
    job_id: str
    output_root: str
    manifest_mode: str  # "authoritative" | "partial" | "fallback"
    manifest_found: bool
    files_indexed: int
    files_updated: int
    files_skipped: int
    files_missing_source: int
    errors_count: int
    diagnostics_json: str  # JSON list of scan diagnostic dicts
    integrity_json: Optional[str] = None  # JSON with manifest integrity info
    created_at: str = ""


# ---------------------------------------------------------------------------
# Analysis job/file linkage
# ---------------------------------------------------------------------------


@dataclass
class AnalysisJobFileLink:
    """Links an analysis job to an output file it processed.

    Also carries denormalised job-level metadata from the ``output_analysis_jobs``
    table so callers can build ``AnalysisJobDebugInfo`` without a second query.
    """

    analysis_job_id: str
    output_file_id: str
    result_id: Optional[str] = None
    result_status: Optional[str] = None
    created_at: str = ""
    # Job-level metadata (populated via JOIN)
    scope_type: str = ""
    job_status: str = ""
    job_created_at: str = ""
    total_count: int = 0
    processed_count: int = 0
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Manifest integrity persistence
# ---------------------------------------------------------------------------


@dataclass
class ManifestIntegritySnapshot:
    """A persisted result of a manifest integrity validation."""

    files_declared: int = 0
    files_found: int = 0
    missing_files: List[str] = field(default_factory=list)
    undeclared_files: List[str] = field(default_factory=list)
    is_complete: bool = True
    diagnostics: List[str] = field(default_factory=list)
    manifest_mode: str = ""


# ---------------------------------------------------------------------------
# Debug snapshot — aggregate view of a single output file
# ---------------------------------------------------------------------------


@dataclass
class ScannerDebugInfo:
    """Scanner-related debug info for a file."""

    manifest_mode: str = ""
    manifest_found: bool = False
    manifest_path: Optional[str] = None
    scan_diagnostics: List[Dict[str, Any]] = field(default_factory=list)
    last_scan_event_id: Optional[str] = None
    last_scan_at: Optional[str] = None


@dataclass
class ManifestDebugInfo:
    """Manifest-related debug info for a file."""

    manifest_path: Optional[str] = None
    manifest_mode: str = ""
    is_complete: bool = True
    missing_files: List[str] = field(default_factory=list)
    undeclared_files: List[str] = field(default_factory=list)
    files_declared: int = 0
    files_found: int = 0


@dataclass
class AnalysisDebugInfo:
    """Analysis-related debug info for a file."""

    latest_analysis_id: Optional[str] = None
    latest_analysis_status: Optional[str] = None
    latest_analysis_at: Optional[str] = None
    analysis_source_hash: Optional[str] = None
    analysis_translated_hash: Optional[str] = None
    validity_state: str = "missing"  # "missing" | "valid" | "outdated"
    diagnostics: List[Dict[str, Any]] = field(default_factory=list)
    history_count: int = 0


@dataclass
class IntegrityDebugInfo:
    """Integrity-related debug info for a file."""

    current_source_hash: Optional[str] = None
    current_translated_hash: Optional[str] = None
    analysis_source_hash: Optional[str] = None
    analysis_translated_hash: Optional[str] = None
    hash_match: Optional[bool] = None
    file_exists_on_disk: bool = True
    source_exists_on_disk: bool = True


@dataclass
class AnalysisJobDebugInfo:
    """Summary of recent analysis jobs that touched a file."""

    job_id: str
    scope_type: str
    status: str
    total_count: int
    processed_count: int
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0


@dataclass
class OutputFileDebugSnapshot:
    """Aggregated debug snapshot for a single output file.

    Combines file metadata, hashes, validity state, stale reason,
    manifest info, scanner info, analysis summary, and recent jobs.
    """

    # File identity
    file_id: str
    job_id: str
    file_name: str
    status: str
    created_at: str
    updated_at: str

    # Optional file identity
    relative_path: Optional[str] = None
    last_analyzed_at: Optional[str] = None

    # Hashes
    current_source_hash: Optional[str] = None
    current_translated_hash: Optional[str] = None

    # Validity
    analysis_stale: bool = False
    stale_reason: Optional[str] = None
    latest_analysis_state: str = "missing"

    # Sub-structures
    manifest: ManifestDebugInfo = field(default_factory=ManifestDebugInfo)
    scanner: ScannerDebugInfo = field(default_factory=ScannerDebugInfo)
    analysis: AnalysisDebugInfo = field(default_factory=AnalysisDebugInfo)
    integrity: IntegrityDebugInfo = field(default_factory=IntegrityDebugInfo)
    recent_analysis_jobs: List[AnalysisJobDebugInfo] = field(default_factory=list)
