"""Descriptor Service — read, create, update, preview, validate, serialize.

This module is the core of spec #13 (Descriptor Module).  It handles all
descriptor-file operations for Stellaris .mod files.
"""

import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from translator_app.diagnostics.models import (
    Diagnostic,
    DiagnosticLevel,
    ValidationResult,
)
from translator_app.mods.descriptor_models import (
    DESCRIPTOR_NOT_FOUND,
    DESCRIPTOR_PARSE_ERROR,
    DESCRIPTOR_READ_FAILED,
    DESCRIPTOR_WRITE_FAILED,
    INVALID_DESCRIPTOR_FORMAT,
    MISSING_SUPPORTED_VERSION,
    MOD_PATH_NOT_FOUND,
    MULTIPLE_TAG_BLOCKS,
    PATH_MISMATCH,
    UNKNOWN_FIELDS_PRESERVED,
    Descriptor,
    DescriptorResult,
)

# ---------------------------------------------------------------------------
# Well-known fields — these get mapped to dedicated Descriptor attributes.
# Everything else is stored in raw_fields.
# ---------------------------------------------------------------------------
_KNOWN_KEYS = frozenset({
    "name", "path", "supported_version", "version",
    "picture", "remote_file_id", "tags",
})


class DescriptorService:
    """Service for reading, creating, updating, and validating Stellaris
    descriptor (.mod) files.
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read_descriptor(self, file_path: str) -> Descriptor:
        """Read and parse a descriptor file from disk.

        Returns a fully-populated :class:`Descriptor` including
        diagnostics for any issues found during parsing.
        """
        path = Path(file_path)
        diagnostics: List[Diagnostic] = []

        if not path.exists():
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Descriptor file not found: {file_path}",
                code=DESCRIPTOR_NOT_FOUND,
                file_path=file_path,
            ))
            return Descriptor(source_path=file_path, diagnostics=diagnostics)

        if not path.is_file():
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Not a file: {file_path}",
                code=DESCRIPTOR_READ_FAILED,
                file_path=file_path,
            ))
            return Descriptor(source_path=file_path, diagnostics=diagnostics)

        try:
            content = path.read_text(encoding="utf-8-sig")
        except Exception as exc:
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Failed to read descriptor: {exc}",
                code=DESCRIPTOR_READ_FAILED,
                file_path=file_path,
            ))
            return Descriptor(source_path=file_path, diagnostics=diagnostics)

        return self._parse_content(content, file_path, diagnostics)

    def create_descriptor(
        self,
        mod_path: str,
        target_mods_dir: str,
        name: Optional[str] = None,
        supported_version: Optional[str] = None,
        tags: Optional[List[str]] = None,
        picture: Optional[str] = None,
        remote_file_id: Optional[str] = None,
        write: bool = False,
    ) -> DescriptorResult:
        """Create a new descriptor for a mod.

        If *write* is ``True`` the descriptor file is written to disk;
        otherwise only a preview is returned.
        """
        result = DescriptorResult()
        warnings: List[str] = []
        errors: List[str] = []

        # 1. Validate mod_path
        mod_path_obj = Path(mod_path)
        if not mod_path_obj.is_dir():
            errors.append(MOD_PATH_NOT_FOUND)
            result.errors = errors
            return result

        # 2. Determine folder name and expected path
        folder_name = mod_path_obj.name
        expected_path = f"mod/{folder_name}"

        # 3. Determine descriptor file path
        descriptor_path = str(mod_path_obj / "descriptor.mod")

        # 4. Build descriptor
        resolved_name = name or folder_name
        descriptor = Descriptor(
            name=resolved_name,
            path=expected_path,
            supported_version=supported_version or "",
            tags=tags or [],
            picture=picture or "",
            remote_file_id=remote_file_id or "",
            source_path=str(mod_path_obj),
        )

        # 5. Validate
        validation = self.validate_descriptor(
            descriptor,
            mod_path=mod_path,
            target_mods_dir=target_mods_dir,
        )
        for d in validation.diagnostics:
            if d.level in (DiagnosticLevel.WARNING,):
                if d.code not in warnings:
                    warnings.append(d.code)
            elif d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL):
                if d.code not in errors:
                    errors.append(d.code)

        # 6. Serialize
        descriptor_text = self.serialize_descriptor(descriptor)

        # 7. Write or preview
        if write:
            try:
                Path(descriptor_path).write_text(descriptor_text, encoding="utf-8")
                result.created = True
            except Exception as exc:
                errors.append(DESCRIPTOR_WRITE_FAILED)
                result.errors = errors
                result.descriptor_text = descriptor_text
                result.descriptor_path = descriptor_path
                return result

        result.descriptor_path = descriptor_path
        result.descriptor_text = descriptor_text
        result.warnings = warnings
        result.errors = errors
        return result

    def update_descriptor(
        self,
        descriptor_path: str,
        patch_fields: Dict[str, str],
        overwrite: bool = True,
        backup: bool = True,
    ) -> DescriptorResult:
        """Update an existing descriptor file with new field values.

        *patch_fields* is a dict of field-name → new-value.  Fields not
        present in *patch_fields* keep their existing value.

        Returns a :class:`DescriptorResult` with the updated content.
        """
        result = DescriptorResult()
        result.descriptor_path = descriptor_path
        warnings: List[str] = []
        errors: List[str] = []

        # 1. Read existing descriptor
        descriptor = self.read_descriptor(descriptor_path)

        # Check for fatal read errors
        read_errors = [
            d for d in descriptor.diagnostics
            if d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL)
        ]
        if read_errors:
            for d in read_errors:
                if d.code not in errors:
                    errors.append(d.code)
            result.errors = errors
            result.descriptor_text = self.serialize_descriptor(descriptor)
            return result

        # 2. Apply patch_fields to the descriptor attributes
        patched = self._apply_patch(descriptor, patch_fields)

        # 3. Serialize updated descriptor
        descriptor_text = self.serialize_descriptor(patched)

        # 4. Backup if requested
        backup_path: Optional[str] = None
        if backup and os.path.isfile(descriptor_path):
            backup_path = self._create_backup(descriptor_path)

        # 5. Write
        if overwrite:
            try:
                Path(descriptor_path).write_text(descriptor_text, encoding="utf-8")
                result.updated = True
            except Exception as exc:
                errors.append(DESCRIPTOR_WRITE_FAILED)
                result.errors = errors
                result.descriptor_text = descriptor_text
                result.backup_path = backup_path
                return result

        result.descriptor_text = descriptor_text
        result.backup_path = backup_path
        result.warnings = warnings
        result.errors = errors
        return result

    def preview_descriptor(
        self,
        mod_path: str,
        target_mods_dir: str,
        name: Optional[str] = None,
        supported_version: Optional[str] = None,
        tags: Optional[List[str]] = None,
        picture: Optional[str] = None,
        remote_file_id: Optional[str] = None,
    ) -> str:
        """Generate descriptor text without writing anything to disk."""
        result = self.create_descriptor(
            mod_path=mod_path,
            target_mods_dir=target_mods_dir,
            name=name,
            supported_version=supported_version,
            tags=tags,
            picture=picture,
            remote_file_id=remote_file_id,
            write=False,
        )
        return result.descriptor_text

    def validate_descriptor(
        self,
        descriptor: Descriptor,
        mod_path: Optional[str] = None,
        target_mods_dir: Optional[str] = None,
    ) -> ValidationResult:
        """Validate a descriptor and return diagnostics."""
        diags: List[Diagnostic] = []

        # Check supported_version
        if not descriptor.supported_version:
            diags.append(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message="No supported_version set in descriptor",
                code=MISSING_SUPPORTED_VERSION,
                file_path=descriptor.source_path,
            ))

        # Check path against expected
        if target_mods_dir and descriptor.path:
            folder_name = Path(descriptor.source_path).name if descriptor.source_path else ""
            expected_path = f"mod/{folder_name}"
            if descriptor.path != expected_path:
                diags.append(Diagnostic(
                    level=DiagnosticLevel.WARNING,
                    message=f"Descriptor path '{descriptor.path}' does not match expected '{expected_path}'",
                    code=PATH_MISMATCH,
                    file_path=descriptor.source_path,
                ))

        # Check mod_path exists
        if mod_path and not os.path.isdir(mod_path):
            diags.append(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Mod path does not exist: {mod_path}",
                code=MOD_PATH_NOT_FOUND,
                file_path=mod_path,
            ))

        # Check for unknown fields
        if descriptor.raw_fields:
            diags.append(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message=f"Unknown fields preserved: {', '.join(descriptor.raw_fields.keys())}",
                code=UNKNOWN_FIELDS_PRESERVED,
                file_path=descriptor.source_path,
            ))

        # Copy any existing descriptor diagnostics
        for d in descriptor.diagnostics:
            if d.code not in {d2.code for d2 in diags}:
                diags.append(d)

        is_valid = not any(
            d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL)
            for d in diags
        )
        return ValidationResult(is_valid=is_valid, diagnostics=diags)

    def serialize_descriptor(self, descriptor: Descriptor) -> str:
        """Serialize a :class:`Descriptor` back into text form.

        The field order follows the TZ recommendation:
        name → path → supported_version → tags → picture → remote_file_id → raw_fields.
        """
        lines: List[str] = []

        # name
        if descriptor.name:
            lines.append(f'name="{descriptor.name}"')

        # path
        if descriptor.path:
            lines.append(f'path="{descriptor.path}"')

        # supported_version
        if descriptor.supported_version:
            lines.append(f'supported_version="{descriptor.supported_version}"')

        # tags
        if descriptor.tags:
            quoted = " ".join(f'"{t}"' for t in descriptor.tags)
            lines.append(f"tags={{\n {quoted}\n}}")

        # picture
        if descriptor.picture:
            lines.append(f'picture="{descriptor.picture}"')

        # remote_file_id
        if descriptor.remote_file_id:
            lines.append(f'remote_file_id="{descriptor.remote_file_id}"')

        # raw_fields (preserve original order)
        for key, value in descriptor.raw_fields.items():
            lines.append(f'{key}="{value}"')

        return "\n".join(lines) + "\n"

    # ------------------------------------------------------------------
    # Internal: parsing
    # ------------------------------------------------------------------

    def _parse_content(
        self,
        content: str,
        source_path: Optional[str] = None,
        diagnostics: Optional[List[Diagnostic]] = None,
    ) -> Descriptor:
        """Parse descriptor text content into a :class:`Descriptor`."""
        if diagnostics is None:
            diagnostics = []

        descriptor = Descriptor(source_path=source_path, diagnostics=list(diagnostics))
        raw_fields: Dict[str, str] = {}
        seen_keys: Dict[str, int] = {}

        # Process line by line, but track tag blocks spanning multiple lines
        lines = content.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            # Skip empty / comment lines
            if not stripped or stripped.startswith("#"):
                i += 1
                continue

            # Try to detect a block value: key={ ... }
            block_match = re.match(
                r'(\w+)\s*=\s*\{', stripped, re.IGNORECASE
            )
            if block_match:
                key = block_match.group(1).lower()
                # Collect the remainder of the block
                block_lines = [stripped]
                brace_depth = stripped.count("{") - stripped.count("}")
                i += 1
                while i < len(lines) and brace_depth > 0:
                    current = lines[i].strip()
                    block_lines.append(current)
                    brace_depth += current.count("{") - current.count("}")
                    i += 1

                block_text = " ".join(block_lines)
                self._set_field(
                    descriptor, raw_fields, seen_keys,
                    key, block_text, source_path, diagnostics,
                )
                continue

            # Simple key="value" or key=value
            simple_match = re.match(
                r'(\w+)\s*=\s*"([^"]*)"', stripped
            )
            if simple_match:
                key = simple_match.group(1).lower()
                value = simple_match.group(2)
                self._set_field(
                    descriptor, raw_fields, seen_keys,
                    key, value, source_path, diagnostics,
                )
                i += 1
                continue

            # Bare value (no quotes) — treat as unknown if not recognised
            bare_match = re.match(r'(\w+)\s*=\s*(\S+)', stripped)
            if bare_match:
                key = bare_match.group(1).lower()
                value = bare_match.group(2)
                self._set_field(
                    descriptor, raw_fields, seen_keys,
                    key, value, source_path, diagnostics,
                )
                i += 1
                continue

            # Line we don't understand — skip
            i += 1

        descriptor.raw_fields = raw_fields

        # Warn about unknown fields
        if raw_fields:
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message=f"Unknown fields preserved: {', '.join(raw_fields.keys())}",
                code=UNKNOWN_FIELDS_PRESERVED,
                file_path=source_path,
            ))

        # Warn about missing supported_version
        if not descriptor.supported_version:
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message="No supported_version found in descriptor",
                code=MISSING_SUPPORTED_VERSION,
                file_path=source_path,
            ))

        descriptor.diagnostics = diagnostics
        return descriptor

    def _set_field(
        self,
        descriptor: Descriptor,
        raw_fields: Dict[str, str],
        seen_keys: Dict[str, int],
        key: str,
        value: str,
        source_path: Optional[str],
        diagnostics: List[Diagnostic],
    ) -> None:
        """Map a parsed key/value to the appropriate Descriptor attribute
        or store it in *raw_fields*.
        """
        # Track duplicate keys
        if key in seen_keys:
            seen_keys[key] += 1
            if key == "tags" and seen_keys[key] > 1:
                diagnostics.append(Diagnostic(
                    level=DiagnosticLevel.WARNING,
                    message="Multiple tags blocks found in descriptor",
                    code=MULTIPLE_TAG_BLOCKS,
                    file_path=source_path,
                ))
        else:
            seen_keys[key] = 1

        if key == "name":
            descriptor.name = value
        elif key == "path":
            descriptor.path = value
        elif key == "supported_version":
            descriptor.supported_version = value
        elif key == "version":
            # Stored in raw_fields since Descriptor has no explicit version field
            # (version is an alias handled by ModInfo, not by spec #13)
            raw_fields[key] = value
        elif key == "picture":
            descriptor.picture = value
        elif key == "remote_file_id":
            descriptor.remote_file_id = value
        elif key == "tags":
            parsed_tags = self._parse_tags_block(value)
            # Merge tags — don't overwrite if we've seen tags before
            existing = set(descriptor.tags)
            for t in parsed_tags:
                if t not in existing:
                    descriptor.tags.append(t)
                    existing.add(t)
        else:
            if key not in raw_fields:
                raw_fields[key] = value

    @staticmethod
    def _parse_tags_block(block_text: str) -> List[str]:
        """Extract individual tag strings from a ``tags={ ... }`` block."""
        # Remove the outer tags={ ... } wrapper
        inner = re.sub(r'^\w+\s*=\s*\{', '', block_text)
        inner = re.sub(r'\}\s*$', '', inner)
        inner = inner.strip()

        if not inner:
            return []

        # Extract quoted tags
        tags = re.findall(r'"([^"]*)"', inner)
        if not tags:
            # Fallback: split by whitespace
            tags = inner.split()
        return tags

    # ------------------------------------------------------------------
    # Internal: applying patches
    # ------------------------------------------------------------------

    @staticmethod
    def _apply_patch(descriptor: Descriptor, patch_fields: Dict[str, str]) -> Descriptor:
        """Create a new Descriptor with *patch_fields* applied on top of
        *descriptor*.

        Special handling:
        - ``name``, ``path``, ``supported_version``, ``picture``,
          ``remote_file_id`` map to the corresponding attributes.
        - ``tags`` is split by whitespace into a list.
        - ``tags+`` / ``tags-`` append / remove from the tags list.
        - ``raw_fields`` is a dict merge.
        - Any other key goes into *raw_fields*.
        """
        import copy
        patched = copy.deepcopy(descriptor)

        for field_key, field_value in patch_fields.items():
            fk = field_key.lower()

            if fk == "name":
                patched.name = field_value
            elif fk == "path":
                patched.path = field_value
            elif fk == "supported_version":
                patched.supported_version = field_value
            elif fk == "picture":
                patched.picture = field_value
            elif fk == "remote_file_id":
                patched.remote_file_id = field_value
            elif fk == "tags":
                patched.tags = field_value.split() if isinstance(field_value, str) else list(field_value)
            elif fk == "tags+":
                additions = field_value.split() if isinstance(field_value, str) else list(field_value)
                existing = set(patched.tags)
                for t in additions:
                    if t not in existing:
                        patched.tags.append(t)
                        existing.add(t)
            elif fk == "tags-":
                removals = set(field_value.split() if isinstance(field_value, str) else list(field_value))
                patched.tags = [t for t in patched.tags if t not in removals]
            elif fk == "raw_fields":
                if isinstance(field_value, dict):
                    patched.raw_fields.update(field_value)
                # else: ignore type mismatch
            else:
                # Unknown key → raw_fields
                patched.raw_fields[fk] = field_value

        return patched

    # ------------------------------------------------------------------
    # Internal: backup
    # ------------------------------------------------------------------

    @staticmethod
    def _create_backup(file_path: str) -> str:
        """Create a backup of *file_path*.

        The backup is stored as ``<file>.bak`` if that does not exist yet,
        otherwise a timestamped name is used.
        """
        path = Path(file_path)
        bak_path = path.with_suffix(path.suffix + ".bak")

        if not bak_path.exists():
            shutil.copy2(str(path), str(bak_path))
            return str(bak_path)

        # Timestamped backup
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ts_bak = path.with_name(f"{path.stem}_{timestamp}{path.suffix}.bak")
        # If that also exists (unlikely), keep appending until unique
        counter = 0
        while ts_bak.exists():
            counter += 1
            ts_bak = path.with_name(
                f"{path.stem}_{timestamp}_{counter}{path.suffix}.bak"
            )
        shutil.copy2(str(path), str(ts_bak))
        return str(ts_bak)
