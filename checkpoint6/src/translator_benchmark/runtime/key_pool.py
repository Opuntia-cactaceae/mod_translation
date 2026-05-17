import time
from typing import List, Tuple, Optional, Dict

#арбуз ключей
class KeyPool:
    def __init__(self, api_keys: List[str]):
        self.keys = api_keys
        self.current_index = 0
        self.key_rate_limited_until: Dict[str, float] = {key: 0.0 for key in api_keys}

    def acquire_next_key(self) -> Tuple[int, str]:
        """
        Returns:
            Tuple of (key index, key string).
        """
        now = time.time()
        for _ in range(len(self.keys)):
            key = self.keys[self.current_index]
            until = self.key_rate_limited_until.get(key, 0.0)
            if until <= now:
                idx = self.current_index
                self.current_index = (self.current_index + 1) % len(self.keys)
                return idx, key
            self.current_index = (self.current_index + 1) % len(self.keys)

        nearest_wait = float('inf')
        for key in self.keys:
            until = self.key_rate_limited_until.get(key, 0.0)
            wait = max(0.0, until - now)
            if wait < nearest_wait:
                nearest_wait = wait

        if nearest_wait > 0:
            time.sleep(nearest_wait)
            now = time.time()

        return self.acquire_next_key()

    def mark_key_rate_limited(self, key_index: int, cooldown_sec: float) -> None:
        """
        Args:
            key_index: Index of key.
            cooldown_sec: Cooldown duration.
        """
        if key_index < 0 or key_index >= len(self.keys):
            return
        key = self.keys[key_index]
        until = time.time() + cooldown_sec
        prev = self.key_rate_limited_until.get(key, 0.0)
        if until > prev:
            self.key_rate_limited_until[key] = until

    def is_key_rate_limited(self, key_index: int) -> bool:
        """
        Args:
            key_index: Index of key.

        Returns:
            True if key is rate limited.
        """
        if key_index < 0 or key_index >= len(self.keys):
            return False
        key = self.keys[key_index]
        until = self.key_rate_limited_until.get(key, 0.0)
        return until > time.time()

    def get_key_by_index(self, key_index: int) -> str:
        """
        Args:
            key_index: Index of key.

        Returns:
            Key string.
        """
        if key_index < 0 or key_index >= len(self.keys):
            raise IndexError(f"Key index {key_index} out of range")
        return self.keys[key_index]

    def get_key_rate_limit_until(self, key_index: int) -> float:
        """
        Args:
            key_index: Index of key.

        Returns:
            Unix timestamp (0 if not limited).
        """
        if key_index < 0 or key_index >= len(self.keys):
            return 0.0
        key = self.keys[key_index]
        return self.key_rate_limited_until.get(key, 0.0)


def create_key_pool(api_keys: List[str]) -> KeyPool:
    """
    Args:
        api_keys: List of API keys.

    Returns:
        KeyPool instance.
    """
    return KeyPool(api_keys)


def acquire_next_key(key_pool: KeyPool) -> Tuple[int, str]:
    """
    Args:
        key_pool: KeyPool instance.

    Returns:
        Tuple of (key index, key string).
    """
    return key_pool.acquire_next_key()


def mark_key_rate_limited(key_pool: KeyPool, key_index: int, cooldown_sec: float) -> None:
    """
    Args:
        key_pool: KeyPool instance.
        key_index: Index of key.
        cooldown_sec: Cooldown duration.
    """
    key_pool.mark_key_rate_limited(key_index, cooldown_sec)