from __future__ import annotations

from typing import Sequence
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func

from app.application.auth.dtos import RefreshSessionData
from app.domain.users.entities import User
from app.domain.translations.entities import TranslationRequest

from app.infrastructure.db.orm_models import (
    UserORM,
    TranslationRequestORM,
    RefreshSessionORM,
)
from app.infrastructure.db.mappers import (
    orm_to_user,
    user_to_orm,
    orm_to_translation_request,
    translation_request_to_orm,
)


class SqlAlchemyUsersRepository:
    def __init__(self, session: AsyncSession):
        """
        Purpose:
            Инициализация репозитория пользователей.

        Input:
            session: AsyncSession — активная сессия SQLAlchemy.

        Output:
            None.

        Side Effects:
            Нет.

        Notes:
            Репозиторий не управляет транзакцией.
        """
        self.session = session

    async def get(self, user_id: int) -> User | None:
        """
        Purpose:
            Получить пользователя по идентификатору.

        Input:
            user_id: int — идентификатор пользователя.

        Output:
            User | None — доменная сущность пользователя или None.

        Side Effects:
            Нет.

        Notes:
            ORM-модель преобразуется в доменную сущность.
        """
        orm = await self.session.get(UserORM, user_id)
        return orm_to_user(orm) if orm else None

    async def get_by_email(self, email: str) -> User | None:
        """
        Purpose:
            Получить пользователя по email.

        Input:
            email: str — email пользователя.

        Output:
            User | None — доменная сущность пользователя или None.

        Side Effects:
            Нет.

        Notes:
            Ожидается уникальность email на уровне БД.
        """
        res = await self.session.execute(select(UserORM).where(UserORM.email == email))
        orm = res.scalar_one_or_none()
        return orm_to_user(orm) if orm else None

    async def add(self, user: User) -> None:
        """
        Purpose:
            Добавить нового пользователя в текущую сессию.

        Input:
            user: User — доменная сущность пользователя.

        Output:
            None.

        Side Effects:
            Добавляет ORM-модель в сессию SQLAlchemy.

        Notes:
            Commit выполняется UnitOfWork.
        """
        self.session.add(user_to_orm(user))


class SqlAlchemyTranslationsRepository:
    def __init__(self, session: AsyncSession):
        """
        Purpose:
            Инициализация репозитория переводов.

        Input:
            session: AsyncSession — активная сессия SQLAlchemy.

        Output:
            None.

        Side Effects:
            Нет.

        Notes:
            Репозиторий не управляет транзакцией.
        """
        self.session = session

    async def get_by_request_id(self, user_id: int, request_id: str) -> TranslationRequest | None:
        """
        Purpose:
            Получить перевод по (user_id, request_id).

        Input:
            user_id: int — идентификатор пользователя.
            request_id: str — идемпотентный идентификатор запроса.

        Output:
            TranslationRequest | None — доменная сущность перевода или None.

        Side Effects:
            Нет.

        Notes:
            Используется для обеспечения идемпотентности.
        """
        stmt = select(TranslationRequestORM).where(
            TranslationRequestORM.user_id == user_id,
            TranslationRequestORM.request_id == request_id,
        )
        res = await self.session.execute(stmt)
        orm = res.scalar_one_or_none()
        return orm_to_translation_request(orm) if orm else None

    async def get_many_by_request_ids(
        self,
        user_id: int,
        request_ids: Sequence[str],
    ) -> list[TranslationRequest]:
        """
        Purpose:
            Получить переводы по набору request_id для конкретного пользователя.

        Input:
            user_id: int — идентификатор пользователя.
            request_ids: Sequence[str] — список идемпотентных идентификаторов запросов.

        Output:
            list[TranslationRequest] — список найденных доменных сущностей переводов.

        Side Effects:
            Нет.

        Notes:
            Возвращает только существующие записи.
        """
        if not request_ids:
            return []

        stmt = select(TranslationRequestORM).where(
            TranslationRequestORM.user_id == user_id,
            TranslationRequestORM.request_id.in_(list(request_ids)),
        )
        res = await self.session.execute(stmt)
        return [orm_to_translation_request(o) for o in res.scalars().all()]

    async def add(self, translation: TranslationRequest) -> None:
        """
        Purpose:
            Добавить один перевод в текущую сессию.

        Input:
            translation: TranslationRequest — доменная сущность перевода.

        Output:
            None.

        Side Effects:
            Добавляет ORM-модель в сессию SQLAlchemy.

        Notes:
            Commit выполняется UnitOfWork.
        """
        self.session.add(translation_request_to_orm(translation))

    async def add_many(self, translations: Sequence[TranslationRequest]) -> None:
        """
        Purpose:
            Добавить несколько переводов в текущую сессию.

        Input:
            translations: Sequence[TranslationRequest] — последовательность доменных сущностей переводов.

        Output:
            None.

        Side Effects:
            Добавляет ORM-модели в сессию SQLAlchemy.

        Notes:
            Используется для batch-операций.
        """
        self.session.add_all([translation_request_to_orm(t) for t in translations])

    async def list_by_user(self, user_id: int, limit: int, offset: int) -> list[TranslationRequest]:
        """
        Purpose:
            Получить список переводов пользователя с пагинацией.

        Input:
            user_id: int — идентификатор пользователя.
            limit: int — максимальное количество записей.
            offset: int — смещение выборки.

        Output:
            list[TranslationRequest] — список доменных сущностей переводов.

        Side Effects:
            Нет.

        Notes:
            Результат отсортирован по created_at DESC.
        """
        stmt = (
            select(TranslationRequestORM)
            .where(TranslationRequestORM.user_id == user_id)
            .order_by(TranslationRequestORM.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        res = await self.session.execute(stmt)
        return [orm_to_translation_request(o) for o in res.scalars().all()]

    async def delete_by_user(self, user_id: int) -> int:
        """
        Purpose:
            Удалить всю историю переводов конкретного пользователя.

        Output:
            int — количество удалённых строк.

        Notes:
            Commit выполняется UnitOfWork.
        """
        stmt = delete(TranslationRequestORM).where(TranslationRequestORM.user_id == user_id)
        res = await self.session.execute(stmt)
        return int(res.rowcount or 0)

    async def stats_global(self) -> dict:
        """
        Purpose:
            Вернуть простую статистику по истории переводов всех пользователей.

        Output:
            dict — агрегаты.

        Notes:
            Считаем только то, что можно по истории:
              - total переводов
              - mean/p50/p95/p99 по длине исходного текста
        """
        stmt = select(
            func.count(TranslationRequestORM.id),
            func.avg(func.length(TranslationRequestORM.source_text)),
            func.percentile_cont(0.50).within_group(func.length(TranslationRequestORM.source_text)),
            func.percentile_cont(0.95).within_group(func.length(TranslationRequestORM.source_text)),
            func.percentile_cont(0.99).within_group(func.length(TranslationRequestORM.source_text)),
        )
        res = await self.session.execute(stmt)
        total, mean_len, p50, p95, p99 = res.one()

        return {
            "total": int(total or 0),
            "len_mean": float(mean_len or 0.0),
            "len_p50": float(p50 or 0.0),
            "len_p95": float(p95 or 0.0),
            "len_p99": float(p99 or 0.0),
        }


class SqlAlchemyRefreshTokensRepository:
    def __init__(self, session: AsyncSession):
        """
        Purpose:
            Инициализация репозитория refresh-сессий.

        Input:
            session: AsyncSession — активная сессия SQLAlchemy.

        Output:
            None.

        Side Effects:
            Нет.

        Notes:
            Репозиторий не управляет транзакцией.
        """
        self.session = session

    async def add_session(self, sess: RefreshSessionData) -> None:
        """
        Purpose:
            Создать и сохранить refresh-сессию в БД.

        Input:
            sess: RefreshSessionData — данные refresh-сессии.

        Output:
            None.

        Side Effects:
            Добавляет ORM-модель в сессию SQLAlchemy.

        Notes:
            Commit выполняется UnitOfWork.
        """
        orm = RefreshSessionORM(
            refresh_jti=sess.refresh_jti,
            user_id=sess.user_id,
            issued_at=sess.issued_at,
            expires_at=sess.expires_at,
            revoked_at=None,
            replaced_by_jti=None,
            ip=sess.ip,
            user_agent=sess.user_agent,
        )
        self.session.add(orm)


    async def get_session(self, jti: str) -> RefreshSessionORM | None:
        """
        Purpose:
            Получить refresh-сессию по jti.

        Input:
            jti: str — уникальный идентификатор refresh-токена.

        Output:
            RefreshSessionORM | None — ORM-модель сессии или None.

        Side Effects:
            Нет.

        Notes:
            Используется в refresh-token flow.
        """
        return await self.session.get(RefreshSessionORM, jti)

    async def revoke_session(self, jti: str) -> None:
        """
        Purpose:
            Ревокать одну refresh-сессию.

        Input:
            jti: str — идентификатор refresh-токена.

        Output:
            None.

        Side Effects:
            Устанавливает revoked_at для найденной сессии.

        Notes:
            Используется при logout и refresh-rotation.
        """
        sess = await self.get_session(jti)
        if sess and sess.revoked_at is None:
            sess.revoked_at = datetime.utcnow()

    async def revoke_all_for_user(self, user_id: int) -> None:
        """
        Purpose:
            Ревокать все активные refresh-сессии пользователя.

        Input:
            user_id: int — идентификатор пользователя.

        Output:
            None.

        Side Effects:
            Обновляет revoked_at для всех активных сессий пользователя.

        Notes:
            Используется при logout-all, смене пароля и инцидентах безопасности.
        """
        stmt = (
            update(RefreshSessionORM)
            .where(
                RefreshSessionORM.user_id == user_id,
                RefreshSessionORM.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.utcnow())
        )
        await self.session.execute(stmt)