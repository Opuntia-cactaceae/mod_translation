import logging
import sys
from typing import Optional

#не юзаю
def configure_logging(log_path: Optional[str] = None) -> None:
    """
    Args:
        log_path: Optional file path for logging.
    """
    handlers = [logging.StreamHandler(sys.stdout)]
    if log_path:
        handlers.append(logging.FileHandler(log_path, encoding="utf-8"))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=handlers,
    )


def get_logger(name: str) -> logging.Logger:
    """
    Args:
        name: Logger name.

    Returns:
        Logger instance.
    """
    return logging.getLogger(name)


def write_log(message: str, log_file: str) -> None:
    """
    Args:
        message: Message to log.
        log_file: Log file name (e.g., "prompts.log").
    """
    import os
    from ..config.settings import load_settings

    settings = load_settings()
    log_dir = settings["log_dir"]
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, log_file)

    with open(log_path, "a", encoding="utf-8") as f:
        f.write(message)
        f.write("\n")