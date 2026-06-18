from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from jose import JWTError, jwt


@dataclass(frozen=True)
class JwtPair:
    access_token: str
    refresh_token: str


class JwtService:
    """
    Purpose:
        Выпуск и валидация JWT access/refresh токенов.

    Notes:
        - Access: payload: sub, role, type=access, exp, iat
        - Refresh: payload: sub, jti, type=refresh, exp, iat
        - Персистентность refresh-сессий выполняется через RefreshTokensRepository.
    """

    def __init__(
        self,
        *,
        secret: str,
        algorithm: str,
        access_ttl_seconds: int,
        refresh_ttl_seconds: int,
    ) -> None:
        self._secret = secret
        self._alg = algorithm
        self._access_ttl = access_ttl_seconds
        self._refresh_ttl = refresh_ttl_seconds

    def issue_pair(self, user_id: int, role: str) -> JwtPair:
        """
        Purpose:
            Выпустить пару токенов access/refresh для пользователя.

        Input:
            user_id: int — идентификатор пользователя (sub).
            role: str — роль пользователя.

        Output:
            JwtPair — access_token и refresh_token (refresh содержит jti).

        Side Effects:
            Нет.

        Notes:
            jti refresh-токена должен быть сохранён в БД как refresh-сессия use-case’ом.
        """
        now = datetime.now(timezone.utc)

        access_payload: Dict[str, Any] = {
            "sub": str(user_id),
            "role": role,
            "type": "access",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=self._access_ttl)).timestamp()),
        }

        refresh_jti = uuid.uuid4().hex
        refresh_payload: Dict[str, Any] = {
            "sub": str(user_id),
            "jti": refresh_jti,
            "type": "refresh",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=self._refresh_ttl)).timestamp()),
        }

        access_token = jwt.encode(access_payload, self._secret, algorithm=self._alg)
        refresh_token = jwt.encode(refresh_payload, self._secret, algorithm=self._alg)
        return JwtPair(access_token=access_token, refresh_token=refresh_token)

    def decode_access(self, token: str) -> dict:
        """
        Purpose:
            Декодировать и валидировать access JWT.

        Input:
            token: str — JWT строка.

        Output:
            dict — payload токена.

        Side Effects:
            Нет.

        Notes:
            Проверяет подпись, exp и type=access.
        """
        payload = self._decode(token)
        if payload.get("type") != "access":
            raise ValueError("Invalid token type")
        if payload.get("sub") is None or payload.get("role") is None:
            raise ValueError("Invalid token payload")
        return payload

    def decode_refresh(self, token: str) -> dict:
        """
        Purpose:
            Декодировать и валидировать refresh JWT.

        Input:
            token: str — JWT строка.

        Output:
            dict — payload токена.

        Side Effects:
            Нет.

        Notes:
            Проверяет подпись, exp и type=refresh.
        """
        payload = self._decode(token)
        if payload.get("type") != "refresh":
            raise ValueError("Invalid token type")
        if payload.get("sub") is None or payload.get("jti") is None:
            raise ValueError("Invalid token payload")
        return payload

    def _decode(self, token: str) -> dict:
        """
        Purpose:
            Декодировать JWT и валидировать подпись и срок действия.

        Input:
            token: str — JWT строка.

        Output:
            dict — payload токена.

        Side Effects:
            Нет.

        Notes:
            При ошибке валидации выбрасывает ValueError.
        """
        try:
            return jwt.decode(token, self._secret, algorithms=[self._alg])
        except JWTError as e:
            raise ValueError("Invalid token") from e

    def issue_confirm_delete_history(self, *, admin_user_id: int, target_user_id: int, ttl_seconds: int = 60) -> str:
        """
        Purpose:
            Выпустить confirm JWT для удаления истории конкретного пользователя.

        Notes:
            Payload:
              - sub = admin_user_id
              - type = "confirm"
              - action = "delete_history_user"
              - target_user_id = user_id, для которого разрешено удаление
              - exp/iat
        """
        now = datetime.now(timezone.utc)
        payload: Dict[str, Any] = {
            "sub": str(admin_user_id),
            "type": "confirm",
            "action": "delete_history_user",
            "target_user_id": int(target_user_id),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
        }
        return jwt.encode(payload, self._secret, algorithm=self._alg)

    def decode_confirm_delete_history(self, token: str, *, expected_target_user_id: int) -> dict:
        """
        Purpose:
            Декодировать и валидировать confirm JWT для удаления истории пользователя.

        Notes:
            Проверяет подпись/exp через _decode(), затем type/action/target_user_id.
        """
        payload = self._decode(token)

        if payload.get("type") != "confirm":
            raise ValueError("Invalid token type")
        if payload.get("action") != "delete_history_user":
            raise ValueError("Invalid token action")

        try:
            target = int(payload.get("target_user_id"))
        except Exception:
            raise ValueError("Invalid token payload")

        if target != int(expected_target_user_id):
            raise ValueError("Invalid token payload")

        return payload

