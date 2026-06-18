"""Placeholder preservation analyzer.

Verifies that placeholders, tokens, and tags present in the source text
are preserved in the translated output.

Priority order for placeholder detection:
1. Builtin rule set (via ProtectionEngine — single source of truth)
2. Validation placeholder_guard (optional)
3. Fallback regex extractor
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
# PH tag regex (used to filter out internal rule-set PH markers)
# ---------------------------------------------------------------------------

_INTERNAL_PH_TAG_RE = re.compile(r'<PH\s+id="r\d+"\s*/>')

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


def _extract_with_builtin_rule_set(text: str) -> List[str]:
    """Extract placeholders using the builtin rule set via ProtectionEngine.

    This is the authoritative extractor — it uses the same rule set as the
    core protection pipeline (``translator_app.protection.builtin_rules``).
    No legacy bridge or duplicate regex patterns are involved.

    Returns the **original user-facing placeholder text** (e.g. ``[Root.GetName]``,
    ``$OWNER$``), NOT internal ``<PH id="r{N}"/>`` tags.  Internal PH markers
    are never valid user-facing placeholders.

    Args:
        text: Text to extract placeholders from.

    Returns:
        List of original placeholder strings (e.g. ``[Root.GetName]``).
    """
    from translator_app.protection.engine import ProtectionEngine
    from translator_app.protection.rule_set import build_builtin_rule_set

    engine = ProtectionEngine()
    rule_set = build_builtin_rule_set()
    protected, mapping = engine.protect(text, [rule_set])
    # Return original placeholder text, NOT internal <PH id="r{N}"/> tags.
    # The protection mapping is {ph_id: original_text, ...}.
    return list(mapping.values())


def _collect_available_extractors() -> List:
    """Get all available extractor functions in priority order.

    Returns a list of (priority, callable) pairs where lower priority
    numbers run first.
    """
    extractors: List = [("fallback", _extract_with_fallback)]

    # Builtin rule set is always available (translator_app internal module)
    extractors.insert(0, ("builtin_rule_set", _extract_with_builtin_rule_set))

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

    IMPORTANT: Internal ``<PH id="r{N}"/>`` markers produced by the rule-set
    protection strategy are **never** valid user-facing placeholders.  They
    are filtered out in a final safety pass.

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

    # ── Safety filter: remove internal rule-set PH markers ──────────────
    # Internal <PH id="r{N}"/> tokens must NEVER reach user-facing
    # diagnostics, regardless of which extractor produced them or whether
    # they leaked into the file text from an incomplete restore.
    results = [ph for ph in results if not _INTERNAL_PH_TAG_RE.search(ph)]

    return results


def _get_placeholder_content(placeholder: str) -> str:
    """Extract the inner content of a placeholder, stripping wrapper chars.

    E.g. ``$type59$`` → ``type59``,  ``£type59£`` → ``type59``,
    ``[Root.GetName]`` → ``Root.GetName``, ``{name}`` → ``name``.

    Returns the placeholder unchanged if no known wrapper is detected.
    """
    if len(placeholder) >= 2:
        if placeholder.startswith("$") and placeholder.endswith("$"):
            return placeholder[1:-1]
        if placeholder.startswith("£") and placeholder.endswith("£"):
            return placeholder[1:-1]
        if placeholder.startswith("[") and placeholder.endswith("]"):
            return placeholder[1:-1]
        if placeholder.startswith("{") and placeholder.endswith("}"):
            return placeholder[1:-1]
    return placeholder


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

        # Position-independent placeholder matching (replaces old identity-based
        # positional matching that caused false-positive diagnostic attribution).
        #
        # Matching strategy:
        #   1. Exact text match (first pass) — a placeholder is PRESERVED if its
        #      exact text appears in the translated output.
        #   2. Cross-type content match (second pass) — if exact text is missing
        #      but the INNER content matches a translated placeholder with a
        #      different wrapper type (e.g. ``$type59$`` → ``£type59£``), it
        #      is CHANGED (type change detected).
        #   3. Remaining unmatched source placeholders → MISSING.
        #   4. Remaining translated placeholders whose IDENTITY type does not
        #      exist in the source at all → EXTRA.
        #
        # NOTE: Pure content changes within the same type (e.g. ``$NAME$`` →
        # ``$OWNER$``) are NOT detected by this supplementary analyzer to
        # avoid false attribution when multiple same-type placeholders exist.
        # The authoritative ``SnapshotPlaceholderIntegrityAnalyzer`` handles
        # this via the placeholder registry with exact-text matching.

        missing: List[Tuple[str, str, int]] = []
        changed: List[Tuple[str, str, str, str]] = []
        extra: List[Tuple[str, str, int]] = []

        remaining_translated = list(translated_placeholders)
        remaining_t_ids = list(translated_ids)

        # 1. Exact text matching (position-independent)
        for ph, ph_id in zip(source_placeholders, source_ids):
            try:
                idx = remaining_translated.index(ph)
                remaining_translated.pop(idx)
                remaining_t_ids.pop(idx)
            except ValueError:
                # 2. Cross-type content matching: same inner content,
                #    different wrapper type (e.g. $type59$ → £type59£)
                remaining_contents = [
                    _get_placeholder_content(p) for p in remaining_translated
                ]
                src_content = _get_placeholder_content(ph)
                if src_content and src_content in remaining_contents:
                    content_idx = remaining_contents.index(src_content)
                    t_id = remaining_t_ids[content_idx]
                    t_ph = remaining_translated.pop(content_idx)
                    remaining_t_ids.pop(content_idx)
                    changed.append((ph, ph_id, t_id, t_ph))
                else:
                    # 3. Truly missing — not found in translated at all
                    missing.append((ph, ph_id, 0))

        # 4. Remaining translated that have no exact-text match in source → extra
        source_text_set = set(source_placeholders)
        for ph, ph_id in zip(remaining_translated, remaining_t_ids):
            if ph not in source_text_set:
                extra.append((ph, ph_id, 0))

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
        for src_ph, expected_id, actual_id, actual_ph in changed:
            diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="CHANGED_PLACEHOLDER",
                message=(
                    f"Placeholder content changed: '{src_ph}' → '{actual_ph}' "
                    f"(identity '{expected_id}')"
                ),
                source=AnalysisCheckName.PLACEHOLDERS.value,
                line=find_line_for_text(source_text, src_ph),
                key=None,
                details={
                    "source_placeholder": src_ph,
                    "translated_placeholder": actual_ph,
                    "identity": expected_id,
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
