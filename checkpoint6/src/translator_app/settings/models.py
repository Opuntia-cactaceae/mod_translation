"""Settings data models matching the Settings Module specification."""

from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Nested setting groups (sections 4.1 – 4.9 of the spec)
# ---------------------------------------------------------------------------


@dataclass
class PathSettings:
    """4.1 Paths settings — paths to key application directories."""
    downloaded_mods_dir: Optional[str] = None
    stellaris_mods_dir: Optional[str] = None
    translations_output_dir: Optional[str] = None
    app_cache_dir: Optional[str] = None
    stellaris_cache_path: Optional[str] = None


@dataclass
class LanguageSettings:
    """4.2 Language settings — default language pair."""
    default_src_lang: str = "en"
    default_dst_lang: str = "ru"


@dataclass
class RuntimeDefaults:
    """4.3 Runtime defaults — default model/provider settings."""
    default_provider: Optional[str] = "groq"
    default_model: Optional[str] = None
    default_fallback_models: list = field(default_factory=list)
    default_timeout_sec: float = 30.0
    default_max_retries: int = 3
    default_temperature: float = 0.0
    default_max_completion_tokens: Optional[int] = None
    default_max_requests_per_minute: Optional[int] = None


@dataclass
class TranslationDefaults:
    """4.4 Translation defaults — common translation defaults.

    Note: default_game and default_file_handler are NOT fields here.
    Legacy code may store them via getattr(), but new code should use
    game_settings.*.default_file_handler and profiles/game_settings for game.
    """
    default_batch_size: int = 10
    default_use_cache: bool = True
    default_save_raw_responses: bool = False
    default_protection_strategy: str = "xml_placeholders"
    default_validator: str = "composite"
    default_allow_fallback_on_json_error: bool = True


@dataclass
class PromptDefaults:
    """4.5 Prompt defaults — default prompt preset references."""
    default_prompt_preset_id: Optional[str] = None
    default_prompt_profile: str = "strict_json_batch"


@dataclass
class OutputSettings:
    """4.6 Output settings — file saving defaults."""
    default_output_mode: str = "auto"
    default_overwrite: bool = False
    default_backup_on_overwrite: bool = True
    default_filename_template: str = "{source_name}.{dst_lang}.yml"


@dataclass
class CacheSettings:
    """4.7 Cache settings — translation cache configuration."""
    translation_cache_enabled: bool = True
    cache_include_model: bool = False
    cache_include_prompt_hash: bool = True
    cache_include_protection_strategy: bool = True
    cache_max_entries: Optional[int] = None


@dataclass
class UiSettings:
    """4.8 UI settings — interface preferences."""
    theme: str = "system"
    last_opened_project_id: Optional[str] = None
    last_opened_mod_id: Optional[str] = None
    last_used_src_lang: str = "en"
    last_used_dst_lang: str = "ru"
    last_used_provider: Optional[str] = None
    last_used_model: Optional[str] = None


@dataclass
class LoggingSettings:
    """4.9 Logging settings."""
    log_level: str = "info"
    log_raw_prompts: bool = False
    log_raw_responses: bool = False
    keep_job_logs_days: int = 30


# ---------------------------------------------------------------------------
# Game-specific settings (multi-game support)
# ---------------------------------------------------------------------------


@dataclass
class StellarisGameSettings:
    """Stellaris-specific game settings."""
    downloaded_mods_dir: str = ""
    mods_dir: str = ""
    cache_path: str = ""
    default_file_handler: str = "stellaris_localisation"


@dataclass
class GenericGameSettings:
    """Generic (non-Stellaris) game settings."""
    root_dir: str = ""
    output_dir: str = ""
    default_file_handler: str = "plain_text"


@dataclass
class GameSettings:
    """Container for per-game settings sections."""
    stellaris: StellarisGameSettings = field(default_factory=StellarisGameSettings)
    generic: GenericGameSettings = field(default_factory=GenericGameSettings)


# ---------------------------------------------------------------------------
# Top-level AppSettings
# ---------------------------------------------------------------------------

VALID_OUTPUT_MODES = frozenset({"auto", "same_directory", "output_directory", "manual_path"})
VALID_THEMES = frozenset({"system", "light", "dark"})
VALID_LOG_LEVELS = frozenset({"debug", "info", "warning", "error", "critical"})


@dataclass
class AppSettings:
    """Top-level application settings container.

    Matches the structure described in the Settings Module specification:
    - 9 nested groups (paths, language, runtime_defaults, translation_defaults,
      prompt_defaults, output, cache, ui, logging)
    - schema_version for future migrations
    - updated_at timestamp
    """
    paths: PathSettings = field(default_factory=PathSettings)
    language: LanguageSettings = field(default_factory=LanguageSettings)
    runtime_defaults: RuntimeDefaults = field(default_factory=RuntimeDefaults)
    translation_defaults: TranslationDefaults = field(default_factory=TranslationDefaults)
    prompt_defaults: PromptDefaults = field(default_factory=PromptDefaults)
    output: OutputSettings = field(default_factory=OutputSettings)
    cache: CacheSettings = field(default_factory=CacheSettings)
    ui: UiSettings = field(default_factory=UiSettings)
    logging: LoggingSettings = field(default_factory=LoggingSettings)
    game_settings: GameSettings = field(default_factory=GameSettings)
    schema_version: int = 1
    updated_at: Optional[str] = None


CURRENT_SCHEMA_VERSION = 1

# Default settings singleton — a fresh instance every time
# because dataclass default_factory creates mutable defaults.
def _default_settings() -> AppSettings:
    return AppSettings()


DEFAULT_SETTINGS = _default_settings()
