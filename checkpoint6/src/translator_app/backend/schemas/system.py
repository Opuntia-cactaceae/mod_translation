"""System/Filesystem API schemas."""

from typing import List, Optional

from pydantic import BaseModel


class PathInfoRequest(BaseModel):
    path: str


class PathInfoResponse(BaseModel):
    path: str
    exists: bool
    is_file: bool = False
    is_directory: bool = False
    can_read: bool = False
    can_write: bool = False
    parent: Optional[str] = None
    name: str = ""


class DirectoryItem(BaseModel):
    name: str
    path: str
    type: str  # "file" or "directory"
    size_bytes: Optional[int] = None
    modified_at: Optional[str] = None


class ListDirectoryRequest(BaseModel):
    path: str
    mode: str = "both"  # "files" | "directories" | "both"
    extensions: Optional[List[str]] = None
    show_hidden: bool = False


class ListDirectoryResponse(BaseModel):
    path: str
    parent: Optional[str] = None
    items: List[DirectoryItem] = []
    diagnostics: List[str] = []


class HomeResponse(BaseModel):
    home: str


class RevealPathRequest(BaseModel):
    path: str


class RevealPathResponse(BaseModel):
    success: bool
    message: str = ""
