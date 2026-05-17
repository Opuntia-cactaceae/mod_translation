"""Preflight validation for translation preview.

Builds a diagnostics report *before* the full task plan is assembled,
giving the user early feedback about problematic input files without
running any translations.
"""

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from translator_app.file_processing.models.file_type import FileCategory, FileType
from translator_app.file_processing.service import FileProcessingService
from translator_app.translation.config import TranslationConfig
from translator_app.translation.task_planner import TaskPlanner

# Pattern for Stellaris-style language indicators in file names:
#   l_english.yml, l_russian.yml, l_french.yml, etc.
_LANG_IN_FILENAME_RE = re.compile(
    r"(?:^|[/\\])l_([a-z]+(?:_[a-z]+)?)\.(?:yml|yaml)$",
    re.IGNORECASE,
)

# Well-known Stellaris localisation language identifiers.
_KNOWN_LANGUAGES = {
    "english", "russian", "french", "german", "spanish",
    "polish", "braz_por", "turkish", "japanese", "korean",
    "chinese", "simp_chinese",
}


def _detect_language_from_filename(file_path: str) -> Optional[str]:
    """Try to extract a language hint from the file name.

    Matches Stellaris-style ``l_<language>.yml`` patterns.
    Returns the language string (e.g. ``"english"``) or *None*.
    """
    m = _LANG_IN_FILENAME_RE.search(file_path)
    if m:
        lang = m.group(1).lower()
        if lang in _KNOWN_LANGUAGES:
            return lang
    return None


def build_preflight_report(
    file_paths: List[str],
    config: TranslationConfig,
    planner: TaskPlanner,
    file_service: FileProcessingService,
) -> Dict[str, Any]:
    """Analyse input files for common issues *before* translation.

    This function is intentionally **non-blocking**: a parse failure
    for one file does not crash the whole preview. Errors are collected
    into the returned report.

    Parameters
    ----------
    file_paths:
        List of file paths to validate.
    config:
        The active ``TranslationConfig`` (used for language settings).
    planner:
        The ``TaskPlanner`` instance (used for its config reference).
    file_service:
        The ``FileProcessingService`` used for detection/parsing.

    Returns
    -------
    dict with keys:
        warnings           — non-blocking diagnostic messages
        errors             — blocking error messages
        unsupported_files  — paths that could not be detected
        duplicate_files    — paths that appear more than once
        empty_files        — paths with size == 0
        zero_unit_files    — paths parsed OK but yielded 0 units
        detected_languages — unique languages found across files
        has_blocking_errors — True if translation cannot proceed
    """
    warnings: List[str] = []
    errors: List[str] = []
    unsupported_files: List[str] = []
    duplicate_files: List[str] = []
    empty_files: List[str] = []
    zero_unit_files: List[str] = []
    detected_languages: List[str] = []
    seen_languages: set = set()

    src_lang = config.src_lang
    dst_lang = config.dst_lang

    # ------------------------------------------------------------------
    # A. Duplicate detection
    # ------------------------------------------------------------------
    seen_paths: Dict[str, int] = {}
    for raw_path in file_paths:
        resolved = str(Path(raw_path).resolve())
        seen_paths.setdefault(resolved, 0)
        seen_paths[resolved] += 1

    for path, count in seen_paths.items():
        if count > 1:
            duplicate_files.append(path)
    if duplicate_files:
        warnings.append(
            f"Duplicate files detected: {len(duplicate_files)} file(s) "
            f"appear more than once in the file list."
        )

    # ------------------------------------------------------------------
    # B–F. Per-file checks
    # ------------------------------------------------------------------
    for raw_path in file_paths:
        name = Path(raw_path).name
        try:
            resolved = Path(raw_path).resolve()
        except (OSError, RuntimeError):
            resolved = Path(raw_path)

        # -- Unsupported files (B) --
        try:
            detection = file_service.detect_file(str(resolved))
            is_unknown = detection.file_type.category == FileCategory.UNKNOWN
            has_no_confidence = detection.confidence <= 0.0
            if is_unknown or has_no_confidence:
                unsupported_files.append(str(resolved))
                continue  # skip further checks for unsupported files
        except Exception as exc:
            unsupported_files.append(str(resolved))
            errors.append(f"{name}: detection failed — {exc}")
            continue

        # -- Empty files (C) --
        try:
            if resolved.exists() and resolved.stat().st_size == 0:
                empty_files.append(str(resolved))
                continue  # empty file can't have units
        except (OSError, RuntimeError):
            pass

        # -- Language detection (F) from file name --
        lang_from_name = _detect_language_from_filename(str(resolved))
        if lang_from_name and lang_from_name not in seen_languages:
            seen_languages.add(lang_from_name)
            detected_languages.append(lang_from_name)

        # Also use detection-level language hint
        try:
            dl = getattr(detection, "detected_language", "") or getattr(detection, "language", "")
            if dl and dl not in seen_languages:
                seen_languages.add(dl)
                if dl not in detected_languages:
                    detected_languages.append(dl)
        except Exception:
            pass

        # -- Parse & units (D, E) --
        try:
            parsed = file_service.parse_file(str(resolved))
        except Exception as exc:
            errors.append(f"{name}: parse failed — {exc}")
            continue

        try:
            units = file_service.extract_translation_units(
                parsed, src_lang=src_lang, dst_lang=dst_lang
            )
            if len(units) == 0:
                zero_unit_files.append(str(resolved))
        except Exception as exc:
            errors.append(f"{name}: extract units failed — {exc}")

    # ------------------------------------------------------------------
    # F. Mixed language warning
    # ------------------------------------------------------------------
    if len(detected_languages) > 1:
        warnings.append(
            f"Multiple source languages detected: {', '.join(sorted(detected_languages))}"
        )

    # ------------------------------------------------------------------
    # G. Blocking errors
    # ------------------------------------------------------------------
    has_blocking_errors = len(unsupported_files) > 0 or len(errors) > 0

    return {
        "warnings": warnings,
        "errors": errors,
        "unsupported_files": unsupported_files,
        "duplicate_files": duplicate_files,
        "empty_files": empty_files,
        "zero_unit_files": zero_unit_files,
        "detected_languages": detected_languages,
        "has_blocking_errors": has_blocking_errors,
    }
