"""File-related Pydantic schemas."""

from pydantic import BaseModel
from typing import Optional


class FileInfo(BaseModel):
    path: str
    name: str
    detected_type: str = "unknown"
    size: int = 0
    translatable_entries: int = 0


class FileListResponse(BaseModel):
    files: list[FileInfo] = []


class FileListRequest(BaseModel):
    directory: str = "."


class FileReadRequest(BaseModel):
    path: str


class FileReadResponse(BaseModel):
    content: str
    path: str
    size: int


class PreviewOutputPathRequest(BaseModel):
    original_path: str
    output_dir: Optional[str] = None
    suffix: str = "_translated"


class PreviewOutputPathResponse(BaseModel):
    output_path: str


class FindLocalisationRequest(BaseModel):
    root_paths: list[str]


class LocalisationFileInfo(BaseModel):
    path: str
    file_type: str = "unknown"
    language: str = ""
    translatable_entries: int = 0


class FindLocalisationResponse(BaseModel):
    files: list[LocalisationFileInfo] = []
    diagnostics: list[str] = []
