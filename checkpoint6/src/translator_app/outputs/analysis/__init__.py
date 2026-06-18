"""Output file analysis package.

Provides the snapshot-authoritative analysis framework for translated
output files:

- ``SnapshotAuthoritativeEvaluator`` derives scores and diagnostics from
  protection-snapshot token integrity data.
- ``SnapshotAwareAnalyzer`` validates protection snapshot metadata and
  runs the UnifiedTokenizer for token integrity comparison.
- ``SnapshotPlaceholderIntegrityAnalyzer`` checks placeholder restoration
  using the snapshot placeholder registry (Phase 8B).
- ``PlaceholderAnalyzer`` provides supplementary (non-authoritative)
  placeholder diagnostics.
- ``OutputAnalysisService`` orchestrates single-file and batch analysis.
- ``AnalysisDivergenceTracker`` retains historical backward-compatibility
  support for reading persisted analysis data.

Architecture::

    OutputAnalysisService -> SnapshotAwareAnalyzer
                           -> SnapshotAuthoritativeEvaluator
                           -> Supplementary analyzer chain
                           -> repository

The legacy ``calc_metric`` / ``LegacyCompilabilityAdapter`` path has been
removed.  Authoritative scoring is derived from protection-snapshot token
integrity and placeholder integrity — no regex heuristics, no
``checkpoint3`` dependency.
"""
