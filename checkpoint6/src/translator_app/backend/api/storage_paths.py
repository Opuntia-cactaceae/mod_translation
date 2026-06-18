"""API endpoint for inspecting application storage paths."""

from fastapi import APIRouter

from translator_app.storage.paths import get_storage_paths
from translator_app.storage.paths import get_data_dir
from translator_app.storage.paths import get_config_path
from translator_app.storage.paths import get_secrets_path
from translator_app.storage.paths import get_profiles_path
from translator_app.storage.paths import get_prompt_presets_path
from translator_app.storage.paths import get_db_path
from translator_app.storage.paths import get_cache_path
from translator_app.storage.paths import get_trace_path
from translator_app.storage.paths import get_discovery_cache_path
from translator_app.storage.paths import get_raw_responses_dir
from translator_app.storage.paths import get_output_dir

router = APIRouter(tags=["storage"])


@router.get("/storage/paths")
def get_storage_paths_endpoint():
    """Return all resolved storage paths (no secrets, only paths)."""
    return {
        "data_dir": get_data_dir(),
        "config_path": get_config_path(),
        "secrets_path": get_secrets_path(),
        "profiles_path": get_profiles_path(),
        "prompt_presets_path": get_prompt_presets_path(),
        "db_path": get_db_path(),
        "cache_path": get_cache_path(),
        "trace_path": get_trace_path(),
        "discovery_cache_path": get_discovery_cache_path(),
        "raw_responses_dir": get_raw_responses_dir(),
        "output_dir": get_output_dir(),
    }
