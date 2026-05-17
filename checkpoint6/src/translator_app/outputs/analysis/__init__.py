"""Output file analysis package.

Provides analysis framework for translated output files:
- Placeholder preservation analysis
- Legacy compilability analysis (via adapter)
- Batch and single-file analysis orchestration

Architecture:
    Routers -> OutputAnalysisService -> analyzers/adapters -> repository
"""
