"""Editor API endpoints."""

from fastapi import APIRouter, Depends

from translator_app.backend.schemas.editor import (
    EditorDataResponse,
    EditorFileResponse,
    EditorRowSchema,
    EditorStatsSchema,
    UpdateEntryRequest,
    UpdateEntryResponse,
    SaveFileRequest,
    SaveFileResponse,
    BulkEditRequest,
    BulkEditResponse,
)
from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import (
    APIError,
    NOT_IMPLEMENTED,
    FILE_NOT_FOUND,
    ROW_NOT_FOUND,
    INVALID_EDIT,
    SAVE_FAILED,
)

router = APIRouter(tags=["editor"])


@router.get("/files/{file_id:path}", response_model=EditorFileResponse)
def get_editor_file(file_id: str, svcs: Services = Depends(get_services)):
    """Open a file in the editor and return structured editor data."""
    import os
    if not os.path.exists(file_id):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_id}",
            status_code=404,
        )

    svcs.editor.open_file(file_id)

    try:
        editor_data = svcs.editor.get_editor_data(file_id=file_id, path=file_id)
    except Exception as e:
        raise APIError(
            code=NOT_IMPLEMENTED,
            message=f"Cannot load editor data: {e}",
            status_code=501,
        )

    # Build legacy entries list for backward compatibility
    entries = []
    for row in editor_data.rows:
        entries.append({
            "key": row.key,
            "value": row.source_text,
            "line_number": row.line_no,
            "is_translatable": row.editable,
            "translated": row.translated_text,
            "entry_type": row.entry_type,
            "status": row.status,
        })

    # Extract language from source (best-effort)
    language = "english"
    try:
        parsed = svcs.file_processing.parse(file_id)
        if parsed.header:
            language = parsed.header.replace(":", "").strip()
    except Exception:
        pass

    rows = [
        EditorRowSchema(
            row_id=r.row_id,
            line_no=r.line_no,
            entry_type=r.entry_type,
            key=r.key,
            source_text=r.source_text,
            translated_text=r.translated_text,
            status=r.status,
            warnings=[_diag_to_dict(w) for w in r.warnings],
            errors=[_diag_to_dict(e) for e in r.errors],
            raw_line=r.raw_line,
            editable=r.editable,
        )
        for r in editor_data.rows
    ]

    stats = EditorStatsSchema(
        total_rows=editor_data.stats.total_rows if editor_data.stats else 0,
        translated_rows=editor_data.stats.translated_rows if editor_data.stats else 0,
        edited_rows=editor_data.stats.edited_rows if editor_data.stats else 0,
        warnings_count=editor_data.stats.warnings_count if editor_data.stats else 0,
        errors_count=editor_data.stats.errors_count if editor_data.stats else 0,
    ) if editor_data.stats else None

    return EditorFileResponse(
        file_id=file_id,
        content="",
        entries=entries,
        language=language,
        rows=rows,
        stats=stats,
    )


@router.put("/files/{file_id:path}/entries/{entry_id}", response_model=UpdateEntryResponse)
def update_entry(file_id: str, entry_id: str, body: UpdateEntryRequest, svcs: Services = Depends(get_services)):
    """Update a translation entry."""
    import os
    if not os.path.exists(file_id):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_id}",
            status_code=404,
        )

    try:
        row = svcs.editor.update_entry(
            file_id=file_id,
            entry_id=entry_id,
            translated_text=body.translated,
        )
    except ValueError as e:
        code = ROW_NOT_FOUND if "Row not found" in str(e) else INVALID_EDIT
        status = 404 if code == ROW_NOT_FOUND else 400
        raise APIError(
            code=code,
            message=str(e),
            status_code=status,
        )

    return UpdateEntryResponse(
        success=True,
        entry_id=entry_id,
        row=EditorRowSchema(
            row_id=row.row_id,
            line_no=row.line_no,
            entry_type=row.entry_type,
            key=row.key,
            source_text=row.source_text,
            translated_text=row.translated_text,
            status=row.status,
            warnings=[_diag_to_dict(w) for w in row.warnings],
            errors=[_diag_to_dict(e) for e in row.errors],
            raw_line=row.raw_line,
            editable=row.editable,
        ),
    )


@router.post("/files/{file_id:path}/entries/bulk", response_model=BulkEditResponse)
def bulk_update_entries(file_id: str, body: BulkEditRequest, svcs: Services = Depends(get_services)):
    """Bulk update translation entries."""
    import os
    if not os.path.exists(file_id):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_id}",
            status_code=404,
        )

    changes = [{"row_id": c.row_id, "translated_text": c.translated_text} for c in body.changes]
    try:
        rows = svcs.editor.bulk_update(file_id=file_id, changes=changes)
    except ValueError as e:
        raise APIError(
            code=INVALID_EDIT,
            message=str(e),
            status_code=400,
        )

    return BulkEditResponse(
        success=True,
        updated_count=len(rows),
        rows=[
            EditorRowSchema(
                row_id=r.row_id,
                line_no=r.line_no,
                entry_type=r.entry_type,
                key=r.key,
                source_text=r.source_text,
                translated_text=r.translated_text,
                status=r.status,
                warnings=[_diag_to_dict(w) for w in r.warnings],
                errors=[_diag_to_dict(e) for e in r.errors],
                raw_line=r.raw_line,
                editable=r.editable,
            )
            for r in rows
        ],
    )


@router.post("/files/{file_id:path}/save", response_model=SaveFileResponse)
def save_editor_file(file_id: str, body: SaveFileRequest = None, svcs: Services = Depends(get_services)):
    """Save editor changes to file."""
    import os
    if not os.path.exists(file_id):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_id}",
            status_code=404,
        )

    if body is None:
        body = SaveFileRequest()

    # If no explicit output_path, use naming service to generate one
    naming_result = None
    if not body.output_path and svcs.editor._output_naming:
        from translator_app.output.models import OutputNamingOptions
        options = OutputNamingOptions(
            overwrite=body.overwrite,
            backup=body.backup,
        )
        naming_result = svcs.editor._output_naming.generate_name(
            source_path=file_id,
            dst_lang="ru",
            options=options,
        )
        output_path = naming_result.output_path
    else:
        output_path = body.output_path or file_id

    try:
        saved_path = svcs.editor.save_file(
            file_id=file_id,
            output_path=output_path,
            overwrite=body.overwrite,
            backup=body.backup,
            naming_result=naming_result,
        )
    except FileExistsError as e:
        raise APIError(
            code=SAVE_FAILED,
            message=str(e),
            status_code=409,
        )
    except RuntimeError as e:
        raise APIError(
            code=SAVE_FAILED,
            message=str(e),
            status_code=500,
        )
    except Exception as e:
        raise APIError(
            code=SAVE_FAILED,
            message=f"Save failed: {e}",
            status_code=500,
        )

    # Validate after save
    validation = svcs.editor.validate_before_save(file_id)

    return SaveFileResponse(
        success=True,
        file_id=file_id,
        output_path=saved_path,
        message=f"File saved to {saved_path}",
        validation=validation,
    )


@router.post("/files/{file_id:path}/validate", response_model=dict)
def validate_editor_file(file_id: str, svcs: Services = Depends(get_services)):
    """Validate editor changes before saving."""
    import os
    if not os.path.exists(file_id):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_id}",
            status_code=404,
        )

    validation = svcs.editor.validate_before_save(file_id)
    return validation


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _diag_to_dict(d):
    """Convert a diagnostic object to a dict for JSON serialization."""
    if isinstance(d, dict):
        return d
    return {
        "level": getattr(d, "level", ""),
        "message": getattr(d, "message", ""),
        "code": getattr(d, "code", ""),
    }
