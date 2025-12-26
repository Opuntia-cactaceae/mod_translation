from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.orm_models import UserORM, TranslationRequestORM


class AdminRead:
    """
    Purpose:
        Read-only доступ к админским данным (пользователи, переводы, статистика).

    Notes:
        - Не управляет транзакциями, работает поверх переданной AsyncSession.
        - Используется только для чтения (SELECT).
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_users(self) -> dict:
        """
        Purpose:
            Получить список пользователей.

        Output:
            dict: {"items": [...]}

        Notes:
            Возвращает данные в форме, совместимой со схемой AdminUsersOut.
        """
        res = await self._session.execute(
            select(UserORM).order_by(UserORM.id.asc())
        )
        users = res.scalars().all()
        return {
            "items": [
                {
                    "id": u.id,
                    "email": u.email,
                    "role": u.role,
                    "is_active": u.is_active,
                }
                for u in users
            ]
        }

    async def list_translations(self) -> dict:
        """
        Purpose:
            Получить список переводов.

        Output:
            dict: {"items": [...]}

        Notes:
            Возвращает данные в форме, совместимой со схемой AdminTranslationsOut.
        """
        res = await self._session.execute(
            select(TranslationRequestORM).order_by(TranslationRequestORM.id.desc())
        )
        trs = res.scalars().all()
        return {
            "items": [
                {
                    "id": t.id,
                    "user_id": t.user_id,
                    "request_id": t.request_id,
                    "status": t.status,
                    "model_id": t.model_id,
                }
                for t in trs
            ]
        }

    async def stats(self) -> dict:
        """
        Purpose:
            Получить агрегированную статистику.

        Output:
            dict: {"users_total": int, "translations_total": int}
        """
        users_total = await self._session.scalar(select(func.count()).select_from(UserORM))
        translations_total = await self._session.scalar(select(func.count()).select_from(TranslationRequestORM))
        return {
            "users_total": int(users_total or 0),
            "translations_total": int(translations_total or 0),
        }