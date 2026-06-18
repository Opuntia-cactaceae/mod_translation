from __future__ import annotations

from datetime import datetime, timezone

from app.application.auth.dtos import TokenPairDTO, RefreshSessionData
from app.application.common.errors import InvalidCredentials, ValidationError
from app.application.common.uow import UnitOfWork
from app.domain.users.entities import User
from app.infrastructure.security.password_hasher import PasswordHasher
from app.infrastructure.security.jwt_service import JwtService


class LoginUser:
    def __init__(self, uow: UnitOfWork, hasher: PasswordHasher, jwt_service: JwtService):
        self.uow = uow
        self.hasher = hasher
        self.jwt_service = jwt_service

    async def execute(
        self,
        *,
        email: str,
        password: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> TokenPairDTO:
        """
        Purpose:
            Выполнить аутентификацию пользователя и выпустить пару токенов.

        Input:
            email: str — email пользователя.
            password: str — пароль пользователя.
            ip: str | None — IP клиента.
            user_agent: str | None — User-Agent клиента.

        Output:
            TokenPairDTO — access_token и refresh_token.

        Side Effects:
            Создаёт refresh-сессию в персистентном хранилище.

        Notes:
            При неверных учётных данных выбрасывает InvalidCredentials.
        """
        async with self.uow:
            user = await self.uow.users.get_by_email(email)
            if user is None or not user.is_active:
                raise InvalidCredentials("Invalid credentials")

            if not self.hasher.verify(password, user.password_hash):
                raise InvalidCredentials("Invalid credentials")

            pair = self.jwt_service.issue_pair(user_id=user.id, role=user.role)

            refresh_payload = self.jwt_service.decode_refresh(pair.refresh_token)
            refresh_jti = str(refresh_payload["jti"])

            issued_at_ts = int(refresh_payload.get("iat", 0))
            expires_at_ts = int(refresh_payload.get("exp", 0))

            issued_at = datetime.fromtimestamp(issued_at_ts, tz=timezone.utc).replace(tzinfo=None)
            expires_at = datetime.fromtimestamp(expires_at_ts, tz=timezone.utc).replace(tzinfo=None)

            await self.uow.refresh_tokens.add_session(
                RefreshSessionData(
                    refresh_jti=refresh_jti,
                    user_id=user.id,
                    issued_at=issued_at,
                    expires_at=expires_at,
                    ip=ip,
                    user_agent=user_agent,
                )
            )

        return TokenPairDTO(access_token=pair.access_token, refresh_token=pair.refresh_token)


class RegisterUser:
    def __init__(self, uow: UnitOfWork, password_hasher: PasswordHasher):
        self.uow = uow
        self.password_hasher = password_hasher

    async def execute(self, email: str, password: str) -> User:
        async with self.uow:
            existing = await self.uow.users.get_by_email(email)
            if existing:
                raise ValidationError("User already exists")


            password_hash = self.password_hasher.hash(password)

            user = User(
                id=0,
                email=email,
                password_hash=password_hash,
                role="user",
                is_active=True,
                created_at=datetime.utcnow()
            )

            await self.uow.users.add(user)
            await self.uow.commit()

            return user