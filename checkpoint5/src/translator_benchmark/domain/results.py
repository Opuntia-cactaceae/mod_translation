from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, TYPE_CHECKING
from .enums import ValidationStatus, ResponseOutcomeType

if TYPE_CHECKING:
    from .entities import AcceptedTranslation


@dataclass
class ValidationResult:
    status: ValidationStatus
    parsed_items: Optional[List[str]] = None
    errors: List[str] = field(default_factory=list)
    repair_actions: List[str] = field(default_factory=list)
    should_retry: bool = False
    should_fallback_to_single: bool = False


@dataclass
class RuntimeCallResult:
    """данные от апишки ллмки"""
    success: bool
    raw_text: Optional[str] = None
    latency_ms: int = 0
    used_model: str = ""
    used_key_index: Optional[int] = None
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    input_token_count: Optional[int] = None
    output_token_count: Optional[int] = None
    total_token_count: Optional[int] = None
    response_outcome_type: Optional[ResponseOutcomeType] = None
    retry_reason: Optional[str] = None
    repair_applied: bool = False
    fallback_triggered: bool = False


@dataclass
class RowProcessingResult:
    """результат обработки одной строчки"""
    row_id: str
    source_text: Optional[str] = None
    reference_text: Optional[str] = None
    accepted_translation: Optional["AcceptedTranslation"] = None
    attempt_count: int = 0
    status: str = "pending"
    error_message: Optional[str] = None
    retry_count: int = 0
    repair_applied: bool = False
    fallback_used: bool = False
    total_input_tokens: Optional[int] = None
    total_output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None