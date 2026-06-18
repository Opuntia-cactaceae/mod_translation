"""Grouping strategies for translated output files.

Provides pluggable grouping strategies plus a resolver that selects the
appropriate strategy based on game id, parser id, and manifest metadata.
"""

import posixpath
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_LOCALISATION_DIR_RE = re.compile(
    r"(?:^|/)localisation/([^/]+)/l_[^/]+\.\w+$"
)
"""Matches Stellaris localisation paths like ``localisation/english/l_english.yml``."""


def _get_parent_dir(relative_path: str) -> Optional[str]:
    """Extract the parent directory from a relative path.

    Returns None if there is no parent (single filename).
    """
    parent = posixpath.dirname(relative_path)
    return parent if parent and parent != "." else None


# ---------------------------------------------------------------------------
# Strategy interface
# ---------------------------------------------------------------------------


class OutputGroupingStrategy(ABC):
    """Strategy interface for computing group keys and labels.

    Implementations may use the *relative_path* and optional *metadata*
    dict to determine the group.
    """

    @abstractmethod
    def get_group_key(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        ...

    @abstractmethod
    def get_group_label(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        ...


# ---------------------------------------------------------------------------
# Concrete strategies
# ---------------------------------------------------------------------------


class DefaultPathGroupingStrategy(OutputGroupingStrategy):
    """Default grouping strategy based on parent directory of relative paths.

    Rules:
    - If relative path exists and has a parent directory, the group key
      is that parent directory.
    - If no parent directory exists, group_key = "__root__".
    - group_label for root = "Root", otherwise the parent directory.
    """

    def get_group_key(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        if not relative_path:
            return "__root__"
        parent = _get_parent_dir(relative_path)
        return parent if parent else "__root__"

    def get_group_label(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        if not relative_path:
            return "Root"
        parent = _get_parent_dir(relative_path)
        return parent if parent else "Root"


class StellarisGroupingStrategy(OutputGroupingStrategy):
    """Grouping strategy for Stellaris localisation files.

    Groups by language folder under ``localisation/``.

    Examples::

        localisation/english/l_english.yml  →  group_key = "l_english"
        localisation/russian/l_russian.yml  →  group_key = "l_russian"

    Falls back to ``DefaultPathGroupingStrategy`` for non-localisation
    paths so that mixed mods (localisation + scripts + events) still
    receive sensible grouping.
    """

    def __init__(self) -> None:
        self._fallback = DefaultPathGroupingStrategy()

    def get_group_key(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        if not relative_path:
            return "__root__"
        match = _LOCALISATION_DIR_RE.search(relative_path)
        if match:
            language_dir = match.group(1)
            # Map language directory to its l_ prefix: "english" -> "l_english"
            return f"l_{language_dir}"
        # Non-localisation path: use default parent-dir grouping
        return self._fallback.get_group_key(relative_path, metadata)

    def get_group_label(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        if not relative_path:
            return "Root"
        match = _LOCALISATION_DIR_RE.search(relative_path)
        if match:
            language_dir = match.group(1)
            return f"l_{language_dir}"
        return self._fallback.get_group_label(relative_path, metadata)


class AggregationMetadataGroupingStrategy(OutputGroupingStrategy):
    """Grouping strategy that uses manifest aggregation metadata fields.

    Priority order (highest first):

        1. ``aggregation_group`` from metadata
        2. ``logical_group`` from metadata
        3. ``aggregation_key`` from metadata (first path segment)
        4. ``logical_bundle`` from metadata
        5. Falls back to ``DefaultPathGroupingStrategy``

    This strategy is designed for manifests that carry structured grouping
    hints (e.g. DLC bundles, content packs, aggregate mods).
    """

    def __init__(self) -> None:
        self._fallback = DefaultPathGroupingStrategy()

    # Metadata field lookup keys — accept both snake_case and camelCase
    _AGGREGATION_GROUP_KEYS = frozenset({
        "aggregation_group", "aggregationGroup",
    })
    _LOGICAL_GROUP_KEYS = frozenset({
        "logical_group", "logicalGroup",
    })
    _AGGREGATION_KEY_KEYS = frozenset({
        "aggregation_key", "aggregationKey",
    })
    _LOGICAL_BUNDLE_KEYS = frozenset({
        "logical_bundle", "logicalBundle",
    })

    @classmethod
    def _pick_value(
        cls, metadata: Dict[str, Any], key_set: frozenset
    ) -> Optional[str]:
        for key in key_set:
            val = metadata.get(key)
            if val and isinstance(val, str):
                return val
        return None

    def get_group_key(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        md = metadata or {}
        # 1. aggregation_group
        val = self._pick_value(md, self._AGGREGATION_GROUP_KEYS)
        if val:
            return f"agg_{val}"
        # 2. logical_group
        val = self._pick_value(md, self._LOGICAL_GROUP_KEYS)
        if val:
            return f"logical_{val}"
        # 3. aggregation_key (use first segment)
        val = self._pick_value(md, self._AGGREGATION_KEY_KEYS)
        if val:
            return f"agg_{val}"
        # 4. logical_bundle
        val = self._pick_value(md, self._LOGICAL_BUNDLE_KEYS)
        if val:
            return f"bundle_{val}"
        # 5. fallback to path-based grouping
        return self._fallback.get_group_key(relative_path, metadata)

    def get_group_label(
        self,
        relative_path: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        md = metadata or {}
        # Same priority order but labels are more human-readable
        val = self._pick_value(md, self._AGGREGATION_GROUP_KEYS)
        if val:
            return val.replace("_", " ").title()
        val = self._pick_value(md, self._LOGICAL_GROUP_KEYS)
        if val:
            return val.replace("_", " ").title()
        val = self._pick_value(md, self._AGGREGATION_KEY_KEYS)
        if val:
            return val.replace("_", " ").title()
        val = self._pick_value(md, self._LOGICAL_BUNDLE_KEYS)
        if val:
            return val.replace("_", " ").title()
        return self._fallback.get_group_label(relative_path, metadata)


# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------


class OutputGroupingStrategyResolver:
    """Selects the best ``OutputGroupingStrategy`` for a given context.

    Selection rules (first match wins):

        1. If ``game_id == "stellaris"`` → ``StellarisGroupingStrategy``
        2. If ``parser_id`` indicates a stellaris localisation parser
           (e.g. ``stellaris_localisation``) → ``StellarisGroupingStrategy``
        3. If manifest metadata contains any aggregation field
           (``aggregation_group``, ``logical_group``, etc.) →
           ``AggregationMetadataGroupingStrategy``
        4. Otherwise → ``DefaultPathGroupingStrategy``

    Callers can also supply an explicit strategy override.
    """

    STELLARIS_PARSER_IDS = frozenset({
        "stellaris_localisation",
        "stellaris-loc",
        "ck3_localisation",
    })
    """Parser ids that indicate Stellaris-like localisation structure."""

    AGGREGATION_METADATA_HINTS = frozenset({
        "aggregation_group",
        "aggregationGroup",
        "logical_group",
        "logicalGroup",
        "logical_bundle",
        "logicalBundle",
        "aggregation_key",
        "aggregationKey",
    })
    """Metadata keys that indicate aggregation-based grouping should be used."""

    def __init__(
        self,
        default_strategy: Optional[OutputGroupingStrategy] = None,
    ) -> None:
        self._default = default_strategy or DefaultPathGroupingStrategy()

    def resolve(
        self,
        game_id: Optional[str] = None,
        parser_id: Optional[str] = None,
        manifest_metadata: Optional[Dict[str, Any]] = None,
        explicit_strategy: Optional[OutputGroupingStrategy] = None,
    ) -> OutputGroupingStrategy:
        """Select the appropriate grouping strategy.

        Args:
            game_id: Game identifier (e.g. ``"stellaris"``).
            parser_id: Parser identifier.
            manifest_metadata: Aggregation-related metadata from the
                output manifest.
            explicit_strategy: If provided, this strategy is returned
                directly (bypasses all selection logic).

        Returns:
            An ``OutputGroupingStrategy`` instance.
        """
        if explicit_strategy is not None:
            return explicit_strategy

        # Rule 1: stellaris game
        if game_id and game_id.lower() == "stellaris":
            return StellarisGroupingStrategy()

        # Rule 2: stellaris-like parser
        if parser_id and parser_id.lower() in self.STELLARIS_PARSER_IDS:
            return StellarisGroupingStrategy()

        # Rule 3: aggregation metadata present
        if manifest_metadata:
            md_lower = {k.lower(): v for k, v in manifest_metadata.items()}
            for hint in self.AGGREGATION_METADATA_HINTS:
                if md_lower.get(hint.lower()):
                    return AggregationMetadataGroupingStrategy()

        # Rule 4: fallback
        return self._default


# ---------------------------------------------------------------------------
# Convenience functions
# ---------------------------------------------------------------------------

_resolver = OutputGroupingStrategyResolver()


def build_default_group_key(relative_path: Optional[str]) -> str:
    """Convenience function: returns the default group key."""
    return DefaultPathGroupingStrategy().get_group_key(relative_path)


def build_default_group_label(relative_path: Optional[str]) -> str:
    """Convenience function: returns the default group label."""
    return DefaultPathGroupingStrategy().get_group_label(relative_path)


def resolve_grouping_strategy(
    game_id: Optional[str] = None,
    parser_id: Optional[str] = None,
    manifest_metadata: Optional[Dict[str, Any]] = None,
) -> OutputGroupingStrategy:
    """One-shot convenience: resolve and return a grouping strategy."""
    return _resolver.resolve(
        game_id=game_id,
        parser_id=parser_id,
        manifest_metadata=manifest_metadata,
    )
