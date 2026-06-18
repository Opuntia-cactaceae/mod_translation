from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Literal

TranslationStatus = Literal["ok", "corrupted"]

@dataclass(frozen=True)
class TranslationRequest:
    id: int
    user_id: int
    request_id: str
    source_text: str
    source_lang: str
    target_lang: str
    model_id: str
    translated_text: Optional[str]
    status: TranslationStatus
    error_message: Optional[str]
    created_at: datetime