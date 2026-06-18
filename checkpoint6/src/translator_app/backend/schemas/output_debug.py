"""API schemas for output file debug/observability endpoints."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ManifestDebugInfoResponse(BaseModel):
    """Manifest-related debug info for a file."""

    manifest_path: Optional[str] = None
    manifest_mode: str = ""
    is_complete: bool = True
    missing_files: List[str] = []
    undeclared_files: List[str] = []
    files_declared: int = 0
    files_found: int = 0


class ScannerDebugInfoResponse(BaseModel):
    """Scanner-related debug info for a file."""

    manifest_mode: str = ""
    manifest_found: bool = False
    manifest_path: Optional[str] = None
    scan_diagnostics: List[Dict[str, Any]] = []
    last_scan_event_id: Optional[str] = None
    last_scan_at: Optional[str] = None


class AnalysisDebugInfoResponse(BaseModel):
    """Analysis-related debug info for a file."""

    latest_analysis_id: Optional[str] = None
    latest_analysis_status: Optional[str] = None
    latest_analysis_at: Optional[str] = None
    analysis_source_hash: Optional[str] = None
    analysis_translated_hash: Optional[str] = None
    validity_state: str = "not_analyzed"
    diagnostics: List[Dict[str, Any]] = []
    history_count: int = 0
    snapshot_analysis: Optional[Dict[str, Any]] = None
    profile_staleness: Optional[Dict[str, Any]] = None


class IntegrityDebugInfoResponse(BaseModel):
    """Integrity-related debug info for a file."""

    current_source_hash: Optional[str] = None
    current_translated_hash: Optional[str] = None
    analysis_source_hash: Optional[str] = None
    analysis_translated_hash: Optional[str] = None
    hash_match: Optional[bool] = None
    file_exists_on_disk: bool = True
    source_exists_on_disk: bool = True


class AnalysisJobDebugInfoResponse(BaseModel):
    """Summary of an analysis job that touched a file."""

    job_id: str
    scope_type: str = ""
    status: str = ""
    total_count: int = 0
    processed_count: int = 0
    created_at: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0


class OutputFileDebugSnapshotResponse(BaseModel):
    """Aggregated debug snapshot response for an output file."""

    file_id: str
    job_id: str
    file_name: str
    relative_path: Optional[str] = None
    status: str
    created_at: str = ""
    updated_at: str = ""
    last_analyzed_at: Optional[str] = None
    current_source_hash: Optional[str] = None
    current_translated_hash: Optional[str] = None
    analysis_stale: bool = False
    stale_reason: Optional[str] = None
    latest_analysis_state: str = "not_analyzed"
    manifest: ManifestDebugInfoResponse = ManifestDebugInfoResponse()
    scanner: ScannerDebugInfoResponse = ScannerDebugInfoResponse()
    analysis: AnalysisDebugInfoResponse = AnalysisDebugInfoResponse()
    integrity: IntegrityDebugInfoResponse = IntegrityDebugInfoResponse()
    recent_analysis_jobs: List[AnalysisJobDebugInfoResponse] = []


class OutputScanEventResponse(BaseModel):
    """A persisted scan/reindex event."""

    id: str
    job_id: str
    output_root: str
    manifest_mode: str
    manifest_found: bool
    files_indexed: int
    files_updated: int
    files_skipped: int
    files_missing_source: int
    errors_count: int
    diagnostics: List[Dict[str, Any]] = []
    created_at: str = ""


class OutputAnalysisJobDebugResponse(BaseModel):
    """Debug info for an analysis job."""

    analysis_job_id: str
    linked_file_count: int = 0
    linked_file_ids: List[str] = []
