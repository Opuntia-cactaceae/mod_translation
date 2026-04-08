import logging
import sqlite3
from typing import Dict, Any, Optional
from ..config.schema import EvaluationConfig
from ..storage.result_repository import load_experiment_translations
from ..storage.metric_repository import save_experiment_metrics
from ..storage.classic_metric_repository import load_classic_comet_segment_scores
#такое часто будет, для того чтобы меж компами таскать нормально
#(можно было изначально написать чтоб не разваливалось но это не мой подход)
try:
    from .metrics_adapter import compute_quality_metrics, compute_operational_metrics
except ImportError:
    compute_quality_metrics = None
    compute_operational_metrics = None

try:
    from .token_efficiency_runner import compute_token_efficiency_metrics
except ImportError:
    compute_token_efficiency_metrics = None

logger = logging.getLogger(__name__)


def _create_comet_scorer(comet_model_path: Optional[str] = None) -> Optional[Any]:
    """
    для метрки COMET делаем скорер

    Args:
        comet_model_path: Optional path to COMET model checkpoint.
            If None, downloads default model "Unbabel/wmt22-comet-da".

    Returns:
        ModelCometScorer instance or None if COMET not available.
    """
    try:
        from comet import download_model, load_from_checkpoint
        from ..legacy_bridge.calc_metric_adapter import ModelCometScorer

        if comet_model_path is None:
            model_path = download_model("Unbabel/wmt22-comet-da")
        else:
            model_path = comet_model_path

        comet_model = load_from_checkpoint(model_path)

        scorer = ModelCometScorer(comet_model, cache=None)
        logger.info(f"Created COMET scorer with model: {model_path}")
        return scorer

    except ImportError as e:
        logger.warning(
            f"COMET not available, text scores will be zero. Error: {e}"
        )
        return None
    except Exception as e:
        logger.warning(
            f"Failed to create COMET scorer, text scores will be zero. Error: {e}"
        )
        return None


def evaluate_experiment(
    evaluation_config: EvaluationConfig,
    db_path: str,
    comet_scorer: Optional[Any] = None,
    precomputed_text_scores: Optional[list] = None,
) -> Dict[str, Any]:
    """
    считаем нашу метрику и "операционные" метрики.

	1.	Загружаем переводы из базы
	2.	Оставляем только успешно переведенные строки (где есть final_translation)
	3.	Считаем метрику с 3 чекпоинта
	4.	Считаем "операционные" метрики
	5.	Сохраняем всё в таблицу metrics
	6.	Возвращаем итог

    Args:
        evaluation_config: Evaluation configuration.
        db_path: Path to benchmark SQLite database.
        comet_scorer: Optional COMET scorer instance.
        precomputed_text_scores: Optional precomputed COMET scores.

    Returns:
        Dictionary with all metrics (quality + operational).
    """
    experiment_id = evaluation_config.experiment_id
    logger.info(f"Evaluating experiment {experiment_id}")

    translations = load_experiment_translations(db_path, experiment_id)
    if not translations:
        logger.warning(f"No translations found for experiment {experiment_id}")
        return {
            "error": "no_translations",
            "experiment_id": experiment_id,
        }

    logger.info(f"Loaded {len(translations)} translations for evaluation")

    # Пытаемся загрузить предварительно вычисленные COMET scores из classic evaluation
    if precomputed_text_scores is None:
        scores_dict = load_classic_comet_segment_scores(db_path, experiment_id)
        if scores_dict:
            logger.info(f"Loaded {len(scores_dict)} precomputed COMET segment scores")
            # Строим precomputed_text_scores в порядке translations
            precomputed_text_scores = []
            for item in translations:
                row_id = item.get("row_id")
                score = scores_dict.get(row_id)
                precomputed_text_scores.append(score)  # может быть None если score отсутствует
            # Проверяем, есть ли хотя бы один не-None score
            if any(s is not None for s in precomputed_text_scores):
                logger.info(f"Using precomputed COMET scores for {sum(1 for s in precomputed_text_scores if s is not None)} segments")
            else: #да почемуммммууууу оно не работает тооооо
                logger.info("No valid precomputed scores found, will compute COMET from scratch")
                precomputed_text_scores = None
        else:
            logger.info("No precomputed COMET segment scores found in database")

    source_texts = []
    reference_texts = []
    candidate_texts = []

    for item in translations:
        source_texts.append(item.get("source_text", ""))
        reference_texts.append(item.get("reference_text", ""))
        candidate_texts.append(item.get("candidate_text", ""))

    if comet_scorer is None and precomputed_text_scores is None:
        comet_scorer = _create_comet_scorer(evaluation_config.comet_model_path)
        if comet_scorer is not None:
            logger.info("Using auto-created COMET scorer for text quality evaluation")
        else:
            logger.warning("COMET scorer not available, text scores will be zero")
    elif precomputed_text_scores is not None:
        logger.info("Using precomputed COMET scores, COMET scorer not needed")

    if compute_quality_metrics is None:
        logger.error("Quality metrics computation not available (missing dependencies)")
        quality_metrics = {
            "text_score_mean": 0.0,
            "tag_content_score_mean": 0.0,
            "tag_structure_score_mean": 0.0,
            "compilability_rate": 0.0,
            "final_score_mean": 0.0,
            "per_row_scores": [],
        }
    else:
        quality_metrics = compute_quality_metrics(
            source_texts=source_texts,
            reference_texts=reference_texts,
            candidate_texts=candidate_texts,
            comet_scorer=comet_scorer,
            precomputed_text_scores=precomputed_text_scores,
            comet_cache_file=None,  #недоделано TODO
            reuse_old_comet_cache=True,
            comet_batch_size=evaluation_config.batch_size,
            show_progress=True,
        )

    operational_metrics = compute_experiment_operational_metrics(db_path, experiment_id)

    token_efficiency_metrics = {}
    if compute_token_efficiency_metrics is not None:
        try:
            token_efficiency_metrics = compute_token_efficiency_metrics(db_path, experiment_id)
        except Exception as e:
            logger.warning(f"Failed to compute token efficiency metrics: {e}")
    else:
        logger.info("Token efficiency metrics not available (optional dependency missing)")

    all_metrics = {
        **quality_metrics,
        **operational_metrics,
        **token_efficiency_metrics,
        "experiment_id": experiment_id,
        "total_rows_evaluated": len(translations),
    }

    try:
        save_experiment_metrics(db_path, experiment_id, all_metrics)
        logger.info(f"Metrics saved for experiment {experiment_id}")
    except Exception as e:
        logger.error(f"Failed to save metrics: {e}")

    return all_metrics


def compute_experiment_operational_metrics(db_path: str, experiment_id: str) -> Dict[str, float]:
    """
    Args:
        db_path: Path to benchmark SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with operational metrics:
        - total_rows
        - success_count
        - failed_count
        - fallback_count
        - attempts_count
        - total_latency_ms
        - success_rate
        - valid_response_rate
        - fallback_rate
        - avg_latency_ms
        - attempts_per_row
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                COUNT(*) as total_rows,
                SUM(CASE WHEN final_translation IS NOT NULL THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN final_translation IS NULL THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) as fallback_count
            FROM results
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        total_rows = row[0] if row else 0
        success_count = row[1] if row and row[1] is not None else 0
        failed_count = row[2] if row and row[2] is not None else 0
        fallback_count = row[3] if row and row[3] is not None else 0

        cursor.execute(
            """
            SELECT
                COUNT(*) as attempts_count,
                SUM(latency_ms) as total_latency_ms
            FROM attempts
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        attempts_count = row[0] if row and row[0] is not None else 0
        total_latency_ms = row[1] if row and row[1] is not None else 0

        valid_response_count = success_count

    finally:
        conn.close()

    operational = compute_operational_metrics(
        total_rows=total_rows,
        success_count=success_count,
        failed_count=failed_count,
        fallback_count=fallback_count,
        attempts_count=attempts_count,
        total_latency_ms=total_latency_ms,
        valid_response_count=valid_response_count,
    )

    operational.update({
        "total_rows": total_rows,
        "success_count": success_count,
        "failed_count": failed_count,
        "fallback_count": fallback_count,
        "attempts_count": attempts_count,
        "total_latency_ms": total_latency_ms,
    })

    return operational


def evaluate_experiment_with_config(
    config_path: str,
    db_path: str,
    comet_scorer: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    грузим конфиг и запускаем оценку

    Args:
        config_path: Path to evaluation config JSON file.
        db_path: Path to benchmark SQLite database.
        comet_scorer: Optional COMET scorer instance.

    Returns:
        Dictionary with all metrics.
    """
    import json
    from ..config.experiment_loader import load_evaluation_config

    evaluation_config = load_evaluation_config(config_path)
    return evaluate_experiment(evaluation_config, db_path, comet_scorer)