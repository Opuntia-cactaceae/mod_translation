from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime

@dataclass(frozen=True)
class User:
    id: int
    email: str
    password_hash: str
    role: str
    is_active: bool
    created_at: datetime