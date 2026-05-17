"""Output Naming Service — generates and validates output file names.

Supports auto naming (Stellaris localisation convention), custom names,
prefix/suffix, conflict detection, overwrite, and backup generation.
"""

import os
import re
import time
from pathlib import Path
from typing import Optional

from translator_app.output.models import OutputNameResult, OutputNamingOptions

# Mapping from ISO language codes to Stellaris full language names.
# Used when replacing ``l_<lang>`` patterns in localisation file names.
LANG_CODE_TO_FULL = {
    "en": "english",
    "ru": "russian",
    "fr": "french",
    "de": "german",
    "es": "spanish",
    "it": "italian",
    "pt": "portuguese",
    "pl": "polish",
    "ja": "japanese",
    "ko": "korean",
    "zh": "chinese",
    "ar": "arabic",
    "tr": "turkish",
    "nl": "dutch",
    "sv": "swedish",
    "da": "danish",
    "fi": "finnish",
    "no": "norwegian",
    "cs": "czech",
    "hu": "hungarian",
    "ro": "romanian",
    "uk": "ukrainian",
    "el": "greek",
    "he": "hebrew",
    "th": "thai",
    "vi": "vietnamese",
    "id": "indonesian",
    "ms": "malay",
}

# Reverse mapping: full name → ISO code.
FULL_TO_LANG_CODE = {v: k for k, v in LANG_CODE_TO_FULL.items()}

# Regex to detect Stellaris localisation language pattern: ``_l_<language_name>``
# e.g. ``events_l_english.yml``, ``mod_text_l_russian.yml``
LANG_PATTERN_RE = re.compile(r"_l_([a-z_]+)$")

# Characters not allowed in file names on most OS.
FORBIDDEN_CHARS = set(r'/\:*?"<>|')


class OutputNamingService:
    """Generates and validates output file names for translated files.

    Delegates conflict detection, backup paths, and uniqueness checks
    to dedicated methods so callers (EditorService, API) stay clean.
    """

    def __init__(self):
        pass

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_name(
        self,
        source_path: str,
        src_lang: str = "en",
        dst_lang: str = "ru",
        options: Optional[OutputNamingOptions] = None,
        output_dir: Optional[str] = None,
    ) -> OutputNameResult:
        """Generate an output file name and check for conflicts.

        Steps:
        1. Compute ``final_name`` based on ``options.mode`` and the source file.
        2. Build full ``output_path = output_dir / final_name``.
        3. Check whether a file already exists at that path.
        4. Decide on overwrite / backup based on ``options``.
        5. Return an ``OutputNameResult`` with all findings.

        Args:
            source_path: Path to the source file.
            src_lang: Source language (ISO code or full name).
            dst_lang: Destination language (ISO code or full name).
            options: Naming options (defaults used when ``None``).
            output_dir: Output directory (uses source file dir when ``None``).

        Returns:
            OutputNameResult with generated path, conflict info, and backup path.
        """
        if options is None:
            options = OutputNamingOptions()

        final_name = self._build_name(source_path, src_lang, dst_lang, options)
        base_dir = self._resolve_output_dir(source_path, output_dir)
        output_path = os.path.join(base_dir, final_name)

        return self._build_result(output_path, final_name, options)

    def preview_path(
        self,
        source_path: str,
        output_dir: Optional[str] = None,
        options: Optional[OutputNamingOptions] = None,
    ) -> OutputNameResult:
        """Preview the output path without any side effects.

        Takes an assumed ``dst_lang`` from the source file or defaults to "ru".
        This is the safe endpoint for the UI preview — it never checks disk state
        beyond existence.
        """
        if options is None:
            options = OutputNamingOptions()
        # Infer dst_lang from the file name if possible
        dst_lang = self._infer_dst_lang(source_path) or "ru"
        src_lang = "en"

        return self.generate_name(
            source_path=source_path,
            src_lang=src_lang,
            dst_lang=dst_lang,
            options=options,
            output_dir=output_dir,
        )

    def resolve_conflict(self, path: str, strategy: str = "rename") -> str:
        """Resolve a naming conflict by applying *strategy*.

        Supported strategies:
            - ``"rename"``: append ``_1``, ``_2`` … until unique.
            - ``"overwrite"``: return the path unchanged (caller is expected
              to overwrite).

        Returns the resolved (unique) path.
        """
        if strategy == "overwrite":
            return path
        # rename strategy
        return self.ensure_unique_name(path)

    def ensure_unique_name(self, path: str) -> str:
        """Return a unique file path by appending ``_1``, ``_2`` … if needed.

        ``file.yml`` → ``file_1.yml`` (if ``file.yml`` exists)
        ``file_1.yml`` → ``file_2.yml`` (if ``file_1.yml`` exists)
        """
        p = Path(path)
        if not p.exists():
            return path

        stem = p.stem
        suffix = p.suffix
        parent = p.parent

        counter = 1
        while True:
            candidate = parent / f"{stem}_{counter}{suffix}"
            if not candidate.exists():
                return str(candidate)
            counter += 1

    def build_backup_path(self, path: str) -> str:
        """Build a backup path for the given file.

        ``file.yml`` → ``file_backup_<timestamp>.yml``
        """
        p = Path(path)
        timestamp = int(time.time())
        backup_name = f"{p.stem}_backup_{timestamp}{p.suffix}"
        return str(p.parent / backup_name)

    # ------------------------------------------------------------------
    # Internal: name generation
    # ------------------------------------------------------------------

    def _build_name(
        self,
        source_path: str,
        src_lang: str,
        dst_lang: str,
        options: OutputNamingOptions,
    ) -> str:
        """Build the final file name (no directory)."""
        source_name = os.path.basename(source_path)
        base, ext = os.path.splitext(source_name)

        if options.mode == "custom":
            return self._apply_custom_name(options.custom_name, ext)

        # Auto mode: apply prefix/suffix to base FIRST, then language suffix
        modified_base = self._apply_prefix_suffix(base, options)
        final_base = self._apply_auto_naming(modified_base, src_lang, dst_lang, options)
        final_base = self._normalize_name(final_base)

        return f"{final_base}{ext}"

    def _apply_auto_naming(
        self,
        base: str,
        src_lang: str,
        dst_lang: str,
        options: OutputNamingOptions,
    ) -> str:
        """Apply auto-naming logic to *base*.

        Two sub-strategies:
        1. If the base contains ``_l_<src_lang>`` → replace with ``_l_<dst_lang>``
           (Stellaris localisation convention).
        2. Otherwise append ``_<dst_lang>`` (or ``_<src_lang>_<dst_lang>`` when
           ``include_lang`` is True).
        """
        src_full = LANG_CODE_TO_FULL.get(src_lang, src_lang)
        dst_full = LANG_CODE_TO_FULL.get(dst_lang, dst_lang)
        dst_code = FULL_TO_LANG_CODE.get(dst_lang, dst_lang)

        # Try to match _l_<language> pattern
        match = LANG_PATTERN_RE.search(base)
        if match:
            found_lang = match.group(1)
            # Replace the found language with dst_lang (full name)
            new_base = base[:match.start()] + f"_l_{dst_full}"
            return new_base

        # No Stellaris pattern: append language suffix
        if options.include_lang:
            src_code = FULL_TO_LANG_CODE.get(src_lang, src_lang)
            return f"{base}_{src_code}_{dst_code}"

        return f"{base}_{dst_code}"

    def _apply_custom_name(self, custom_name: Optional[str], ext: str) -> str:
        """Apply a custom user-provided name."""
        if not custom_name:
            raise ValueError("EMPTY_NAME: custom name is empty")

        self._validate_name(custom_name)

        name, name_ext = os.path.splitext(custom_name)
        # Ensure the right extension
        if not name_ext:
            return f"{name}{ext}"
        if name_ext != ext:
            # Keep user extension but warn — this is benign
            return custom_name
        return custom_name

    def _apply_prefix_suffix(self, base: str, options: OutputNamingOptions) -> str:
        """Apply optional prefix and suffix to *base*."""
        result = base
        if options.prefix:
            result = f"{options.prefix}{result}"
        if options.suffix:
            result = f"{result}{options.suffix}"
        return result

    @staticmethod
    def _normalize_name(name: str) -> str:
        """Normalize a file name: replace spaces with underscores."""
        return name.replace(" ", "_")

    # ------------------------------------------------------------------
    # Internal: validation
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_name(name: str) -> None:
        """Validate file name and raise on violations."""
        if not name:
            raise ValueError("EMPTY_NAME: name is empty")

        # Check for forbidden characters
        forbidden = FORBIDDEN_CHARS & set(name)
        if forbidden:
            chars = "".join(forbidden)
            raise ValueError(f"INVALID_FILE_NAME: forbidden characters: {chars}")

        # Check length (256 is a reasonable limit)
        if len(name) > 256:
            raise ValueError("INVALID_FILE_NAME: name too long (>256 chars)")

    # ------------------------------------------------------------------
    # Internal: helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_output_dir(source_path: str, output_dir: Optional[str] = None) -> str:
        """Resolve the output directory."""
        if output_dir:
            return output_dir
        return os.path.dirname(source_path)

    def _build_result(
        self,
        output_path: str,
        final_name: str,
        options: OutputNamingOptions,
    ) -> OutputNameResult:
        """Build an OutputNameResult from computed values."""
        p = Path(output_path)
        exists = p.exists()
        warnings: list = []

        backup_path = None
        will_overwrite = False

        if exists:
            if options.overwrite:
                will_overwrite = True
                if options.backup:
                    backup_path = self.build_backup_path(output_path)
                    warnings.append(f"BACKUP_CREATED: backup at {backup_path}")
                else:
                    warnings.append("RENAME_APPLIED: will overwrite without backup")
            else:
                # Not overwriting → rename to avoid conflict
                unique = self.ensure_unique_name(output_path)
                output_path = unique
                # Rebuild final_name from unique path
                final_name = os.path.basename(unique)
                warnings.append(f"RENAME_APPLIED: renamed to {final_name}")

        return OutputNameResult(
            output_path=output_path,
            final_name=final_name,
            conflict=exists,
            will_overwrite=will_overwrite,
            backup_path=backup_path,
            warnings=warnings,
        )

    @staticmethod
    def _infer_dst_lang(source_path: str) -> Optional[str]:
        """Try to infer destination language from a source file name."""
        base = os.path.basename(source_path)
        base_no_ext = os.path.splitext(base)[0]
        match = LANG_PATTERN_RE.search(base_no_ext)
        if match:
            lang = match.group(1)
            code = FULL_TO_LANG_CODE.get(lang)
            if code:
                return code
            return lang
        return None

    # ------------------------------------------------------------------
    # Backward-compatible shim
    # ------------------------------------------------------------------

    def output_path(self, original_path: str, output_dir: Optional[str] = None) -> str:
        """Legacy method: generate a simple output path.

        Used by ``POST /api/files/preview-output-path``.
        Delegates to ``preview_path`` internally.
        """
        result = self.preview_path(
            source_path=original_path,
            output_dir=output_dir,
        )
        return result.output_path

    def output_dir(self, base_dir: str, mod_name: str) -> str:
        """Legacy method: generate an output directory for a mod."""
        return os.path.join(base_dir, mod_name)
