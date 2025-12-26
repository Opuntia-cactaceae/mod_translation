from pydantic import BaseModel
from typing import List, Optional

from app.api.schemas.common import RequestId


class AdminUser(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool

class AdminTranslation(BaseModel):
    id: int
    user_id: int
    request_id: RequestId
    status: str
    model_id: str

class AdminUsersOut(BaseModel):
    items: List[AdminUser]

class AdminTranslationsOut(BaseModel):
    items: List[AdminTranslation]

class AdminHistoryConfirmOut(BaseModel):
    confirm_token: str
    expires_in: int

class AdminDeleteHistoryOut(BaseModel):
    user_id: int
    deleted: int

class AdminStatsOut(BaseModel):
    total: int
    len_mean: float
    len_p50: float
    len_p95: float
    len_p99: float
