import time
from typing import Optional, Dict, Any


def classify_error(exception: Exception) -> str:
    """
    Args:
        exception: Exception object.

    Returns:
        Error type: "rate_limit", "auth", "billing", "timeout",
                    "dns", "tls", "connection", "network", "unknown".
    """
    status_code = getattr(exception, "status_code", None)
    if status_code == 429:
        return "rate_limit"
    if status_code == 401:
        return "auth"
    if status_code in (402, 403):
        return "billing"

    name = type(exception).__name__.lower()

    # Timeout errors
    if name in {"apitimeouterror", "timeout", "readtimeouterror",
                "connecttimeouterror", "writetimeouterror"}:
        return "timeout"
    if isinstance(exception, TimeoutError):
        return "timeout"

    # DNS resolution errors
    if "dns" in name or "resolve" in name or "gai" in name:
        return "dns"

    # TLS/SSL errors
    if "tls" in name or "ssl" in name or "certificate" in name:
        return "tls"

    # Connection refused / reset errors
    # (ConnectionError, ConnectionRefusedError, ConnectionResetError)
    if name in {"connectionerror", "connectionrefusederror",
                "connectionreseterror", "brokenpipeerror"}:
        return "connection"

    # Generic network errors
    if "socket" in name or "network" in name:
        return "network"

    # httpx / urllib3 transport errors — check message for hints
    msg = str(exception).lower()
    if any(kw in msg for kw in ("dns", "name resolution", "getaddrinfo")):
        return "dns"
    if any(kw in msg for kw in ("tls", "ssl", "certificate")):
        return "tls"
    if any(kw in msg for kw in ("refused", "reset by peer", "connection aborted")):
        return "connection"

    return "unknown"


def parse_retry_after(exception: Exception) -> Optional[float]:
    """
    Args:
        exception: Exception object.

    Returns:
        Retry after duration in seconds, or None if not found.
    """
    headers = None
    resp = getattr(exception, "response", None)
    if resp is not None:
        headers = getattr(resp, "headers", None)
    if headers is None:
        headers = getattr(exception, "headers", None)
    if not headers:
        return None

    val = headers.get("retry-after") or headers.get("Retry-After")
    if not val:
        return None

    try:
        return float(val)
    except ValueError:
        pass

    num = ""
    for ch in val:
        if ch.isdigit() or ch == ".":
            num += ch
        elif num:
            break
    try:
        return float(num) if num else None
    except ValueError:
        return None


def should_retry(error_type: str, attempt_number: int, max_retries: int) -> bool:
    """
    Args:
        error_type: Error type string.
        attempt_number: Current attempt number (1‑based).
        max_retries: Maximum allowed retries.

    Returns:
        True if retry should be performed.
    """
    if attempt_number >= max_retries:
        return False
    retryable_errors = {"rate_limit", "timeout", "dns", "tls", "connection", "network", "unknown"}
    return error_type in retryable_errors


def compute_retry_delay_sec(error_type: str, attempt_number: int, retry_after: Optional[float] = None) -> float:
    """
    Args:
        error_type: Error type.
        attempt_number: Attempt number.
        retry_after: Parsed retry-after header value (optional).

    Returns:
        Delay in seconds.
    """
    if retry_after is not None:
        return retry_after

    base_delay = min(2.0 ** (attempt_number - 1), 30.0)
    import random
    jitter = random.uniform(0.9, 1.1)
    return base_delay * jitter