"""Editor Data Module — models for editor comparison view.

EditorRow, EditorData, EditorStats, and EditorState.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class EditorRow:
    """A single row in the editor comparison view.

    Maps 1:1 to a FileEntry with its translation and diagnostics.
    """

    row_id: str
    line_no: int
    entry_type: str  # translation_entry | comment | empty | raw_unknown
    key: str
    source_text: str
    translated_text: Optional[str] = None
    status: str = "untranslated"  # non_editable | untranslated | translated | edited | from_cache | error
    warnings: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    raw_line: str = ""
    editable: bool = True


@dataclass
class EditorStats:
    """Aggregated statistics for editor data."""

    total_rows: int = 0
    translated_rows: int = 0
    edited_rows: int = 0
    warnings_count: int = 0
    errors_count: int = 0


@dataclass
class EditorData:
    """Complete editor dataset for a single file."""

    file_id: str
    source_path: str = ""
    output_path: str = ""
    rows: list = field(default_factory=list)  # list[EditorRow]
    stats: Optional[EditorStats] = None


@dataclass
class EditorState:
    """Persistent UI state for the editor viewport."""

    current_file: Optional[str] = None
    current_language: str = "english"
    zoom_level: float = 1.0
    show_translated_only: bool = False
    show_untranslated_only: bool = False
    selected_entry_index: Optional[int] = None
    unsaved_changes: bool = False
