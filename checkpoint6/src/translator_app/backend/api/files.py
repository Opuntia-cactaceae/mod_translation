"""Files API endpoints."""

import os
from fastapi import APIRouter, Depends

from translator_app.backend.path_utils import canonicalize_path, expand_user_path
from translator_app.backend.schemas.files import (
    FileInfo,
    FileListResponse,
    FileListRequest,
    FileReadRequest,
    FileReadResponse,
    PreviewOutputPathRequest,
    PreviewOutputPathResponse,
    FindLocalisationRequest,
    FindLocalisationResponse,
    LocalisationFileInfo,
)
from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import (
    APIError,
    FILE_NOT_FOUND,
    PATH_NOT_FOUND,
    FILE_READ_FAILED,
)
from translator_app.file_processing.models.file_type import FileCategory

router = APIRouter(tags=["files"])


@router.post("/list", response_model=FileListResponse)
def list_files(body: FileListRequest, svcs: Services = Depends(get_services)):
    """List files in a directory."""
    directory = str(expand_user_path(body.directory))
    if not os.path.isdir(directory):
        raise APIError(
            code=PATH_NOT_FOUND,
            message=f"Directory not found: {directory}",
            status_code=404,
        )

    files = []
    for entry in os.scandir(directory):
        if entry.is_file():
            canonical = canonicalize_path(entry.path)
            detection = svcs.file_processing.detect(canonical)
            files.append(FileInfo(
                path=canonical,
                name=entry.name,
                detected_type=detection.file_type.category.value,
                size=entry.stat().st_size,
            ))
    return FileListResponse(files=files)


@router.post("/read", response_model=FileReadResponse)
def read_file(body: FileReadRequest):
    """Read a text file."""
    path = str(expand_user_path(body.path))
    if not os.path.exists(path):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {path}",
            status_code=404,
        )
    if not os.path.isfile(path):
        raise APIError(
            code=FILE_READ_FAILED,
            message=f"Not a file: {path}",
            status_code=400,
        )

    # Try reading as text, reject binary files
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        size = len(content.encode("utf-8"))
    except UnicodeDecodeError:
        raise APIError(
            code=FILE_READ_FAILED,
            message=f"Cannot read as text file (binary): {path}",
            recoverable=False,
        )
    except Exception as e:
        raise APIError(
            code=FILE_READ_FAILED,
            message=f"Failed to read file: {e}",
            status_code=500,
        )

    return FileReadResponse(content=content, path=path, size=size)


@router.post("/preview-output-path", response_model=PreviewOutputPathResponse)
def preview_output_path(body: PreviewOutputPathRequest, svcs: Services = Depends(get_services)):
    """Preview the output path for a translated file."""
    naming = svcs.output_naming
    # Use preview_path for full naming result
    from translator_app.output.models import OutputNamingOptions
    options = OutputNamingOptions(
        suffix=body.suffix if body.suffix != "_translated" else None,
    )
    result = naming.preview_path(
        source_path=body.original_path,
        output_dir=body.output_dir,
        options=options,
    )
    return PreviewOutputPathResponse(output_path=result.output_path)


@router.post("/find-localisation", response_model=FindLocalisationResponse)
def find_localisation(body: FindLocalisationRequest, svcs: Services = Depends(get_services)):
    """Recursively search directories for Stellaris localisation files.

    Scans each root_path for .yml/.yaml files, runs file detection,
    and for supported stellaris_localisation files parses and counts
    translatable entries.
    """
    found_files: list[LocalisationFileInfo] = []
    diagnostics: list[str] = []

    for root_path in body.root_paths:
        root_path = str(expand_user_path(root_path))
        root_canonical = canonicalize_path(root_path)
        if not os.path.isdir(root_canonical):
            diagnostics.append(f"Path not found or not a directory: {root_path}")
            continue

        for dirpath, _dirnames, filenames in os.walk(root_canonical):
            for filename in filenames:
                if not filename.lower().endswith(('.yml', '.yaml')):
                    continue
                full_path = os.path.join(dirpath, filename)
                full_canonical = canonicalize_path(full_path)

                try:
                    detection = svcs.file_processing.detect_file(full_canonical)
                    is_localisation = (
                        detection.file_type.category == FileCategory.STELLARIS_LOCALISATION
                        and detection.detected_language != ""
                    )
                    if not is_localisation:
                        continue

                    translatable_count = 0
                    if detection.supported:
                        try:
                            parsed = svcs.file_processing.parse_file(full_canonical)
                            translatable_count = len(parsed.translatable_entries)
                        except Exception as e:
                            diagnostics.append(
                                f"Parse warning for {full_canonical}: {e}"
                            )

                    found_files.append(LocalisationFileInfo(
                        path=full_canonical,
                        file_type="stellaris_localisation",
                        language=detection.detected_language or "",
                        translatable_entries=translatable_count,
                    ))
                except Exception as e:
                    diagnostics.append(
                        f"Error processing {full_canonical}: {e}"
                    )

    return FindLocalisationResponse(files=found_files, diagnostics=diagnostics)


# Backward-compatible function exports
list_files_handler = list_files
get_file_info_handler = lambda file_path="": FileInfo(path=file_path, name=os.path.basename(file_path))
