from typing import Optional
from .logging_utils import write_log


def log_prompt(system: Optional[str], user: str) -> None:
    """
    Args:
        system: System prompt content (optional).
        user: User prompt content.
    """
    msg = "PROMPT\n"
    if system:
        msg += f"[SYSTEM]\n{system}\n"
    msg += f"[USER]\n{user}\n"

    write_log(msg, "prompts.log")