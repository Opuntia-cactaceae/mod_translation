"""Domain models for output file analysis."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class AnalysisCheckName(str, Enum):
    """Names of supported analysis checks."""

    COMPILABILITY = "compilability"
    PLACEHOLDERS = "placeholders"


class AnalysisStatus(str, Enum):
    """Overall status of an analysis check or result."""

    PASSED = "passed"
    WARNING = "warning"
    FAILED = "failed"
    ERROR = "error"


@dataclass
class AnalysisDiagnostic:
    """A single diagnostic emitted during analysis."""

    severity: str  # "error" | "warning" | "info"
    code: str
    message: str
    source: str  # "compilability" | "placeholder" | "parser" | "io"
    line: Optional[int] = None
    column: Optional[int] = None
    key: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CheckResult:
    """Result of a single analysis check."""

    check_name: str
    status: AnalysisStatus
    score: Optional[float] = None
    diagnostics: List[AnalysisDiagnostic] = field(default_factory=list)


@dataclass
class AnalysisContext:
    """Context passed to analyzers."""

    parser_id: Optional[str] = None
    game_id: Optional[str] = None
    protection_strategy: Optional[str] = None
    protection_options: Optional[Dict[str, Any]] = None
    src_lang: Optional[str] = None
    dst_lang: Optional[str] = None
    source_entries: Optional[List[Dict[str, Any]]] = None
    translated_entries: Optional[List[Dict[str, Any]]] = None


@dataclass
class OutputFileAnalysisResult:
    """Complete result of analyzing a single output file."""

    id: str
    output_file_id: str
    job_id: str
    analyzer_version: str
    status: AnalysisStatus
    compilability_score: Optional[float] = None
    placeholders_score: Optional[float] = None
    errors_count: int = 0
    warnings_count: int = 0
    source_hash: Optional[str] = None
    translated_hash: Optional[str] = None
    diagnostics: List[AnalysisDiagnostic] = field(default_factory=list)
    created_at: str = ""


@dataclass
class BatchAnalysisRequest:
    """Request to analyze multiple output files."""

    job_id: Optional[str] = None
    mod_id: Optional[str] = None
    group_key: Optional[str] = None
    output_file_ids: Optional[List[str]] = None
    checks: List[str] = field(default_factory=lambda: ["compilability", "placeholders"])
    save: bool = True
    only_stale: bool = False


@dataclass
class BatchAnalysisResult:
    """Result of a batch analysis operation."""

    requested_count: int = 0
    analyzed_count: int = 0
    skipped_count: int = 0
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0
    results: List[OutputFileAnalysisResult] = field(default_factory=list)
    diagnostics: List[AnalysisDiagnostic] = field(default_factory=list)
