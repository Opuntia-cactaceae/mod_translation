"""Draft Job Selection API endpoints.

Provides a backend-backed source of truth for the "add files to
translation job" flow with hierarchical grouping, diagnostics, and
persistence across server restarts.

Endpoints
---------
- ``GET    /api/draft-job-selection``           — read current state (incl. grouped)
- ``PUT    /api/draft-job-selection/files``      — replace from raw textarea
- ``POST   /api/draft-job-selection/files``      — add file paths
- ``DELETE /api/draft-job-selection/files``      — remove file paths
- ``PUT    /api/draft-job-selection``            — replace all (legacy form sync)
- ``DELETE /api/draft-job-selection``            — clear all
- ``POST   /api/draft-job-selection/clear``      — POST variant of clear
- ``POST   /api/draft-job-selection/mods``       — add mod localisation files
- ``POST   /api/draft-job-selection/search``     — search localisation files
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, INVALID_REQUEST

logger = logging.getLogger(__name__)

router = APIRouter(tags=["draft-job-selection"])


# ------------------------------------------------------------------ #
#  Schemas                                                           #
# ------------------------------------------------------------------ #


class DraftSelectionFile(BaseModel):
    """A single file entry within a draft selection group."""
    path: str
    name: str
    relative_path: Optional[str] = None
    parent_folder: Optional[str] = None
    source: Optional[str] = None  # "mod" | "search" | "manual" | "raw"
    mod_id: Optional[str] = None
    mod_name: Optional[str] = None
    handler: Optional[str] = None
    exists: bool = False
    selected: bool = True


class DraftSelectionGroup(BaseModel):
    """A group of draft selection files (by mod or folder)."""
    group_type: str  # "mod" | "folder"
    group_id: str
    title: str
    subtitle: Optional[str] = None
    files: Optional[List[DraftSelectionFile]] = None
    children: Optional[List["DraftSelectionGroup"]] = None


# Resolve forward reference for self-referencing model
DraftSelectionGroup.model_rebuild()


class DraftJobStateResponse(BaseModel):
    """Full draft job selection state with grouped view and diagnostics."""
    files: List[str] = []
    file_metadata: Dict[str, Dict[str, Any]] = {}
    grouped: List[DraftSelectionGroup] = []
    diagnostics: List[Dict[str, Any]] = []
    count: int = 0
    updated_at: Optional[str] = None


class AddFilesRequest(BaseModel):
    """Add files to the draft."""
    file_paths: List[str]
    metadata: Optional[Dict[str, Any]] = None


class RemoveFilesRequest(BaseModel):
    """Remove files from the draft."""
    file_paths: List[str]


class SetFilesRequest(BaseModel):
    """Replace the entire draft file list."""
    files: List[str]
    file_metadata: Optional[Dict[str, Dict[str, Any]]] = None


class SetFilesFromRawRequest(BaseModel):
    """Full replacement from raw textarea."""
    paths_text: str
    source: str = "raw"


class AddModFilesRequest(BaseModel):
    """Add localisation files from mods."""
    mod_ids: List[str] = []
    mod_paths: List[str] = []
    handler: str = "stellaris_localisation"
    language: str = "english"


class SearchFilesRequest(BaseModel):
    """Search for localisation files."""
    roots: List[str]
    handler: str = "stellaris_localisation"
    language: str = "english"
    add: bool = False


# ------------------------------------------------------------------ #
#  Helpers                                                           #
# ------------------------------------------------------------------ #


def _build_response(draft) -> DraftJobStateResponse:
    """Build a full response from the current draft state."""
    state = draft.get_full_state()
    return DraftJobStateResponse(**state)


# ------------------------------------------------------------------ #
#  Handlers                                                          #
# ------------------------------------------------------------------ #


@router.get("/api/draft-job-selection", response_model=DraftJobStateResponse)
def get_draft_job_selection(svcs: Services = Depends(get_services)):
    """Read the current draft job selection state (full: grouped, diagnostics)."""
    return _build_response(svcs.draft_selection)


@router.put(
    "/api/draft-job-selection/files",
    response_model=DraftJobStateResponse,
)
def set_draft_files_from_raw(
    body: SetFilesFromRawRequest,
    svcs: Services = Depends(get_services),
):
    """Full replacement from raw textarea.

    Parses multi-line text, normalises paths, deduplicates, and
    preserves metadata for paths that survive.
    """
    draft = svcs.draft_selection
    draft.add_files_from_raw_text(body.paths_text, source=body.source)
    return _build_response(draft)


@router.post(
    "/api/draft-job-selection/files",
    response_model=DraftJobStateResponse,
    status_code=200,
)
def add_draft_files(
    body: AddFilesRequest,
    svcs: Services = Depends(get_services),
):
    """Add file paths to the draft (does not reset existing)."""
    draft = svcs.draft_selection
    draft.add_files(body.file_paths, metadata=body.metadata)
    return _build_response(draft)


@router.delete(
    "/api/draft-job-selection/files",
    response_model=DraftJobStateResponse,
)
def remove_draft_files(
    body: RemoveFilesRequest,
    svcs: Services = Depends(get_services),
):
    """Remove file paths from the draft."""
    draft = svcs.draft_selection
    draft.remove_files(body.file_paths)
    return _build_response(draft)


@router.put(
    "/api/draft-job-selection",
    response_model=DraftJobStateResponse,
)
def set_draft_job_selection(
    body: SetFilesRequest,
    svcs: Services = Depends(get_services),
):
    """Replace the entire draft file list atomically.

    Used when the user edits the file paths textarea in the Create Job
    form.  Metadata for files that still exist is preserved.
    """
    draft = svcs.draft_selection
    draft.set_files(body.files, file_metadata=body.file_metadata)
    return _build_response(draft)


@router.delete(
    "/api/draft-job-selection",
    response_model=DraftJobStateResponse,
)
def clear_draft_job_selection(svcs: Services = Depends(get_services)):
    """Clear all files and metadata from the draft."""
    draft = svcs.draft_selection
    draft.clear()
    return _build_response(draft)


@router.post(
    "/api/draft-job-selection/clear",
    response_model=DraftJobStateResponse,
)
def clear_draft_job_selection_post(svcs: Services = Depends(get_services)):
    """POST variant of clear for frontends that prefer POST over DELETE."""
    draft = svcs.draft_selection
    draft.clear()
    return _build_response(draft)


@router.post(
    "/api/draft-job-selection/mods",
    response_model=DraftJobStateResponse,
)
def add_draft_files_from_mods(
    body: AddModFilesRequest,
    svcs: Services = Depends(get_services),
):
    """Add localisation files from one or more mods to the draft.

    Does not reset the current draft selection — merges with existing files.
    Uses the ``mod_discovery`` service to resolve mod IDs to file paths.
    """
    draft = svcs.draft_selection
    _added, diagnostics = draft.add_files_from_mods(
        mod_ids=body.mod_ids,
        mod_paths=body.mod_paths,
        handler=body.handler,
        language=body.language,
    )
    state = _build_response(draft)
    # Merge any mod-resolution diagnostics into the response
    if diagnostics:
        state.diagnostics.extend(diagnostics)
    return state


@router.post(
    "/api/draft-job-selection/search",
    response_model=DraftJobStateResponse,
)
def search_and_add_draft_files(
    body: SearchFilesRequest,
    svcs: Services = Depends(get_services),
):
    """Search for localisation files and optionally add to the draft.

    When ``add`` is ``True``, found files are added to the draft.
    When ``add`` is ``False``, only a preview (grouped view) is returned.
    """
    draft = svcs.draft_selection
    _found, diagnostics = draft.search_and_add_files(
        roots=body.roots,
        handler=body.handler,
        language=body.language,
        add=body.add,
    )
    state = _build_response(draft)
    if diagnostics:
        state.diagnostics.extend(diagnostics)
    return state
