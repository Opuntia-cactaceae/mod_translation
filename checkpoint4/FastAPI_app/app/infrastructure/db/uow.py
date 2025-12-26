from __future__ import annotations
from sqlalchemy.ext.asyncio import AsyncSession
from app.application.common.uow import UnitOfWork
from app.infrastructure.db.repositories import (
    SqlAlchemyUsersRepository,
    SqlAlchemyTranslationsRepository,
    SqlAlchemyRefreshTokensRepository,
)

class SqlAlchemyUnitOfWork(UnitOfWork):
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = SqlAlchemyUsersRepository(session)
        self.translations = SqlAlchemyTranslationsRepository(session)
        self.refresh_tokens = SqlAlchemyRefreshTokensRepository(session)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if exc:
            await self.rollback()
        else:
            await self.commit()

    async def commit(self) -> None:
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()
