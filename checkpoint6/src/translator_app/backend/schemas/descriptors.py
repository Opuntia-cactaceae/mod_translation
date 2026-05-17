"""Pydantic schemas for the Descriptor Module API (spec #13)."""

from typing import Dict, List, Optional

from pydantic import BaseModel


class DescriptorReadResponse(BaseModel):
    """Response for reading a descriptor file."""
    name: str = ""
    path: str = ""
    supported_version: str = ""
    tags: List[str] = []
    picture: str = ""
    remote_file_id: str = ""
    raw_fields: Dict[str, str] = {}
    source_path: Optional[str] = None
    descriptor_text: str = ""
    warnings: List[str] = []
    errors: List[str] = []


class DescriptorPreviewRequest(BaseModel):
    """Request to preview a descriptor before writing."""
    mod_path: str
    target_mods_dir: str
    name: Optional[str] = None
    supported_version: Optional[str] = None
    tags: Optional[List[str]] = None
    picture: Optional[str] = None
    remote_file_id: Optional[str] = None


class DescriptorPreviewResponse(BaseModel):
    """Response with preview descriptor text."""
    descriptor_text: str
    descriptor_path: str
    warnings: List[str] = []
    errors: List[str] = []


class DescriptorWriteRequest(BaseModel):
    """Request to create a descriptor file on disk."""
    mod_path: str
    target_mods_dir: str
    name: Optional[str] = None
    supported_version: Optional[str] = None
    tags: Optional[List[str]] = None
    picture: Optional[str] = None
    remote_file_id: Optional[str] = None


class DescriptorWriteResponse(BaseModel):
    """Response after writing a descriptor file."""
    descriptor_path: str
    descriptor_text: str
    created: bool
    warnings: List[str] = []
    errors: List[str] = []


class DescriptorValidateRequest(BaseModel):
    """Request to validate a descriptor."""
    descriptor_path: str
    mod_path: Optional[str] = None
    target_mods_dir: Optional[str] = None


class DescriptorValidateResponse(BaseModel):
    """Response with validation results."""
    is_valid: bool
    warnings: List[str] = []
    errors: List[str] = []
