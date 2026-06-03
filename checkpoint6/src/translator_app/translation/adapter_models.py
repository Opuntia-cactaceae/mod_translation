"""18. Translation Core Adapter Module — data models.

Adapter-level dataclasses for batch/single translation flow,
fallback handling, diagnostics, and statistics.
"""

from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Error codes
# ---------------------------------------------------------------------------

TRANSLATION_FAILED = "TRANSLATION_FAILED"
BATCH_FAILED = "BATCH_FAILED"
FALLBACK_FAILED = "FALLBACK_FAILED"
TRANSLATION_COUNT_MISMATCH = "TRANSLATION_COUNT_MISMATCH"
EMPTY_TRANSLATION = "EMPTY_TRANSLATION"
INVALID_RESPONSE_FORMAT = "INVALID_RESPONSE_FORMAT"
CHATBOT_REPLY_DETECTED = "CHATBOT_REPLY_DETECTED"
API_ERROR = "API_ERROR"
TIMEOUT = "TIMEOUT"
RATE_LIMIT = "RATE_LIMIT"
PLACEHOLDER_RESTORE_FAILED = "PLACEHOLDER_RESTORE_FAILED"


# ---------------------------------------------------------------------------
# Unit statuses
# ---------------------------------------------------------------------------

STATUS_PENDING = "pending"
STATUS_TRANSLATED = "translated"
STATUS_FAILED = "failed"
STATUS_FALLBACK_TRANSLATED = "fallback_translated"
STATUS_SKIPPED = "skipped"


# ---------------------------------------------------------------------------
# Adapter-level row (internal representation)
# ---------------------------------------------------------------------------


@dataclass
class AdapterRow:
    """Internal adapter representation of a single translation unit.

    This is the format used *inside* the adapter before/after calling
    the translation runtime.  Maps to/from ``TranslationUnit``.
    """
    row_id: str = ""
    source_text: str = ""
    protected_text: str = ""
    translated_text: Optional[str] = None
    error_message: str = ""
    metadata: dict = field(default_factory=dict)

    @property
    def has_translation(self) -> bool:
        return bool(self.translated_text)


# ---------------------------------------------------------------------------
# Batch
# ---------------------------------------------------------------------------


@dataclass
class AdapterBatch:
    """A group of ``AdapterRow`` items to be sent in one batch call."""
    rows: list[AdapterRow] = field(default_factory=list)
    batch_id: str = ""

    @property
    def size(self) -> int:
        return len(self.rows)

    @property
    def source_texts(self) -> list[str]:
        return [r.source_text for r in self.rows]


# ---------------------------------------------------------------------------
# Batch result
# ---------------------------------------------------------------------------


@dataclass
class AdapterBatchResult:
    """Result of a single batch translation call to the runtime."""
    translated_texts: list[str] = field(default_factory=list)
    success: bool = True
    error: Optional[str] = None
    raw_response: Optional[str] = None

    @property
    def count(self) -> int:
        return len(self.translated_texts)


# ---------------------------------------------------------------------------
# Diagnostic
# ---------------------------------------------------------------------------


@dataclass
class AdapterDiagnostic:
    """Diagnostic message produced during adapter processing."""
    level: str = "info"  # "info" | "warning" | "error"
    code: str = ""
    message: str = ""
    unit_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@dataclass
class AdapterStats:
    """Aggregated statistics for a translation run."""
    total_units: int = 0
    translated_units: int = 0
    failed_units: int = 0
    fallback_count: int = 0
    batch_count: int = 0
    total_latency_ms: float = 0.0

    @property
    def avg_latency_ms(self) -> float:
        if self.total_units == 0:
            return 0.0
        return round(self.total_latency_ms / self.total_units, 2)


# ---------------------------------------------------------------------------
# Run result (top-level output of the adapter)
# ---------------------------------------------------------------------------


@dataclass
class AdapterRunResult:
    """Complete result of a translation run.

    Contains the updated ``TranslationUnit`` list, aggregated stats,
    and any diagnostics emitted during processing.
    """
    units: list = field(default_factory=list)   # list[TranslationUnit]
    stats: AdapterStats = field(default_factory=AdapterStats)
    diagnostics: list[AdapterDiagnostic] = field(default_factory=list)

    @property
    def success_count(self) -> int:
        return self.stats.translated_units

    @property
    def failure_count(self) -> int:
        return self.stats.failed_units
