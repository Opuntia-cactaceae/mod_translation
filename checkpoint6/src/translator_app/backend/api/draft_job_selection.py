"""Draft Job Selection API endpoints.

Provides a backend-backed source of truth for the "add files to
translation job" flow.  The frontend reads and mutates the draft
exclusively through these endpoints — no localStorage.

State
-----
The draft is an in-memory collection of file paths with per-file
metadata (mod_id, mod_name).  A backend restart clears it, which
is acceptable — the draft is short-lived selection state, not a
persistent entity.

Endpoints
---------
- ``GET    /api/draft-job-selection``    — read current state
- ``POST   /api/draft-job-selection/files``  — add files
- ``DELETE /api/draft-job-selection/files``  — remove files
- ``PUT    /api/draft-job-selection``    — replace all (sync from form)
- ``DELETE /api/draft-job-selection``    — clear all
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services

logger = logging.getLogger(__name__)

router = APIRouter(tags=["draft-job-selection"])


# ------------------------------------------------------------------ #
#  Schemas                                                           #
# ------------------------------------------------------------------ #

from pydantic import BaseModel


class DraftJobStateResponse(BaseModel):
    """Full draft job selection state."""
    files: List[str]
    file_metadata: Dict[str, Dict[str, Any]]
    count: int


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


# ------------------------------------------------------------------ #
#  Handlers                                                          #
# ------------------------------------------------------------------ #


@router.get("/api/draft-job-selection", response_model=DraftJobStateResponse)
def get_draft_job_selection(svcs: Services = Depends(get_services)):
    """Read the current draft job selection state."""
    draft = svcs.draft_selection
    return DraftJobStateResponse(
        files=draft.files,
        file_metadata=draft.file_metadata,
        count=draft.count,
    )


@router.post(
    "/api/draft-job-selection/files",
    response_model=DraftJobStateResponse,
    status_code=200,
)
def add_draft_files(
    body: AddFilesRequest,
    svcs: Services = Depends(get_services),
):
    """Add files to the draft selection.

    Deduplicates by canonical path.  If *metadata* is provided it is
    associated with every file in this request.
    """
    draft = svcs.draft_selection
    draft.add_files(body.file_paths, metadata=body.metadata)
    return DraftJobStateResponse(
        files=draft.files,
        file_metadata=draft.file_metadata,
        count=draft.count,
    )


@router.delete(
    "/api/draft-job-selection/files",
    response_model=DraftJobStateResponse,
)
def remove_draft_files(
    body: RemoveFilesRequest,
    svcs: Services = Depends(get_services),
):
    """Remove files from the draft selection."""
    draft = svcs.draft_selection
    draft.remove_files(body.file_paths)
    return DraftJobStateResponse(
        files=draft.files,
        file_metadata=draft.file_metadata,
        count=draft.count,
    )


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
    return DraftJobStateResponse(
        files=draft.files,
        file_metadata=draft.file_metadata,
        count=draft.count,
    )


@router.delete(
    "/api/draft-job-selection",
    response_model=DraftJobStateResponse,
)
def clear_draft_job_selection(svcs: Services = Depends(get_services)):
    """Clear all files and metadata from the draft."""
    draft = svcs.draft_selection
    draft.clear()
    return DraftJobStateResponse(
        files=draft.files,
        file_metadata=draft.file_metadata,
        count=draft.count,
    )
