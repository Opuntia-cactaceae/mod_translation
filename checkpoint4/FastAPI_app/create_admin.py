import asyncio
from datetime import datetime

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select

from app.settings import settings
from app.infrastructure.db.orm_models import UserORM
from app.infrastructure.security.password_hasher import PasswordHasher


ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin12345"


async def main() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    hasher = PasswordHasher()

    async with Session() as session:
        res = await session.execute(select(UserORM).where(UserORM.email == ADMIN_EMAIL))
        existing = res.scalar_one_or_none()

        if existing:
            existing.role = "admin"
            existing.is_active = True
            existing.password_hash = hasher.hash(ADMIN_PASSWORD)
        else:
            session.add(
                UserORM(
                    email=ADMIN_EMAIL,
                    password_hash=hasher.hash(ADMIN_PASSWORD),
                    role="admin",
                    is_active=True,
                    created_at=datetime.utcnow(),
                )
            )

        await session.commit()

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())