"""Schemas for the output-file open-folder endpoints."""

from pydantic import BaseModel


class OpenFolderResponse(BaseModel):
    """Response from opening a source/translated folder."""

    success: bool = True
    message: str = ""
