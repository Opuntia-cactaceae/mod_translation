from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.application.common.ports import TranslationGateway
from app.infrastructure.translation_gateway.registry import build_translators
from app.settings import settings

from app.infrastructure.db.admin_read import AdminRead
from app.infrastructure.db.session import get_session
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork

from app.infrastructure.translation_gateway.adapter import TranslationGatewayAdapter


from app.infrastructure.security.jwt_service import JwtService
from app.infrastructure.security.password_hasher import PasswordHasher
from app.infrastructure.ratelimit.adapter import RateLimiter


def get_uow(session=Depends(get_session)) -> SqlAlchemyUnitOfWork:
    return SqlAlchemyUnitOfWork(session)


@lru_cache(maxsize=1)
def _translation_gateway_singleton() -> TranslationGateway:
    """
    Purpose:
        Создать и закешировать TranslationGateway.

    """
    return TranslationGatewayAdapter(translators=build_translators())


def get_translation_gateway() -> TranslationGateway:
    """
    Purpose:
        DI-зависимость для TranslationGateway.

    Output:
        TranslationGateway — singleton-экземпляр.
    """
    return _translation_gateway_singleton()


@lru_cache(maxsize=1)
def _jwt_service_singleton() -> JwtService:
    """
    Purpose:
        Создать и закешировать JwtService с единым секретом.
    """
    return JwtService(
        secret=settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
        access_ttl_seconds=settings.jwt_access_ttl_seconds,
        refresh_ttl_seconds=settings.jwt_refresh_ttl_seconds,
    )


def get_jwt_service() -> JwtService:
    return _jwt_service_singleton()


@lru_cache(maxsize=1)
def _rate_limiter_singleton() -> RateLimiter:
    return RateLimiter()


def get_rate_limiter() -> RateLimiter:
    return _rate_limiter_singleton()


@lru_cache(maxsize=1)
def _password_hasher_singleton() -> PasswordHasher:
    return PasswordHasher()


def get_password_hasher() -> PasswordHasher:
    return _password_hasher_singleton()


def get_admin_read(session=Depends(get_session)) -> AdminRead:
    return AdminRead(session)


bearer_scheme = HTTPBearer(auto_error=True)


@dataclass(frozen=True)
class CurrentUser:
    id: int
    role: str


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    jwt_service: JwtService = Depends(get_jwt_service),
) -> CurrentUser:
    """
    Purpose:
        Извлечь текущего пользователя из access JWT.
    """
    token = credentials.credentials

    try:
        payload = jwt_service.decode_access(token)
        user_id = int(payload["sub"])
        role = str(payload["role"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    return CurrentUser(id=user_id, role=role)


async def require_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """
    Purpose:
        Проверить наличие административной роли.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    return user