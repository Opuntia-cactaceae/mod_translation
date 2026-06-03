"""Protection Service — rule-set-driven protection using ProtectionEngine.

Delegates all protect/restore logic to ``ProtectionEngine`` which operates
on ``ProtectionRuleSet`` instances.  This is the single entry point for
the translation pipeline; no legacy strategy code is involved.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from translator_app.protection.engine import ProtectionEngine
from translator_app.protection.ranges import (
    OverlapDiagnostic,
    SourceRange,
    discover_all_matches,
    validate_ranges,
)
from translator_app.protection.rule_set import (
    DEFAULT_RULE_SET_ID,
    ProtectionRuleSet,
    ProtectionRuleSetRepository,
    build_builtin_rule_set,
)
from translator_app.protection_custom.models import (
    CustomProtectionRule,
    custom_rule_to_protection_rule,
)

logger = logging.getLogger(__name__)


class ProtectionService:
    """Protection service backed by rule sets and ProtectionEngine.

    All protection is driven by ``ProtectionRuleSet`` instances retrieved
    from the repository.  No hardcoded regex, no legacy strategy lookup.
    """

    def __init__(
        self,
        rule_set_repo: Optional[ProtectionRuleSetRepository] = None,
        custom_rule_repo: Optional[Any] = None,
    ):
        """Protection service backed by rule sets and ProtectionEngine.

        Args:
            rule_set_repo: Repository for ``ProtectionRuleSet`` persistence.
            custom_rule_repo: Optional ``CustomProtectionRuleRepository``.
                When provided, enabled custom rules are merged into the
                protection pipeline as a virtual rule set so they execute
                through the same ``ProtectionEngine`` with full
                ``rule_kind`` semantics.
        """
        self._repo = rule_set_repo
        self._custom_repo = custom_rule_repo
        self._engine = ProtectionEngine()

    # ------------------------------------------------------------------
    # Rule-set resolution
    # ------------------------------------------------------------------

    def _resolve_rule_sets(
        self,
        rule_set_ids: Optional[List[str]] = None,
    ) -> List[ProtectionRuleSet]:
        """Resolve rule sets by ID, or return all enabled sets.

        Falls back to the default builtin rule set if no repo is available
        (e.g. in tests).

        When ``custom_rule_repo`` is configured, enabled custom rules are
        adapted to ``ProtectionRule`` instances and bundled as a virtual
        rule set appended after the resolved rule sets.  This ensures
        custom rules execute through the same ``ProtectionEngine`` with
        full ``rule_kind`` semantics.
        """
        if not rule_set_ids:
            # Return all enabled rule sets
            if self._repo is not None:
                rule_sets = self._repo.get_enabled()
            else:
                # Fallback for tests: use builtin
                from translator_app.protection.rule_set import build_builtin_rule_set
                rule_sets = [build_builtin_rule_set()]
        else:
            rule_sets: List[ProtectionRuleSet] = []
            for rs_id in rule_set_ids:
                if self._repo is not None:
                    rs = self._repo.get(rs_id)
                    if rs is not None:
                        rule_sets.append(rs)
                else:
                    # Fallback for tests
                    from translator_app.protection.rule_set import build_builtin_rule_set
                    if rs_id == DEFAULT_RULE_SET_ID:
                        rule_sets.append(build_builtin_rule_set())

        # Merge enabled custom rules as a virtual rule set
        if self._custom_repo is not None:
            try:
                custom_rules = self._custom_repo.get_enabled_sorted()
                if custom_rules:
                    protection_rules = [
                        custom_rule_to_protection_rule(r)
                        for r in custom_rules
                    ]
                    virtual_rs = ProtectionRuleSet(
                        id="__custom_rules__",
                        name="Custom Rules",
                        builtin=False,
                        enabled=True,
                        rules=protection_rules,
                    )
                    rule_sets.append(virtual_rs)
            except Exception:
                logger.warning(
                    "Failed to load custom protection rules, skipping",
                    exc_info=True,
                )

        return rule_sets

    # ------------------------------------------------------------------
    # Protect / Restore
    # ------------------------------------------------------------------

    def protect(
        self,
        text: str,
        rule_set_ids: Optional[List[str]] = None,
        overlap_mode: str = "diagnostic",
    ) -> Tuple[str, Dict[str, str]]:
        """Protect *text* using the given rule sets.

        Args:
            text: Original source text.
            rule_set_ids: IDs of rule sets to apply.  ``None`` = all enabled.
            overlap_mode:
                ``"diagnostic"`` — compute and return diagnostics (no raise).
                ``"strict"`` — raise ``ProtectionOverlapError`` on hard overlaps.
                ``"safe"`` — resolve conflicts by priority, lower-priority
                conflicting matches are deterministically skipped.

        Returns:
            ``(protected_text, mapping)`` where mapping is
            ``{"r{N}": original_token}``.
        """
        if not text:
            return text, {}

        rule_sets = self._resolve_rule_sets(rule_set_ids)
        if not rule_sets:
            return text, {}

        try:
            return self._engine.protect(text, rule_sets, overlap_mode=overlap_mode)
        except Exception as exc:
            logger.warning(
                "ProtectionService.protect failed: overlap_mode=%s, "
                "rule_set_count=%d, text_len=%d, error=%s",
                overlap_mode, len(rule_sets), len(text), exc,
            )
            return text, {}

    def restore(
        self,
        text: str,
        mapping: Dict[str, str],
    ) -> str:
        """Restore protected tokens from *mapping*.

        Uses the unified ``ProtectionEngine.restore`` which handles
        all ``<PH id="r{N}"/>`` placeholders regardless of their source.

        Note: unlike the old behaviour, we **always** delegate to the
        engine even when *mapping* is empty, because the engine now
        handles orphaned ``<PH>`` placeholders as a safety net.
        """
        if not text:
            return text
        try:
            return self._engine.restore(text, mapping)
        except Exception as exc:
            logger.warning(
                "ProtectionService.restore failed: mapping_size=%d, text_len=%d, error=%s",
                len(mapping), len(text), exc,
            )
            return text

    # ------------------------------------------------------------------
    # Protect with overlap detection
    # ------------------------------------------------------------------

    def protect_with_details(
        self,
        text: str,
        rule_set_ids: Optional[List[str]] = None,
        overlap_mode: str = "diagnostic",
    ) -> Tuple[str, Dict[str, str], List[SourceRange], List[OverlapDiagnostic]]:
        """Protect *text* and return source ranges and overlap diagnostics.

        See ``ProtectionEngine.protect_with_details()`` for details.

        Parameters
        ----------
        overlap_mode:
            ``"diagnostic"`` — compute and return diagnostics (no raise).
            ``"strict"`` — raise ``ProtectionOverlapError`` on hard overlaps.
            ``"safe"`` — resolve conflicts by priority, lower-priority
            conflicting matches are deterministically skipped.
        """
        if not text:
            return text, {}, [], []

        rule_sets = self._resolve_rule_sets(rule_set_ids)
        if not rule_sets:
            return text, {}, [], []

        try:
            return self._engine.protect_with_details(
                text, rule_sets, overlap_mode=overlap_mode,
            )
        except Exception as exc:
            logger.warning(
                "ProtectionService.protect_with_details failed: "
                "overlap_mode=%s, rule_set_count=%d, text_len=%d, error=%s",
                overlap_mode, len(rule_sets), len(text), exc,
            )
            return text, {}, [], []

    # ------------------------------------------------------------------
    # Overlap validation (standalone — no protection applied)
    # ------------------------------------------------------------------

    def validate_overlaps(
        self,
        text: str,
        rule_set_ids: Optional[List[str]] = None,
    ) -> List[OverlapDiagnostic]:
        """Scan *text* for potential rule overlaps without applying protection.

        Useful for preview/UI scenarios where the user wants to see
        conflicts before committing to a rule configuration.
        """
        if not text:
            return []

        rule_sets = self._resolve_rule_sets(rule_set_ids)
        if not rule_sets:
            return []

        try:
            rules = ProtectionEngine.get_compiled_rules(rule_sets)
            rules_with_pri = [(r.priority or 999_999, r) for r in rules]
            all_ranges = discover_all_matches(text, rules_with_pri)
            return validate_ranges(all_ranges, strict=True)
        except Exception as exc:
            logger.warning(
                "ProtectionService.validate_overlaps failed: "
                "rule_set_count=%d, text_len=%d, error=%s",
                len(rule_sets), len(text), exc,
            )
            return []

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def list_available_rule_sets(self) -> List[dict]:
        """Return all rule sets as dicts with metadata.

        Returns ``id``, ``name``, ``description``, ``builtin``,
        ``enabled``, and ``rule_count`` for each rule set.  Used by
        the frontend to render rule set cards and populate selectors.
        """
        if self._repo is None:
            builtin = build_builtin_rule_set()
            return [{
                "id": DEFAULT_RULE_SET_ID,
                "name": "Default Game Localisation Protection",
                "description": builtin.description,
                "builtin": True,
                "enabled": True,
                "rule_count": len(builtin.rules),
            }]
        return [
            {
                "id": rs.id,
                "name": rs.name,
                "description": rs.description,
                "builtin": rs.builtin,
                "enabled": rs.enabled,
                "rule_count": len(rs.rules),
            }
            for rs in self._repo.get_all()
        ]

    def get_default_rule_set_ids(self) -> List[str]:
        """Return the default rule set IDs to use when none are specified."""
        return [DEFAULT_RULE_SET_ID]

    def compute_protection_fingerprint(
        self,
        rule_set_ids: Optional[List[str]] = None,
    ) -> str:
        """Compute a deterministic fingerprint of the effective protection state.

        Includes:
        * Rule set IDs (sorted).
        * For each enabled custom rule: id, pattern, rule_kind, token_type,
          priority, flags (sorted by id for determinism).

        The fingerprint changes when any effective protection rule semantics
        change, ensuring the cache correctly invalidates.

        Args:
            rule_set_ids: Optional rule set IDs.  When ``None```, uses all
                          enabled rule sets from the repository.

        Returns:
            SHA-256 hex digest string.
        """
        import hashlib
        import json

        components: dict[str, list] = {
            "rule_set_ids": sorted(rule_set_ids or []),
            "custom_rules": [],
        }

        # Collect custom rules if repo is available
        if self._custom_repo is not None:
            try:
                custom_rules = self._custom_repo.get_enabled_sorted()
                for r in custom_rules:
                    components["custom_rules"].append({
                        "id": r.id,
                        "pattern": r.pattern,
                        "rule_kind": r.rule_kind or "atomic",
                        "token_type": r.token_type or "custom_token",
                        "priority": r.priority,
                        "flags": sorted(r.flags) if r.flags else [],
                    })
            except Exception:
                logger.warning(
                    "Failed to load custom rules for fingerprint, skipping",
                    exc_info=True,
                )

        raw = json.dumps(components, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
