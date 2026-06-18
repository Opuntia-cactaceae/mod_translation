from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List


@dataclass
class DatasetRow:
    """одна строка"""
    row_id: str
    source_text: str
    reference_text: Optional[str] = None
    src_lang: str = "en"
    dst_lang: str = "ru"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProtectedText:
    """С заменой плейсхолдерами"""
    original_text: str
    protected_text: str
    protection_state: Dict[str, Any] = field(default_factory=dict)
    reference_text: Optional[str] = None


@dataclass
class BatchRequest:
    """батч"""
    batch_id: str
    rows: List[DatasetRow]
    protected_rows: List[ProtectedText]


@dataclass
class TranslationCandidate:
    """Полученный сырой текст"""
    row_id: str
    raw_response_text: str
    parsed_translation: Optional[str] = None
    validation_status: str = "pending"
    validation_errors: List[str] = field(default_factory=list)
    repair_actions: List[str] = field(default_factory=list)


@dataclass
class AcceptedTranslation:
    """Переведенная строка"""
    row_id: str
    final_text: str
    protected_text: str
    restored_text: str
    model_name: str
    prompt_profile: str
    protection_strategy: str
    validator_name: str


@dataclass
class ExperimentRun:
    """данные эксперимента"""
    experiment_id: str
    config_snapshot: Dict[str, Any]
    created_at: str