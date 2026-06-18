import datetime


def utc_now_iso() -> str:
    """
    Returns:
        ISO string with timezone.
    """
    return datetime.datetime.now(datetime.timezone.utc).isoformat()