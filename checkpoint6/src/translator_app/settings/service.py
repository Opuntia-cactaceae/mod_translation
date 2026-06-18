"""Settings service — load, save, migrate, export, and import settings."""

import json
import os
import shutil
import tempfile
from dataclasses import is_dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from translator_app.settings.models import (
    AppSettings,
    DEFAULT_SETTINGS,
    CURRENT_SCHEMA_VERSION,
    PathSettings,
    LanguageSettings,
    RuntimeDefaults,
    TranslationDefaults,
    PromptDefaults,
    OutputSettings,
    CacheSettings,
    UiSettings,
    LoggingSettings,
    GameSettings,
    StellarisGameSettings,
    GenericGameSettings,
)
from translator_app.storage.paths import get_config_path


def _nested_set(obj, key_path: str, value):
    """Set a nested attribute on a dataclass instance using dot-separated key_path."""
    parts = key_path.split(".", 1)
    if len(parts) == 1:
        if hasattr(obj, parts[0]):
            setattr(obj, parts[0], value)
    else:
        child = getattr(obj, parts[0], None)
        if child is not None:
            _nested_set(child, parts[1], value)


def _nested_update(obj, patch: dict) -> None:
    """Recursively apply a dict patch to a dataclass object, preserving types."""
    for key, value in patch.items():
        if hasattr(obj, key):
            child = getattr(obj, key)
            if isinstance(value, dict) and is_dataclass(child):
                _nested_update(child, value)
            else:
                setattr(obj, key, value)


def _from_dict(data: dict) -> AppSettings:
    """Reconstruct an AppSettings from a (possibly nested) dict.

    For each nested section:
    - if the key is absent → use a fresh default instance of that dataclass
    - if the key is present and is a dict → merge provided values over defaults
      (so partial sections don't lose unspecified fields)
    """
    section_defaults = {
        "paths": PathSettings,
        "language": LanguageSettings,
        "runtime_defaults": RuntimeDefaults,
        "translation_defaults": TranslationDefaults,
        "prompt_defaults": PromptDefaults,
        "output": OutputSettings,
        "cache": CacheSettings,
        "ui": UiSettings,
        "logging": LoggingSettings,
        "game_settings": GameSettings,
    }
    kwargs = {}
    for key, cls in section_defaults.items():
        val = data.get(key)
        if val is not None and isinstance(val, dict):
            if key == "game_settings":
                # Deep merge for two-level game_settings
                gs = GameSettings()
                for gskey, gscls in (("stellaris", StellarisGameSettings), ("generic", GenericGameSettings)):
                    gsval = val.get(gskey)
                    if gsval is not None and isinstance(gsval, dict):
                        base = gscls()
                        merged = {**base.__dict__, **gsval}
                        setattr(gs, gskey, gscls(**merged))
                kwargs[key] = gs
            else:
                base = cls()
                merged = {**base.__dict__, **val}
                kwargs[key] = cls(**merged)
        else:
            kwargs[key] = cls()

    # ---- Backward compatibility: populate game_settings from old paths ----
    gs = kwargs["game_settings"]
    # From nested paths section
    paths_data = data.get("paths", {})
    if not gs.stellaris.downloaded_mods_dir and paths_data.get("downloaded_mods_dir"):
        gs.stellaris.downloaded_mods_dir = paths_data["downloaded_mods_dir"]
    if not gs.stellaris.mods_dir and paths_data.get("stellaris_mods_dir"):
        gs.stellaris.mods_dir = paths_data["stellaris_mods_dir"]
    if not gs.stellaris.cache_path and paths_data.get("stellaris_cache_path"):
        gs.stellaris.cache_path = paths_data["stellaris_cache_path"]
    # From flat legacy keys (both paths and translation defaults)
    if not gs.stellaris.downloaded_mods_dir and data.get("downloaded_mods_dir"):
        gs.stellaris.downloaded_mods_dir = data["downloaded_mods_dir"]
    if not gs.stellaris.mods_dir and data.get("stellaris_mods_dir"):
        gs.stellaris.mods_dir = data["stellaris_mods_dir"]
    if not gs.stellaris.cache_path and data.get("stellaris_cache_path"):
        gs.stellaris.cache_path = data["stellaris_cache_path"]
    # Legacy compatibility: migrate old flat default_file_handler into
    # game_settings.generic.default_file_handler when default_game was "generic".
    # New code should use game_settings directly.
    if (not gs.generic.default_file_handler
            and data.get("default_file_handler")
            and data.get("default_game") == "generic"):
        gs.generic.default_file_handler = data["default_file_handler"]

    # Fill remaining top-level fields
    for key in ("schema_version", "updated_at"):
        if key in data:
            kwargs[key] = data[key]
    # Handle flat-style data (legacy): try to map flat fields into groups
    settings = AppSettings(**{k: v for k, v in kwargs.items() if k != "paths"})
    settings.paths = kwargs.get("paths", PathSettings())
    # Re-apply all provided values in case some were overwritten by defaults
    _apply_flat_to_nested(settings, data)
    return settings


def _apply_flat_to_nested(settings: AppSettings, data: dict) -> None:
    """Apply flat key-value pairs from legacy data into the nested structure."""
    # Paths
    for pk in ("downloaded_mods_dir", "stellaris_mods_dir", "translations_output_dir",
               "app_cache_dir", "stellaris_cache_path"):
        if pk in data:
            setattr(settings.paths, pk, data[pk])
    # Language
    if "default_src_lang" in data:
        settings.language.default_src_lang = data["default_src_lang"]
    if "default_dst_lang" in data:
        settings.language.default_dst_lang = data["default_dst_lang"]
    # Runtime
    for rk in ("default_provider", "default_model", "default_timeout_sec",
               "default_max_retries", "default_temperature"):
        if rk in data:
            setattr(settings.runtime_defaults, rk, data[rk])
    # Translation
    if "default_batch_size" in data:
        settings.translation_defaults.default_batch_size = data["default_batch_size"]
    if "batch_size" in data:
        settings.translation_defaults.default_batch_size = data["batch_size"]
    # UI
    if "theme" in data:
        settings.ui.theme = data["theme"]
    # Cache
    if "cache_enabled" in data:
        settings.cache.translation_cache_enabled = bool(data["cache_enabled"])
    # Logging
    if "log_level" in data:
        settings.logging.log_level = data["log_level"]


# ---------------------------------------------------------------------------
# Migration functions
# ---------------------------------------------------------------------------

_MIGRATIONS = {
    # schema_version -> list of (from_ver, migration_fn)
    # Future: 1: [(1, _migrate_v1_to_v2)]
}


def _apply_migrations(settings: AppSettings) -> AppSettings:
    """Apply pending migrations in order."""
    loaded_ver = getattr(settings, "schema_version", 0)
    if loaded_ver >= CURRENT_SCHEMA_VERSION:
        return settings

    # Run migrations sequentially
    for version in range(loaded_ver + 1, CURRENT_SCHEMA_VERSION + 1):
        mig = _MIGRATIONS.get(version, [])
        for from_ver, fn in mig:
            if loaded_ver == from_ver:
                fn(settings)
                loaded_ver = version
    settings.schema_version = CURRENT_SCHEMA_VERSION
    return settings


# ---------------------------------------------------------------------------
# SettingsService
# ---------------------------------------------------------------------------


class SettingsService:
    """Loads, saves, validates and migrates application settings.

    Public methods correspond to the spec:
      load_settings() -> AppSettings
      save_settings(settings: AppSettings) -> AppSettings
      get_settings() -> AppSettings
      update_settings(patch: dict) -> AppSettings
      reset_settings() -> AppSettings
      export_settings() -> dict
      import_settings(data: dict) -> AppSettings
    """

    def __init__(self, config_path: Optional[str] = None):
        self._config_path = (
            config_path
            or os.environ.get("TRANSLATOR_APP_CONFIG_PATH")
            or get_config_path()
        )
        self._settings = AppSettings()

    # ------------------------------------------------------------------ #
    # Property
    # ------------------------------------------------------------------ #

    @property
    def settings(self) -> AppSettings:
        return self._settings

    # ------------------------------------------------------------------ #
    # Load / Save
    # ------------------------------------------------------------------ #

    def load(self, apply_migration: bool = True) -> AppSettings:
        """Load settings from the JSON config file.

        If the file is missing, return DEFAULT_SETTINGS.
        If the file is corrupted, back it up and return DEFAULT_SETTINGS.
        Optionally applies schema_version migration.
        """
        path = Path(self._config_path)
        if not path.exists():
            self._settings = AppSettings()
            return self._settings

        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
            self._settings = _from_dict(data)
        except (json.JSONDecodeError, TypeError, ValueError, KeyError) as exc:
            self._backup_corrupt(path)
            self._settings = AppSettings()
            return self._settings

        if apply_migration:
            self._settings = _apply_migrations(self._settings)

        return self._settings

    def save(self) -> None:
        """Write settings to JSON with atomic write (temp file + rename)."""
        path = Path(self._config_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        # Set updated_at timestamp
        self._settings.updated_at = datetime.now(timezone.utc).isoformat()

        # Atomic write: write to temp file, then rename
        fd, tmp_path = tempfile.mkstemp(
            suffix=".tmp",
            prefix="config_",
            dir=str(path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self._to_dict(), f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(fd)
            shutil.move(tmp_path, str(path))
        except Exception:
            # Clean up temp file on failure
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

    # ------------------------------------------------------------------ #
    # Update / Reset
    # ------------------------------------------------------------------ #

    def update_settings(self, patch: dict) -> AppSettings:
        """Apply a dict patch to the current settings, supporting nested keys.

        Example::

            service.update_settings({
                "logging": {"log_level": "debug"},
                "language": {"default_src_lang": "fr"},
                "game_settings": {"stellaris": {"mods_dir": "/path"}},
            })

        Also handles flat (legacy) keys via ``_apply_flat_to_nested``.
        """
        _nested_update(self._settings, patch)
        # Handle flat keys (legacy frontend format)
        _apply_flat_to_nested(self._settings, patch)
        return self._settings

    def update(self, **kwargs) -> None:
        """Legacy flat update (kept for backward compatibility)."""
        for key, value in kwargs.items():
            if hasattr(self._settings, key):
                setattr(self._settings, key, value)

    def reset_settings(self) -> AppSettings:
        """Reset settings to defaults."""
        self._settings = AppSettings()
        return self._settings

    # ------------------------------------------------------------------ #
    # Export / Import
    # ------------------------------------------------------------------ #

    def export_settings(self) -> dict:
        """Export current settings as a plain dict."""
        return self._to_dict()

    def import_settings(self, data: dict) -> AppSettings:
        """Import settings from a dict (replaces current)."""
        self._settings = _from_dict(data)
        return self._settings

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _to_dict(self) -> dict:
        """Recursively convert dataclass settings to a plain dict."""
        return _dataclass_to_dict(self._settings)

    def _backup_corrupt(self, path: Path) -> None:
        """Rename a corrupt config file to ``<name>.corrupt.<timestamp>``."""
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"{path.name}.corrupt.{ts}"
        backup_path = path.with_name(backup_name)
        shutil.move(str(path), str(backup_path))


def _dataclass_to_dict(obj) -> dict:
    """Recursively convert a nested dataclass structure to a dict."""
    if is_dataclass(obj):
        result = {}
        for f in obj.__dataclass_fields__:
            val = getattr(obj, f)
            if is_dataclass(val):
                result[f] = _dataclass_to_dict(val)
            elif isinstance(val, list):
                result[f] = [
                    _dataclass_to_dict(v) if is_dataclass(v) else v
                    for v in val
                ]
            else:
                result[f] = val
        return result
    return obj
