"""Translation Profiles Module — models, service, validation, and JSON storage.

Spec: Translation Profiles
"""

import json
import os
import shutil
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_PLACEHOLDERS = frozenset({"text", "texts", "src_lang", "dst_lang", "src_lang_code", "dst_lang_code"})
"""Placeholder names allowed in any prompt template."""

BATCH_PROFILES = frozenset({"json_batch", "strict_json_batch"})
"""Profile names that use batch mode and require {texts}."""

# Well-known supported values (used as baseline, runtime may extend)
KNOWN_PROVIDERS = frozenset({
    "openai", "groq", "deepseek", "anthropic", "google", "together",
    "mistral", "cohere", "azure", "ollama", "custom",
})
KNOWN_PROMPT_PROFILES = frozenset({
    "simple_single", "json_batch", "strict_json_batch", "strict_json_stellaris",
})
KNOWN_PROTECTION_STRATEGIES = frozenset({
    "none", "legacy_game_tokens", "xml_placeholders", "placeholder",
})
KNOWN_VALIDATORS = frozenset({
    "json_batch", "plain_text", "composite", "roundtrip", "strict_json",
})

# Error codes
PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND"
INVALID_PROFILE_FORMAT = "INVALID_PROFILE_FORMAT"
INVALID_GAME = "INVALID_GAME"
INVALID_FILE_HANDLER = "INVALID_FILE_HANDLER"
INVALID_RUNTIME = "INVALID_RUNTIME"
INVALID_LANGUAGE_PAIR = "INVALID_LANGUAGE_PAIR"
INVALID_BATCH_SIZE = "INVALID_BATCH_SIZE"
INVALID_PROMPT_PROFILE = "INVALID_PROMPT_PROFILE"
INVALID_PROTECTION_STRATEGY = "INVALID_PROTECTION_STRATEGY"
INVALID_VALIDATOR = "INVALID_VALIDATOR"
MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
IMPORT_FAILED = "IMPORT_FAILED"
EXPORT_FAILED = "EXPORT_FAILED"


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------


@dataclass
class ProfileDiagnostic:
    """Validation diagnostic for a profile field."""
    level: str = "error"  # "error" | "warning" | "info"
    code: str = ""
    message: str = ""
    field: str = ""


# ---------------------------------------------------------------------------
# Timestamp / ID helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# TranslationProfile model
# ---------------------------------------------------------------------------


@dataclass
class TranslationProfile:
    """A saved translation configuration profile.

    Bundles runtime, prompt, protection, validation, and output settings
    into a named, versioned entity. System profiles are read-only.
    """
    id: str = field(default_factory=_uuid_id)
    name: str = ""
    description: str = ""
    game: str = "stellaris"
    file_handler: Optional[str] = None
    config: Dict[str, Any] = field(default_factory=dict)
    is_system: bool = False
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)

    def __post_init__(self):
        if not self.id:
            self.id = _uuid_id()
        now = _now_iso()
        if not self.created_at:
            self.created_at = now
        if not self.updated_at:
            self.updated_at = now


# ---------------------------------------------------------------------------
# System profiles (code-defined, read-only)
# ---------------------------------------------------------------------------

_SYSTEM_STELLARIS_STRICT = TranslationProfile(
    id="stellaris_enru_strict",
    name="Stellaris EN\u2192RU strict",
    description="Stellaris localisation with strict JSON batch prompt, "
                "legacy game token protection, and JSON batch validation.",
    game="stellaris",
    file_handler="stellaris_localisation",
    config={
        "src_lang": "en",
        "dst_lang": "ru",
        "batch_size": 20,
        "use_cache": True,
        "save_raw_responses": False,
        "runtime": {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "temperature": 0.0,
            "max_completion_tokens": 4096,
            "timeout_sec": 60,
            "max_retries": 3,
        },
        "prompt": {
            "profile_name": "strict_json_stellaris",
        },
        "protection": {
            "strategy": "legacy_game_tokens",
            "options": {},
        },
        "validation": {
            "validator_name": "json_batch",
            "options": {},
            "allow_fallback_on_json_error": True,
        },
        "output": {
            "preserve_relative_path": True,
        },
    },
    is_system=True,
)

_SYSTEM_GENERIC_JSON = TranslationProfile(
    id="generic_json_enru",
    name="Generic JSON EN\u2192RU",
    description="Generic JSON file translation with strict JSON batch prompt.",
    game="generic",
    file_handler="json",
    config={
        "src_lang": "en",
        "dst_lang": "ru",
        "batch_size": 20,
        "use_cache": True,
        "save_raw_responses": False,
        "runtime": {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "temperature": 0.0,
            "max_completion_tokens": 4096,
            "timeout_sec": 60,
            "max_retries": 3,
        },
        "prompt": {
            "profile_name": "strict_json_batch",
        },
        "protection": {
            "strategy": "none",
            "options": {},
        },
        "validation": {
            "validator_name": "json_batch",
            "options": {},
            "allow_fallback_on_json_error": True,
        },
        "output": {
            "preserve_relative_path": True,
        },
    },
    is_system=True,
)

_SYSTEM_GENERIC_YAML = TranslationProfile(
    id="generic_yaml_enru",
    name="Generic YAML EN\u2192RU",
    description="Generic YAML file translation with strict JSON batch prompt.",
    game="generic",
    file_handler="yaml",
    config={
        "src_lang": "en",
        "dst_lang": "ru",
        "batch_size": 20,
        "use_cache": True,
        "save_raw_responses": False,
        "runtime": {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "temperature": 0.0,
            "max_completion_tokens": 4096,
            "timeout_sec": 60,
            "max_retries": 3,
        },
        "prompt": {
            "profile_name": "strict_json_batch",
        },
        "protection": {
            "strategy": "none",
            "options": {},
        },
        "validation": {
            "validator_name": "json_batch",
            "options": {},
            "allow_fallback_on_json_error": True,
        },
        "output": {
            "preserve_relative_path": True,
        },
    },
    is_system=True,
)

_SYSTEM_GENERIC_TEXT = TranslationProfile(
    id="generic_text_enru",
    name="Generic Text EN\u2192RU",
    description="Generic plain text file translation with simple single prompt.",
    game="generic",
    file_handler="plain_text",
    config={
        "src_lang": "en",
        "dst_lang": "ru",
        "batch_size": 1,
        "use_cache": True,
        "save_raw_responses": False,
        "runtime": {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "temperature": 0.0,
            "max_completion_tokens": 4096,
            "timeout_sec": 60,
            "max_retries": 3,
        },
        "prompt": {
            "profile_name": "simple_single",
        },
        "protection": {
            "strategy": "none",
            "options": {},
        },
        "validation": {
            "validator_name": "plain_text",
            "options": {},
            "allow_fallback_on_json_error": False,
        },
        "output": {
            "preserve_relative_path": True,
        },
    },
    is_system=True,
)

_SYSTEM_PROFILES: Dict[str, TranslationProfile] = {
    "stellaris_enru_strict": _SYSTEM_STELLARIS_STRICT,
    "generic_json_enru": _SYSTEM_GENERIC_JSON,
    "generic_yaml_enru": _SYSTEM_GENERIC_YAML,
    "generic_text_enru": _SYSTEM_GENERIC_TEXT,
}


# ---------------------------------------------------------------------------
# Placeholder validation helpers
# ---------------------------------------------------------------------------

import re

_PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")


def _find_placeholders(template: str) -> List[str]:
    """Extract all ``{placeholder}`` names from a template string."""
    return _PLACEHOLDER_RE.findall(template)


def _check_unknown_placeholders(template: str) -> List[str]:
    """Return sorted list of placeholder names not in ALLOWED_PLACEHOLDERS."""
    found = _find_placeholders(template)
    return sorted(n for n in found if n not in ALLOWED_PLACEHOLDERS)


def _check_missing_placeholders(template: str, required: set) -> List[str]:
    """Return sorted list of required placeholders that are missing."""
    found = set(_find_placeholders(template))
    return sorted(required - found)


# ---------------------------------------------------------------------------
# Supported value resolvers (lazy imports to avoid cycles)
# ---------------------------------------------------------------------------


def _get_supported_games() -> frozenset:
    try:
        from translator_app.games.registry import list_games
        return frozenset(g["id"] for g in list_games())  # type: ignore
    except Exception:
        return frozenset({"stellaris", "generic"})


def _get_supported_file_handlers(game: str) -> frozenset:
    try:
        from translator_app.games.registry import list_file_handlers
        return frozenset(h["id"] for h in list_file_handlers(game))  # type: ignore
    except Exception:
        return frozenset()


def _get_supported_providers() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_providers as _res
        result = _res()
        if result:
            return KNOWN_PROVIDERS | frozenset(result)
    except Exception:
        pass
    return KNOWN_PROVIDERS


def _get_supported_prompt_profiles() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_prompt_profiles as _res
        result = _res()
        if result:
            return KNOWN_PROMPT_PROFILES | frozenset(result)
    except Exception:
        pass
    return KNOWN_PROMPT_PROFILES


def _get_supported_protection_strategies() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_protection_strategies as _res
        result = _res()
        if result:
            return KNOWN_PROTECTION_STRATEGIES | frozenset(result)
    except Exception:
        pass
    return KNOWN_PROTECTION_STRATEGIES


def _get_supported_validators() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_validators as _res
        result = _res()
        if result:
            return KNOWN_VALIDATORS | frozenset(result)
    except Exception:
        pass
    return KNOWN_VALIDATORS


# ---------------------------------------------------------------------------
# TranslationProfileService
# ---------------------------------------------------------------------------


class TranslationProfileService:
    """Full-featured service for translation profile CRUD, validation, import/export.

    * JSON persistence with atomic writes.
    * Corrupted file backup.
    * System profiles are read-only.
    """

    def __init__(self, store_path: Optional[str] = None):
        self._store_path = store_path
        self._profiles: Dict[str, TranslationProfile] = {}
        self._load_system_profiles()
        if store_path:
            self._load_user_profiles()

    # ------------------------------------------------------------------
    # System profiles
    # ------------------------------------------------------------------

    def _load_system_profiles(self) -> None:
        for pid, profile in _SYSTEM_PROFILES.items():
            self._profiles[pid] = profile

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def list_profiles(self) -> List[TranslationProfile]:
        """Return all profiles (system + user)."""
        return list(self._profiles.values())

    def get_profile(self, profile_id: str) -> Optional[TranslationProfile]:
        """Get a profile by its id."""
        return self._profiles.get(profile_id)

    def create_profile(
        self,
        name: str,
        game: str = "stellaris",
        file_handler: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        description: str = "",
    ) -> TranslationProfile:
        """Create a new user profile with the given fields."""
        now = _now_iso()
        profile = TranslationProfile(
            id=_uuid_id(),
            name=name,
            description=description,
            game=game,
            file_handler=file_handler,
            config=config or {},
            is_system=False,
            created_at=now,
            updated_at=now,
        )
        self._profiles[profile.id] = profile
        self._save()
        return profile

    def update_profile(
        self,
        profile_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        game: Optional[str] = None,
        file_handler: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> TranslationProfile:
        """Update an existing user profile. System profiles cannot be updated."""
        profile = self._profiles.get(profile_id)
        if profile is None:
            raise ValueError(f"Profile not found: {profile_id}")
        if profile.is_system:
            raise ValueError("System profiles cannot be modified")

        if name is not None:
            profile.name = name
        if description is not None:
            profile.description = description
        if game is not None:
            profile.game = game
        if file_handler is not None:
            profile.file_handler = file_handler
        if config is not None:
            profile.config = dict(config)

        profile.updated_at = _now_iso()
        self._save()
        return profile

    def delete_profile(self, profile_id: str) -> bool:
        """Delete a user profile. System profiles cannot be deleted."""
        profile = self._profiles.get(profile_id)
        if profile is None:
            return False
        if profile.is_system:
            raise ValueError("System profiles cannot be deleted")
        del self._profiles[profile_id]
        self._save()
        return True

    def copy_profile(self, profile_id: str, new_name: str) -> TranslationProfile:
        """Copy any profile (system or user) into a new editable user profile."""
        source = self._profiles.get(profile_id)
        if source is None:
            raise ValueError(f"Profile not found: {profile_id}")

        now = _now_iso()
        new_profile = TranslationProfile(
            id=_uuid_id(),
            name=new_name,
            description=source.description,
            game=source.game,
            file_handler=source.file_handler,
            config=dict(source.config),
            is_system=False,
            created_at=now,
            updated_at=now,
        )
        self._profiles[new_profile.id] = new_profile
        self._save()
        return new_profile

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def validate_profile(self, profile: TranslationProfile) -> List[ProfileDiagnostic]:
        """Validate a profile and return diagnostics.

        Checks:
        * name not empty.
        * game exists in games registry.
        * file_handler is allowed for game.
        * runtime.provider/model present.
        * src_lang != dst_lang.
        * batch_size >= 1.
        * prompt.profile_name present and known.
        * protection strategy known (if set).
        * validator known (if set).
        * prompt templates contain required placeholders.
        """
        diagnostics: List[ProfileDiagnostic] = []

        # --- name ---
        if not profile.name.strip():
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=MISSING_REQUIRED_FIELD,
                message="Profile name is required",
                field="name",
            ))

        # --- game ---
        supported_games = _get_supported_games()
        if profile.game and profile.game not in supported_games:
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=INVALID_GAME,
                message=f"Unknown game: {profile.game}. Supported: {sorted(supported_games)}",
                field="game",
            ))

        # --- file_handler ---
        if profile.file_handler:
            supported_handlers = _get_supported_file_handlers(profile.game)
            if supported_handlers and profile.file_handler not in supported_handlers:
                diagnostics.append(ProfileDiagnostic(
                    level="error",
                    code=INVALID_FILE_HANDLER,
                    message=f"File handler '{profile.file_handler}' not allowed for game '{profile.game}'. "
                            f"Allowed: {sorted(supported_handlers)}",
                    field="file_handler",
                ))

        cfg = profile.config or {}

        # --- runtime ---
        runtime = cfg.get("runtime", {}) if isinstance(cfg.get("runtime"), dict) else {}
        if not runtime.get("provider"):
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=MISSING_REQUIRED_FIELD,
                message="Runtime provider is required",
                field="config.runtime.provider",
            ))
        elif runtime.get("provider") not in _get_supported_providers():
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=INVALID_RUNTIME,
                message=f"Unknown provider: {runtime.get('provider')}. "
                        f"Supported: {sorted(_get_supported_providers())}",
                field="config.runtime.provider",
            ))
        if not runtime.get("model"):
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=MISSING_REQUIRED_FIELD,
                message="Runtime model is required",
                field="config.runtime.model",
            ))

        # --- src_lang / dst_lang ---
        src_lang = cfg.get("src_lang", "")
        dst_lang = cfg.get("dst_lang", "")
        if src_lang and dst_lang and src_lang == dst_lang:
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=INVALID_LANGUAGE_PAIR,
                message=f"src_lang and dst_lang must be different (both are '{src_lang}')",
                field="config.src_lang",
            ))

        # --- batch_size ---
        batch_size = cfg.get("batch_size", 10)
        if isinstance(batch_size, (int, float)) and batch_size < 1:
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=INVALID_BATCH_SIZE,
                message="batch_size must be >= 1",
                field="config.batch_size",
            ))

        # --- prompt ---
        prompt = cfg.get("prompt", {}) if isinstance(cfg.get("prompt"), dict) else {}
        profile_name = prompt.get("profile_name", "")
        if not profile_name:
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=MISSING_REQUIRED_FIELD,
                message="Prompt profile_name is required",
                field="config.prompt.profile_name",
            ))
        elif profile_name not in _get_supported_prompt_profiles():
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=INVALID_PROMPT_PROFILE,
                message=f"Unknown prompt profile: {profile_name}. "
                        f"Supported: {sorted(_get_supported_prompt_profiles())}",
                field="config.prompt.profile_name",
            ))

        # --- prompt template placeholders ---
        is_batch = profile_name in BATCH_PROFILES
        batch_user_template = prompt.get("batch_user_template", "")
        single_user_template = prompt.get("single_user_template", "")

        if is_batch and batch_user_template:
            missing = _check_missing_placeholders(batch_user_template, {"texts"})
            if missing:
                diagnostics.append(ProfileDiagnostic(
                    level="error",
                    code=INVALID_PROFILE_FORMAT,
                    message="Batch user template must contain {texts}",
                    field="config.prompt.batch_user_template",
                ))
            unknowns = _check_unknown_placeholders(batch_user_template)
            for u in unknowns:
                diagnostics.append(ProfileDiagnostic(
                    level="error",
                    code=INVALID_PROFILE_FORMAT,
                    message=f"Unknown placeholder '{{{u}}}' in batch_user_template",
                    field="config.prompt.batch_user_template",
                ))

        if single_user_template:
            missing = _check_missing_placeholders(single_user_template, {"text"})
            if missing:
                diagnostics.append(ProfileDiagnostic(
                    level="error",
                    code=INVALID_PROFILE_FORMAT,
                    message="Single user template must contain {text}",
                    field="config.prompt.single_user_template",
                ))
            unknowns = _check_unknown_placeholders(single_user_template)
            for u in unknowns:
                diagnostics.append(ProfileDiagnostic(
                    level="error",
                    code=INVALID_PROFILE_FORMAT,
                    message=f"Unknown placeholder '{{{u}}}' in single_user_template",
                    field="config.prompt.single_user_template",
                ))

        # --- protection ---
        protection = cfg.get("protection", {}) if isinstance(cfg.get("protection"), dict) else {}
        strategy = protection.get("strategy", "")
        if strategy and strategy not in _get_supported_protection_strategies():
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=INVALID_PROTECTION_STRATEGY,
                message=f"Unknown protection strategy: {strategy}. "
                        f"Supported: {sorted(_get_supported_protection_strategies())}",
                field="config.protection.strategy",
            ))

        # --- validation ---
        validation = cfg.get("validation", {}) if isinstance(cfg.get("validation"), dict) else {}
        validator_name = validation.get("validator_name", "")
        if validator_name and validator_name not in _get_supported_validators():
            diagnostics.append(ProfileDiagnostic(
                level="error",
                code=INVALID_VALIDATOR,
                message=f"Unknown validator: {validator_name}. "
                        f"Supported: {sorted(_get_supported_validators())}",
                field="config.validation.validator_name",
            ))

        return diagnostics

    # ------------------------------------------------------------------
    # Export / Import
    # ------------------------------------------------------------------

    def export_profile(self, profile_id: str) -> Dict[str, Any]:
        """Export a profile as a JSON-serializable dict (no system/internal fields)."""
        profile = self._profiles.get(profile_id)
        if profile is None:
            raise ValueError(f"Profile not found: {profile_id}")

        return {
            "name": profile.name,
            "description": profile.description,
            "game": profile.game,
            "file_handler": profile.file_handler,
            "config": dict(profile.config),
        }

    def import_profile(self, data: Dict[str, Any]) -> TranslationProfile:
        """Import a profile from a JSON dict.

        Validates:
        * Structure (required keys exist).
        * Profile data is valid via validate_profile.
        """
        if "name" not in data or not data.get("name"):
            raise ValueError("Import requires a 'name' field")
        if "game" not in data or not data.get("game"):
            raise ValueError("Import requires a 'game' field")
        if "config" not in data or not data.get("config"):
            raise ValueError("Import requires a 'config' field")

        name = data["name"]
        game = data["game"]
        file_handler = data.get("file_handler")
        config = data.get("config", {})
        description = data.get("description", "")

        # Validate via temporary profile
        tmp = TranslationProfile(
            name=name,
            game=game,
            file_handler=file_handler,
            config=config,
            description=description,
        )
        diagnostics = self.validate_profile(tmp)
        errors = [d for d in diagnostics if d.level == "error"]
        if errors:
            raise ValueError(f"Validation failed: {errors[0].message}")

        return self.create_profile(
            name=name,
            game=game,
            file_handler=file_handler,
            config=config,
            description=description,
        )

    # ------------------------------------------------------------------
    # JSON persistence
    # ------------------------------------------------------------------

    def _serialize_user_profiles(self) -> Dict[str, Any]:
        """Serialize only user profiles (system profiles are not persisted)."""
        profiles = {}
        for pid, profile in self._profiles.items():
            if profile.is_system:
                continue
            profiles[pid] = {
                "id": profile.id,
                "name": profile.name,
                "description": profile.description,
                "game": profile.game,
                "file_handler": profile.file_handler,
                "config": dict(profile.config),
                "is_system": profile.is_system,
                "created_at": profile.created_at,
                "updated_at": profile.updated_at,
            }
        return {"profiles": profiles}

    @staticmethod
    def _deserialize_profile(item: dict) -> TranslationProfile:
        return TranslationProfile(
            id=str(item.get("id", _uuid_id())),
            name=str(item.get("name", "")),
            description=str(item.get("description", "")),
            game=str(item.get("game", "stellaris")),
            file_handler=item.get("file_handler"),
            config=dict(item.get("config", {})),
            is_system=bool(item.get("is_system", False)),
            created_at=str(item.get("created_at", _now_iso())),
            updated_at=str(item.get("updated_at", _now_iso())),
        )

    def _load_user_profiles(self) -> None:
        if not self._store_path:
            return
        path = Path(self._store_path)
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for pid, item in data.get("profiles", {}).items():
                rec = self._deserialize_profile(item)
                self._profiles[rec.id] = rec
        except (json.JSONDecodeError, TypeError, KeyError):
            self._backup_corrupted(str(path))

    def _save(self) -> None:
        if not self._store_path:
            return
        path = Path(self._store_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        data = self._serialize_user_profiles()
        content = json.dumps(data, indent=2, ensure_ascii=False)

        fd, tmp_path = tempfile.mkstemp(
            suffix=".tmp",
            prefix="translation_profiles_",
            dir=str(path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)
            os.replace(tmp_path, str(path))
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

    # ------------------------------------------------------------------
    # Duplicate cleanup
    # ------------------------------------------------------------------

    def cleanup_duplicate_profiles(self) -> int:
        """Remove duplicate user profiles, keeping only the newest per unique
        (name, game, file_handler) triplet.

        Two user profiles are considered duplicates if they share the same
        ``name``, ``game``, and ``file_handler``.  Only the most recently
        created profile is kept; older duplicates are deleted.

        Returns the number of removed profiles.
        """
        # Group user profiles by (name, game, file_handler) key
        groups: Dict[str, list] = {}
        for pid, profile in list(self._profiles.items()):
            if profile.is_system:
                continue
            key = (profile.name, profile.game, profile.file_handler or "")
            groups.setdefault(key, []).append(pid)

        removed = 0
        for key, pids in groups.items():
            if len(pids) <= 1:
                continue
            # Sort by created_at descending, keep the newest
            with_dates = []
            for pid in pids:
                p = self._profiles[pid]
                with_dates.append((pid, p.created_at))
            with_dates.sort(key=lambda x: x[1], reverse=True)
            # Keep the first (newest), remove the rest
            for pid, _ in with_dates[1:]:
                del self._profiles[pid]
                removed += 1

        if removed:
            self._save()
        return removed

    def _backup_corrupted(self, file_path: str) -> None:
        """Rename a corrupted file so data is not lost."""
        path = Path(file_path)
        if path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"{path.name}.corrupt.{timestamp}"
            backup_path = path.with_name(backup_name)
            shutil.copy2(str(path), str(backup_path))
