from pydantic import BaseModel
from typing import List, Optional
from app.api.schemas.common import Status

class HistoryItem(BaseModel):
    request_id: str
    source_text: str
    translated_text: Optional[str]
    source_lang: str
    target_lang: str
    model_id: str
    status: Status
    error_message: Optional[str]

class HistoryOut(BaseModel):
    items: List[HistoryItem]
