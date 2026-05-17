"""Analyzer registry and protocol definition.

Allows registering analyzers by check name and looking them up
at runtime.  Keeps analysis orchestration decoupled from specific
analyzer implementations.
"""

from typing import Dict, List, Optional, Protocol, Sequence, runtime_checkable

from translator_app.outputs.analysis.models import (
    AnalysisCheckName,
    AnalysisContext,
    CheckResult,
)
from translator_app.outputs.models import TranslatedOutputFile


@runtime_checkable
class OutputFileAnalyzer(Protocol):
    """Protocol that all output file analyzers must satisfy."""

    name: str
    version: str

    def analyze(
        self,
        source_text: str,
        translated_text: str,
        file: TranslatedOutputFile,
        context: AnalysisContext,
    ) -> CheckResult:
        """Run a single analysis check on a translated output file.

        Args:
            source_text: Raw source content.
            translated_text: Raw translated content.
            file: The output file domain model.
            context: Analysis context with parsed entries, parser info etc.

        Returns:
            A ``CheckResult`` with status, score, and diagnostics.
        """


class AnalyzerRegistry:
    """Registry mapping check names to analyzer instances."""

    def __init__(self) -> None:
        self._analyzers: Dict[str, OutputFileAnalyzer] = {}

    def register(self, check_name: str, analyzer: OutputFileAnalyzer) -> None:
        """Register an analyzer for a check name."""
        self._analyzers[check_name] = analyzer

    def get(self, check_name: str) -> Optional[OutputFileAnalyzer]:
        """Get analyzer for a check name, or None."""
        return self._analyzers.get(check_name)

    def get_for_checks(
        self, checks: Optional[List[str]] = None
    ) -> Dict[str, OutputFileAnalyzer]:
        """Resolve analyzers for the requested checks.

        If *checks* is None or empty, returns all registered analyzers.
        Unknown check names are silently skipped.
        """
        if not checks:
            return dict(self._analyzers)

        result: Dict[str, OutputFileAnalyzer] = {}
        for name in checks:
            analyzer = self._analyzers.get(name)
            if analyzer is not None:
                result[name] = analyzer
        return result

    def list_checks(self) -> List[str]:
        """Return list of all registered check names."""
        return list(self._analyzers.keys())
