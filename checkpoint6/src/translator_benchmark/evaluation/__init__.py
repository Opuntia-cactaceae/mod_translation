"""
Evaluation module for computing metrics and generating reports.
"""

# Try to import metrics_adapter, but allow failures (e.g., missing pandas)
try:
    from .metrics_adapter import compute_quality_metrics, compute_operational_metrics
except ImportError as e:
    # If legacy dependencies are missing, set to None; functions will raise when called
    compute_quality_metrics = None
    compute_operational_metrics = None
    _metrics_adapter_error = e

from .score_runner import evaluate_experiment, evaluate_experiment_with_config, compute_experiment_operational_metrics
from .report_builder import (
    build_experiment_summary_report,
    build_leaderboard_report,
    format_summary_as_text,
    format_leaderboard_as_text,
)

__all__ = [
    "compute_quality_metrics",
    "compute_operational_metrics",
    "evaluate_experiment",
    "evaluate_experiment_with_config",
    "compute_experiment_operational_metrics",
    "build_experiment_summary_report",
    "build_leaderboard_report",
    "format_summary_as_text",
    "format_leaderboard_as_text",
]