"""API schemas for translated output files."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class OutputFileAnalysisSummaryResponse(BaseModel):
    """Summary of the latest analysis for an output file."""

    id: str
    status: str
    compilability_score: Optional[float] = None
    placeholders_score: Optional[float] = None
    errors_count: int = 0
    warnings_count: int = 0
    created_at: str = ""
    source_hash: Optional[str] = None
    translated_hash: Optional[str] = None


class OutputFileResponse(BaseModel):
    """Full detail response for a single output file."""

    id: str
    job_id: str
    mod_id: Optional[str] = None
    mod_name: Optional[str] = None
    source_file_path: str = ""
    translated_file_path: str = ""
    relative_source_path: Optional[str] = None
    relative_translated_path: Optional[str] = None
    file_name: str = ""
    file_ext: Optional[str] = None
    game_id: Optional[str] = None
    parser_id: Optional[str] = None
    aggregation_key: Optional[str] = None
    group_key: Optional[str] = None
    group_label: Optional[str] = None
    source_size_bytes: Optional[int] = None
    translated_size_bytes: Optional[int] = None
    created_at: str = ""
    updated_at: str = ""
    last_analyzed_at: Optional[str] = None
    editor_available: bool = True
    status: str = "ready"
    analysis_stale: bool = False
    latest_analysis: Optional[OutputFileAnalysisSummaryResponse] = None
    latest_analysis_state: str = "not_analyzed"
    output_metadata: Optional[Dict[str, Any]] = None


class OutputFileListItem(BaseModel):
    """Lightweight output file item for list/tree responses."""

    id: str
    file_name: str = ""
    source_file_name: Optional[str] = None
    source_file_path: str = ""
    relative_source_path: Optional[str] = None
    relative_translated_path: Optional[str] = None
    status: str = "ready"


class OutputGroupNodeResponse(BaseModel):
    """A group node in the output files tree."""

    group_key: str
    group_label: str
    files: List[OutputFileListItem] = []


class OutputModNodeResponse(BaseModel):
    """A mod node in the output files tree."""

    mod_id: str
    mod_name: str
    groups: Dict[str, OutputGroupNodeResponse] = {}


class OutputJobNodeResponse(BaseModel):
    """A job node in the output files tree."""

    job_id: str
    name: str = ""
    mods: Dict[str, OutputModNodeResponse] = {}


class JobTimestampInfo(BaseModel):
    """Timestamp info for a job, used for date grouping."""

    created_at: str = ""
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None


class OutputFileTreeResponse(BaseModel):
    """The full output files tree response."""

    jobs: Dict[str, OutputJobNodeResponse] = {}
    job_timestamps: Dict[str, JobTimestampInfo] = {}


class OutputFileListResponse(BaseModel):
    """Paginated list of output files."""

    items: List[OutputFileResponse] = []
    total: int = 0
    limit: int = 100
    offset: int = 0


class OutputFilesSummaryResponse(BaseModel):
    """Summary statistics for a job's output files."""

    files_count: int = 0
    mods_count: int = 0
    groups_count: int = 0
    analyzed_count: int = 0
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0
    missing_count: int = 0
    stale_count: int = 0


class FileContentsResponse(BaseModel):
    """Response with source and translated file contents (read-only)."""

    source_path: str = ""
    translated_path: str = ""
    source_content: str = ""
    translated_content: str = ""
    source_exists: bool = False
    translated_exists: bool = False


# ---------------------------------------------------------------------------
# Analysis schemas
# ---------------------------------------------------------------------------


class OutputAnalysisDiagnosticResponse(BaseModel):
    """A single diagnostic from output file analysis."""

    severity: str  # "error" | "warning" | "info"
    code: str
    message: str
    source: str  # "compilability" | "placeholder" | "parser" | "io"
    line: Optional[int] = None
    column: Optional[int] = None
    key: Optional[str] = None
    details: Dict[str, Any] = {}


class OutputAnalyzeRequest(BaseModel):
    """Request body for analyzing a single output file."""

    checks: List[str] = ["compilability", "placeholders"]
    save: bool = True
    protection_profile_id: Optional[str] = None


class OutputBatchAnalyzeRequest(BaseModel):
    """Request body for batch analysis of output files."""

    job_id: Optional[str] = None
    mod_id: Optional[str] = None
    group_key: Optional[str] = None
    output_file_ids: Optional[List[str]] = None
    checks: List[str] = ["compilability", "placeholders"]
    save: bool = True
    only_stale: bool = False
    protection_profile_id: Optional[str] = None


class OutputAnalysisResultResponse(BaseModel):
    """Result of analyzing a single output file."""

    id: str
    output_file_id: str
    job_id: str
    analyzer_version: str
    status: str
    compilability_score: Optional[float] = None
    placeholders_score: Optional[float] = None
    errors_count: int = 0
    warnings_count: int = 0
    source_hash: Optional[str] = None
    translated_hash: Optional[str] = None
    diagnostics: List[OutputAnalysisDiagnosticResponse] = []
    created_at: str = ""


class OutputBatchAnalysisResultResponse(BaseModel):
    """Result of batch-analyzing multiple output files."""

    requested_count: int = 0
    analyzed_count: int = 0
    skipped_count: int = 0
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0
    results: List[OutputAnalysisResultResponse] = []


# ---------------------------------------------------------------------------
# Scan / Reindex schemas
# ---------------------------------------------------------------------------


class ScanDiagnosticResponse(BaseModel):
    """A diagnostic emitted during a scan."""

    severity: str  # "info" | "warning" | "error"
    code: str
    message: str
    path: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class OutputReindexRequest(BaseModel):
    """Request body for triggered a reindex of a job's output files."""

    force: bool = False


class OutputScanResultResponse(BaseModel):
    """Result of scanning / reindexing a job's output files."""

    job_id: str
    scanned_count: int = 0
    indexed_count: int = 0
    updated_count: int = 0
    skipped_count: int = 0
    missing_source_count: int = 0
    errors_count: int = 0
    diagnostics: List[ScanDiagnosticResponse] = []
    manifest_found: bool = False
    manifest_mode: str = "fallback"


# ---------------------------------------------------------------------------
# Analysis Jobs (async)
# ---------------------------------------------------------------------------


class CreateOutputAnalysisJobRequestSchema(BaseModel):
    """Request body for creating an async analysis job."""

    scope_type: str
    job_id: Optional[str] = None
    mod_id: Optional[str] = None
    group_key: Optional[str] = None
    output_file_ids: Optional[List[str]] = None
    checks: List[str] = ["compilability", "placeholders"]
    only_stale: bool = False


class OutputAnalysisJobResponse(BaseModel):
    """Response model for an analysis job."""

    id: str
    scope_type: str
    scope: Any = None
    checks: List[str] = []
    status: str
    total_count: int = 0
    processed_count: int = 0
    skipped_count: int = 0
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0
    created_at: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    cancel_requested: bool = False
    error_message: Optional[str] = None


class OutputAnalysisJobListResponse(BaseModel):
    """Paginated list of analysis jobs."""

    items: List[OutputAnalysisJobResponse] = []
    total: int = 0
    limit: int = 50
    offset: int = 0
