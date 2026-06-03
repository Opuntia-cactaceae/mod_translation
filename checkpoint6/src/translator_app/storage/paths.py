"""Centralized storage path resolution for the translator application.

All persistent storage paths are resolved from a single ``data_dir``
(the ``TRANSLATOR_APP_DATA_DIR`` env var, or ``<project_root>/app_data``
by default).  Every individual path may be overridden via its own
``TRANSLATOR_APP_*`` env var.

Environment variables
---------------------
``TRANSLATOR_APP_DATA_DIR``
    Base directory for ALL application data.  If not set, defaults to
    ``<checkpoint6>/app_data``.  Every individual path that is not
    explicitly overridden defaults to a location inside this directory.

Individual overrides (takes precedence over ``TRANSLATOR_APP_DATA_DIR``):
    * ``TRANSLATOR_APP_CONFIG_PATH``
    * ``TRANSLATOR_APP_SECRETS_PATH``
    * ``TRANSLATOR_APP_PROFILES_PATH``
    * ``TRANSLATOR_APP_PROMPT_PRESETS_PATH``
    * ``TRANSLATOR_APP_DB_PATH``
    * ``TRANSLATOR_APP_CACHE_PATH``
    * ``TRANSLATOR_APP_TRACE_PATH``
    * ``TRANSLATOR_APP_DISCOVERY_CACHE_PATH``
    * ``TRANSLATOR_APP_RAW_RESPONSES_DIR``
    * ``TRANSLATOR_APP_OUTPUT_DIR``

Test isolation
--------------
When ``PYTEST_CURRENT_TEST`` is set in the environment **and** a resolved
path does not live inside ``TRANSLATOR_APP_DATA_DIR``, a ``RuntimeError``
is raised.  This prevents tests from accidentally reading or writing
production data.
"""

import logging
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Env var names
# ---------------------------------------------------------------------------

ENV_DATA_DIR = "TRANSLATOR_APP_DATA_DIR"
ENV_CONFIG_PATH = "TRANSLATOR_APP_CONFIG_PATH"
ENV_SECRETS_PATH = "TRANSLATOR_APP_SECRETS_PATH"
ENV_PROFILES_PATH = "TRANSLATOR_APP_PROFILES_PATH"
ENV_PROMPT_PRESETS_PATH = "TRANSLATOR_APP_PROMPT_PRESETS_PATH"
ENV_DB_PATH = "TRANSLATOR_APP_DB_PATH"
ENV_CACHE_PATH = "TRANSLATOR_APP_CACHE_PATH"
ENV_TRACE_PATH = "TRANSLATOR_APP_TRACE_PATH"
ENV_DISCOVERY_CACHE_PATH = "TRANSLATOR_APP_DISCOVERY_CACHE_PATH"
ENV_RAW_RESPONSES_DIR = "TRANSLATOR_APP_RAW_RESPONSES_DIR"
ENV_OUTPUT_DIR = "TRANSLATOR_APP_OUTPUT_DIR"
ENV_PROVIDER_MODELS_PATH = "TRANSLATOR_APP_PROVIDER_MODELS_PATH"

# ---------------------------------------------------------------------------
# Package root → project root helper
# ---------------------------------------------------------------------------

_PACKAGE_DIR = Path(__file__).resolve().parent.parent  # src/translator_app/
_PROJECT_ROOT = _PACKAGE_DIR.parent.parent  # checkpoint6/


def default_app_data_dir() -> str:
    """Return the default ``data_dir`` when ``TRANSLATOR_APP_DATA_DIR`` is
    not set.

    The default is ``<project_root>/app_data``
    (i.e. ``checkpoint6/app_data``).
    """
    return str(_PROJECT_ROOT / "app_data")


# ---------------------------------------------------------------------------
# Paths dataclass
# ---------------------------------------------------------------------------


@dataclass
class StoragePaths:
    """All persistent storage paths for the translator application."""

    data_dir: str
    config_path: str
    secrets_path: Optional[str]
    profiles_path: str
    prompt_presets_path: str
    db_path: str
    cache_path: Optional[str] = None
    trace_path: Optional[str] = None
    discovery_cache_path: Optional[str] = None
    raw_responses_dir: Optional[str] = None
    output_dir: Optional[str] = None
    provider_models_path: Optional[str] = None


# ---------------------------------------------------------------------------
# Resolution helpers
# ---------------------------------------------------------------------------


def _running_under_pytest() -> bool:
    """Return True if we are inside a pytest session."""
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


def _assert_path_under_test_dir(
    resolved: str,
    data_dir: Optional[str],
    was_explicitly_overridden: bool = False,
) -> None:
    """If we are in pytest, ensure the resolved path is not a production default.

    This is a safety net to prevent test code from accidentally touching
    production storage locations.  It only fires when:

    * We are running under ``PYTEST_CURRENT_TEST``.
    * The path was NOT explicitly overridden via an env var (i.e. it
      fell through to the production default).
    * The path is outside the ``TRANSLATOR_APP_DATA_DIR``.

    If a test intentionally overrides an env var to a custom path
    (``was_explicitly_overridden=True``), the guard trusts that the
    test author knows what they are doing.
    """
    if not _running_under_pytest():
        return
    if was_explicitly_overridden:
        return  # test intentionally set this path — trust it

    if data_dir is None:
        raise RuntimeError(
            "TRANSLATOR_APP_DATA_DIR is not set but PYTEST_CURRENT_TEST is active.\n"
            "A path fell back to its production default without an explicit env var.\n"
            "Ensure your conftest.py sets TRANSLATOR_APP_DATA_DIR."
        )
    resolved_path = Path(resolved).resolve()
    data_dir_path = Path(data_dir).resolve()
    try:
        resolved_path.relative_to(data_dir_path)
    except ValueError:
        raise RuntimeError(
            f"Test attempted to access a storage path that is a production default\n"
            f"and is outside the test data dir!\n"
            f"  Resolved path: {resolved_path}\n"
            f"  Test data dir: {data_dir_path}\n"
            f"Tip: either set the corresponding TRANSLATOR_APP_* env var to a\n"
            f"test-isolated path, or use conftest.py's isolated_app_config fixture."
        )


def _resolve_path(
    env_var_name: str,
    env_var_value: Optional[str],
    default_fn,
    data_dir: Optional[str],
    relative_inside_data_dir: Optional[str] = None,
) -> str:
    """Resolve a single storage path.

    Priority:
    1. Explicit env var override (``TRANSLATOR_APP_*_PATH``).
    2. Inside ``TRANSLATOR_APP_DATA_DIR`` (if set and ``relative_inside_data_dir``
       is provided).
    3. Default production path.

    The pytest path guard only fires in case 3 (production default) — if
    an explicit override is set (case 1) we trust the caller knows what
    they are doing.
    """
    was_overridden = False

    # Priority 1: explicit env var
    if env_var_value:
        result = env_var_value
        was_overridden = True
    # Priority 2: inside data dir
    elif data_dir and relative_inside_data_dir is not None:
        result = str(Path(data_dir) / relative_inside_data_dir)
    # Priority 3: production default
    else:
        result = default_fn()

    # Safety guard for pytest (only fires on production default paths)
    _assert_path_under_test_dir(result, data_dir, was_explicitly_overridden=was_overridden)
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_storage_paths() -> StoragePaths:
    """Resolve and return all storage paths based on environment variables.

    Call this once at application startup (or service factory time) and
    pass the result to service constructors.
    """
    data_dir = os.environ.get(ENV_DATA_DIR) or default_app_data_dir()

    paths = StoragePaths(
        data_dir=data_dir,
        config_path=_resolve_path(
            ENV_CONFIG_PATH,
            os.environ.get(ENV_CONFIG_PATH),
            lambda: str(Path(data_dir) / "config.json"),
            data_dir,
            "config.json",
        ),
        secrets_path=_resolve_path(
            ENV_SECRETS_PATH,
            os.environ.get(ENV_SECRETS_PATH),
            lambda: str(Path(data_dir) / "secrets.json"),
            data_dir,
            "secrets.json",
        ),
        profiles_path=_resolve_path(
            ENV_PROFILES_PATH,
            os.environ.get(ENV_PROFILES_PATH),
            lambda: str(Path(data_dir) / "translation_profiles.json"),
            data_dir,
            "translation_profiles.json",
        ),
        prompt_presets_path=_resolve_path(
            ENV_PROMPT_PRESETS_PATH,
            os.environ.get(ENV_PROMPT_PRESETS_PATH),
            lambda: str(Path(data_dir) / "prompt_presets.json"),
            data_dir,
            "prompt_presets.json",
        ),
        db_path=_resolve_path(
            ENV_DB_PATH,
            os.environ.get(ENV_DB_PATH),
            lambda: str(Path(data_dir) / "translator_app.db"),
            data_dir,
            "translator_app.db",
        ),
        cache_path=_resolve_path(
            ENV_CACHE_PATH,
            os.environ.get(ENV_CACHE_PATH),
            lambda: str(Path(data_dir) / "cache.sqlite"),
            data_dir,
            "cache.sqlite",
        ),
        trace_path=_resolve_path(
            ENV_TRACE_PATH,
            os.environ.get(ENV_TRACE_PATH),
            lambda: str(Path(data_dir) / "traces"),
            data_dir,
            "traces",
        ),
        discovery_cache_path=_resolve_path(
            ENV_DISCOVERY_CACHE_PATH,
            os.environ.get(ENV_DISCOVERY_CACHE_PATH),
            lambda: str(Path(data_dir) / "discovery_cache.json"),
            data_dir,
            "discovery_cache.json",
        ),
        raw_responses_dir=_resolve_path(
            ENV_RAW_RESPONSES_DIR,
            os.environ.get(ENV_RAW_RESPONSES_DIR),
            lambda: str(Path(data_dir) / "raw_responses"),
            data_dir,
            "raw_responses",
        ),
        output_dir=_resolve_path(
            ENV_OUTPUT_DIR,
            os.environ.get(ENV_OUTPUT_DIR),
            lambda: str(Path(data_dir) / "outputs"),
            data_dir,
            "outputs",
        ),
        provider_models_path=_resolve_path(
            ENV_PROVIDER_MODELS_PATH,
            os.environ.get(ENV_PROVIDER_MODELS_PATH),
            lambda: str(Path(data_dir) / "provider_models.json"),
            data_dir,
            "provider_models.json",
        ),
    )
    return paths


# ---------------------------------------------------------------------------
# Migration from old (pre-checkpoint6) default paths
# ---------------------------------------------------------------------------


def _get_old_default_paths() -> dict[str, str]:
    """Return the *previous* default paths that may contain data from
    before the app_data directory was introduced.

    These are used by :func:`maybe_migrate_old_paths` to copy existing
    data into the new unified ``app_data/`` on first run.  The old files
    are never deleted.
    """
    return {
        "config": str(_PROJECT_ROOT / "config.json"),
        "profiles": str(_PACKAGE_DIR / "translation_profiles.json"),
        "prompt_presets": str(_PACKAGE_DIR / "prompt_presets.json"),
        "db": str(_PACKAGE_DIR / "app_data" / "translator_app.db"),
    }


def maybe_migrate_old_paths() -> None:
    """Migrate data from pre-checkpoint6 default paths into the new
    unified ``app_data/`` directory.

    For each known old default path: if the old file exists **and** the
    new destination does **not** exist yet, copy the file.  Old files
    are never deleted — the migration is a one-time copy.

    Logs a warning for each migrated file so operators are aware.
    Called from ``app.py`` startup during the lifespan hook.

    **Skipped under pytest** to avoid copying production files into
    temporary test directories.
    """
    if _running_under_pytest():
        return
    paths = get_storage_paths()
    old_paths = _get_old_default_paths()
    new_paths = {
        "config": paths.config_path,
        "profiles": paths.profiles_path,
        "prompt_presets": paths.prompt_presets_path,
        "db": paths.db_path,
    }

    logger.info("Checking for data to migrate from legacy paths...")
    any_migrated = False
    for name, old_str in old_paths.items():
        old = Path(old_str)
        new = Path(new_paths[name])
        if not old.exists():
            logger.debug("  %s: no old data at %s (skipped)", name, old)
            continue
        if new.exists():
            logger.info(
                "  %s: old data exists at %s BUT target %s already exists "
                "(migration skipped — current data takes precedence)",
                name,
                old,
                new,
            )
            continue
        new.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(old), str(new))
        logger.warning(
            "  %s: migrated from %s to %s",
            name,
            old,
            new,
        )
        any_migrated = True

    if any_migrated:
        logger.info(
            "Migration complete. Old files at %s have been **copied** (not moved). "
            "They can be safely removed once the new app_data/ is verified.",
            _PROJECT_ROOT / "app_data",
        )
    else:
        logger.info("No legacy data migration needed — all targets already up to date.")


# ---------------------------------------------------------------------------
# Backward-compatible individual getters
# ---------------------------------------------------------------------------

# Cache the resolved paths so repeated calls in the same process are
# consistent (env vars shouldn't change mid-process).
_storage_paths_cache: Optional[StoragePaths] = None


def _get_cached_paths() -> StoragePaths:
    global _storage_paths_cache
    if _storage_paths_cache is None:
        _storage_paths_cache = get_storage_paths()
    return _storage_paths_cache


def get_data_dir() -> str:
    return _get_cached_paths().data_dir


def get_config_path() -> str:
    return _get_cached_paths().config_path


def get_secrets_path() -> Optional[str]:
    return _get_cached_paths().secrets_path


def get_profiles_path() -> str:
    return _get_cached_paths().profiles_path


def get_prompt_presets_path() -> str:
    return _get_cached_paths().prompt_presets_path


def get_db_path() -> str:
    return _get_cached_paths().db_path


def get_cache_path() -> Optional[str]:
    return _get_cached_paths().cache_path


def get_trace_path() -> Optional[str]:
    return _get_cached_paths().trace_path


def get_discovery_cache_path() -> Optional[str]:
    return _get_cached_paths().discovery_cache_path


def get_raw_responses_dir() -> Optional[str]:
    return _get_cached_paths().raw_responses_dir


def get_output_dir() -> Optional[str]:
    return _get_cached_paths().output_dir


def get_provider_models_path() -> Optional[str]:
    return _get_cached_paths().provider_models_path


def clear_paths_cache() -> None:
    """Clear the cached storage paths.

    Call this after changing environment variables (e.g. in test setup)
    so that the next call to any ``get_*_path()`` re-resolves from env.
    """
    global _storage_paths_cache
    _storage_paths_cache = None
