"""Prompt Presets Module (#16) — models, service, validation, and JSON storage.

Spec: #16 Prompt Presets Module
"""

import json
import os
import re
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

# Error codes (spec section "Ошибки")
PRESET_NOT_FOUND = "PRESET_NOT_FOUND"
INVALID_PRESET_FORMAT = "INVALID_PRESET_FORMAT"
INVALID_PROFILE = "INVALID_PROFILE"
MISSING_REQUIRED_PLACEHOLDER = "MISSING_REQUIRED_PLACEHOLDER"
UNKNOWN_PLACEHOLDER = "UNKNOWN_PLACEHOLDER"
EMPTY_PROMPT = "EMPTY_PROMPT"
IMPORT_FAILED = "IMPORT_FAILED"
EXPORT_FAILED = "EXPORT_FAILED"


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------


@dataclass
class PromptDiagnostic:
    """Validation diagnostic for a prompt preset field (spec 16)."""
    level: str = "error"  # "error" | "warning" | "info"
    code: str = ""
    message: str = ""
    field: str = ""


# ---------------------------------------------------------------------------
# Timestamp helper
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# PromptPreset model
# ---------------------------------------------------------------------------


@dataclass
class PromptPreset:
    """A named prompt preset with optional batch/single template variants.

    Backward-compatible: ``system_prompt`` and ``user_prompt_template``
    serve as fallbacks when batch/single specific fields are not set.

    Spec: #16 Prompt Presets Module
    """
    name: str
    description: str = ""
    profile_name: str = ""
    batch_system_prompt: str = ""
    batch_user_template: str = ""
    single_system_prompt: str = ""
    single_user_template: str = ""
    log_prompts: bool = False

    # System fields (spec 16)
    id: str = ""
    is_system: bool = False
    created_at: str = ""
    updated_at: str = ""
    version: int = 1
    diagnostics: List[PromptDiagnostic] = field(default_factory=list)

    # Legacy backward-compat fields
    system_prompt: str = ""
    user_prompt_template: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = str(uuid.uuid4())
        now = _now_iso()
        if not self.created_at:
            self.created_at = now
        if not self.updated_at:
            self.updated_at = now
        # Sync legacy fields from batch templates if not set
        if not self.system_prompt and self.batch_system_prompt:
            self.system_prompt = self.batch_system_prompt
        if not self.user_prompt_template and self.batch_user_template:
            self.user_prompt_template = self.batch_user_template


# ---------------------------------------------------------------------------
# System presets (spec 16 — MVP)
# ---------------------------------------------------------------------------

_SYSTEM_SIMPLE_SINGLE = PromptPreset(
    id="simple_single",
    name="Simple Single",
    description="Simple single-text translation prompt. "
                "Translates one text at a time. No batch support.",
    profile_name="simple_single",
    batch_system_prompt="",
    batch_user_template="",
    single_system_prompt=(
        "Translate the following text from {src_lang} to {dst_lang}. "
        "Return only the translation, no explanations."
    ),
    single_user_template="{text}",
    system_prompt=(
        "Translate the following text from {src_lang} to {dst_lang}. "
        "Return only the translation, no explanations."
    ),
    user_prompt_template="{text}",
    log_prompts=False,
    is_system=True,
    version=1,
)

_SYSTEM_JSON_BATCH = PromptPreset(
    id="json_batch",
    name="JSON Batch",
    description="Batch translation prompt that expects a JSON array response. "
                "Handles multiple texts in a single request.",
    profile_name="json_batch",
    batch_system_prompt=(
        "You are a translation engine. Translate the following texts "
        "from {src_lang} to {dst_lang}. "
        "Return ONLY a valid JSON array of strings. No explanations."
    ),
    batch_user_template="{texts}",
    single_system_prompt=(
        "Translate the following text from {src_lang} to {dst_lang}. "
        "Return only the translation, no explanations."
    ),
    single_user_template="{text}",
    system_prompt="You are a translation engine.",
    user_prompt_template="{texts}",
    log_prompts=False,
    is_system=True,
    version=1,
)

_SYSTEM_STRICT_JSON_BATCH = PromptPreset(
    id="strict_json_batch",
    name="Strict JSON Batch",
    description="Strict batch translation prompt. "
                "Expects a valid JSON array with no additional text.",
    profile_name="strict_json_batch",
    batch_system_prompt=(
        "You are a precise translation engine. Translate the following texts "
        "from {src_lang} to {dst_lang}. "
        "CRITICAL: Return ONLY a valid JSON array of translated strings. "
        "No markdown, no explanations, no additional text. "
        'Example format: ["translation1", "translation2"]'
    ),
    batch_user_template="{texts}",
    single_system_prompt=(
        "Translate the following text from {src_lang} to {dst_lang}. "
        "Return only the translation, no explanations."
    ),
    single_user_template="{text}",
    system_prompt="You are a precise translation engine.",
    user_prompt_template="{texts}",
    log_prompts=False,
    is_system=True,
    version=1,
)

_SYSTEM_STRICT_JSON_STELLARIS = PromptPreset(
    id="strict_json_stellaris",
    name="Strict JSON Stellaris",
    description="Stellaris-specific strict JSON batch prompt. "
                "Preserves game formatting codes like $KEY$ and §!.",
    profile_name="strict_json_batch",
    batch_system_prompt=(
        "You are a Stellaris game localisation translator. "
        "Translate the following game texts from {src_lang} to {dst_lang}. "
        "Preserve all game formatting codes ($KEY$, §!, etc.). "
        "CRITICAL: Return ONLY a valid JSON array of translated strings. "
        "No markdown, no explanations."
    ),
    batch_user_template="{texts}",
    single_system_prompt=(
        "Translate the following game text from {src_lang} to {dst_lang}. "
        "Preserve all game formatting codes."
    ),
    single_user_template="{text}",
    system_prompt="You are a Stellaris game localisation translator.",
    user_prompt_template="{texts}",
    log_prompts=False,
    is_system=True,
    version=1,
)

_SYSTEM_PRESETS: Dict[str, PromptPreset] = {
    "simple_single": _SYSTEM_SIMPLE_SINGLE,
    "json_batch": _SYSTEM_JSON_BATCH,
    "strict_json_batch": _SYSTEM_STRICT_JSON_BATCH,
    "strict_json_stellaris": _SYSTEM_STRICT_JSON_STELLARIS,
}


# ---------------------------------------------------------------------------
# Placeholder validation helpers
# ---------------------------------------------------------------------------

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
# Profile name resolver (delegates to settings.validation)
# ---------------------------------------------------------------------------


def _get_supported_profiles() -> frozenset:
    try:
        from translator_app.settings.validation import get_supported_prompt_profiles as _res
        return _res()
    except Exception:
        return frozenset({"simple_single", "json_batch", "strict_json_batch"})


# ---------------------------------------------------------------------------
# PromptPresetService
# ---------------------------------------------------------------------------


class PromptPresetService:
    """Full-featured service for prompt preset CRUD, validation, import/export.

    Spec: #16 Prompt Presets Module

    * JSON persistence with atomic writes.
    * Corrupted file backup.
    * System presets are read-only.
    """

    def __init__(self, store_path: Optional[str] = None):
        self._store_path = store_path
        self._presets: Dict[str, PromptPreset] = {}
        self._load_system_presets()
        if store_path:
            self._load_user_presets()

    # ------------------------------------------------------------------
    # System presets
    # ------------------------------------------------------------------

    def _load_system_presets(self) -> None:
        for pid, preset in _SYSTEM_PRESETS.items():
            self._presets[pid] = preset

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def list_presets(self) -> List[PromptPreset]:
        """Return all presets (system + user)."""
        return list(self._presets.values())

    def get_preset(self, preset_id: str) -> Optional[PromptPreset]:
        """Get a preset by its id."""
        return self._presets.get(preset_id)

    # Legacy backward-compat: get by name or id
    def get(self, name: str) -> Optional[PromptPreset]:
        """Look up preset by id first, then by name (backward-compat)."""
        if name in self._presets:
            return self._presets[name]
        for p in self._presets.values():
            if p.name == name:
                return p
        return None

    def create_preset(
        self,
        name: str,
        profile_name: str,
        description: str = "",
        batch_system_prompt: str = "",
        batch_user_template: str = "",
        single_system_prompt: str = "",
        single_user_template: str = "",
        log_prompts: bool = False,
    ) -> PromptPreset:
        """Create a new user preset with the given fields."""
        now = _now_iso()
        preset = PromptPreset(
            id=str(uuid.uuid4()),
            name=name,
            description=description,
            profile_name=profile_name,
            batch_system_prompt=batch_system_prompt,
            batch_user_template=batch_user_template,
            single_system_prompt=single_system_prompt,
            single_user_template=single_user_template,
            log_prompts=log_prompts,
            is_system=False,
            created_at=now,
            updated_at=now,
            version=1,
            system_prompt=batch_system_prompt or single_system_prompt,
            user_prompt_template=batch_user_template or single_user_template,
        )
        self._presets[preset.id] = preset
        self._save()
        return preset

    def update_preset(
        self,
        preset_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        profile_name: Optional[str] = None,
        batch_system_prompt: Optional[str] = None,
        batch_user_template: Optional[str] = None,
        single_system_prompt: Optional[str] = None,
        single_user_template: Optional[str] = None,
        log_prompts: Optional[bool] = None,
    ) -> PromptPreset:
        """Update an existing user preset. System presets cannot be updated."""
        preset = self._presets.get(preset_id)
        if preset is None:
            raise ValueError(f"Preset not found: {preset_id}")
        if preset.is_system:
            raise ValueError("System presets cannot be modified")

        if name is not None:
            preset.name = name
        if description is not None:
            preset.description = description
        if profile_name is not None:
            preset.profile_name = profile_name
        if batch_system_prompt is not None:
            preset.batch_system_prompt = batch_system_prompt
        if batch_user_template is not None:
            preset.batch_user_template = batch_user_template
        if single_system_prompt is not None:
            preset.single_system_prompt = single_system_prompt
        if single_user_template is not None:
            preset.single_user_template = single_user_template
        if log_prompts is not None:
            preset.log_prompts = log_prompts

        # Sync legacy fields
        if not preset.system_prompt:
            preset.system_prompt = preset.batch_system_prompt or preset.single_system_prompt
        if not preset.user_prompt_template:
            preset.user_prompt_template = preset.batch_user_template or preset.single_user_template

        preset.updated_at = _now_iso()
        preset.version += 1
        self._save()
        return preset

    def delete_preset(self, preset_id: str) -> bool:
        """Delete a user preset. System presets cannot be deleted."""
        preset = self._presets.get(preset_id)
        if preset is None:
            return False
        if preset.is_system:
            raise ValueError("System presets cannot be deleted")
        del self._presets[preset_id]
        self._save()
        return True

    def copy_system_preset(self, preset_id: str, new_name: str) -> PromptPreset:
        """Copy a system preset into a new editable user preset."""
        source = self._presets.get(preset_id)
        if source is None:
            raise ValueError(f"Preset not found: {preset_id}")

        now = _now_iso()
        new_preset = PromptPreset(
            id=str(uuid.uuid4()),
            name=new_name,
            description=source.description,
            profile_name=source.profile_name,
            batch_system_prompt=source.batch_system_prompt,
            batch_user_template=source.batch_user_template,
            single_system_prompt=source.single_system_prompt,
            single_user_template=source.single_user_template,
            log_prompts=source.log_prompts,
            is_system=False,
            created_at=now,
            updated_at=now,
            version=1,
            system_prompt=source.system_prompt,
            user_prompt_template=source.user_prompt_template,
        )
        self._presets[new_preset.id] = new_preset
        self._save()
        return new_preset

    def list_names(self) -> List[str]:
        """Legacy alias: return all preset names."""
        return [p.name for p in self._presets.values()]

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def validate_preset(self, preset: PromptPreset) -> List[PromptDiagnostic]:
        """Validate a preset and return diagnostics.

        Checks:
        * profile_name is known (via resolver).
        * batch profiles require {texts} in batch_user_template.
        * single profiles require {text} in single_user_template.
        * No unknown placeholders.
        * Empty required prompts = error.
        """
        diagnostics: List[PromptDiagnostic] = []
        supported = _get_supported_profiles()

        # --- profile_name ---
        if preset.profile_name and preset.profile_name not in supported:
            diagnostics.append(PromptDiagnostic(
                level="error",
                code=INVALID_PROFILE,
                message=(
                    f"Unknown profile: {preset.profile_name}. "
                    f"Supported: {sorted(supported)}"
                ),
                field="profile_name",
            ))

        is_batch = preset.profile_name in BATCH_PROFILES

        # --- batch_user_template ---
        if is_batch:
            if not preset.batch_user_template.strip():
                diagnostics.append(PromptDiagnostic(
                    level="error",
                    code=EMPTY_PROMPT,
                    message="Batch user template must not be empty",
                    field="batch_user_template",
                ))
            else:
                missing = _check_missing_placeholders(
                    preset.batch_user_template, {"texts"}
                )
                if missing:
                    diagnostics.append(PromptDiagnostic(
                        level="error",
                        code=MISSING_REQUIRED_PLACEHOLDER,
                        message="Batch user template must contain {texts}",
                        field="batch_user_template",
                    ))
                unknowns = _check_unknown_placeholders(preset.batch_user_template)
                for u in unknowns:
                    diagnostics.append(PromptDiagnostic(
                        level="error",
                        code=UNKNOWN_PLACEHOLDER,
                        message=f"Unknown placeholder '{{{u}}}' in batch_user_template",
                        field="batch_user_template",
                    ))

            if preset.batch_system_prompt.strip():
                unknowns = _check_unknown_placeholders(preset.batch_system_prompt)
                for u in unknowns:
                    diagnostics.append(PromptDiagnostic(
                        level="error",
                        code=UNKNOWN_PLACEHOLDER,
                        message=f"Unknown placeholder '{{{u}}}' in batch_system_prompt",
                        field="batch_system_prompt",
                    ))
        else:
            # For non-batch, still check batch fields if non-empty
            if preset.batch_user_template.strip():
                unknowns = _check_unknown_placeholders(preset.batch_user_template)
                for u in unknowns:
                    diagnostics.append(PromptDiagnostic(
                        level="error",
                        code=UNKNOWN_PLACEHOLDER,
                        message=f"Unknown placeholder '{{{u}}}' in batch_user_template",
                        field="batch_user_template",
                    ))
            if preset.batch_system_prompt.strip():
                unknowns = _check_unknown_placeholders(preset.batch_system_prompt)
                for u in unknowns:
                    diagnostics.append(PromptDiagnostic(
                        level="error",
                        code=UNKNOWN_PLACEHOLDER,
                        message=f"Unknown placeholder '{{{u}}}' in batch_system_prompt",
                        field="batch_system_prompt",
                    ))

        # --- single_user_template ---
        if not preset.single_user_template.strip():
            diagnostics.append(PromptDiagnostic(
                level="error",
                code=EMPTY_PROMPT,
                message="Single user template must not be empty",
                field="single_user_template",
            ))
        else:
            missing = _check_missing_placeholders(
                preset.single_user_template, {"text"}
            )
            if missing:
                diagnostics.append(PromptDiagnostic(
                    level="error",
                    code=MISSING_REQUIRED_PLACEHOLDER,
                    message="Single user template must contain {text}",
                    field="single_user_template",
                ))
            unknowns = _check_unknown_placeholders(preset.single_user_template)
            for u in unknowns:
                diagnostics.append(PromptDiagnostic(
                    level="error",
                    code=UNKNOWN_PLACEHOLDER,
                    message=f"Unknown placeholder '{{{u}}}' in single_user_template",
                    field="single_user_template",
                ))

        # --- single_system_prompt ---
        if preset.single_system_prompt.strip():
            unknowns = _check_unknown_placeholders(preset.single_system_prompt)
            for u in unknowns:
                diagnostics.append(PromptDiagnostic(
                    level="error",
                    code=UNKNOWN_PLACEHOLDER,
                    message=f"Unknown placeholder '{{{u}}}' in single_system_prompt",
                    field="single_system_prompt",
                ))

        return diagnostics

    # ------------------------------------------------------------------
    # Export / Import
    # ------------------------------------------------------------------

    def export_preset(self, preset_id: str) -> Dict[str, Any]:
        """Export a preset as a JSON-serializable dict.

        Follows the spec format:
        {
          "name": "...",
          "profile_name": "...",
          "batch_system_prompt": "...",
          ...
        }
        """
        preset = self._presets.get(preset_id)
        if preset is None:
            raise ValueError(f"Preset not found: {preset_id}")

        return {
            "name": preset.name,
            "profile_name": preset.profile_name,
            "batch_system_prompt": preset.batch_system_prompt,
            "batch_user_template": preset.batch_user_template,
            "single_system_prompt": preset.single_system_prompt,
            "single_user_template": preset.single_user_template,
            "log_prompts": preset.log_prompts,
        }

    def import_preset(self, data: Dict[str, Any]) -> PromptPreset:
        """Import a preset from a JSON dict.

        Validates:
        * Structure (required keys exist).
        * profile_name is supported.
        * Placeholders are valid.
        """
        # --- structural validation ---
        if "name" not in data or not data["name"]:
            raise ValueError("Import requires a 'name' field")
        if "profile_name" not in data or not data["profile_name"]:
            raise ValueError("Import requires a 'profile_name' field")

        profile_name = data["profile_name"]
        supported = _get_supported_profiles()
        if profile_name not in supported:
            raise ValueError(
                f"Unknown profile: {profile_name}. Supported: {sorted(supported)}"
            )

        name = data["name"]
        description = data.get("description", "")
        batch_system_prompt = data.get("batch_system_prompt", "")
        batch_user_template = data.get("batch_user_template", "")
        single_system_prompt = data.get("single_system_prompt", "")
        single_user_template = data.get("single_user_template", "")
        log_prompts = data.get("log_prompts", False)

        # Validate via temporary preset
        tmp = PromptPreset(
            name=name,
            profile_name=profile_name,
            batch_system_prompt=batch_system_prompt,
            batch_user_template=batch_user_template,
            single_system_prompt=single_system_prompt,
            single_user_template=single_user_template,
        )
        diagnostics = self.validate_preset(tmp)
        errors = [d for d in diagnostics if d.level == "error"]
        if errors:
            raise ValueError(f"Validation failed: {errors[0].message}")

        return self.create_preset(
            name=name,
            profile_name=profile_name,
            description=description,
            batch_system_prompt=batch_system_prompt,
            batch_user_template=batch_user_template,
            single_system_prompt=single_system_prompt,
            single_user_template=single_user_template,
            log_prompts=log_prompts,
        )

    # ------------------------------------------------------------------
    # JSON persistence
    # ------------------------------------------------------------------

    def _serialize_user_presets(self) -> Dict[str, Any]:
        """Serialize only user presets (system presets are not persisted)."""
        presets = {}
        for pid, preset in self._presets.items():
            if preset.is_system:
                continue
            presets[pid] = {
                "id": preset.id,
                "name": preset.name,
                "description": preset.description,
                "profile_name": preset.profile_name,
                "batch_system_prompt": preset.batch_system_prompt,
                "batch_user_template": preset.batch_user_template,
                "single_system_prompt": preset.single_system_prompt,
                "single_user_template": preset.single_user_template,
                "log_prompts": preset.log_prompts,
                "is_system": preset.is_system,
                "created_at": preset.created_at,
                "updated_at": preset.updated_at,
                "version": preset.version,
                "system_prompt": preset.system_prompt,
                "user_prompt_template": preset.user_prompt_template,
            }
        return {"presets": presets}

    @staticmethod
    def _deserialize_preset(item: dict) -> PromptPreset:
        return PromptPreset(
            id=item.get("id", str(uuid.uuid4())),
            name=item.get("name", ""),
            description=item.get("description", ""),
            profile_name=item.get("profile_name", ""),
            batch_system_prompt=item.get("batch_system_prompt", ""),
            batch_user_template=item.get("batch_user_template", ""),
            single_system_prompt=item.get("single_system_prompt", ""),
            single_user_template=item.get("single_user_template", ""),
            log_prompts=item.get("log_prompts", False),
            is_system=item.get("is_system", False),
            created_at=item.get("created_at", _now_iso()),
            updated_at=item.get("updated_at", _now_iso()),
            version=item.get("version", 1),
            system_prompt=item.get("system_prompt", ""),
            user_prompt_template=item.get("user_prompt_template", ""),
        )

    def _load_user_presets(self) -> None:
        if not self._store_path:
            return
        path = Path(self._store_path)
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for pid, item in data.get("presets", {}).items():
                rec = self._deserialize_preset(item)
                self._presets[rec.id] = rec
        except (json.JSONDecodeError, TypeError, KeyError):
            self._backup_corrupted(str(path))

    def _save(self) -> None:
        if not self._store_path:
            return
        path = Path(self._store_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        data = self._serialize_user_presets()
        content = json.dumps(data, indent=2, ensure_ascii=False)

        fd, tmp_path = tempfile.mkstemp(
            suffix=".tmp",
            prefix="prompt_presets_",
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

    def _backup_corrupted(self, file_path: str) -> None:
        """Rename a corrupted file so data is not lost."""
        path = Path(file_path)
        if path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"{path.name}.corrupt.{timestamp}"
            backup_path = path.with_name(backup_name)
            shutil.copy2(str(path), str(backup_path))


# ---------------------------------------------------------------------------
# Backward-compatible registry
# ---------------------------------------------------------------------------


class PromptPresetRegistry:
    """Backward-compatible registry adapter.

    Legacy code paths create a ``PromptPresetRegistry()`` and call
    ``register()`` / ``get()`` / ``list_names()``.  This adapter
    delegates to an internal ``PromptPresetService`` (no persistence).
    """

    def __init__(self):
        self._service = PromptPresetService(store_path=None)

    def register(self, preset: PromptPreset) -> None:
        self._service._presets[preset.id] = preset  # noqa

    def get(self, name: str) -> Optional[PromptPreset]:
        return self._service.get(name)

    def list_names(self) -> List[str]:
        return self._service.list_names()
