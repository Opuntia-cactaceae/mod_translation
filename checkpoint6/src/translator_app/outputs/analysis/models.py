"""Domain models for output file analysis.

Phase 5 additions:
* ``protection_snapshot`` field on ``AnalysisContext``.
* ``AnalysisEngineMode`` enum for single-path migration scaffolding.

Phase 6B additions:
* ``AnalysisDivergence`` model for comparing legacy vs snapshot results.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class AnalysisCheckName(str, Enum):
    """Names of supported analysis checks.

    ``COMPILABILITY`` is a legacy name retained in the enum for
    backward-compatible serialisation of historical analysis data.
    The authoritative scoring path uses snapshot-native codes.
    """

    COMPILABILITY = "compilability"
    PLACEHOLDERS = "placeholders"


class AnalysisStatus(str, Enum):
    """Overall status of an analysis check or result."""

    PASSED = "passed"
    WARNING = "warning"
    FAILED = "failed"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Snapshot-aware analysis (shadow/debug mode, Phase 4)
# ---------------------------------------------------------------------------


class SnapshotAnalysisStatus(str, Enum):
    """Status of a snapshot-aware analysis check.

    Separate from ``AnalysisStatus`` — snapshot analysis was originally
    a shadow/debug check that did not influence legacy scoring decisions.
    Now it is the authoritative path.
    """

    SKIPPED = "skipped"
    OK = "ok"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class SnapshotAnalysisDiagnostic:
    """A single diagnostic emitted by the snapshot-aware analyzer.

    Because the snapshot analyzer runs in shadow mode these diagnostics
    are purely informational — they never become authoritative.
    """

    severity: str  # "error" | "warning" | "info"
    code: str
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SnapshotAnalysisResult:
    """Result of a snapshot-aware analysis check.

    Produced by ``SnapshotAwareAnalyzer`` and stored in-memory only —
    never persisted to the database.  Accessed via the debug endpoint
    for observability purposes.

    .. versionchanged:: Phase 7
       ``integrity_result`` carries the full ``TokenIntegrityResult``
       from the snapshot-driven token integrity analyzer, enabling
       the ``SnapshotAuthoritativeEvaluator`` to produce authoritative
       scores and diagnostics.

    .. versionchanged:: Phase 8B
       ``placeholder_integrity_result`` carries the
       ``PlaceholderIntegrityResult`` from the snapshot-driven
       placeholder integrity analyzer.
    """

    status: SnapshotAnalysisStatus
    diagnostics: List[SnapshotAnalysisDiagnostic] = field(default_factory=list)
    created_at: str = ""
    integrity_result: Any = None
    placeholder_integrity_result: Any = None
    version_check: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Analysis engine mode (Phase 5: single-path migration scaffolding)
# ---------------------------------------------------------------------------


class AnalysisEngineMode(str, Enum):
    """Controls which analysis path is authoritative.

    Modes
    -----
    LEGACY_AUTHORITATIVE
        Legacy analysis is the source of truth.
        .. deprecated:: Phase 7
            No longer used — snapshot is now authoritative.

    SNAPSHOT_SHADOW
        Snapshot analysis runs alongside legacy, still in shadow
        mode, but with full snapshot data available for diagnostics.
        .. deprecated:: Phase 7
            No longer used — snapshot is now authoritative.

    SNAPSHOT_AUTHORITATIVE
        Snapshot analysis is the source of truth (current mode).
    """

    LEGACY_AUTHORITATIVE = "legacy_authoritative"
    SNAPSHOT_SHADOW = "snapshot_shadow"
    SNAPSHOT_AUTHORITATIVE = "snapshot_authoritative"


@dataclass
class AnalysisDiagnostic:
    """A single diagnostic emitted during analysis."""

    severity: str  # "error" | "warning" | "info"
    code: str
    message: str
    source: str  # "compilability" | "placeholder" | "parser" | "io"
    line: Optional[int] = None
    column: Optional[int] = None
    key: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CheckResult:
    """Result of a single analysis check."""

    check_name: str
    status: AnalysisStatus
    score: Optional[float] = None
    diagnostics: List[AnalysisDiagnostic] = field(default_factory=list)


@dataclass
class AnalysisContext:
    """Context passed to analyzers.

    ``protection_metadata`` is an optional dict populated from the
    translation trace's ``PROTECTION_SNAPSHOT_CREATED`` events when
    the analysis service has access to a ``ProtectionMetadataResolver``.
    It carries the protection snapshot hash, strategy name, and
    applied rule count so that analyzers can correlate results with
    the protection state at translation time.

    ``protection_snapshot`` (Phase 5) is the full ``ProtectionSnapshot``
    dict (token schema, applied rules, placeholder registry) loaded
    from ``ProtectionSnapshotRepository``.  It is ``None`` when the
    full snapshot is not available.
    """

    parser_id: Optional[str] = None
    game_id: Optional[str] = None
    protection_strategy: Optional[str] = None
    protection_options: Optional[Dict[str, Any]] = None
    protection_metadata: Optional[Dict[str, Any]] = None
    protection_snapshot: Optional[Dict[str, Any]] = None
    src_lang: Optional[str] = None
    dst_lang: Optional[str] = None
    source_entries: Optional[List[Dict[str, Any]]] = None
    translated_entries: Optional[List[Dict[str, Any]]] = None


@dataclass
class OutputAnalysisOptions:
    """Options for running output file analysis.

    Attributes:
        protection_profile_id:
            If set, analysis will build a fresh ``ProtectionSnapshot``
            from the profile's enabled rules instead of using the
            original translation snapshot.
    """

    protection_profile_id: Optional[str] = None


@dataclass
class OutputFileAnalysisResult:
    """Complete result of analyzing a single output file."""

    id: str
    output_file_id: str
    job_id: str
    analyzer_version: str
    status: AnalysisStatus
    compilability_score: Optional[float] = None
    placeholders_score: Optional[float] = None
    errors_count: int = 0
    warnings_count: int = 0
    source_hash: Optional[str] = None
    translated_hash: Optional[str] = None
    diagnostics: List[AnalysisDiagnostic] = field(default_factory=list)
    created_at: str = ""
    analysis_metadata: Optional[Dict[str, Any]] = None


@dataclass
class BatchAnalysisRequest:
    """Request to analyze multiple output files."""

    job_id: Optional[str] = None
    mod_id: Optional[str] = None
    group_key: Optional[str] = None
    output_file_ids: Optional[List[str]] = None
    checks: List[str] = field(default_factory=lambda: ["compilability", "placeholders"])
    save: bool = True
    only_stale: bool = False
    protection_profile_id: Optional[str] = None


@dataclass
class BatchAnalysisResult:
    """Result of a batch analysis operation."""

    requested_count: int = 0
    analyzed_count: int = 0
    skipped_count: int = 0
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0
    results: List[OutputFileAnalysisResult] = field(default_factory=list)
    diagnostics: List[AnalysisDiagnostic] = field(default_factory=list)


class DivergenceType(str, Enum):
    """Classification of the divergence between legacy and snapshot analysis."""

    BOTH_OK = "both_ok"
    """Both legacy and snapshot agree: no issues found."""
    BOTH_FAILED = "both_failed"
    """Both legacy and snapshot detected issues (may or may not agree on which)."""
    LEGACY_FALSE_POSITIVE_CANDIDATE = "legacy_false_positive_candidate"
    """Legacy reported an issue but snapshot did not — possible false positive."""
    SNAPSHOT_DISCOVERED_ISSUE = "snapshot_discovered_issue"
    """Legacy OK but snapshot detected an issue — possible missed detection."""
    SNAPSHOT_UNAVAILABLE = "snapshot_unavailable"
    """Snapshot analysis was skipped or unavailable — no comparison possible."""
    UNKNOWN = "unknown"
    """Divergence could not be determined (e.g. incomplete data)."""

    SNAPSHOT_AUTHORITATIVE_NO_LEGACY = "snapshot_authoritative_no_legacy"
    """Snapshot analysis is now authoritative — no legacy comparison possible.

    The legacy path has been removed.  This divergence type signals that
    the result was produced entirely by the snapshot-driven path."""


@dataclass
class AnalysisDivergence:
    """Comparison between legacy and snapshot analysis results.

    This model captures *what* diverged and *how* so that operators
    can assess snapshot maturity before flipping the authoritative
    mode away from ``LEGACY_AUTHORITATIVE``.

    It is **purely informational** — no decisions are based on it.

    Attributes
    ----------
    divergence_type:
        One of the ``DivergenceType`` values classifying the outcome.
    legacy_status:
        The status from the legacy analysis path (e.g. ``"passed"``,
        ``"failed"``, ``"error"``), or ``None``.
    snapshot_status:
        The status from the snapshot analysis path (e.g. ``"ok"``,
        ``"error"``, ``"skipped"``), or ``None``.
    legacy_failed:
        Whether the legacy path considered the file failed/erroneous.
    snapshot_failed:
        Whether the snapshot path considered the file failed/erroneous.
        ``None`` when snapshot was unavailable.
    legacy_issue_codes:
        Distinct issue/diagnostic codes from the legacy result.
    snapshot_issue_codes:
        Distinct issue/diagnostic codes from the snapshot result.
    details:
        Additional structured information about the divergence.
    """

    divergence_type: DivergenceType = DivergenceType.UNKNOWN
    legacy_status: Optional[str] = None
    snapshot_status: Optional[str] = None
    legacy_failed: bool = False
    snapshot_failed: Optional[bool] = None
    legacy_issue_codes: List[str] = field(default_factory=list)
    snapshot_issue_codes: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Persisted divergence summary (Phase 6E)
# ---------------------------------------------------------------------------


@dataclass
class AnalysisDivergenceSummary:
    """Aggregated divergence statistics for a translation job.

    Built from persisted ``AnalysisDivergence`` rows to provide at-a-glance
    migration readiness without re-computing per-file divergence.

    Attributes
    ----------
    job_id:
        The translation job these metrics belong to.
    total:
        Number of output files that have been analysed.
    counts_by_type:
        Map of ``DivergenceType`` value -> count (e.g. ``{"both_ok": 7, ...}``).
    legacy_false_positive_candidates:
        Count of files where legacy failed but snapshot passed.
    snapshot_discovered_issues:
        Count of files where legacy passed but snapshot found issues.
    both_failed:
        Count of files where both legacy and snapshot detected issues.
    both_ok:
        Count of files where both methods agree: no issues.
    snapshot_unavailable:
        Count of files where snapshot analysis was unavailable/skipped.
    unknown:
        Count of files where divergence could not be determined.
    snapshot_available_ratio:
        Fraction of files where snapshot was available (0.0 to 1.0).
    migration_risk_level:
        Derived readiness label - one of ``"low"``, ``"medium"``, ``"high"``,
        or ``"unknown"`` when there is no data.
    """

    job_id: str
    total: int = 0
    counts_by_type: Dict[str, int] = field(default_factory=dict)
    legacy_false_positive_candidates: int = 0
    snapshot_discovered_issues: int = 0
    both_failed: int = 0
    both_ok: int = 0
    snapshot_unavailable: int = 0
    unknown: int = 0
    snapshot_available_ratio: float = 0.0
    migration_risk_level: str = "unknown"
