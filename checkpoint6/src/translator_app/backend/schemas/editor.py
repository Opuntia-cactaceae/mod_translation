"""Editor-related Pydantic schemas."""

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class EditorRowSchema(BaseModel):
    row_id: str
    line_no: int
    entry_type: str
    key: str
    source_text: str
    translated_text: Optional[str] = None
    status: str = "untranslated"
    warnings: list = []
    errors: list = []
    raw_line: str = ""
    editable: bool = True


class EditorStatsSchema(BaseModel):
    total_rows: int = 0
    translated_rows: int = 0
    edited_rows: int = 0
    warnings_count: int = 0
    errors_count: int = 0


class EditorDataResponse(BaseModel):
    file_id: str
    source_path: str = ""
    rows: List[EditorRowSchema] = []
    stats: Optional[EditorStatsSchema] = None


class EditorFileResponse(BaseModel):
    file_id: str
    content: str = ""
    entries: list = []
    language: str = "english"
    rows: List[EditorRowSchema] = []
    stats: Optional[EditorStatsSchema] = None


class UpdateEntryRequest(BaseModel):
    translated: str


class UpdateEntryResponse(BaseModel):
    success: bool
    entry_id: str
    row: Optional[EditorRowSchema] = None


class SaveFileRequest(BaseModel):
    output_path: str = ""
    overwrite: bool = False
    backup: bool = True


class SaveFileResponse(BaseModel):
    success: bool
    file_id: str
    output_path: str = ""
    message: str = ""
    validation: Optional[Dict[str, Any]] = None


class BulkEditEntry(BaseModel):
    row_id: str
    translated_text: str


class BulkEditRequest(BaseModel):
    changes: List[BulkEditEntry]


class BulkEditResponse(BaseModel):
    success: bool
    updated_count: int = 0
    rows: List[EditorRowSchema] = []
