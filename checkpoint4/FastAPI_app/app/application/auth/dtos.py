from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class TokenPairDTO:
    access_token: str
    refresh_token: str


@dataclass(frozen=True)
class RefreshSessionData:
    refresh_jti: str
    user_id: int
    issued_at: datetime
    expires_at: datetime
    ip: str | None = None
    user_agent: str | None = None