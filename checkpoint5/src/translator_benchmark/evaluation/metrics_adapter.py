import logging
from typing import List, Dict, Any, Optional

from ..legacy_bridge.calc_metric_adapter import legacy_compute_scores

logger = logging.getLogger(__name__)


def compute_quality_metrics(
    source_texts: List[str],
    reference_texts: List[str],
    candidate_texts: List[str],
    comet_scorer: Optional[Any] = None,
    precomputed_text_scores: Optional[List[Optional[float]]] = None,
    comet_cache_file: Optional[str] = None,
    reuse_old_comet_cache: bool = True,
    comet_batch_size: int = 128,
    show_progress: bool = False,
) -> Dict[str, Any]:
    """
    Расчитываем нашу собственную метрику перевода с 3 чекпоинта

    Args:
        source_texts: List of source texts (optional, can be empty strings).
        reference_texts: List of reference translations.
        candidate_texts: List of candidate translations.
        comet_scorer: Optional ModelCometScorer instance for COMET metric.
        precomputed_text_scores: Optional list of precomputed COMET scores.
        comet_cache_file: Path to COMET cache file.
        reuse_old_comet_cache: Whether to reuse existing cache.
        comet_batch_size: Batch size for COMET scoring.
        show_progress: Whether to show progress bars.

    Returns:
        Dictionary with quality metrics:
        - text_score_mean
        - tag_content_score_mean
        - tag_structure_score_mean
        - compilability_rate
        - final_score_mean
        - per_row_scores (optional list of tuples)
    """
    if not source_texts:
        source_texts = [""] * len(reference_texts)

    logger.info(f"Computing quality metrics for {len(reference_texts)} rows")

    legacy_result = legacy_compute_scores(
        src=source_texts,
        ref=reference_texts,
        cand=candidate_texts,
        comet_scorer=comet_scorer,
        precomputed_text_scores=precomputed_text_scores,
        comet_cache_file=comet_cache_file,
        reuse_old_comet_cache=reuse_old_comet_cache,
        comet_batch_size=comet_batch_size,
        show_progress=show_progress,
    )

    required_keys = [
        "text_score_mean",
        "tag_content_score_mean",
        "tag_structure_score_mean",
        "compilability_rate",
        "final_score_mean",
    ]
    for key in required_keys:
        if key not in legacy_result:
            raise KeyError(f"Missing key {key} in legacy metric result")

    result = {
        "text_score_mean": float(legacy_result["text_score_mean"]),
        "tag_content_score_mean": float(legacy_result["tag_content_score_mean"]),
        "tag_structure_score_mean": float(legacy_result["tag_structure_score_mean"]),
        "compilability_rate": float(legacy_result["compilability_rate"]),
        "final_score_mean": float(legacy_result["final_score_mean"]),
        "per_row_scores": legacy_result.get("per_row_scores", []),
    }

    logger.info(
        f"Quality metrics computed: final_score_mean={result['final_score_mean']:.3f}, "
        f"compilability_rate={result['compilability_rate']:.3f}"
    )

    return result


def compute_operational_metrics(
    total_rows: int,
    success_count: int,
    failed_count: int,
    fallback_count: int,
    attempts_count: int,
    total_latency_ms: int,
    valid_response_count: Optional[int] = None,
) -> Dict[str, float]:
    """
    "операционные" метрики

    Args:
        total_rows: Total number of rows processed.
        success_count: Number of successfully translated rows.
        failed_count: Number of failed rows (no valid translation).
        fallback_count: Number of rows where fallback was used.
        attempts_count: Total number of LLM attempts.
        total_latency_ms: Total latency across all attempts (milliseconds).
        valid_response_count: Number of rows with valid response (optional).

    Returns:
        Dictionary with operational metrics:
        - success_rate
        - valid_response_rate (if valid_response_count provided)
        - fallback_rate
        - avg_latency_ms
        - attempts_per_row
    """
    if total_rows == 0:
        return {
            "success_rate": 0.0,
            "valid_response_rate": 0.0,
            "fallback_rate": 0.0,
            "avg_latency_ms": 0.0,
            "attempts_per_row": 0.0,
        }

    success_rate = success_count / total_rows
    fallback_rate = fallback_count / total_rows if total_rows > 0 else 0.0

    if valid_response_count is not None:
        valid_response_rate = valid_response_count / total_rows
    else:
        valid_response_rate = success_rate

    avg_latency_ms = total_latency_ms / attempts_count if attempts_count > 0 else 0.0
    attempts_per_row = attempts_count / total_rows if total_rows > 0 else 0.0

    return {
        "success_rate": success_rate,
        "valid_response_rate": valid_response_rate,
        "fallback_rate": fallback_rate,
        "avg_latency_ms": avg_latency_ms,
        "attempts_per_row": attempts_per_row,
    }