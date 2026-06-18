from typing import Dict, Callable
from .base import PromptProfile
from .simple_single import build_simple_single_profile
from .json_batch import build_json_batch_profile
from .strict_json_batch import build_strict_json_batch_profile
from ..config.schema import PromptConfig

_PROFILE_BUILDERS: Dict[str, Callable[[PromptConfig], PromptProfile]] = {
    "simple_single": build_simple_single_profile,
    "json_batch": build_json_batch_profile,
    "strict_json_batch": build_strict_json_batch_profile,
}


def get_prompt_profile(config: PromptConfig) -> PromptProfile:
    """
    Args:
        config: Prompt configuration.

    Returns:
        PromptProfile instance.

    Raises:
        KeyError: If profile name is not registered.
    """
    builder = _PROFILE_BUILDERS.get(config.profile_name)
    if builder is None:
        raise KeyError(
            f"Prompt profile '{config.profile_name}' not found. "
            f"Available: {list(_PROFILE_BUILDERS.keys())}"
        )
    return builder(config)


def register_prompt_profile(name: str, builder: Callable[[PromptConfig], PromptProfile]) -> None:
    """
    Args:
        name: Profile name.
        builder: Builder function.
    """
    _PROFILE_BUILDERS[name] = builder