from dataclasses import dataclass
from typing import Optional, Literal

from app.application.common.types import TranslationStatus


@dataclass(frozen=True)
class TranslationDTO:
    request_id: str
    translated_text: Optional[str]
    status: TranslationStatus
    error_message: Optional[str] = None