"""Job-related Pydantic schemas for the API layer."""

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class JobProgressResponse(BaseModel):
    """Structured progress information for API responses."""
    total_units: int = 0
    processed_units: int = 0
    failed_units: int = 0
    cached_units: int = 0
    current_batch_index: int = 0
    total_batches: int = 0
    percent: float = 0.0
    eta_seconds: Optional[float] = None


class JobDiagnosticResponse(BaseModel):
    """Diagnostic entry in API responses."""
    level: str = "info"
    code: str = ""
    message: str = ""
    batch_index: Optional[int] = None
    details: Optional[Dict[str, Any]] = None


class TaskPlanSummary(BaseModel):
    """Lightweight summary of a TaskPlan for API responses."""
    total_units: int = 0
    total_tasks: int = 0
    batch_size: int = 0
    cache_hits: int = 0
    cache_misses: int = 0


class JobResponse(BaseModel):
    """Full job representation returned by the API."""
    id: str
    name: str = ""
    status: str = "pending"
    source_job_id: Optional[str] = None
    progress: float = 0.0
    total_units: int = 0
    completed_units: int = 0
    failed_units: int = 0
    cached_units: int = 0
    current_batch_index: int = 0
    total_batches: int = 0
    created_at: str = ""
    updated_at: Optional[str] = None
    error_message: Optional[str] = None
    file_paths: List[str] = []
    output_files: List[str] = []
    output_root_dir: Optional[str] = None
    progress_detail: Optional[JobProgressResponse] = None
    task_plan_summary: Optional[TaskPlanSummary] = None
    diagnostics: List[JobDiagnosticResponse] = []
    result_summary: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None
    active_worker: bool = False


class JobSummaryResponse(BaseModel):
    """Lightweight job summary for progress polling — no heavy fields."""
    id: str
    status: str = "pending"
    progress: float = 0.0
    total_units: int = 0
    completed_units: int = 0
    failed_units: int = 0
    cached_units: int = 0
    current_batch_index: int = 0
    total_batches: int = 0
    updated_at: Optional[str] = None
    active_worker: bool = False
    error_message: Optional[str] = None


class FileJobMetadata(BaseModel):
    """Per-file metadata carried alongside file_paths in a create-job request."""
    mod_id: Optional[str] = None
    mod_name: Optional[str] = None
    game_id: Optional[str] = None
    source_root: Optional[str] = None
    group: Optional[str] = None


class CreateJobRequest(BaseModel):
    file_paths: List[str]
    name: str = ""
    priority: int = 1
    config: Optional[Dict[str, Any]] = None
    autostart: bool = False
    # Legacy job-level mod context.  Kept for backward compatibility with
    # clients that send a single mod per job.  New clients should prefer
    # ``file_metadata`` for per-file granularity.
    mod_id: Optional[str] = None
    mod_name: Optional[str] = None
    # Per-file metadata keyed by file path (same normalised keys as file_paths).
    file_metadata: Optional[Dict[str, FileJobMetadata]] = None


class JobActionResponse(BaseModel):
    success: bool
    job: Optional[JobResponse] = None
    message: str = ""


class UpdateConfigRequest(BaseModel):
    """Partial config update for a pending or paused job."""
    config: Dict[str, Any]
