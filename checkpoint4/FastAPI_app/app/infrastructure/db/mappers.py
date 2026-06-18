from __future__ import annotations

from datetime import datetime, timezone

from app.domain.users.entities import User
from app.domain.translations.entities import TranslationRequest
from app.infrastructure.db.orm_models import UserORM, TranslationRequestORM


def _to_naive_utc(dt: datetime) -> datetime:
    """
    Purpose:
        Привести datetime к naive UTC (без tzinfo).
    """
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _to_aware_utc(dt: datetime) -> datetime:
    """
    Purpose:
        Привести datetime к aware UTC (tzinfo=UTC) для доменного слоя.
    """
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc)
    return dt.replace(tzinfo=timezone.utc)


def orm_to_user(orm: UserORM) -> User:
    """
    Purpose:
        Преобразовать ORM-модель пользователя в доменную сущность.

    Input:
        orm: UserORM — ORM-модель пользователя.

    Output:
        User — доменная сущность пользователя.

    Side Effects:
        Нет.

    Notes:
        Используется внутри инфраструктурного слоя.
    """
    return User(
        id=orm.id,
        email=orm.email,
        password_hash=orm.password_hash,
        role=orm.role,
        is_active=orm.is_active,
        created_at=_to_aware_utc(orm.created_at),
    )


def user_to_orm(entity: User) -> UserORM:
    """
    Purpose:
        Преобразовать доменную сущность пользователя в ORM-модель.

    Input:
        entity: User — доменная сущность пользователя.

    Output:
        UserORM — ORM-модель пользователя.

    Side Effects:
        Нет.

    Notes:
        Идентификатор может быть не установлен для новых сущностей.
    """
    orm = UserORM()
    if entity.id:
        orm.id = entity.id
    orm.email = entity.email
    orm.password_hash = entity.password_hash
    orm.role = entity.role
    orm.is_active = entity.is_active
    orm.created_at = _to_naive_utc(entity.created_at)
    return orm


def orm_to_translation_request(orm: TranslationRequestORM) -> TranslationRequest:
    """
    Purpose:
        Преобразовать ORM-модель перевода в доменную сущность.

    Input:
        orm: TranslationRequestORM — ORM-модель перевода.

    Output:
        TranslationRequest — доменная сущность перевода.

    Side Effects:
        Нет.

    Notes:
        Используется репозиториями при чтении из БД.
    """
    return TranslationRequest(
        id=orm.id,
        user_id=orm.user_id,
        request_id=orm.request_id,
        source_text=orm.source_text,
        source_lang=orm.source_lang,
        target_lang=orm.target_lang,
        model_id=orm.model_id,
        translated_text=orm.translated_text,
        status=orm.status,
        error_message=orm.error_message,
        created_at=_to_aware_utc(orm.created_at),
    )


def translation_request_to_orm(entity: TranslationRequest) -> TranslationRequestORM:
    """
    Purpose:
        Преобразовать доменную сущность перевода в ORM-модель.

    Input:
        entity: TranslationRequest — доменная сущность перевода.

    Output:
        TranslationRequestORM — ORM-модель перевода.

    Side Effects:
        Нет.

    Notes:
        Используется репозиториями при сохранении в БД.
    """
    orm = TranslationRequestORM()

    if entity.id:
        orm.id = entity.id

    orm.user_id = entity.user_id
    orm.request_id = entity.request_id
    orm.source_text = entity.source_text
    orm.source_lang = entity.source_lang
    orm.target_lang = entity.target_lang
    orm.model_id = entity.model_id
    orm.translated_text = entity.translated_text
    orm.status = entity.status
    orm.error_message = entity.error_message
    orm.created_at = _to_naive_utc(entity.created_at)
    return orm