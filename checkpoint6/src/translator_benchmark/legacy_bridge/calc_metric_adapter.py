import sys
import os
from typing import List, Dict, Optional, Any
import logging

logger = logging.getLogger(__name__)

#любимый мой костыль на старое переводческое ядро
#Оставь надежду, всяк сюда входящий
legacy_path = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'checkpoint3', 'llm_tranlator', 'translator_code')
if legacy_path not in sys.path:
    sys.path.insert(0, legacy_path)

try:
    from calc_metric import ScoreSet, ModelCometScorer, CometFileCache, summarize_tags, compilability_score
except ImportError as e:
    logger.error(
        f"Failed to import legacy calc_metric from {legacy_path}. "
        "Ensure the legacy code is available and dependencies are installed: "
        "pandas, tqdm, comet (unbabel-comet). "
        "If you don't need legacy metric evaluation, please install required packages."
    )
    raise


def legacy_compute_scores(
    src: List[str],
    ref: List[str],
    cand: List[str],
    comet_scorer: Optional[ModelCometScorer] = None,
    precomputed_text_scores: Optional[List[Optional[float]]] = None,
    comet_cache_file: Optional[str] = None,
    reuse_old_comet_cache: bool = True,
    comet_batch_size: int = 128,
    show_progress: bool = False,
) -> Dict[str, Any]:
    """
    считаем нашу метрику

    Args:
        src: List of source texts (optional, can be empty strings).
        ref: List of reference translations.
        cand: List of candidate translations.
        comet_scorer: Optional ModelCometScorer instance for COMET metric.
        precomputed_text_scores: Optional list of precomputed COMET scores.
        comet_cache_file: Path to COMET cache file.
        reuse_old_comet_cache: Whether to reuse existing cache.
        comet_batch_size: Batch size for COMET scoring.
        show_progress: Whether to show progress bars.

    Returns:
        Dictionary with aggregated metrics:
        - text_score_mean
        - tag_content_score_mean
        - tag_structure_score_mean
        - compilability_rate
        - final_score_mean
        - per_row_scores (optional if needed)
    """
    assert len(ref) == len(cand)
    if src:
        assert len(src) == len(ref)
    else:
        src = [None] * len(ref)

    scoreset = ScoreSet(
        refs=ref,
        cands=cand,
        srcs=src if src else None,
        comet_scorer=comet_scorer,
        precomputed_text_scores=precomputed_text_scores,
        comet_batch_size=comet_batch_size,
        show_progress=show_progress,
        parallel=True,
        comet_cache_file=comet_cache_file,
        reuse_old_comet_cache=reuse_old_comet_cache,
    )

    result = scoreset.compute()

    text_scores = result.text_score
    tag_content_scores = result.tag_content_score
    tag_structure_scores = result.tag_structure_score
    compilability_scores = result.compilability
    final_scores = result.final_score

    def safe_mean(values: List[float]) -> float:
        return sum(values) / len(values) if values else 0.0

    metrics = {
        "text_score_mean": safe_mean(text_scores),
        "tag_content_score_mean": safe_mean(tag_content_scores),
        "tag_structure_score_mean": safe_mean(tag_structure_scores),
        "compilability_rate": safe_mean(compilability_scores),
        "final_score_mean": safe_mean(final_scores),
        "per_row_scores": list(zip(text_scores, tag_content_scores, tag_structure_scores, compilability_scores, final_scores)),
    }

    return metrics


def legacy_check_compilability(text: str) -> float:
    """
    компилируемость

    Args:
        text: Candidate text.

    Returns:
        1.0 if compilable, 0.0 otherwise.
    """
    tags = summarize_tags(text)
    return compilability_score(tags)


def legacy_get_tag_summary(text: str) -> Dict[str, Any]:
    """
    инфа по тегам

    Args:
        text: Input text.

    Returns:
        Dictionary with tag summary.
    """
    tags = summarize_tags(text)
    return {
        "n_color_spans": tags.n_color_spans,
        "n_dollar_vars": tags.n_dollar_vars,
        "n_pound_icons": tags.n_pound_icons,
        "n_script_tags": tags.n_script_tags,
        "malformed_any": tags.malformed_any,
    }