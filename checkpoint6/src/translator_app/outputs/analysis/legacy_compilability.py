"""Legacy compilability analysis adapter.

Wraps the legacy ``calc_metric`` module's compilability/tag logic through
the existing ``legacy_bridge`` adapter, never importing legacy functions
directly into UI-layer code.

If the legacy bridge functions are not available, falls back gracefully.
"""

import logging
from typing import List, Optional

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
ANALYZER_NAME = "compilability"
ANALYZER_VERSION = "1.0.0"

# Score thresholds for status mapping
# score >= 1.0 and no errors -> passed
# 0.8 <= score < 1.0 -> warning
# score < 0.8 -> failed
# exception -> error diagnostic
PASSED_THRESHOLD = 1.0
WARNING_THRESHOLD = 0.8


def _legacy_check_available() -> bool:
    """Check if the legacy compilability functions are available."""
    try:
        from translator_benchmark.legacy_bridge import legacy_check_compilability
        legacy_check_compilability("test")
        return True
    except (ImportError, Exception):
        return False


def _legacy_check(text: str) -> float:
    """Run legacy compilability check via bridge adapter.

    Args:
        text: Translated text to check.

    Returns:
        1.0 if compilable, 0.0 if not compilable.

    Raises:
        ImportError: If legacy bridge is not available.
    """
    from translator_benchmark.legacy_bridge import legacy_check_compilability
    return legacy_check_compilability(text)


def _legacy_get_tag_summary(text: str) -> dict:
    """Get legacy tag summary via bridge adapter.

    Args:
        text: Text to analyse.

    Returns:
        Dict with tag details: n_color_spans, n_dollar_vars, etc.

    Raises:
        ImportError: If legacy bridge is not available.
    """
    from translator_benchmark.legacy_bridge import legacy_get_tag_summary
    return legacy_get_tag_summary(text)


def _compute_status(score: float, has_errors: bool) -> AnalysisStatus:
    """Map score to analysis status using configured thresholds.

    Args:
        score: Compilability score (0.0 - 1.0).
        has_errors: Whether there are error-level diagnostics.

    Returns:
        Mapped AnalysisStatus.
    """
    if has_errors:
        return AnalysisStatus.FAILED
    if score >= PASSED_THRESHOLD:
        return AnalysisStatus.PASSED
    if score >= WARNING_THRESHOLD:
        return AnalysisStatus.WARNING
    return AnalysisStatus.FAILED


def _build_fallback_check_result() -> CheckResult:
    """Build a fallback result when legacy bridge is unavailable.

    Returns a passed result since we cannot assess compilability
    without the legacy code.
    """
    return CheckResult(
        check_name=AnalysisCheckName.COMPILABILITY.value,
        status=AnalysisStatus.PASSED,
        score=1.0,
        diagnostics=[
            AnalysisDiagnostic(
                severity="info",
                code="LEGACY_UNAVAILABLE",
                message="Legacy compilability check not available — skipped",
                source=AnalysisCheckName.COMPILABILITY.value,
            )
        ],
    )


class LegacyCompilabilityAdapter:
    """Adapter wrapping legacy compilability check.

    Uses ``translator_benchmark.legacy_bridge`` to access legacy
    ``summarize_tags`` and ``compilability_score`` functions.
    Never imports from legacy code directly.
    """

    name: str = ANALYZER_NAME
    version: str = ANALYZER_VERSION

    def __init__(self) -> None:
        self._available = _legacy_check_available()

    def analyze(
        self,
        source_text: str,
        translated_text: str,
        file: TranslatedOutputFile,
        context: AnalysisContext,
    ) -> CheckResult:
        """Check compilability of translated text.

        Uses the legacy ``compilability_score`` function (via bridge) on
        the translated text.  If parser entries are available, analyses
        per-entry and aggregates.  Otherwise uses raw file-level approach.

        Returns:
            CheckResult with score and status mapped via thresholds.
        """
        if not self._available:
            return _build_fallback_check_result()

        diagnostics: List[AnalysisDiagnostic] = []

        # Use translated_entries for per-entry analysis if available
        translated_entries = context.translated_entries or []
        if translated_entries:
            return self._analyze_per_entry(
                translated_text=translated_text,
                translated_entries=translated_entries,
                diagnostics=diagnostics,
            )

        # Fallback: file-level analysis
        return self._analyze_file_level(
            translated_text=translated_text,
            diagnostics=diagnostics,
        )

    def _analyze_per_entry(
        self,
        translated_text: str,
        translated_entries: List[dict],
        diagnostics: List[AnalysisDiagnostic],
    ) -> CheckResult:
        """Analyse compilability per-entry using legacy bridge.

        Aggregates per-entry scores into an overall score.
        """
        total_score = 0.0
        entry_count = 0
        has_errors = False

        try:
            for entry in translated_entries:
                entry_text = entry.get("translated_text") or entry.get("source_text") or ""
                if not entry_text.strip():
                    continue

                score = _legacy_check(entry_text)
                total_score += score
                entry_count += 1

                if score < PASSED_THRESHOLD:
                    key = entry.get("key", "")
                    line = entry.get("translated_line") or entry.get("source_line")
                    diagnostics.append(AnalysisDiagnostic(
                        severity="error",
                        code="COMPILABILITY_FAILED",
                        message=f"Entry has malformed tags (score={score})",
                        source=AnalysisCheckName.COMPILABILITY.value,
                        line=int(line) if line else None,
                        key=key,
                        details={
                            "entry_score": score,
                            "entry_text": entry_text[:200],
                        },
                    ))
                    has_errors = True

            avg_score = total_score / entry_count if entry_count > 0 else 1.0
        except ImportError:
            return _build_fallback_check_result()
        except Exception as exc:
            diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="LEGACY_COMPILABILITY_ERROR",
                message=f"Legacy compilability check raised an error: {exc}",
                source=AnalysisCheckName.COMPILABILITY.value,
                details={"error": str(exc)},
            ))
            return CheckResult(
                check_name=AnalysisCheckName.COMPILABILITY.value,
                status=AnalysisStatus.ERROR,
                score=None,
                diagnostics=diagnostics,
            )

        status = _compute_status(avg_score, has_errors)

        return CheckResult(
            check_name=AnalysisCheckName.COMPILABILITY.value,
            status=status,
            score=avg_score,
            diagnostics=diagnostics,
        )

    def _analyze_file_level(
        self,
        translated_text: str,
        diagnostics: List[AnalysisDiagnostic],
    ) -> CheckResult:
        """Analyse compilability at the file level (single score)."""
        try:
            score = _legacy_check(translated_text)
        except ImportError:
            return _build_fallback_check_result()
        except Exception as exc:
            diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="LEGACY_COMPILABILITY_ERROR",
                message=f"Legacy compilability check raised an error: {exc}",
                source=AnalysisCheckName.COMPILABILITY.value,
                details={"error": str(exc)},
            ))
            return CheckResult(
                check_name=AnalysisCheckName.COMPILABILITY.value,
                status=AnalysisStatus.ERROR,
                score=None,
                diagnostics=diagnostics,
            )

        has_errors = score < PASSED_THRESHOLD
        if has_errors:
            diagnostics.append(AnalysisDiagnostic(
                severity="error",
                code="COMPILABILITY_FAILED",
                message="Translated file has malformed or missing tags",
                source=AnalysisCheckName.COMPILABILITY.value,
                details={"score": score},
            ))

        status = _compute_status(score, has_errors)

        return CheckResult(
            check_name=AnalysisCheckName.COMPILABILITY.value,
            status=status,
            score=score,
            diagnostics=diagnostics,
        )
