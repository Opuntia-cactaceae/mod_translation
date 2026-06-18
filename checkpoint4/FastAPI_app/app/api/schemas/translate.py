from pydantic import BaseModel, Field
from typing import Literal, List, Optional, Union
from app.api.schemas.common import ProviderKeys, Status, TimeoutMode, RequestId


class TranslateIn(BaseModel):
    request_id: Optional[RequestId] = None
    source_text: str
    source_lang: str
    target_lang: str
    model_id: str

    provider_keys: Optional[ProviderKeys] = None
    timeout_mode: TimeoutMode = "wait"


class TranslateOut(BaseModel):
    request_id: RequestId
    translated_text: Optional[str] = None
    status: Status
    error_message: Optional[str] = None


class TranslateBatchItemIn(BaseModel):
    request_id: RequestId
    source_text: str = Field(min_length=1)


class TranslateBatchIn(BaseModel):
    source_lang: str
    target_lang: str
    model_id: str

    items: List[TranslateBatchItemIn] = Field(min_length=1)

    provider_keys: Optional[ProviderKeys] = None
    timeout_mode: TimeoutMode = "wait"


class TranslateBatchOut(BaseModel):
    items: List[TranslateOut]