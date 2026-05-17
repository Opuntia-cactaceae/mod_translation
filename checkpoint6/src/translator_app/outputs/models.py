"""Domain models for translated output files."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional


@dataclass
class OutputFileAnalysisSummary:
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


@dataclass
class TranslatedOutputFile:
    """A translated output file produced by a translation job."""

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
    latest_analysis: Optional[OutputFileAnalysisSummary] = None
    output_metadata: Optional[Dict[str, Any]] = None
    current_source_hash: Optional[str] = None
    current_translated_hash: Optional[str] = None


@dataclass
class OutputJobNode:
    """A job node in the output files tree."""

    job_id: str
    mods: dict  # mod_id -> OutputModNode


@dataclass
class OutputModNode:
    """A mod node in the output files tree."""

    mod_id: str
    mod_name: str
    groups: dict  # group_key -> OutputGroupNode


@dataclass
class OutputGroupNode:
    """A group node in the output files tree."""

    group_key: str
    group_label: str
    files: list = field(default_factory=list)


@dataclass
class OutputFilesTree:
    """The full output files tree: jobs -> mods -> groups -> files."""

    jobs: dict  # job_id -> OutputJobNode
