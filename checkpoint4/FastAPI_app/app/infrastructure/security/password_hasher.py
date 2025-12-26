from __future__ import annotations

from passlib.context import CryptContext


class PasswordHasher:
    """
    Purpose:
        Хэширование и проверка паролей с использованием bcrypt.

    Notes:
        - Хэширование выполняется на стороне сервера.
        - Верификация выполняется сравнением plaintext пароля с сохранённым hash.
    """

    def __init__(self) -> None:
        self._ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

    def hash(self, password: str) -> str:
        """
        Purpose:
            Сгенерировать криптографический хэш для пароля.

        Input:
            password: str — исходный пароль в plaintext.

        Output:
            str — строка хэша (bcrypt).

        Side Effects:
            Нет.
        """
        h = self._ctx.hash(password)
        return h

    def verify(self, password: str, password_hash: str) -> bool:
        """
        Purpose:
            Проверить соответствие plaintext пароля сохранённому хэшу.

        Input:
            password: str — пароль в plaintext.
            password_hash: str — сохранённый bcrypt-хэш.

        Output:
            bool — True, если пароль корректен; иначе False.

        Side Effects:
            Нет.
        """
        return self._ctx.verify(password, password_hash)