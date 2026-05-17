"""Protection Service — delegates to translator_benchmark protection strategies.

Supports:
    * ``none`` — identity (no changes).
    * ``legacy_game_tokens`` — protect/restore game token patterns.
    * ``xml_placeholders`` — protect/restore XML / placeholder patterns.
    * Any strategy registered in ``translator_benchmark.protection.protection_registry``.
"""

from typing import Dict, Tuple, Optional

from translator_benchmark.protection.protection_registry import get_protection_strategy
from translator_benchmark.protection.base import ProtectionStrategy
from translator_benchmark.config.schema import ProtectionConfig as BenchmarkProtectionConfig


class ProtectionService:
    """Protection service that delegates to benchmark strategies.

    Uses a cached strategy registry so strategies are built once per name.
    The default strategy is ``"none"`` (identity).  Per-call override via
    ``strategy_name`` parameter is supported.
    """

    def __init__(self):
        self._strategies: Dict[str, ProtectionStrategy] = {}

    def _get_strategy(self, strategy_name: str) -> ProtectionStrategy:
        """Get or create a protection strategy by name."""
        if not strategy_name:
            strategy_name = "none"
        if strategy_name not in self._strategies:
            self._strategies[strategy_name] = self._resolve_strategy(strategy_name)
        return self._strategies[strategy_name]

    def _resolve_strategy(self, name: str) -> ProtectionStrategy:
        """Resolve a strategy from the benchmark registry.

        Raises ValueError for unknown strategy names.
        """
        try:
            return get_protection_strategy(
                BenchmarkProtectionConfig(strategy_name=name, options={})
            )
        except KeyError:
            if name in ("", "none"):
                from translator_benchmark.protection.none import NoProtectionStrategy
                return NoProtectionStrategy()
            raise ValueError(
                f"Unknown protection strategy: {name}. "
                f"Supported: none, legacy_game_tokens, xml_placeholders"
            )

    def protect(
        self,
        text: str,
        strategy_name: Optional[str] = None,
    ) -> Tuple[str, Dict[str, str]]:
        """Protect tokens in *text* using the given strategy.

        Returns:
            ``(protected_text, mapping_dict)`` where mapping is
            ``{placeholder_id: original_token}``.
        """
        strategy = self._get_strategy(strategy_name or "none")
        try:
            result = strategy.protect(text)
            mapping = result.protection_state.get("mapping", {})
            return result.protected_text, mapping
        except Exception:
            return text, {}

    def restore(
        self,
        text: str,
        mapping: Dict[str, str],
        strategy_name: Optional[str] = None,
    ) -> str:
        """Restore protected tokens from *mapping* using the given strategy."""
        strategy = self._get_strategy(strategy_name or "none")
        try:
            return strategy.restore(text, {"mapping": mapping})
        except Exception:
            return text

    def list_available_strategies(self) -> list:
        """Return names of all registered protection strategies."""
        return ["none", "legacy_game_tokens", "xml_placeholders"]
