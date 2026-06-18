"""GenericAdapter — universal adapter for plain_text / json / yaml files.

This adapter has no game-specific logic (no descriptor, no language header).
It is intended for non-Stellaris files where the user just wants to translate
text content in a given format.
"""

import json
import os
import re
from copy import deepcopy
from typing import List, Optional

import yaml

from translator_app.games.base import GameAdapter
from translator_app.file_processing.models.file_type import FileType, FileCategory
from translator_app.file_processing.models.parsed_file import (
    ParsedGameFile,
    SerializedFile,
    FileDetectionResult,
)
from translator_app.file_processing.models.entries import FileEntry
from translator_app.file_processing.models.translation_unit import TranslationUnit


class GenericAdapter(GameAdapter):
    """Universal file adapter supporting plain_text, json, and yaml formats.

    The optional *file_handler* parameter restricts which file types are
    processed (e.g. ``"json"`` means only ``.json`` files are handled).
    When *None*, all supported extensions are accepted.
    """

    _HANDLER_MAP: dict = {
        "plain_text": (".txt", FileCategory.GENERIC_PLAIN_TEXT),
        "json": (".json", FileCategory.GENERIC_JSON),
        "yaml": (".yml", ".yaml"),
    }

    def __init__(self, file_handler: Optional[str] = None):
        self.file_handler = file_handler

    # ------------------------------------------------------------------
    # File discovery
    # ------------------------------------------------------------------

    def detect_files(self, path: str) -> List[str]:
        """Recursively find translatable files under *path*.

        Returns absolute paths to files whose extension matches a supported
        handler.  No Stellaris-specific filtering is applied.
        """
        found: List[str] = []
        if not os.path.isdir(path):
            return found

        for dirpath, _dirnames, filenames in os.walk(path):
            for filename in filenames:
                full_path = os.path.join(dirpath, filename)
                detection = self.detect_file(full_path)
                if detection.file_type.category != FileCategory.UNKNOWN:
                    found.append(full_path)
        return found

    # ------------------------------------------------------------------
    # Detection
    # ------------------------------------------------------------------

    def detect_file(self, path: str) -> FileDetectionResult:
        """Detect file type by extension.

        Returns one of: ``generic_plain_text``, ``generic_json``,
        ``generic_yaml``, or ``unknown``.
        """
        ext = os.path.splitext(path)[1].lower()
        file_type = self._ext_to_type(ext)
        return FileDetectionResult(
            file_type=file_type,
            confidence=1.0 if file_type.category != FileCategory.UNKNOWN else 0.0,
            path=path,
            supported=True,
        )

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def parse_file(self, path: str) -> ParsedGameFile:
        """Parse a plain_text / json / yaml file into a ParsedGameFile."""
        detection = self.detect_file(path)
        if detection.file_type.category == FileCategory.UNKNOWN:
            raise ValueError(f"Unsupported file type: {path}")

        with open(path, "r", encoding="utf-8-sig") as f:
            content = f.read()

        parsed = ParsedGameFile(
            file_type=detection.file_type,
            raw_content=content,
            source_path=path,
        )

        cat = detection.file_type.category
        if cat == FileCategory.GENERIC_PLAIN_TEXT:
            self._parse_plain_text(content, parsed)
        elif cat == FileCategory.GENERIC_JSON:
            self._parse_json(content, parsed)
        elif cat == FileCategory.GENERIC_YAML:
            self._parse_yaml(content, parsed)

        return parsed

    # ------------------------------------------------------------------
    # Unit extraction
    # ------------------------------------------------------------------

    def extract_units(
        self,
        parsed: ParsedGameFile,
        src_lang: Optional[str] = None,
        dst_lang: Optional[str] = None,
    ) -> List[TranslationUnit]:
        """Extract translatable entries as TranslationUnit objects."""
        units: List[TranslationUnit] = []
        for entry in parsed.translatable_entries:
            if entry.value:
                units.append(TranslationUnit(
                    source=entry.value,
                    key=entry.key,
                    context=entry.key,
                    file_path=parsed.source_path,
                    line_number=entry.line_number,
                    id=entry.id,
                    entry_id=entry.id,
                    file_id=parsed.id,
                    src_lang=src_lang or "",
                    dst_lang=dst_lang or "",
                ))
        return units

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def serialize(
        self,
        parsed: ParsedGameFile,
        translations: List[TranslationUnit],
    ) -> SerializedFile:
        """Apply translated units and serialize back to the original format.

        The original structure (indices, nesting, ordering) is preserved.
        """
        translation_map = {}
        for unit in translations:
            key = unit.entry_id or unit.key
            if key and unit.target:
                translation_map[key] = unit.target

        cat = parsed.file_type.category
        content: str = ""

        if cat == FileCategory.GENERIC_PLAIN_TEXT:
            content = self._serialize_plain_text(parsed, translation_map)
        elif cat == FileCategory.GENERIC_JSON:
            content = self._serialize_json(parsed, translation_map)
        elif cat == FileCategory.GENERIC_YAML:
            content = self._serialize_yaml(parsed, translation_map)

        return SerializedFile(
            content=content,
            source_path=parsed.source_path,
        )

    # ==================================================================
    # Internal: type helpers
    # ==================================================================

    def _ext_to_type(self, ext: str) -> FileType:
        """Map *ext* to a FileType, respecting *file_handler* if set."""
        if self.file_handler == "plain_text" and ext == ".txt":
            return FileType.GENERIC_PLAIN_TEXT
        if self.file_handler == "json" and ext == ".json":
            return FileType.GENERIC_JSON
        if self.file_handler == "yaml" and ext in (".yml", ".yaml"):
            return FileType.GENERIC_YAML

        # No handler restriction — accept all supported extensions
        if self.file_handler is None:
            if ext == ".txt":
                return FileType.GENERIC_PLAIN_TEXT
            if ext == ".json":
                return FileType.GENERIC_JSON
            if ext in (".yml", ".yaml"):
                return FileType.GENERIC_YAML

        return FileType.UNKNOWN

    # ==================================================================
    # Internal: parse helpers
    # ==================================================================

    @staticmethod
    def _parse_plain_text(content: str, parsed: ParsedGameFile) -> None:
        """Parse plain text lines into FileEntry objects."""
        lines = content.splitlines(keepends=True)
        for i, line in enumerate(lines):
            text = line.rstrip("\n").rstrip("\r")
            parsed.entries.append(FileEntry(
                key=str(i),
                value=text,
                line_number=i + 1,
                is_translatable=True,
                id=f"line_{i}",
            ))

    @staticmethod
    def _parse_json(content: str, parsed: ParsedGameFile) -> None:
        """Parse JSON content and extract string leaf values."""
        data = json.loads(content)
        parsed.metadata["_raw_data"] = deepcopy(data)
        GenericAdapter._walk_and_extract(data, parsed, "")

    @staticmethod
    def _parse_yaml(content: str, parsed: ParsedGameFile) -> None:
        """Parse YAML content and extract string leaf values."""
        data = yaml.safe_load(content)
        parsed.metadata["_raw_data"] = deepcopy(data)
        GenericAdapter._walk_and_extract(data, parsed, "")

    @staticmethod
    def _walk_and_extract(data, parsed: ParsedGameFile, prefix: str) -> None:
        """Recursively walk a nested dict/list and extract string values.

        Each string leaf produces a FileEntry whose key is the dotted/indexed
        path to the value (e.g. ``"a.b[0].c"``).
        """
        if isinstance(data, dict):
            for key, value in data.items():
                path_key = f"{prefix}.{key}" if prefix else str(key)
                if isinstance(value, str):
                    parsed.entries.append(FileEntry(
                        key=path_key,
                        value=value,
                        is_translatable=True,
                        id=f"entry_{path_key}",
                    ))
                elif isinstance(value, (dict, list)):
                    GenericAdapter._walk_and_extract(value, parsed, path_key)
        elif isinstance(data, list):
            for idx, value in enumerate(data):
                path_key = f"{prefix}[{idx}]"
                if isinstance(value, str):
                    parsed.entries.append(FileEntry(
                        key=path_key,
                        value=value,
                        is_translatable=True,
                        id=f"entry_{path_key}",
                    ))
                elif isinstance(value, (dict, list)):
                    GenericAdapter._walk_and_extract(value, parsed, path_key)

    # ==================================================================
    # Internal: serialize helpers
    # ==================================================================

    @staticmethod
    def _serialize_plain_text(
        parsed: ParsedGameFile,
        translation_map: dict,
    ) -> str:
        """Rebuild plain text from entries, applying translations."""
        lines: List[str] = []
        for entry in parsed.entries:
            # Try to match by entry id first, then by key
            translated = translation_map.get(entry.id) or translation_map.get(entry.key)
            if translated is not None:
                lines.append(translated)
            elif entry.translated is not None:
                lines.append(entry.translated)
            else:
                lines.append(entry.value)
        return "\n".join(lines)

    @staticmethod
    def _serialize_json(
        parsed: ParsedGameFile,
        translation_map: dict,
    ) -> str:
        """Rebuild JSON data, apply translations, and dump."""
        data = parsed.metadata.get("_raw_data")
        if data is None:
            data = json.loads(parsed.raw_content)
        else:
            data = deepcopy(data)

        for entry in parsed.translatable_entries:
            translated = translation_map.get(entry.id) or translation_map.get(entry.key)
            if translated is not None:
                GenericAdapter._set_nested(data, entry.key, translated)

        return json.dumps(data, ensure_ascii=False, indent=2)

    @staticmethod
    def _serialize_yaml(
        parsed: ParsedGameFile,
        translation_map: dict,
    ) -> str:
        """Rebuild YAML data, apply translations, and dump."""
        data = parsed.metadata.get("_raw_data")
        if data is None:
            data = yaml.safe_load(parsed.raw_content)
        else:
            data = deepcopy(data)

        for entry in parsed.translatable_entries:
            translated = translation_map.get(entry.id) or translation_map.get(entry.key)
            if translated is not None:
                GenericAdapter._set_nested(data, entry.key, translated)

        return yaml.dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False)

    # ------------------------------------------------------------------
    # Path navigation
    # ------------------------------------------------------------------

    @staticmethod
    def _set_nested(data, path: str, value: str) -> None:
        """Navigate a dotted path (e.g. ``"a.b[0].c"``) and set *value*."""
        if not path:
            return
        parts = path.split(".")
        current = data
        for i, part in enumerate(parts):
            array_match = re.match(r"^(.+)\[(\d+)\]$", part)
            is_last = i == len(parts) - 1

            if is_last:
                if array_match:
                    current[array_match.group(1)][int(array_match.group(2))] = value
                else:
                    current[part] = value
            else:
                if array_match:
                    current = current[array_match.group(1)][int(array_match.group(2))]
                else:
                    current = current[part]
