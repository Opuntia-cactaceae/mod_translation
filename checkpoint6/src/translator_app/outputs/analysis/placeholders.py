"""Placeholder preservation analyzer.

Verifies that placeholders, tokens, and tags present in the source text
are preserved in the translated output.

Priority order for placeholder detection:
1. Existing project protection strategies / token utils
2. Validation placeholder_guard
3. Legacy token utils (via bridge)
4. Fallback regex extractor
"""

import logging
import re
from typing import Dict, List, Optional, Set, Tuple

from translator_app.outputs.analysis.models import (
    AnalysisCheckName,
    AnalysisContext,
    AnalysisDiagnostic,
    AnalysisStatus,
    CheckResult,
)
from translator_app.outputs.analysis.line_mapping import find_line_for_key, find_line_for_text
from translator_app.outputs.models import TranslatedOutputFile

logger = logging.getLogger(__name__)

# Analyzer identity
ANALYZER_NAME = "placeholders"
ANALYZER_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Fallback regex patterns (used when no project-level extractor is available)
# ---------------------------------------------------------------------------
FALLBACK_PATTERNS: List[re.Pattern] = [
    # XML-style protected/id placeholders  <PH id="k0"/>  <protected id="xml0"/>
    re.compile(r'<(?:PH|protected)\s+id="[^"]+"/?>'),
    # Printf-style: %s, %d, %.2f, %1$s
    re.compile(r"%\d*\.?\d*[sdfgeE]"),
    # Python / format-style: {name}, {0}
    re.compile(r"\{[^}]+\}"),
    # Dollar variables: $VAR$
    re.compile(r"\$[A-Za-z0-9_|.+\-%]+\$"),
    # Script tags: [Root.GetName]
    re.compile(r"\[.+?\]"),
    # Pound icons:  £food£
    re.compile(r"£[^£\s]+£"),
    # Color codes:  §Y  §!
    re.compile(r"§[A-Za-z0-9!]"),
    # Escaped newlines
    re.compile(r"\\n"),
]


def _extract_with_fallback(text: str) -> List[str]:
    """Extract placeholders using fallback regex patterns.

    Args:
        text: Text to extract placeholders from.

    Returns:
        List of matched placeholder strings.
    """
    found: List[str] = []
    for pattern in FALLBACK_PATTERNS:
        matches = pattern.findall(text)
        found.extend(matches)
    return found


def _extract_with_placeholder_guard(text: str) -> List[str]:
    """Extract placeholders using the validation placeholder_guard module.

    Falls back to fallback regex if placeholder_guard is not available.

    Args:
        text: Text to extract placeholders from.

    Returns:
        List of matched placeholder strings.
    """
    try:
        from translator_benchmark.validation.placeholder_guard import extract_placeholders
        return extract_placeholders(text)
    except ImportError:
        return _extract_with_fallback(text)


def _extract_with_legacy_bridge(text: str) -> List[str]:
    """Extract placeholders using game_token_utils via the legacy bridge.

    Args:
        text: Text to extract placeholders from.

    Returns:
        List of matched placeholder strings.
    """
    from translator_benchmark.legacy_bridge import legacy_protect_tokens

    protected, _ = legacy_protect_tokens(text)
    # Extract <PH id="..."/> tags from protected text
    ph_tags = re.findall(r'<PH\s+id="[^"]+"/>', protected)
    return ph_tags


def _collect_available_extractors() -> List:
    """Get all available extractor functions in priority order.

    Returns a list of (priority, callable) pairs where lower priority
    numbers run first.
    """
    extractors: List = [("fallback", _extract_with_fallback)]

    # game_token_utils is always available (internal module)
    extractors.insert(0, ("legacy_bridge", _extract_with_legacy_bridge))

    try:
        from translator_benchmark.validation.placeholder_guard import extract_placeholders  # noqa: F401
        extractors.insert(0, ("placeholder_guard", _extract_with_placeholder_guard))
    except ImportError:
        logger.debug("Placeholder guard extractor not available, using fallback")

    return extractors


# All available extractors, gathered at module load time
_AVAILABLE_EXTRACTORS = _collect_available_extractors()


def extract_placeholders(text: str) -> List[str]:
    """Extract placeholders from text using all available methods.

    Runs all available extractors and merges results with deduplication
    while preserving the order of first appearance.

    Args:
        text: Source or translated text.

    Returns:
        List of placeholder strings found in order of appearance.
    """
    results: List[str] = []
    seen: Set[str] = set()

    for name, extractor in _AVAILABLE_EXTRACTORS:
        try:
            found = extractor(text)
        except Exception:
            logger.debug("Extractor %s failed for text", name, exc_info=True)
            continue
        for ph in found:
            if ph not in seen:
                results.append(ph)
                seen.add(ph)

    return results


def compute_placeholder_identity(placeholder: str) -> str:
    """Compute a normalised identity for a placeholder.

    Used to detect changed placeholders (same type but different value).
    Strips variable parts like IDs and values while preserving type info.

    Args:
        placeholder: The raw placeholder string.

    Returns:
        Normalised identity string.
    """
    # XML tags: normalise the id value
    if re.match(r'<[^>]+id="[^"]+"', placeholder):
        return re.sub(r'id="[^"]+"', 'id="*"', placeholder)
    # Dollar vars: normalise variable name
    if placeholder.startswith("$") and placeholder.endswith("$"):
        return "$*$"
    # Script tags: normalise content
    if placeholder.startswith("[") and placeholder.endswith("]"):
        return "[*]"
    # Pound icons: normalise icon name
    if placeholder.startswith("£") and placeholder.endswith("£"):
        return "£*£"
    # Format placeholders: normalise specifier
    if placeholder.startswith("%"):
        return re.sub(r"%\d*\.?\d*", "%", placeholder)
    # Python format: normalise key
    if placeholder.startswith("{") and placeholder.endswith("}"):
        return "{*}"
    return placeholder


class PlaceholderAnalyzer:
    """Analyzer that checks placeholder preservation in translations."""

    name: str = ANALYZER_NAME
    version: str = ANALYZER_VERSION

    def analyze(
        self,
        source_text: str,
        translated_text: str,
        file: TranslatedOutputFile,
        context: AnalysisContext,
    ) -> CheckResult:
        """Check that placeholders in source are preserved in translation.

        Returns:
            CheckResult with:
            - placeholders_score = matched_required / required_total
            - passed if score == 1.0 and no missing placeholders
            - warning if there are extra placeholders
            - failed if any required placeholders are missing
        """
        diagnostics: List[AnalysisDiagnostic] = []

        source_placeholders = extract_placeholders(source_text)
        translated_placeholders = extract_placeholders(translated_text)

        # Source placeholder identities for matching
        source_ids: List[str] = [compute_placeholder_identity(p) for p in source_placeholders]
        translated_ids: List[str] = [compute_placeholder_identity(p) for p in translated_placeholders]

        # Count required (non-optional) placeholders.
        # For now, all source placeholders are considered required.
        required_total = len(source_placeholders)

        # Build key-to-line mapping if entries are available
        key_to_line: Dict[str, int] = {}
        source_entries = context.source_entries or []
        for entry in source_entries:
            k = entry.get("key") or ""
            if k:
                line = entry.get("source_line") or 0
                key_to_line[k] = int(line)

        # Check for missing placeholders
        missing: List[Tuple[str, str, int]] = []  # (placeholder, identity, index)
        for i, (ph, ph_id) in enumerate(zip(source_placeholders, source_ids)):
            if ph_id not in translated_ids:
                missing.append((ph, ph_id, i))

        # Check for extra placeholders (present in translation but not in source)
        extra: List[Tuple[str, str, int]] = []
        for i, (ph, ph_id) in enumerate(zip(translated_placeholders, translated_ids)):
            if ph_id not in source_ids:
                extra.append((ph, ph_id, i))

        # Check for changed placeholders (same index position, different identity)
        changed: List[Tuple[str, str, str]] = []  # (source_ph, expected_id, actual_id)
        for i, (src_ph, src_id) in enumerate(zip(source_placeholders, source_ids)):
            if i < len(translated_placeholders):
                tgt_id = translated_ids[i]
                if src_id != tgt_id:
                    changed.append((src_ph, src_id, tgt_id))

        matched_required = required_total - len(missing)
        score = matched_required / required_total if required_total > 0 else 1.0

        # Build diagnostics for missing placeholders (error)
        for ph, ph_id, idx in missing:
            line = find_line_for_text(source_text, ph)
            if not line and source_entries and idx < len(source_entries):
                entry = source_entries[idx]
                line = key_to_line.get(entry.get("key", ""))
            diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="MISSING_PLACEHOLDER",
                message=f"Required placeholder '{ph}' is missing in translation",
                source=AnalysisCheckName.PLACEHOLDERS.value,
                line=line,
                key=None,
                details={"placeholder": ph, "identity": ph_id},
            ))

        # Build diagnostics for extra placeholders (warning)
        for ph, ph_id, idx in extra:
            diagnostics.append(AnalysisDiagnostic(
                severity="warning",
                code="EXTRA_PLACEHOLDER",
                message=f"Unexpected placeholder '{ph}' found in translation",
                source=AnalysisCheckName.PLACEHOLDERS.value,
                line=None,
                key=None,
                details={"placeholder": ph, "identity": ph_id},
            ))

        # Build diagnostics for changed placeholders (error)
        for src_ph, expected_id, actual_id in changed:
            diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="CHANGED_PLACEHOLDER",
                message=(
                    f"Placeholder identity changed: expected '{expected_id}', "
                    f"got '{actual_id}' for source placeholder '{src_ph}'"
                ),
                source=AnalysisCheckName.PLACEHOLDERS.value,
                line=find_line_for_text(source_text, src_ph),
                key=None,
                details={
                    "source_placeholder": src_ph,
                    "expected_identity": expected_id,
                    "actual_identity": actual_id,
                },
            ))

        # Determine overall status
        if missing or changed:
            status = AnalysisStatus.FAILED
        elif extra:
            status = AnalysisStatus.WARNING
        else:
            status = AnalysisStatus.PASSED

        return CheckResult(
            check_name=AnalysisCheckName.PLACEHOLDERS.value,
            status=status,
            score=score,
            diagnostics=diagnostics,
        )
