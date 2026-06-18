import re
from typing import List

from translator_app.file_processing.validators.base import FileValidator
from translator_app.file_processing.models.parsed_file import ParsedGameFile, SerializedFile
from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.diagnostics.models import ValidationResult, Diagnostic, DiagnosticLevel

# Placeholder patterns found in Stellaris localisation
PLACEHOLDER_PATTERNS = [
    re.compile(r'\$[A-Za-z0-9_]+\$'),        # $VARIABLE$
    re.compile(r'\[.*?\]'),                    # [Root.GetName]
    re.compile(r'£[A-Za-z0-9_]+£'),           # £resource£
    re.compile(r'§[A-Za-z0-9!]'),             # §Y, §!, §H
]


class StellarisLocalisationValidator:
    """Validates Stellaris localisation files.

    Supports post-parse, translation, and post-serialize validation stages.
    """

    def validate(self, parsed_file: ParsedGameFile) -> ValidationResult:
        """Run post-parse validation."""
        return self.post_parse_validate(parsed_file)

    def post_parse_validate(self, parsed_file: ParsedGameFile) -> ValidationResult:
        """Validate after parsing: header, entries, structure."""
        result = ValidationResult(is_valid=True)

        # Check language header
        if not parsed_file.header:
            result.is_valid = False
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message="Missing language header (l_<language>:)",
                code="NO_LANGUAGE_HEADER",
            ))

        # Check for multiple language headers
        header_entries = [e for e in parsed_file.entries if e.entry_type == "language_header"]
        if len(header_entries) > 1:
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message=f"Multiple language headers found: {len(header_entries)}",
                code="MULTIPLE_LANGUAGE_HEADERS",
            ))

        # Check for duplicate keys
        seen_keys = {}
        for e in parsed_file.entries:
            if e.is_translatable and e.key:
                if e.key in seen_keys:
                    result.add_diagnostic(Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message=f"Duplicate localisation key '{e.key}'",
                        code="DUPLICATE_LOCALISATION_KEY",
                        line_no=e.line_number,
                        entry_id=e.id,
                    ))
                seen_keys[e.key] = e.line_number

        # Check for unknown lines
        unknown = [e for e in parsed_file.entries if e.entry_type == "raw_unknown"]
        for entry in unknown:
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message=f"Unknown line format at line {entry.line_number}",
                code="UNKNOWN_LINE_FORMAT",
                line_no=entry.line_number,
                entry_id=entry.id,
            ))

        # Check for translatable entries
        translatable = [e for e in parsed_file.entries if e.is_translatable]
        if not translatable:
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message="No translatable entries found",
                code="NO_TRANSLATABLE_ENTRIES",
            ))

        # Copy file-level diagnostics
        for d in getattr(parsed_file, 'diagnostics', []):
            result.add_diagnostic(d)

        return result

    def validate_translations(
        self,
        parsed_file: ParsedGameFile,
        translated_units: List[TranslationUnit],
    ) -> ValidationResult:
        """Validate translation units against parsed file entries."""
        result = ValidationResult(is_valid=True)
        entry_ids = {e.id for e in parsed_file.entries if e.id}
        entry_keys = {e.key for e in parsed_file.entries if e.is_translatable and e.key}

        for unit in translated_units:
            # Check entry_id reference
            if unit.entry_id and unit.entry_id not in entry_ids:
                result.add_diagnostic(Diagnostic(
                    level=DiagnosticLevel.WARNING,
                    message=f"Translation unit references unknown entry_id '{unit.entry_id}'",
                    code="TRANSLATION_UNIT_MISMATCH",
                    entry_id=unit.entry_id,
                ))

            # Check placeholder preservation
            if unit.source and unit.target:
                lost = self._check_placeholders(unit.source, unit.target)
                if lost:
                    result.add_diagnostic(Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message=f"Placeholders lost in translation for key '{unit.key}': {', '.join(lost)}",
                        code="PLACEHOLDER_DAMAGED",
                        entry_id=unit.entry_id,
                    ))

        return result

    def validate_serialized(
        self,
        original: ParsedGameFile,
        serialized: SerializedFile,
    ) -> ValidationResult:
        """Validate serialized output against original parsed file."""
        result = ValidationResult(is_valid=True)

        # Check output is not empty
        if not serialized.content or not serialized.content.strip():
            result.is_valid = False
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message="Serialized output is empty",
                code="SERIALIZATION_FAILED",
            ))
            return result

        # Try to re-parse
        from translator_app.file_processing.parsers.stellaris_localisation import StellarisLocalisationParser
        parser = StellarisLocalisationParser()
        reparsed = parser.parse(serialized.content, original.file_type)

        # Compare key count
        orig_keys = {e.key for e in original.entries if e.is_translatable and e.key}
        new_keys = {e.key for e in reparsed.entries if e.is_translatable and e.key}

        if len(orig_keys) != len(new_keys):
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Key count mismatch: original {len(orig_keys)} vs serialized {len(new_keys)}",
                code="KEYS_CHANGED",
            ))

        # Check key set
        missing = orig_keys - new_keys
        extra = new_keys - orig_keys
        if missing:
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Keys lost in serialization: {', '.join(sorted(missing)[:10])}",
                code="KEYS_CHANGED",
            ))
        if extra:
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Unexpected keys in serialized output: {', '.join(sorted(extra)[:10])}",
                code="KEYS_CHANGED",
            ))

        # Check key order (warning only)
        orig_order = [e.key for e in original.entries if e.is_translatable and e.key]
        new_order = [e.key for e in reparsed.entries if e.is_translatable and e.key]
        if orig_order != new_order:
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message="Key order changed during serialization",
                code="KEYS_REORDERED",
            ))

        # Copy serialization diagnostics
        for d in getattr(serialized, 'diagnostics', []):
            result.add_diagnostic(d)

        return result

    def _check_placeholders(self, source: str, target: str) -> list:
        """Check which placeholders from source are missing in target.

        Returns list of placeholder strings that were lost.
        """
        source_placeholders = set()
        for pattern in PLACEHOLDER_PATTERNS:
            for match in pattern.finditer(source):
                source_placeholders.add(match.group(0))

        if not source_placeholders:
            return []

        target_placeholders = set()
        for pattern in PLACEHOLDER_PATTERNS:
            for match in pattern.finditer(target):
                target_placeholders.add(match.group(0))

        lost = source_placeholders - target_placeholders
        return sorted(lost)
