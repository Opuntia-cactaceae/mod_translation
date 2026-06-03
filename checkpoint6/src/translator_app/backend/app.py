"""Application factory for the Local Backend API."""

from contextlib import asynccontextmanager
import logging
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from translator_app.backend.errors import (
    APIError,
    api_error_handler,
    http_exception_handler,
    generic_exception_handler,
)
from translator_app.backend.deps import get_services
from translator_app.jobs.recovery import recover_interrupted_jobs


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator:
    """Startup / shutdown lifecycle handler."""
    # --- startup ---
    svcs = get_services()
    recovered = recover_interrupted_jobs(
        job_manager=svcs.jobs,
        trace_service=svcs.trace,
    )
    if recovered:
        logger.info(
            "Recovered %d interrupted running job(s) on startup", recovered
        )

    # Start the output analysis worker
    svcs.analysis_worker.start()
    requeued = svcs.analysis_worker.requeue_existing()
    if requeued:
        logger.info(
            "Re-queued %d analysis job(s) on startup", requeued
        )

    yield
    # --- shutdown ---
    svcs.analysis_worker.stop()


logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Wire httpx logger to the in-memory raw log collector so that raw HTTP
# request/response/retry lines (e.g. "HTTP Request: POST …", "Retrying …")
# are captured per-job without persistence.
# ---------------------------------------------------------------------------
from translator_app.translation.runtime_raw_log import get_collector, RuntimeRawLogHandler

httpx_logger = logging.getLogger("httpx")
handler = RuntimeRawLogHandler(get_collector())
handler.setLevel(logging.INFO)
httpx_logger.addHandler(handler)
httpx_logger.setLevel(logging.INFO)
logger.info("httpx logger wired to RuntimeRawLogHandler")

from translator_app.backend.api.health import router as health_router
from translator_app.backend.api.app_state import router as app_state_router
from translator_app.backend.api.settings import router as settings_router
from translator_app.backend.api.files import router as files_router
from translator_app.backend.api.file_processing import router as file_processing_router
from translator_app.backend.api.translation_config import router as translation_config_router
from translator_app.backend.api.jobs import router as jobs_router
from translator_app.backend.api.cache import router as cache_router
from translator_app.backend.api.secrets import router as secrets_router
from translator_app.backend.api.presets import router as presets_router
from translator_app.backend.api.translation_plan import router as translation_plan_router
from translator_app.backend.api.descriptors import router as descriptors_router
from translator_app.backend.api.install import router as install_router
from translator_app.backend.api.logs_diagnostics import router as logs_diagnostics_router
from translator_app.backend.api.stellaris_cache import router as stellaris_cache_router
from translator_app.backend.api.import_export import router as import_export_router
from translator_app.backend.api.translation_trace import router as translation_trace_router
from translator_app.backend.api.mods import router as mods_router
from translator_app.backend.api.output_files import router as output_files_router
from translator_app.backend.api.output_analysis import router as output_analysis_router
from translator_app.backend.api.output_analysis_jobs import router as output_analysis_jobs_router
from translator_app.backend.api.output_debug import router as output_debug_router
from translator_app.backend.api.output_open_folder import router as output_open_folder_router
from translator_app.backend.api.system import router as system_router
from translator_app.backend.api.games import router as games_router
from translator_app.backend.api.profiles import router as profiles_router
from translator_app.backend.api.storage_paths import router as storage_paths_router
from translator_app.backend.api.draft_job_selection import router as draft_job_selection_router
from translator_app.backend.api.editor_session import router as editor_session_router
from translator_app.backend.api.provider_models import router as provider_models_router
from translator_app.backend.api.protection_rules import router as protection_rules_router
from translator_app.backend.api.protection_profiles import router as protection_profiles_router
from translator_app.backend.api.protection_learning_file_source import router as protection_learning_file_source_router
from translator_app.backend.api.protection_validation import router as protection_validation_router
from translator_app.backend.api.rule_sets import router as rule_sets_router
from translator_app.backend.api.divergence_summary import router as divergence_summary_router
from translator_app.backend.api.pairing_projects import router as pairing_projects_router


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Stellaris Translator - Local Backend API",
        version="0.1.0",
        description="Local HTTP API for the Stellaris Translator application",
        lifespan=_lifespan,
    )

    # CORS middleware for local frontend
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register error handlers
    app.add_exception_handler(APIError, api_error_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    # Register routers
    app.include_router(health_router, prefix="/api")
    app.include_router(app_state_router, prefix="/api")
    app.include_router(settings_router, prefix="/api/settings")
    app.include_router(files_router, prefix="/api/files")
    app.include_router(file_processing_router, prefix="/api/file-processing")
    app.include_router(translation_config_router, prefix="/api/translation-config")
    app.include_router(jobs_router, prefix="/api/translation-jobs")
    app.include_router(cache_router, prefix="/api/cache")
    app.include_router(secrets_router, prefix="/api/secrets")
    app.include_router(presets_router)
    app.include_router(translation_plan_router)
    app.include_router(descriptors_router, prefix="/api")
    app.include_router(install_router)
    app.include_router(logs_diagnostics_router)
    app.include_router(stellaris_cache_router)
    app.include_router(import_export_router)
    app.include_router(translation_trace_router)
    app.include_router(mods_router)
    app.include_router(output_files_router, prefix="/api")
    app.include_router(output_analysis_router, prefix="/api")
    app.include_router(output_analysis_jobs_router, prefix="/api")
    app.include_router(output_debug_router, prefix="/api")
    app.include_router(output_open_folder_router, prefix="/api")
    app.include_router(system_router)
    app.include_router(games_router, prefix="/api")
    app.include_router(profiles_router)
    app.include_router(storage_paths_router, prefix="/api")
    app.include_router(draft_job_selection_router)
    app.include_router(editor_session_router)
    app.include_router(provider_models_router)
    app.include_router(protection_rules_router)
    app.include_router(protection_profiles_router)
    app.include_router(protection_learning_file_source_router)
    app.include_router(protection_validation_router)
    app.include_router(rule_sets_router, prefix="/api")
    app.include_router(divergence_summary_router)
    app.include_router(pairing_projects_router)

    return app


if __name__ == "__main__":
    import sys

    # Allow --show-paths to display resolved storage paths without
    # starting the HTTP server.
    if "--show-paths" in sys.argv:
        from translator_app.storage.paths import get_storage_paths

        p = get_storage_paths()
        print("=== Resolved Storage Paths ===")
        for field_name in p.__dataclass_fields__:
            print(f"  {field_name:30s} {getattr(p, field_name)}")
        print()
        print(f"Set TRANSLATOR_APP_DB_PATH=<path> to override the database path.")
        print(f"Set TRANSLATOR_APP_DATA_DIR=<dir>  to override the data directory.")
        sys.exit(0)

    import uvicorn
    uvicorn.run(
        "translator_app.backend.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
        reload=False,
    )
