"""Pydantic schemas for games options API."""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class FileHandlerOptionSchema(BaseModel):
    """Metadata for a single file handler."""

    id: str
    label: str
    extensions: List[str]
    description: str


class GameOptionSchema(BaseModel):
    """Metadata for a single game adapter.

    Both ``features`` (canonical capability dict) and legacy ``supports_*``
    fields are serialised for backward compatibility.
    """

    id: str
    label: str
    vendor: Optional[str] = None
    features: Dict[str, bool] = Field(default_factory=dict)
    supports_mod_discovery: bool = False
    supports_descriptors: bool = False
    supports_install: bool = False
    file_handlers: List[str]


class GamesOptionsResponse(BaseModel):
    """Response for GET /api/games/options."""

    games: List[GameOptionSchema]
    file_handlers: List[FileHandlerOptionSchema]
