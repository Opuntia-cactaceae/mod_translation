"""Translation Plan API endpoints.

POST /api/translation-plan/preview — preview a translation plan
without executing any translations.
"""

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.schemas.translation_plan import (
    TranslationPlanPreviewRequest,
    TranslationPlanPreviewResponse,
)
from translator_app.translation.config import TranslationConfig, TranslationConfigBuilder
from translator_app.translation.task_planner import TaskPlanner
from translator_app.translation.preflight import build_preflight_report

router = APIRouter(prefix="/api/translation-plan", tags=["translation-plan"])


@router.post("/preview", response_model=TranslationPlanPreviewResponse)
def preview_translation_plan(
    body: TranslationPlanPreviewRequest,
    svcs: Services = Depends(get_services),
):
    """Preview a translation plan: parse files, check cache, group into
    batches, and return stats — without executing any translations."""
    # Build config from request or use defaults
    if body.config:
        builder = TranslationConfigBuilder(
            settings_service=svcs.settings,
            secrets_service=svcs.secrets,
            prompt_preset_registry=svcs.prompt_presets,
        )
        config = builder.build_config(ui_config=body.config)
    else:
        config = TranslationConfig()

    # Build planner with services
    planner = TaskPlanner(
        config=config,
        file_service=svcs.file_processing,
        cache=svcs.cache if config.use_cache else None,
    )

    plan = planner.build_plan(file_paths=body.file_paths)

    # --- Preflight diagnostics ---
    preflight = build_preflight_report(
        file_paths=body.file_paths,
        config=config,
        planner=planner,
        file_service=svcs.file_processing,
    )

    return TranslationPlanPreviewResponse(
        total_units=plan.total_units,
        total_tasks=plan.total_tasks,
        batch_size=plan.batch_size,
        cache_hits=plan.cache_hits,
        cache_misses=plan.cache_misses,
        diagnostics=[
            {
                "level": d.level.value if hasattr(d.level, "value") else str(d.level),
                "code": d.code,
                "message": d.message,
                "file_path": d.file_path,
            }
            for d in plan.diagnostics
        ],
        # Preflight fields
        warnings=preflight["warnings"],
        errors=preflight["errors"],
        unsupported_files=preflight["unsupported_files"],
        duplicate_files=preflight["duplicate_files"],
        empty_files=preflight["empty_files"],
        zero_unit_files=preflight["zero_unit_files"],
        detected_languages=preflight["detected_languages"],
        has_blocking_errors=preflight["has_blocking_errors"],
    )
