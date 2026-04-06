from typing import Dict, Callable
from .base import ModelRuntime
from .groq_runtime import create_groq_runtime
from .deepseek_runtime import create_deepseek_runtime
from ..config.schema import RuntimeConfig

_RUNTIME_BUILDERS: Dict[str, Callable[[RuntimeConfig], ModelRuntime]] = {
    "groq": create_groq_runtime,
    "deepseek": create_deepseek_runtime,
}


def get_runtime(runtime_config: RuntimeConfig) -> ModelRuntime:
    """
    Args:
        runtime_config: Runtime configuration.

    Returns:
        ModelRuntime instance.

    Raises:
        KeyError: If provider is not registered.
    """
    builder = _RUNTIME_BUILDERS.get(runtime_config.provider)
    if builder is None:
        raise KeyError(
            f"Runtime provider '{runtime_config.provider}' not found. "
            f"Available: {list(_RUNTIME_BUILDERS.keys())}"
        )
    return builder(runtime_config)


def register_runtime(provider: str, builder: Callable[[RuntimeConfig], ModelRuntime]) -> None:
    """
    Args:
        provider: Provider name.
        builder: Builder function.
    """
    _RUNTIME_BUILDERS[provider] = builder