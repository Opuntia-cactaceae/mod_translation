from typing import Dict, Callable
from .base import ProtectionStrategy
from .none import build_no_protection_strategy
from .legacy_game_tokens import build_legacy_game_tokens_strategy
from .xml_placeholders import build_xml_placeholders_strategy
from ..config.schema import ProtectionConfig

_STRATEGY_BUILDERS: Dict[str, Callable[[], ProtectionStrategy]] = {
    "none": build_no_protection_strategy,
    "legacy_game_tokens": build_legacy_game_tokens_strategy,
    "xml_placeholders": build_xml_placeholders_strategy,
}


def get_protection_strategy(config: ProtectionConfig) -> ProtectionStrategy:
    """
    Args:
        config: Protection configuration.

    Returns:
        ProtectionStrategy instance.

    Raises:
        KeyError: If strategy name is not registered.
    """
    builder = _STRATEGY_BUILDERS.get(config.strategy_name)
    if builder is None:
        raise KeyError(
            f"Protection strategy '{config.strategy_name}' not found. "
            f"Available: {list(_STRATEGY_BUILDERS.keys())}"
        )
    return builder()


def register_protection_strategy(name: str, builder: Callable[[], ProtectionStrategy]) -> None:
    """
    Args:
        name: Strategy name.
        builder: Builder function.
    """
    _STRATEGY_BUILDERS[name] = builder