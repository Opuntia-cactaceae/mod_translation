"""Backend API routers and handler exports."""

from translator_app.backend.api.health import router as health_router, get_health as get_health
from translator_app.backend.api.app_state import router as app_state_router, get_app_state as get_app_state
from translator_app.backend.api.settings import router as settings_router, get_settings as get_settings, update_settings as update_settings
from translator_app.backend.api.files import router as files_router, list_files as list_files, read_file as read_file
from translator_app.backend.api.file_processing import router as file_processing_router
from translator_app.backend.api.translation_config import router as translation_config_router
from translator_app.backend.api.jobs import router as jobs_router, list_jobs as list_jobs, get_job as get_job, create_job as create_job
from translator_app.backend.api.cache import router as cache_router, get_cache_stats as get_cache_info, clear_cache as clear_cache
from translator_app.backend.api.secrets import router as secrets_router
from translator_app.backend.api.translation_plan import router as translation_plan_router
from translator_app.backend.api.descriptors import router as descriptors_router
from translator_app.backend.api.install import router as install_router
from translator_app.backend.api.mods import router as mods_router
from translator_app.backend.api.output_files import router as output_files_router
from translator_app.backend.api.draft_job_selection import router as draft_job_selection_router
from translator_app.backend.api.provider_models import router as provider_models_router
from translator_app.backend.api.protection_rules import router as protection_rules_router
from translator_app.backend.api.protection_profiles import router as protection_profiles_router
from translator_app.backend.api.protection_learning_file_source import router as protection_learning_file_source_router
from translator_app.backend.api.rule_sets import router as rule_sets_router

# Backward-compatible handler references (keep old api module imports working)
get_health_handler = get_health
list_files_handler = list_files
get_cache_info_handler = get_cache_info
clear_cache_handler = clear_cache

__all__ = [
    # routers
    "health_router", "app_state_router", "settings_router", "files_router",
    "file_processing_router", "translation_config_router", "jobs_router",
    "cache_router", "secrets_router", "translation_plan_router",
    "descriptors_router", "install_router", "mods_router", "output_files_router",
    "draft_job_selection_router",
    "provider_models_router",
    "protection_rules_router",
    "protection_profiles_router",
    "protection_learning_file_source_router",
    "rule_sets_router",
    # handlers
    "get_health", "get_app_state", "get_settings", "update_settings",
    "list_files", "read_file",
    "list_jobs", "get_job", "create_job",
    "get_cache_info", "clear_cache",
    # backward compat
    "get_health_handler", "list_files_handler",
    "get_cache_info_handler", "clear_cache_handler",
]
