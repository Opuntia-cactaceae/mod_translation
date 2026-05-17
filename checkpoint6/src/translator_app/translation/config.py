"""Translation Config Module — models, builder, validation, and benchmark interop.

Spec: #15 Translation Config Module
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Nested config models (spec sections 15.1 – 15.4)
# ---------------------------------------------------------------------------


@dataclass
class RuntimeConfig:
    """15.1 Runtime config — provider, model, key reference, retry/throttle."""
    provider: str = ""
    model: str = ""
    api_key_id: str = ""
    api_key_ids: List[str] = field(default_factory=list)
    fallback_models: List[str] = field(default_factory=list)
    temperature: float = 0.0
    max_completion_tokens: Optional[int] = None
    timeout_sec: float = 30.0
    max_retries: int = 3
    max_requests_per_minute: Optional[int] = None


@dataclass
class PromptConfig:
    """15.2 Prompt config — profile reference and template strings."""
    profile_name: str = ""
    batch_system_prompt: str = ""
    batch_user_template: str = ""
    single_system_prompt: str = ""
    single_user_template: str = ""
    log_prompts: bool = False


@dataclass
class ProtectionConfig:
    """15.3 Protection config — strategy name and options."""
    strategy: str = ""
    options: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationConfig:
    """15.4 Validation config — validator name, options, fallback flag."""
    validator_name: str = ""
    options: Dict[str, Any] = field(default_factory=dict)
    allow_fallback_on_json_error: bool = True


@dataclass
class OutputConfig:
    """Output file configuration for translated files.

    Controls where and how translated output is saved.
    Used primarily for generic (non-Stellaris) translations.
    """
    output_dir: str = ""
    root_dir: str = ""
    preserve_relative_path: bool = True
    filename_suffix: str = "_translated"
    overwrite: bool = False
    backup: bool = True


@dataclass
class ConfigMetadata:
    """Metadata attached to every assembled TranslationConfig."""
    created_at: str = ""
    source: str = "default"  # "ui" | "preset" | "profile" | "default"
    preset_id: Optional[str] = None
    profile_id: Optional[str] = None


@dataclass
class TranslationConfig:
    """15. Top-level assembled translation configuration.

    All sub-configs are nested dataclasses.
    Never contains raw API keys — only api_key_id references.
    """
    runtime: RuntimeConfig = field(default_factory=RuntimeConfig)
    prompt: PromptConfig = field(default_factory=PromptConfig)
    protection: ProtectionConfig = field(default_factory=ProtectionConfig)
    validation: ValidationConfig = field(default_factory=ValidationConfig)
    output: OutputConfig = field(default_factory=OutputConfig)
    game: str = "stellaris"
    file_handler: Optional[str] = None
    batch_size: int = 10
    src_lang: str = "en"
    dst_lang: str = "ru"
    use_cache: bool = True
    save_raw_responses: bool = False
    metadata: ConfigMetadata = field(default_factory=ConfigMetadata)


# ---------------------------------------------------------------------------
# BuildConfigInput — what the builder accepts
# ---------------------------------------------------------------------------


@dataclass
class BuildConfigInput:
    """Input contract for config assembly.

    Priority (highest wins):
        override_config > ui_config > profile > preset > settings_defaults
    """
    ui_config: Optional[Dict[str, Any]] = None
    preset_id: Optional[str] = None
    override_config: Optional[Dict[str, Any]] = None
    settings_defaults: Optional[Dict[str, Any]] = None
    translation_profile_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Validation result
# ---------------------------------------------------------------------------


@dataclass
class ConfigValidationError:
    """A single validation error matching the spec error format."""
    code: str = ""
    message: str = ""
    field: str = ""


@dataclass
class ConfigValidationResult:
    """Result of config validation."""
    is_valid: bool = True
    errors: List[ConfigValidationError] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Error codes (spec section "Ошибки")
# ---------------------------------------------------------------------------

CONFIG_VALIDATION_ERROR = "CONFIG_VALIDATION_ERROR"
MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
INVALID_PROVIDER = "INVALID_PROVIDER"
INVALID_MODEL = "INVALID_MODEL"
INVALID_BATCH_SIZE = "INVALID_BATCH_SIZE"
INVALID_PROMPT_TEMPLATE = "INVALID_PROMPT_TEMPLATE"
INVALID_LANGUAGE_PAIR = "INVALID_LANGUAGE_PAIR"
API_KEY_NOT_FOUND = "API_KEY_NOT_FOUND"
INVALID_PROTECTION_STRATEGY = "INVALID_PROTECTION_STRATEGY"
INVALID_VALIDATOR = "INVALID_VALIDATOR"


# ---------------------------------------------------------------------------
# Providers known to require API keys
# ---------------------------------------------------------------------------

_PROVIDERS_REQUIRING_KEY: frozenset = frozenset({"groq", "deepseek"})


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


class TranslationConfigBuilder:
    """Assembles a TranslationConfig from defaults, presets, and UI overrides.

    Integration points:
        * SettingsService / AppSettings — defaults
        * SecretsService — api_key_id existence check
        * PromptPresetRegistry — prompt templates
        * settings.validation.get_supported_* — registry-based value lists
    """

    def __init__(
        self,
        settings_service=None,
        secrets_service=None,
        prompt_preset_registry=None,
        profile_service=None,
    ):
        self._settings_service = settings_service
        self._secrets_service = secrets_service
        self._prompt_preset_registry = prompt_preset_registry
        self._profile_service = profile_service

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def build_config(
        self,
        ui_config: Optional[Dict[str, Any]] = None,
        preset_id: Optional[str] = None,
        override_config: Optional[Dict[str, Any]] = None,
        settings_defaults: Optional[Dict[str, Any]] = None,
        translation_profile_id: Optional[str] = None,
    ) -> TranslationConfig:
        """Assemble a TranslationConfig.

        Priority (highest wins):
            override_config > ui_config > profile > preset > settings_defaults
        """
        # 1. Resolve defaults
        defaults = self._resolve_defaults(settings_defaults)

        # 2. Build from defaults
        runtime = RuntimeConfig(
            provider=defaults.get("provider", ""),
            model=defaults.get("model", ""),
            api_key_id=defaults.get("api_key_id", ""),
            fallback_models=defaults.get("fallback_models", []),
            temperature=defaults.get("temperature", 0.0),
            max_completion_tokens=defaults.get("max_completion_tokens"),
            timeout_sec=defaults.get("timeout_sec", 30.0),
            max_retries=defaults.get("max_retries", 3),
            max_requests_per_minute=defaults.get("max_requests_per_minute"),
        )

        prompt = PromptConfig(
            profile_name=defaults.get("prompt_profile", ""),
            batch_system_prompt=defaults.get("batch_system_prompt", ""),
            batch_user_template=defaults.get("batch_user_template", ""),
            single_system_prompt=defaults.get("single_system_prompt", ""),
            single_user_template=defaults.get("single_user_template", ""),
            log_prompts=defaults.get("log_prompts", False),
        )

        protection = ProtectionConfig(
            strategy=defaults.get("protection_strategy", ""),
            options=defaults.get("protection_options", {}),
        )

        validation = ValidationConfig(
            validator_name=defaults.get("validator_name", ""),
            options=defaults.get("validator_options", {}),
            allow_fallback_on_json_error=defaults.get(
                "allow_fallback_on_json_error", True
            ),
        )

        config = TranslationConfig(
            runtime=runtime,
            prompt=prompt,
            protection=protection,
            validation=validation,
            game=defaults.get("game", "stellaris"),
            batch_size=defaults.get("batch_size", 10),
            src_lang=defaults.get("src_lang", "en"),
            dst_lang=defaults.get("dst_lang", "ru"),
            use_cache=defaults.get("use_cache", True),
            save_raw_responses=defaults.get("save_raw_responses", False),
            metadata=ConfigMetadata(
                created_at=_now_iso(),
                source="default",
                preset_id=None,
            ),
        )

        # Apply output defaults from settings
        if defaults.get("output.output_dir"):
            config.output.output_dir = defaults["output.output_dir"]
        if defaults.get("output.root_dir"):
            config.output.root_dir = defaults["output.root_dir"]

        # 3. Apply preset
        if preset_id:
            config = self._apply_preset(config, preset_id)

        # 3.5 Apply translation profile (above preset, below ui_config)
        if translation_profile_id:
            config = self._apply_translation_profile(config, translation_profile_id)

        # 4. Apply ui_config
        if ui_config:
            config = self._apply_override(config, ui_config)

        # 5. Apply override_config (highest priority)
        if override_config:
            config = self._apply_override(config, override_config)
            config.metadata.source = "ui"

        # 6. Update metadata
        if ui_config and not override_config:
            config.metadata.source = "ui"
        if preset_id:
            config.metadata.preset_id = preset_id
            if config.metadata.source == "default":
                config.metadata.source = "preset"
        if translation_profile_id:
            config.metadata.profile_id = translation_profile_id
            if config.metadata.source == "default":
                config.metadata.source = "profile"

        return config

    def validate_config(self, config: TranslationConfig) -> ConfigValidationResult:
        """Validate a fully assembled TranslationConfig against all rules.

        Returns ConfigValidationResult with error codes matching the spec.
        """
        return _validate_config(
            config,
            secrets_service=self._secrets_service,
            prompt_registry=self._prompt_preset_registry,
        )

    def preview_config(self, config: TranslationConfig) -> Dict[str, Any]:
        """Return a safe dict representation (no raw keys)."""
        d = _config_to_dict(config)
        # Ensure no raw API key leaks
        d.pop("api_key", None)
        return d

    def export_to_benchmark_config(self, config: TranslationConfig) -> Dict[str, Any]:
        """Convert TranslationConfig to a dict compatible with
        translator_benchmark ExperimentConfig."""
        return _to_benchmark_config(config)

    def import_from_benchmark_config(self, data: Dict[str, Any]) -> TranslationConfig:
        """Construct a TranslationConfig from a benchmark ExperimentConfig dict."""
        return _from_benchmark_config(data)

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _resolve_defaults(self, settings_defaults: Optional[Dict]) -> Dict[str, Any]:
        """Pull default values from SettingsService or provided dict."""
        if settings_defaults is not None:
            return dict(settings_defaults)

        if self._settings_service is not None:
            s = self._settings_service.settings
            generic_dir = s.game_settings.generic.output_dir if s.game_settings.generic else ""
            generic_root = s.game_settings.generic.root_dir if s.game_settings.generic else ""
            return {
                "provider": s.runtime_defaults.default_provider or "",
                "model": s.runtime_defaults.default_model or "",
                "api_key_id": "",
                "fallback_models": list(s.runtime_defaults.default_fallback_models or []),
                "temperature": s.runtime_defaults.default_temperature or 0.0,
                "max_completion_tokens": s.runtime_defaults.default_max_completion_tokens,
                "timeout_sec": s.runtime_defaults.default_timeout_sec or 30.0,
                "max_retries": s.runtime_defaults.default_max_retries or 3,
                "max_requests_per_minute": s.runtime_defaults.default_max_requests_per_minute,
                "prompt_profile": s.prompt_defaults.default_prompt_profile or "",
                "batch_system_prompt": "",
                "batch_user_template": "",
                "single_system_prompt": "",
                "single_user_template": "",
                "log_prompts": s.logging.log_raw_prompts or False,
                "protection_strategy": s.translation_defaults.default_protection_strategy or "",
                "protection_options": {},
                "validator_name": s.translation_defaults.default_validator or "",
                "validator_options": {},
                "allow_fallback_on_json_error": s.translation_defaults.default_allow_fallback_on_json_error or True,
                "batch_size": s.translation_defaults.default_batch_size or 10,
                "src_lang": s.language.default_src_lang or "en",
                "dst_lang": s.language.default_dst_lang or "ru",
                # Legacy fallback: default_game and default_file_handler are
                # not TranslationDefaults fields. New code should read game
                # from profiles and file_handler from game_settings.
                "game": getattr(s.translation_defaults, "default_game", None) or "stellaris",
                "file_handler": getattr(s.translation_defaults, "default_file_handler", None),
                "use_cache": s.translation_defaults.default_use_cache if s.translation_defaults.default_use_cache is not None else True,
                "save_raw_responses": s.translation_defaults.default_save_raw_responses or False,
                "output.output_dir": generic_dir,
                "output.root_dir": generic_root,
            }

        return {}

    def _apply_preset(self, config: TranslationConfig, preset_id: str) -> TranslationConfig:
        """Overlay prompt templates from a named preset."""
        preset = None
        if self._prompt_preset_registry is not None:
            preset = self._prompt_preset_registry.get(preset_id)

        if preset is not None:
            config.prompt.profile_name = getattr(preset, "profile_name", config.prompt.profile_name) or config.prompt.profile_name
            if getattr(preset, "batch_system_prompt", None):
                config.prompt.batch_system_prompt = preset.batch_system_prompt
            elif getattr(preset, "system_prompt", None):
                config.prompt.batch_system_prompt = preset.system_prompt
            if getattr(preset, "batch_user_template", None):
                config.prompt.batch_user_template = preset.batch_user_template
            elif getattr(preset, "user_prompt_template", None):
                config.prompt.batch_user_template = preset.user_prompt_template
            if getattr(preset, "single_system_prompt", None):
                config.prompt.single_system_prompt = preset.single_system_prompt
            elif getattr(preset, "system_prompt", None):
                config.prompt.single_system_prompt = preset.system_prompt
            if getattr(preset, "single_user_template", None):
                config.prompt.single_user_template = preset.single_user_template
            elif getattr(preset, "user_prompt_template", None):
                config.prompt.single_user_template = preset.user_prompt_template
        else:
            config.prompt.profile_name = preset_id

        return config

    def _apply_translation_profile(
        self, config: TranslationConfig, profile_id: str
    ) -> TranslationConfig:
        """Overlay config values from a named translation profile."""
        if self._profile_service is None:
            return config
        profile = self._profile_service.get_profile(profile_id)
        if profile is None:
            return config
        # Apply profile config as overrides (handles nested keys)
        return self._apply_override(config, profile.config)

    def _apply_override(self, config: TranslationConfig, overrides: Dict[str, Any]) -> TranslationConfig:
        """Apply a flat override dict onto the nested config.

        Handles both flat keys (e.g. "provider") and prefixed keys
        (e.g. "runtime.provider").
        """
        flat = _flatten_overrides(overrides)

        # Normalize flat keys used in UI / defaults
        for alias_key, target_key in [
            ("prompt_profile", "profile_name"),
            ("protection_strategy", "strategy"),
            ("prompt_preset_id", "_preset_id"),
        ]:
            if alias_key in flat and target_key not in flat:
                flat[target_key] = flat.pop(alias_key)
            elif alias_key in flat:
                flat.pop(alias_key)  # Keep the canonical key

        # Alias: output.dir → output.output_dir (Task 2)
        if "output.dir" in flat and "output.output_dir" not in flat:
            flat["output.output_dir"] = flat.pop("output.dir")
        elif "output.dir" in flat:
            flat.pop("output.dir")

        # Alias: flat api_key_ids / api_key_id → runtime.* (Task 3)
        if "api_key_ids" in flat and "runtime.api_key_ids" not in flat:
            flat["runtime.api_key_ids"] = flat.pop("api_key_ids")
        elif "api_key_ids" in flat:
            flat.pop("api_key_ids")
        if "api_key_id" in flat and "runtime.api_key_id" not in flat:
            flat["runtime.api_key_id"] = flat.pop("api_key_id")
        elif "api_key_id" in flat:
            flat.pop("api_key_id")

        # --- runtime fields ---
        _set_if(flat, config.runtime, "provider")
        _set_if(flat, config.runtime, "model")
        _set_if(flat, config.runtime, "api_key_id")
        _set_if_list(flat, config.runtime, "api_key_ids")
        _set_if(flat, config.runtime, "temperature")
        _set_if_list(flat, config.runtime, "fallback_models")
        _set_if(flat, config.runtime, "max_completion_tokens")
        _set_if(flat, config.runtime, "timeout_sec")
        _set_if(flat, config.runtime, "max_retries")
        _set_if(flat, config.runtime, "max_requests_per_minute")

        # --- prompt fields ---
        _set_if(flat, config.prompt, "profile_name")
        _set_if(flat, config.prompt, "batch_system_prompt")
        _set_if(flat, config.prompt, "batch_user_template")
        _set_if(flat, config.prompt, "single_system_prompt")
        _set_if(flat, config.prompt, "single_user_template")
        _set_if(flat, config.prompt, "log_prompts")

        # --- protection fields ---
        _set_if(flat, config.protection, "strategy")
        _set_if_dict(flat, config.protection, "options")

        # --- validation fields ---
        _set_if(flat, config.validation, "validator_name")
        _set_if_dict(flat, config.validation, "options")
        _set_if(flat, config.validation, "allow_fallback_on_json_error")

        # --- output fields ---
        _set_if(flat, config.output, "output_dir")
        _set_if(flat, config.output, "root_dir")
        _set_if(flat, config.output, "preserve_relative_path")
        _set_if(flat, config.output, "filename_suffix")
        _set_if(flat, config.output, "overwrite")
        _set_if(flat, config.output, "backup")

        # --- top-level fields ---
        _set_if(flat, config, "game")
        _set_if(flat, config, "file_handler")
        _set_if(flat, config, "batch_size")
        _set_if(flat, config, "src_lang")
        _set_if(flat, config, "dst_lang")
        _set_if(flat, config, "use_cache")
        _set_if(flat, config, "save_raw_responses")

        # Runtime prefix keys
        for prefix_key, attr_name in [
            ("runtime.provider", "provider"),
            ("runtime.model", "model"),
            ("runtime.api_key_id", "api_key_id"),
            ("runtime.api_key_ids", "api_key_ids"),
            ("runtime.temperature", "temperature"),
            ("runtime.fallback_models", "fallback_models"),
            ("runtime.max_completion_tokens", "max_completion_tokens"),
            ("runtime.timeout_sec", "timeout_sec"),
            ("runtime.max_retries", "max_retries"),
            ("runtime.max_requests_per_minute", "max_requests_per_minute"),
        ]:
            _set_if(flat, config.runtime, attr_name, key=prefix_key)

        for prefix_key, attr_name in [
            ("prompt.profile_name", "profile_name"),
            ("prompt.batch_system_prompt", "batch_system_prompt"),
            ("prompt.batch_user_template", "batch_user_template"),
            ("prompt.single_system_prompt", "single_system_prompt"),
            ("prompt.single_user_template", "single_user_template"),
            ("prompt.log_prompts", "log_prompts"),
        ]:
            _set_if(flat, config.prompt, attr_name, key=prefix_key)

        for prefix_key, attr_name in [
            ("protection.strategy", "strategy"),
            ("protection.options", "options"),
        ]:
            _set_if(flat, config.protection, attr_name, key=prefix_key)

        for prefix_key, attr_name in [
            ("validation.validator_name", "validator_name"),
            ("validation.options", "options"),
            ("validation.allow_fallback_on_json_error", "allow_fallback_on_json_error"),
        ]:
            _set_if(flat, config.validation, attr_name, key=prefix_key)

        for prefix_key, attr_name in [
            ("output.output_dir", "output_dir"),
            ("output.root_dir", "root_dir"),
            ("output.preserve_relative_path", "preserve_relative_path"),
            ("output.filename_suffix", "filename_suffix"),
            ("output.overwrite", "overwrite"),
            ("output.backup", "backup"),
        ]:
            _set_if(flat, config.output, attr_name, key=prefix_key)

        return config


# ---------------------------------------------------------------------------
# Standalone validation (usable without builder instance)
# ---------------------------------------------------------------------------


def validate_config(
    config: TranslationConfig,
    secrets_service=None,
    prompt_registry=None,
) -> ConfigValidationResult:
    """Validate a fully assembled TranslationConfig."""
    return _validate_config(config, secrets_service, prompt_registry)


def _validate_config(config, secrets_service=None, prompt_registry=None):
    result = ConfigValidationResult(is_valid=True)

    def _error(code: str, message: str, field: str = "") -> None:
        result.is_valid = False
        result.errors.append(ConfigValidationError(code=code, message=message, field=field))

    # ---- Required fields ----
    if not config.runtime.provider:
        _error(MISSING_REQUIRED_FIELD, "Provider is required", "runtime.provider")
    if not config.runtime.model:
        _error(MISSING_REQUIRED_FIELD, "Model is required", "runtime.model")
    if not config.src_lang:
        _error(MISSING_REQUIRED_FIELD, "src_lang is required", "src_lang")
    if not config.dst_lang:
        _error(MISSING_REQUIRED_FIELD, "dst_lang is required", "dst_lang")
    if config.batch_size < 1:
        _error(MISSING_REQUIRED_FIELD, "batch_size must be >= 1", "batch_size")
    if not config.prompt.profile_name:
        _error(MISSING_REQUIRED_FIELD, "Prompt profile_name is required", "prompt.profile_name")

    # ---- Runtime validation ----
    supported_providers = _get_supported_providers()
    if config.runtime.provider and config.runtime.provider not in supported_providers:
        _error(
            INVALID_PROVIDER,
            f"Unknown provider: {config.runtime.provider}. Supported: {sorted(supported_providers)}",
            "runtime.provider",
        )

    if config.runtime.timeout_sec <= 0:
        _error(CONFIG_VALIDATION_ERROR, "timeout_sec must be > 0", "runtime.timeout_sec")

    if config.runtime.max_retries < 0:
        _error(CONFIG_VALIDATION_ERROR, "max_retries must be >= 0", "runtime.max_retries")

    # api_key_id existence check
    if config.runtime.api_key_id:
        if secrets_service is not None:
            existing = secrets_service.get_key(config.runtime.api_key_id)
            if existing is None:
                _error(
                    API_KEY_NOT_FOUND,
                    f"API key not found: {config.runtime.api_key_id}",
                    "runtime.api_key_id",
                )
    elif config.runtime.provider in _PROVIDERS_REQUIRING_KEY:
        _error(
            API_KEY_NOT_FOUND,
            f"Provider '{config.runtime.provider}' requires an API key",
            "runtime.api_key_id",
        )

    # ---- Language validation ----
    if config.src_lang == config.dst_lang:
        _error(
            INVALID_LANGUAGE_PAIR,
            f"src_lang and dst_lang must be different (both are '{config.src_lang}')",
            "src_lang",
        )

    # ---- Prompt validation ----
    supported_profiles = _get_supported_prompt_profiles()
    if config.prompt.profile_name and config.prompt.profile_name not in supported_profiles:
        _error(
            CONFIG_VALIDATION_ERROR,
            f"Unknown prompt profile: {config.prompt.profile_name}. Supported: {sorted(supported_profiles)}",
            "prompt.profile_name",
        )

    # Check batch template for batch-capable profiles
    profile_name = config.prompt.profile_name
    is_batch_profile = profile_name in ("json_batch", "strict_json_batch")
    if is_batch_profile:
        if "{texts}" not in config.prompt.batch_user_template:
            _error(
                INVALID_PROMPT_TEMPLATE,
                "Batch user template must contain {texts}",
                "prompt.batch_user_template",
            )

    # Check single template always
    if config.prompt.single_user_template and "{text}" not in config.prompt.single_user_template:
        _error(
            INVALID_PROMPT_TEMPLATE,
            "Single user template must contain {text}",
            "prompt.single_user_template",
        )

    # Check for unknown placeholders in templates
    _check_unknown_placeholders(config, _error)

    # ---- Protection validation ----
    if config.protection.strategy:
        supported_strategies = _get_supported_protection_strategies()
        if config.protection.strategy not in supported_strategies:
            _error(
                INVALID_PROTECTION_STRATEGY,
                f"Unknown protection strategy: {config.protection.strategy}. "
                f"Supported: {sorted(supported_strategies)}",
                "protection.strategy",
            )

    # ---- Validation config validation ----
    if config.validation.validator_name:
        supported_validators = _get_supported_validators()
        if config.validation.validator_name not in supported_validators:
            _error(
                INVALID_VALIDATOR,
                f"Unknown validator: {config.validation.validator_name}. "
                f"Supported: {sorted(supported_validators)}",
                "validation.validator_name",
            )

    return result


def _check_unknown_placeholders(config, error_fn) -> None:
    """Scan prompt templates for unknown placeholders (not {text}, {texts},
    {src_lang}, {dst_lang})."""
    KNOWN = frozenset({"text", "texts", "src_lang", "dst_lang", "src_lang_code", "dst_lang_code"})
    for field_name, template in [
        ("prompt.batch_user_template", config.prompt.batch_user_template),
        ("prompt.single_user_template", config.prompt.single_user_template),
        ("prompt.batch_system_prompt", config.prompt.batch_system_prompt),
        ("prompt.single_system_prompt", config.prompt.single_system_prompt),
    ]:
        if not template:
            continue
        unknowns = _find_unknown_placeholders(template, KNOWN)
        if unknowns:
            error_fn(
                INVALID_PROMPT_TEMPLATE,
                f"Unknown placeholder(s) in {field_name}: {', '.join(sorted(unknowns))}",
                field_name,
            )


def _find_unknown_placeholders(template: str, known: frozenset) -> List[str]:
    """Find placeholders in a template string not present in *known*."""
    import re

    found = set()
    for m in re.finditer(r"\{(\w+)\}", template):
        name = m.group(1)
        if name not in known:
            found.add(name)
    return sorted(found)


# ---------------------------------------------------------------------------
# Benchmark interop
# ---------------------------------------------------------------------------


def _to_benchmark_config(config: TranslationConfig) -> Dict[str, Any]:
    """Convert TranslationConfig to a benchmark ExperimentConfig-compatible dict."""
    return {
        "experiment_id": f"translation_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "dataset": {
            "dataset_id": "",
            "sqlite_path": "",
            "query_mode": "full",
            "limit": None,
            "filters": {},
        },
        "runtime": {
            "provider": config.runtime.provider,
            "model_name": config.runtime.model,
            "api_keys": [config.runtime.api_key_id] if config.runtime.api_key_id else [],
            "base_url": None,
            "fallback_models": list(config.runtime.fallback_models),
            "timeout_sec": config.runtime.timeout_sec,
            "max_retries": config.runtime.max_retries,
            "max_requests_per_minute": config.runtime.max_requests_per_minute,
            "temperature": config.runtime.temperature,
            "max_completion_tokens": config.runtime.max_completion_tokens,
        },
        "prompt": {
            "profile_name": config.prompt.profile_name,
            "system_prompt": None,
            "user_template": config.prompt.batch_user_template or config.prompt.single_user_template,
            "batch_mode": config.prompt.profile_name in ("json_batch", "strict_json_batch"),
            "expects_json_array": config.prompt.profile_name in ("json_batch", "strict_json_batch"),
            "log_prompts": config.prompt.log_prompts,
            "batch_system_prompt": config.prompt.batch_system_prompt or None,
            "batch_user_template": config.prompt.batch_user_template or None,
            "single_system_prompt": config.prompt.single_system_prompt or None,
            "single_user_template": config.prompt.single_user_template or None,
        },
        "protection": {
            "strategy_name": config.protection.strategy,
            "options": dict(config.protection.options),
        },
        "validation": {
            "validator_name": config.validation.validator_name,
            "options": dict(config.validation.options),
            "allow_fallback_on_json_error": config.validation.allow_fallback_on_json_error,
        },
        "batch_size": config.batch_size,
        "src_lang": config.src_lang,
        "dst_lang": config.dst_lang,
        "game": config.game,
        "file_handler": config.file_handler,
        "use_cache": config.use_cache,
        "save_raw_responses": config.save_raw_responses,
        "output": {
            "output_dir": config.output.output_dir,
            "root_dir": config.output.root_dir,
            "preserve_relative_path": config.output.preserve_relative_path,
            "filename_suffix": config.output.filename_suffix,
            "overwrite": config.output.overwrite,
            "backup": config.output.backup,
        },
    }


def _from_benchmark_config(data: Dict[str, Any]) -> TranslationConfig:
    """Construct TranslationConfig from a benchmark ExperimentConfig dict."""
    r = data.get("runtime", {})
    p = data.get("prompt", {})
    prot = data.get("protection", {})
    v = data.get("validation", {})
    o = data.get("output", {})

    return TranslationConfig(
        runtime=RuntimeConfig(
            provider=r.get("provider", ""),
            model=r.get("model_name", ""),
            api_key_id=r.get("api_keys", [""])[0] if r.get("api_keys") else "",
            fallback_models=list(r.get("fallback_models", [])),
            temperature=r.get("temperature", 0.0),
            max_completion_tokens=r.get("max_completion_tokens"),
            timeout_sec=r.get("timeout_sec", 30.0),
            max_retries=r.get("max_retries", 3),
            max_requests_per_minute=r.get("max_requests_per_minute"),
        ),
        prompt=PromptConfig(
            profile_name=p.get("profile_name", ""),
            batch_system_prompt=p.get("batch_system_prompt") or "",
            batch_user_template=p.get("batch_user_template") or "",
            single_system_prompt=p.get("single_system_prompt") or "",
            single_user_template=p.get("single_user_template") or "",
            log_prompts=p.get("log_prompts", False),
        ),
        protection=ProtectionConfig(
            strategy=prot.get("strategy_name", ""),
            options=dict(prot.get("options", {})),
        ),
        validation=ValidationConfig(
            validator_name=v.get("validator_name", ""),
            options=dict(v.get("options", {})),
            allow_fallback_on_json_error=v.get("allow_fallback_on_json_error", True),
        ),
        output=OutputConfig(
            output_dir=o.get("output_dir", ""),
            root_dir=o.get("root_dir", ""),
            preserve_relative_path=o.get("preserve_relative_path", True),
            filename_suffix=o.get("filename_suffix", "_translated"),
            overwrite=o.get("overwrite", False),
            backup=o.get("backup", True),
        ),
        batch_size=data.get("batch_size", 10),
        src_lang=data.get("src_lang", "en"),
        dst_lang=data.get("dst_lang", "ru"),
        game=data.get("game", "stellaris"),
        file_handler=data.get("file_handler"),
        use_cache=data.get("use_cache", True),
        save_raw_responses=data.get("save_raw_responses", False),
        metadata=ConfigMetadata(
            created_at=_now_iso(),
            source="benchmark_import",
            preset_id=None,
        ),
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _flatten_overrides(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """Recursively flatten nested override dict.

    Keys like ``{"runtime": {"provider": "groq"}}`` become
    ``{"runtime.provider": "groq"}``.
    Also keeps flat keys as-is.
    Non-dict values (including lists) are preserved at their leaf level.

    Dict-typed config fields (``options`` under protection/validation)
    are preserved as opaque dict values — NOT recursively flattened.
    """
    result: Dict[str, Any] = {}
    for key, val in d.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(val, dict) and key != "options":
            result.update(_flatten_overrides(val, prefix=full_key))
        else:
            result[full_key] = val
    return result


def _set_if(src: dict, obj, attr: str, key: Optional[str] = None) -> None:
    """Set *attr* on *obj* if *key* (or *attr*) exists in *src*."""
    k = key if key is not None else attr
    if k in src and src[k] is not None:
        setattr(obj, attr, src[k])


def _set_if_list(src: dict, obj, attr: str) -> None:
    """Set a list attribute from source if present."""
    if attr in src and src[attr] is not None:
        val = src[attr]
        if isinstance(val, list):
            setattr(obj, attr, list(val))


def _set_if_dict(src: dict, obj, attr: str) -> None:
    """Set a dict attribute from source if present."""
    if attr in src and src[attr] is not None:
        val = src[attr]
        if isinstance(val, dict):
            setattr(obj, attr, dict(val))


def _config_to_dict(config: TranslationConfig) -> Dict[str, Any]:
    """Recursively convert a config dataclass tree to a plain dict."""
    return asdict(config)


def config_from_dict(data: Optional[Dict[str, Any]]) -> Optional[TranslationConfig]:
    """Rehydrate a ``TranslationConfig`` from a plain dict.

    Handles both flat keys (``batch_size``, ``src_lang``, …) and nested
    sub-configs (``runtime``, ``prompt``, …).  Missing keys get the dataclass
    default, so a partial dict round-trips safely.

    Returns ``None`` when *data* is ``None``.
    """
    if data is None:
        return None
    flat = dict(data)  # shallow copy, we'll pop nested keys
    sub_configs: Dict[str, type] = {
        "runtime": RuntimeConfig,
        "prompt": PromptConfig,
        "protection": ProtectionConfig,
        "validation": ValidationConfig,
        "output": OutputConfig,
        "metadata": ConfigMetadata,
    }
    kwargs: Dict[str, Any] = {}
    for key, cls in sub_configs.items():
        val = flat.pop(key, None)
        if isinstance(val, dict):
            kwargs[key] = cls(**{k: v for k, v in val.items() if k in cls.__dataclass_fields__})
        else:
            kwargs[key] = cls()  # factory default
    kwargs.update(flat)
    return TranslationConfig(**{k: v for k, v in kwargs.items() if k in TranslationConfig.__dataclass_fields__})


# ---------------------------------------------------------------------------
# Resolver proxies (memoised wrappers around settings.validation)
# ---------------------------------------------------------------------------


def _get_supported_providers() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_providers as _res

        return _res()
    except Exception:
        return frozenset({"groq", "deepseek"})


def _get_supported_prompt_profiles() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_prompt_profiles as _res

        return _res()
    except Exception:
        return frozenset({"simple_single", "json_batch", "strict_json_batch"})


def _get_supported_protection_strategies() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_protection_strategies as _res

        return _res()
    except Exception:
        return frozenset({"none", "legacy_game_tokens", "xml_placeholders"})


def _get_supported_validators() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_validators as _res

        return _res()
    except Exception:
        return frozenset({"composite"})
