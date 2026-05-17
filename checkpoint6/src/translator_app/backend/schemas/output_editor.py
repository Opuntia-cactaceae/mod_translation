"""Schemas for the translated output file editor payload and save."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class OutputSourceFileInfo(BaseModel):
    """Information about the source (original) file."""

    path: str = ""
    relative_path: Optional[str] = None
    exists: bool = False


class OutputTranslatedFileInfo(BaseModel):
    """Information about the translated file."""

    path: str = ""
    relative_path: Optional[str] = None
    exists: bool = False


class OutputEditorEntryResponse(BaseModel):
    """A single entry in the editor's entry list (structured mode)."""

    key: str = ""
    source_text: str = ""
    translated_text: Optional[str] = None
    source_line: int = 0
    translated_line: int = 0
    entry_type: str = "translation_entry"
    translatable: bool = True
    metadata: Dict[str, Any] = {}


class OutputEditorMetadataResponse(BaseModel):
    """Metadata about the file being edited."""

    file_name: str = ""
    file_ext: str = ""
    source_size_bytes: int = 0
    translated_size_bytes: int = 0
    updated_at: str = ""
    status: str = "ready"
    analysis_stale: bool = False
    latest_analysis_state: str = "missing"


class OutputFileEditorPayloadResponse(BaseModel):
    """Full editor payload for a translated output file."""

    output_file_id: str
    job_id: str

    source_file: OutputSourceFileInfo
    translated_file: OutputTranslatedFileInfo

    parser_id: Optional[str] = None
    game_id: Optional[str] = None

    source_content: str = ""
    translated_content: str = ""

    structured: bool = False
    entries: List[OutputEditorEntryResponse] = []

    metadata: OutputEditorMetadataResponse


class SaveTranslatedContentRequest(BaseModel):
    """Request to save edited translated content."""

    translated_content: str
    expected_updated_at: Optional[str] = None


class SaveTranslatedContentResponse(BaseModel):
    """Response after saving edited translated content."""

    success: bool = True
    updated_at: str = ""
    translated_size_bytes: int = 0
    status: str = "ready"
    analysis_stale: bool = True


class FileContentsResponse(BaseModel):
    """Response with source and translated file contents (read-only)."""

    source_path: str = ""
    translated_path: str = ""
    source_content: str = ""
    translated_content: str = ""
    source_exists: bool = False
    translated_exists: bool = False
