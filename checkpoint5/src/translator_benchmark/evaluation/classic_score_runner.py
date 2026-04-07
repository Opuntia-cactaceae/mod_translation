import logging
import sqlite3
from typing import Dict, Any, List, Optional

from .classic_metrics import compute_classic_metrics_with_comet
from ..storage.classic_metric_repository import save_classic_comet_segment_scores

logger = logging.getLogger(__name__)


def load_successful_translations(
    db_path: str,
    experiment_id: str
) -> List[Dict[str, Any]]:
    """
    Загружаем успешно переведенные строки

    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        List of dictionaries with row_id, source, reference, and candidate texts.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT row_id, source_text, reference_text, final_translation
            FROM results
            WHERE experiment_id = ?
              AND reference_text IS NOT NULL
              AND reference_text != ''
              AND final_translation IS NOT NULL
              AND final_translation != ''
            ORDER BY row_id
            """,
            (experiment_id,),
        )
        rows = cursor.fetchall()

        translations = []
        for row_id, source, reference, candidate in rows:
            translations.append({
                "row_id": row_id,
                "source_text": source if source is not None else "",
                "reference_text": reference if reference is not None else "",
                "candidate_text": candidate if candidate is not None else "",
            })

        return translations
    finally:
        conn.close()


def evaluate_classic_metrics(
    db_path: str,
    experiment_id: str,
    with_comet: bool = False,
    comet_model: str = "Unbabel/wmt22-comet-da"
) -> Dict[str, Any]:
    """
    Считаем метрики перевода за эксперимент

    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
        with_comet: Whether to compute COMET metric (optional).
        comet_model: COMET model to use if with_comet=True.

    Returns:
        Dictionary with classic metrics results:
        - experiment_id: experiment identifier
        - classic: classic metrics (BLEU, chrF, TER)
        - comet: COMET metric details (if computed successfully)
        - comet_available: boolean indicating if COMET was computed
        - comet_error: error message if COMET failed (optional)
        - num_scored_rows: number of rows used for scoring
        - total_available_rows: total rows with both reference and translation

    Raises:
        ValueError: If no successful translations found.
    """
    logger.info(f"Evaluating classic metrics for experiment {experiment_id}")

    translations = load_successful_translations(db_path, experiment_id)
    if not translations:
        raise ValueError(
            f"No successful translations with both reference and candidate found "
            f"for experiment {experiment_id}"
        )

    logger.info(f"Found {len(translations)} successful translations for evaluation")

    row_ids = []
    sources = []
    references = []
    candidates = []

    for item in translations:
        row_ids.append(item["row_id"])
        sources.append(item["source_text"])
        references.append(item["reference_text"])
        candidates.append(item["candidate_text"])

    try:
        metrics = compute_classic_metrics_with_comet(
            sources=sources,
            references=references,
            hypotheses=candidates,
            with_comet=with_comet,
            comet_model=comet_model,
        )

        result = {
            "experiment_id": experiment_id,
            "classic": metrics["classic"],
            "comet_available": metrics.get("comet_available", False),
            "comet": metrics.get("comet"),
            "num_scored_rows": metrics["classic"]["num_scored_rows"],
            "total_available_rows": len(translations),
        }

        if "comet_error" in metrics:
            result["comet_error"] = metrics["comet_error"]
            logger.warning(f"COMET computation failed: {metrics['comet_error']}")

        logger.info(
            f"Classic metrics computed: BLEU={metrics['classic'].get('bleu', 'N/A'):.4f}, "
            f"chrF={metrics['classic'].get('chrf', 'N/A'):.4f}, "
            f"TER={metrics['classic'].get('ter', 'N/A'):.4f}"
        )

        if metrics.get("comet_available"):
            logger.info(f"COMET computed: {metrics['comet'].get('score', 'N/A'):.4f}")
            # Сохраняем per-segment COMET scores, если они есть
            comet_result = metrics["comet"]
            if comet_result and "scores" in comet_result and comet_result["scores"]:
                seg_scores = comet_result["scores"]
                # Фильтруем valid triples (как в compute_comet_metric) для сопоставления с row_ids
                valid_row_ids = []
                for idx, (src, ref, hyp) in enumerate(zip(sources, references, candidates)):
                    if src and ref and hyp and src.strip() and ref.strip() and hyp.strip():
                        valid_row_ids.append(row_ids[idx])
                # Проверяем соответствие количества
                if len(valid_row_ids) == len(seg_scores):
                    rows_to_save = list(zip(valid_row_ids, seg_scores))
                    save_classic_comet_segment_scores(db_path, experiment_id, rows_to_save)
                    logger.info(f"Saved {len(rows_to_save)} per-segment COMET scores")
                else:
                    logger.warning(
                        f"Mismatch between valid rows ({len(valid_row_ids)}) and scores ({len(seg_scores)}). "
                        f"Skipping per-segment score saving."
                    )

        return result

    except Exception as e:
        logger.error(f"Failed to compute classic metrics for {experiment_id}: {e}")
        raise


def compute_and_save_classic_metrics(
    db_path: str,
    experiment_id: str,
    with_comet: bool = False,
    comet_model: str = "Unbabel/wmt22-comet-da"
) -> Dict[str, Any]:
    """
    тут и рассчитаем и сохраним

    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
        with_comet: Whether to compute COMET metric.
        comet_model: COMET model to use.

    Returns:
        Dictionary with metrics results.
    """
    from ..storage.classic_metric_repository import save_classic_metrics

    metrics = evaluate_classic_metrics(
        db_path, experiment_id, with_comet, comet_model
    )

    classic_data = metrics["classic"]
    comet_data = metrics.get("comet")
    storage_metrics = {
        "experiment_id": experiment_id,
        "bleu": classic_data.get("bleu"),
        "chrf": classic_data.get("chrf"),
        "ter": classic_data.get("ter"),
        "comet": comet_data.get("score") if comet_data else None,
        "comet_model_name": comet_data.get("model") if comet_data else None,
        "num_scored_rows": classic_data.get("num_scored_rows", 0),
    }

    save_classic_metrics(db_path, storage_metrics)

    logger.info(f"Classic metrics saved for experiment {experiment_id}")

    return metrics