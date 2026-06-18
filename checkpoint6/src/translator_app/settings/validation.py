"""Settings validation — path checking and full settings validation."""

import importlib
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

from translator_app.backend.path_utils import expand_user_path
from translator_app.diagnostics.models import ValidationResult, Diagnostic, DiagnosticLevel
from translator_app.settings.models import (
    AppSettings,
    VALID_OUTPUT_MODES,
    VALID_THEMES,
    VALID_LOG_LEVELS,
)


# ---------------------------------------------------------------------------
# PathValidationResult — matches the spec's per-path result format
# ---------------------------------------------------------------------------


@dataclass
class PathValidationResult:
    """Rich result for a single path validation, matching spec section format."""
    field_name: str = ""
    path: str = ""
    valid: bool = True
    exists: Optional[bool] = None
    is_directory: Optional[bool] = None
    can_read: Optional[bool] = None
    can_write: Optional[bool] = None
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Path validation
# ---------------------------------------------------------------------------

def validate_path(
    path: str,
    expected_type: Optional[str] = None,
    need_read: bool = False,
    need_write: bool = False,
    create_if_missing: bool = False,
) -> PathValidationResult:
    """Validate a filesystem path with all checks from the spec.

    Args:
        path: The path to validate.
        expected_type: ``"file"``, ``"dir"``, or ``None`` to skip type check.
        need_read: Require read permission.
        need_write: Require write permission.
        create_if_missing: If the path does not exist and write is needed,
                           allow creation (does not actually create).

    Returns:
        PathValidationResult with detailed status.
    """
    result = PathValidationResult(path=path)

    # --- expand ~ ---
    expanded_path = expand_user_path(path)
    expanded = str(expanded_path)
    result.path = expanded

    # --- empty ---
    if not path or not path.strip():
        result.valid = False
        result.errors.append("Path is empty")
        return result

    # --- exists ---
    result.exists = os.path.exists(expanded)

    if not result.exists:
        if create_if_missing and need_write:
            # parent directory should exist for creation to be feasible
            parent = os.path.dirname(expanded)
            if parent and not os.path.exists(parent):
                result.valid = False
                result.errors.append(f"Parent directory does not exist: {parent}")
                return result
            # Mark as not existing but allow it (creation is OK)
            result.warnings.append("Path does not exist yet but will be created")
            return result
        else:
            result.valid = False
            result.errors.append("Path does not exist")
            return result

    # --- type check ---
    if expected_type == "dir":
        result.is_directory = os.path.isdir(expanded)
        if not result.is_directory:
            result.valid = False
            result.errors.append("Path is not a directory")
    elif expected_type == "file":
        result.is_directory = os.path.isdir(expanded)
        if result.is_directory:
            result.valid = False
            result.errors.append("Path is not a file")

    # --- permissions ---
    if need_read:
        result.can_read = os.access(expanded, os.R_OK)
        if not result.can_read:
            result.valid = False
            result.errors.append("Path is not readable")

    if need_write:
        result.can_write = os.access(expanded, os.W_OK)
        if not result.can_write:
            result.valid = False
            result.errors.append("Path is not writable")

    return result


# ---------------------------------------------------------------------------
# Full settings validation
# ---------------------------------------------------------------------------

# Supported enum values (could be extended from registries at runtime)
SUPPORTED_PROVIDERS = frozenset({"openai", "groq", "anthropic", "google", "deepseek", "ollama", "custom"})
SUPPORTED_PROTECTION_STRATEGIES = frozenset({"none", "rule_set"})  # rule_set = rule-set-driven
SUPPORTED_VALIDATORS = frozenset({"composite", "basic", "strict"})
SUPPORTED_PROMPT_PROFILES = frozenset({"simple_single", "json_batch", "strict_json_batch"})


# ---------------------------------------------------------------------------
# Resolver layer — soft integration with registry-based modules
# ---------------------------------------------------------------------------


def _resolve_from_registry(module_path: str, dict_name: str, fallback: frozenset) -> frozenset:
    """Try to read supported values from a registry module; fall back to *fallback*.

    Args:
        module_path: Dotted module path (e.g. ``"translator_benchmark.runtime.runtime_registry"``).
        dict_name: Name of the module-level builders dict (e.g. ``"_RUNTIME_BUILDERS"``).
        fallback: Static frozenset to return when the registry is unavailable.

    Returns:
        frozenset of supported value names.
    """
    try:
        module = importlib.import_module(module_path)
        builders = getattr(module, dict_name, None)
        if isinstance(builders, dict):
            return frozenset(builders.keys())
    except Exception:
        logger.debug("Could not load registry %s.%s, using static fallback", module_path, dict_name)
    return fallback


def get_supported_providers() -> frozenset:
    """Return supported provider names.

    Checks ``translator_benchmark.runtime.runtime_registry._RUNTIME_BUILDERS``
    first; falls back to the static :data:`SUPPORTED_PROVIDERS` set.
    """
    return _resolve_from_registry(
        "translator_benchmark.runtime.runtime_registry",
        "_RUNTIME_BUILDERS",
        SUPPORTED_PROVIDERS,
    )


def get_supported_prompt_profiles() -> frozenset:
    """Return supported prompt profile names.

    Checks ``translator_benchmark.prompts.prompt_registry._PROFILE_BUILDERS``
    first; falls back to the static :data:`SUPPORTED_PROMPT_PROFILES` set.
    """
    return _resolve_from_registry(
        "translator_benchmark.prompts.prompt_registry",
        "_PROFILE_BUILDERS",
        SUPPORTED_PROMPT_PROFILES,
    )


def get_supported_protection_strategies() -> frozenset:
    """Return supported protection strategy names.

    Checks ``translator_benchmark.protection.protection_registry._STRATEGY_BUILDERS``
    first; falls back to the static :data:`SUPPORTED_PROTECTION_STRATEGIES` set.
    """
    return _resolve_from_registry(
        "translator_benchmark.protection.protection_registry",
        "_STRATEGY_BUILDERS",
        SUPPORTED_PROTECTION_STRATEGIES,
    )


def get_supported_validators() -> frozenset:
    """Return supported validator names.

    Checks ``translator_benchmark.validation.validation_registry._VALIDATOR_BUILDERS``
    first; falls back to the static :data:`SUPPORTED_VALIDATORS` set.
    """
    return _resolve_from_registry(
        "translator_benchmark.validation.validation_registry",
        "_VALIDATOR_BUILDERS",
        SUPPORTED_VALIDATORS,
    )


def validate_settings(settings: AppSettings) -> ValidationResult:
    """Validate the entire AppSettings instance.

    Checks:
    - Numeric ranges (batch_size > 0, timeout > 0, etc.)
    - Language pair (src != dst)
    - Enum values (output mode, theme, log_level, provider, etc.)
    - Path validity
    """
    result = ValidationResult(is_valid=True)

    def _error(code: str, message: str, field: str = "") -> None:
        nonlocal result
        result.is_valid = False
        result.add_diagnostic(Diagnostic(
            level=DiagnosticLevel.ERROR,
            message=message,
            code=code,
            file_path=field,
        ))

    def _warn(message: str, code: str = "", field: str = "") -> None:
        result.add_diagnostic(Diagnostic(
            level=DiagnosticLevel.WARNING,
            message=message,
            code=code,
            file_path=field,
        ))

    # ---- 4.4 Translation defaults ----
    td = settings.translation_defaults
    if td.default_batch_size <= 0:
        _error("INVALID_NUMERIC_VALUE", "default_batch_size must be > 0", "translation_defaults.default_batch_size")

    # ---- 4.3 Runtime defaults ----
    rd = settings.runtime_defaults
    if rd.default_timeout_sec <= 0:
        _error("INVALID_NUMERIC_VALUE", "default_timeout_sec must be > 0", "runtime_defaults.default_timeout_sec")
    if rd.default_max_retries < 0:
        _error("INVALID_NUMERIC_VALUE", "default_max_retries must be >= 0", "runtime_defaults.default_max_retries")
    if rd.default_temperature < 0:
        _error("INVALID_NUMERIC_VALUE", "default_temperature must be >= 0", "runtime_defaults.default_temperature")
    if rd.default_max_requests_per_minute is not None and rd.default_max_requests_per_minute <= 0:
        _error("INVALID_NUMERIC_VALUE", "default_max_requests_per_minute must be > 0 if set",
               "runtime_defaults.default_max_requests_per_minute")

    # ---- 4.2 Language ----
    lang = settings.language
    if lang.default_src_lang == lang.default_dst_lang:
        _error("SETTINGS_VALIDATION_ERROR", "src_lang and dst_lang must be different", "language")
    if not lang.default_src_lang:
        _error("SETTINGS_VALIDATION_ERROR", "src_lang must not be empty", "language.default_src_lang")
    if not lang.default_dst_lang:
        _error("SETTINGS_VALIDATION_ERROR", "dst_lang must not be empty", "language.default_dst_lang")

    # ---- Enum values ----
    output = settings.output
    if output.default_output_mode not in VALID_OUTPUT_MODES:
        _error("INVALID_ENUM_VALUE",
               f"Invalid output mode: {output.default_output_mode}. Valid: {sorted(VALID_OUTPUT_MODES)}",
               "output.default_output_mode")

    ui = settings.ui
    if ui.theme not in VALID_THEMES:
        _error("INVALID_ENUM_VALUE",
               f"Invalid theme: {ui.theme}. Valid: {sorted(VALID_THEMES)}",
               "ui.theme")

    logging_s = settings.logging
    if logging_s.log_level not in VALID_LOG_LEVELS:
        _error("INVALID_ENUM_VALUE",
               f"Invalid log_level: {logging_s.log_level}. Valid: {sorted(VALID_LOG_LEVELS)}",
               "logging.log_level")

    if rd.default_provider is not None and rd.default_provider not in get_supported_providers():
        _warn(f"Unknown provider: {rd.default_provider}. Validation may fail at runtime.",
              "INVALID_ENUM_VALUE", "runtime_defaults.default_provider")

    if td.default_protection_strategy not in get_supported_protection_strategies():
        _warn(f"Unknown protection strategy: {td.default_protection_strategy}",
              "INVALID_ENUM_VALUE", "translation_defaults.default_protection_strategy")

    if td.default_validator not in get_supported_validators():
        _warn(f"Unknown validator: {td.default_validator}",
              "INVALID_ENUM_VALUE", "translation_defaults.default_validator")

    # ---- 4.5 Prompt defaults ----
    pd_ = settings.prompt_defaults
    if pd_.default_prompt_profile not in get_supported_prompt_profiles():
        _warn(f"Unknown prompt profile: {pd_.default_prompt_profile}",
              "INVALID_ENUM_VALUE", "prompt_defaults.default_prompt_profile")

    # ---- 4.9 Logging ----
    if logging_s.keep_job_logs_days < 0:
        _error("INVALID_NUMERIC_VALUE", "keep_job_logs_days must be >= 0", "logging.keep_job_logs_days")

    # ---- Paths (warn only — paths can be set later) ----
    paths = settings.paths
    for field_name in ("downloaded_mods_dir", "stellaris_mods_dir",
                       "translations_output_dir", "app_cache_dir", "stellaris_cache_path"):
        p = getattr(paths, field_name, None)
        if p is not None:
            vr = validate_path(p, need_read=True)
            if not vr.valid:
                for err in vr.errors:
                    _warn(f"[{field_name}] {err}", "PATH_VALIDATION_WARNING", f"paths.{field_name}")

    # ---- Game settings ----
    gs = settings.game_settings
    # Stellaris: default_file_handler must be "stellaris_localisation"
    if gs.stellaris.default_file_handler != "stellaris_localisation":
        _warn(
            f"Stellaris default_file_handler should be 'stellaris_localisation', "
            f"got '{gs.stellaris.default_file_handler}'",
            "INVALID_ENUM_VALUE",
            "game_settings.stellaris.default_file_handler",
        )
    # Generic: default_file_handler must be in supported set
    SUPPORTED_GENERIC_HANDLERS = frozenset({"plain_text", "json", "yaml"})
    if gs.generic.default_file_handler not in SUPPORTED_GENERIC_HANDLERS:
        _warn(
            f"Generic default_file_handler '{gs.generic.default_file_handler}' "
            f"not in supported set {sorted(SUPPORTED_GENERIC_HANDLERS)}",
            "INVALID_ENUM_VALUE",
            "game_settings.generic.default_file_handler",
        )

    return result
