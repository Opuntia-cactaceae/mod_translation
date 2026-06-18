"""API endpoints for opening source/translated folders via the OS file manager.

All operations are keyed by ``output_file_id`` only — the frontend never
sends raw filesystem paths.  Subprocess logic lives in
``FileOpenService``, not in this router.
"""

import logging

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError
from translator_app.backend.schemas.output_open_folder import OpenFolderResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["output-open-folder"])


@router.post(
    "/output-files/{output_file_id}/open-source-folder",
    response_model=OpenFolderResponse,
)
def open_source_folder(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Open the parent directory of the source file in the OS file manager.

    The frontend must never send raw filesystem paths — only
    ``output_file_id`` is accepted.
    """
    svcs.file_open_service.open_source_folder(output_file_id)
    return OpenFolderResponse(
        success=True,
        message="Source folder opened",
    )


@router.post(
    "/output-files/{output_file_id}/open-translated-folder",
    response_model=OpenFolderResponse,
)
def open_translated_folder(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Open the parent directory of the translated file in the OS file manager.

    The frontend must never send raw filesystem paths — only
    ``output_file_id`` is accepted.
    """
    svcs.file_open_service.open_translated_folder(output_file_id)
    return OpenFolderResponse(
        success=True,
        message="Translated folder opened",
    )
