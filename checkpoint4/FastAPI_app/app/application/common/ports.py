from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Optional, Sequence

from app.application.common.types import TimeoutMode, ProviderKeys, TranslationStatus
from app.domain.users.entities import User
from app.domain.translations.entities import TranslationRequest
from app.application.auth.dtos import RefreshSessionData


@dataclass(frozen=True)
class ModelInfo:
    id: str
    title: Optional[str] = None


@dataclass(frozen=True)
class TranslateCommand:
    request_id: str
    source_text: str
    source_lang: str
    target_lang: str
    model_id: str


@dataclass(frozen=True)
class TranslateResult:
    request_id: str
    translated_text: Optional[str]
    status: TranslationStatus
    error_message: Optional[str] = None


class TranslationGateway(Protocol):
    async def translate_one(
        self,
        cmd: TranslateCommand,
        *,
        provider_keys: Optional[ProviderKeys] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> TranslateResult: ...

    async def translate_batch(
        self,
        cmds: Sequence[TranslateCommand],
        *,
        provider_keys: Optional[ProviderKeys] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> list[TranslateResult]: ...

    async def list_languages(self) -> list[str]: ...
    async def list_models(self) -> list[ModelInfo]: ...


class UsersRepository(Protocol):
    async def get(self, user_id: int) -> User | None: ...
    async def get_by_email(self, email: str) -> User | None: ...
    async def add(self, user: User) -> None: ...


class TranslationsRepository(Protocol):
    async def get_by_request_id(self, user_id: int, request_id: str) -> TranslationRequest | None: ...
    async def get_many_by_request_ids(self, user_id: int, request_ids: Sequence[str]) -> list[TranslationRequest]: ...
    async def add(self, translation: TranslationRequest) -> None: ...
    async def add_many(self, translations: Sequence[TranslationRequest]) -> None: ...
    async def list_by_user(self, user_id: int, limit: int, offset: int) -> list[TranslationRequest]: ...
    async def delete_by_user(self, user_id: int) -> int: ...
    async def stats_global(self) -> dict: ...


class RefreshTokensRepository(Protocol):
    async def add_session(self, session: RefreshSessionData) -> None: ...
    async def get_session(self, jti: str): ...
    async def revoke_session(self, jti: str) -> None: ...
    async def revoke_all_for_user(self, user_id: int) -> None: ...


class MetaCache(Protocol):
    async def get_languages(self) -> Optional[list[str]]: ...
    async def set_languages(self, languages: list[str], ttl_seconds: int) -> None: ...
    async def get_models(self) -> Optional[list[ModelInfo]]: ...
    async def set_models(self, models: list[ModelInfo], ttl_seconds: int) -> None: ...