"""API endpoints for the translated output file editor."""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, NOT_FOUND, SAVE_FAILED
from translator_app.backend.schemas.output_editor import (
    FileContentsResponse,
    OutputFileEditorPayloadResponse,
    SaveTranslatedContentRequest,
    SaveTranslatedContentResponse,
)
from translator_app.outputs.editor_service import EditorServiceError

router = APIRouter(tags=["output-editor"])


def _handle_editor_error(exc: EditorServiceError) -> APIError:
    """Convert an ``EditorServiceError`` to an ``APIError``."""
    return APIError(
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
    )


@router.get(
    "/output-files/{output_file_id}/editor-payload",
    response_model=OutputFileEditorPayloadResponse,
)
def get_output_editor_payload(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Get the full editor payload for a translated output file.

    Returns source + translated content, parser entries (if structured
    parsing is supported), and file metadata — all keyed by
    ``output_file_id``.
    """
    try:
        payload = svcs.output_editor.get_editor_payload(output_file_id)
    except EditorServiceError as exc:
        raise _handle_editor_error(exc)
    except Exception as exc:
        raise APIError(
            code="EDITOR_LOAD_FAILED",
            message=f"Failed to load editor payload: {exc}",
            status_code=500,
        ) from exc

    return OutputFileEditorPayloadResponse(**payload)


@router.put(
    "/output-files/{output_file_id}/translated-content",
    response_model=SaveTranslatedContentResponse,
)
def save_output_translated_content(
    output_file_id: str,
    body: SaveTranslatedContentRequest,
    svcs: Services = Depends(get_services),
):
    """Save edited translated content to disk.

    The backend resolves the translated file path from
    ``output_file_id`` — the frontend never sends raw file paths.
    """
    try:
        result = svcs.output_editor.save_translated_content(
            output_file_id=output_file_id,
            translated_content=body.translated_content,
            expected_updated_at=body.expected_updated_at,
        )
    except EditorServiceError as exc:
        raise _handle_editor_error(exc)
    except Exception as exc:
        raise APIError(
            code=SAVE_FAILED,
            message=f"Failed to save translated content: {exc}",
            status_code=500,
        ) from exc

    return SaveTranslatedContentResponse(**result)


@router.get(
    "/output-files/{output_file_id}/file-contents",
    response_model=FileContentsResponse,
)
def get_file_contents(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Read source and translated file contents from disk (read-only).

    Returns the raw file contents with existence flags.
    Never writes, never uses the serializer, never mutates state.
    """
    try:
        output_file = svcs.output_files_repo.get_by_id(output_file_id)
    except Exception as exc:
        raise APIError(
            code="FILE_CONTENTS_LOAD_FAILED",
            message=f"Failed to load file: {exc}",
            status_code=500,
        ) from exc

    if not output_file:
        raise APIError(
            code="NOT_FOUND",
            message=f"Output file not found: {output_file_id}",
            status_code=404,
        )

    source_path = output_file.source_file_path
    translated_path = output_file.translated_file_path

    source_exists = Path(source_path).exists()
    translated_exists = Path(translated_path).exists()

    source_content = ""
    translated_content = ""

    if source_exists:
        try:
            source_content = Path(source_path).read_text(encoding="utf-8")
        except (OSError, RuntimeError):
            pass

    if translated_exists:
        try:
            translated_content = Path(translated_path).read_text(encoding="utf-8")
        except (OSError, RuntimeError):
            pass

    return FileContentsResponse(
        source_path=source_path,
        translated_path=translated_path,
        source_content=source_content,
        translated_content=translated_content,
        source_exists=source_exists,
        translated_exists=translated_exists,
    )
