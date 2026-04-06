from typing import Dict, Callable, Any
from .base import ResponseValidator
from .composite import build_composite_validator
from ..config.schema import ValidationConfig

_VALIDATOR_BUILDERS: Dict[str, Callable[[Dict[str, Any]], ResponseValidator]] = {
    "composite": build_composite_validator,
}


def get_response_validator(config: ValidationConfig) -> ResponseValidator:
    """
    Args:
        config: Validation configuration.

    Returns:
        ResponseValidator instance.

    Raises:
        KeyError: If validator name is not registered.
    """
    builder = _VALIDATOR_BUILDERS.get(config.validator_name)
    if builder is None:
        raise KeyError(
            f"Validator '{config.validator_name}' not found. "
            f"Available: {list(_VALIDATOR_BUILDERS.keys())}"
        )
    return builder(config.options)


def register_validator(name: str, builder: Callable[[Dict[str, Any]], ResponseValidator]) -> None:
    """
    Args:
        name: Validator name.
        builder: Builder function.
    """
    _VALIDATOR_BUILDERS[name] = builder