import sqlite3
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def save_classic_metrics(db_path: str, metrics: Dict[str, Any]) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        metrics: Dictionary with metric values. Expected keys:
            - experiment_id: str
            - bleu: float or None
            - chrf: float or None
            - ter: float or None
            - comet: float or None
            - num_scored_rows: int
    """
    required_keys = {"experiment_id", "num_scored_rows"}
    for key in required_keys:
        if key not in metrics:
            raise ValueError(f"Missing required key in metrics: {key}")

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO classic_metrics
            (experiment_id, bleu, chrf, ter, comet, comet_model_name, num_scored_rows, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                metrics["experiment_id"],
                metrics.get("bleu"),
                metrics.get("chrf"),
                metrics.get("ter"),
                metrics.get("comet"),
                metrics.get("comet_model_name"),
                metrics["num_scored_rows"],
            ),
        )
        conn.commit()
        logger.info(f"Classic metrics saved for experiment {metrics['experiment_id']}")
    finally:
        conn.close()


def load_classic_metrics(db_path: str, experiment_id: str) -> Optional[Dict[str, Any]]:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with classic metrics or None if not found.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT bleu, chrf, ter, comet, comet_model_name, num_scored_rows, created_at
            FROM classic_metrics
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        return {
            "experiment_id": experiment_id,
            "bleu": row[0],
            "chrf": row[1],
            "ter": row[2],
            "comet": row[3],
            "comet_model_name": row[4],
            "num_scored_rows": row[5],
            "created_at": row[6],
        }
    finally:
        conn.close()


def delete_classic_metrics(db_path: str, experiment_id: str) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM classic_metrics WHERE experiment_id = ?",
            (experiment_id,),
        )
        conn.commit()
        logger.info(f"Classic metrics deleted for experiment {experiment_id}")
    finally:
        conn.close()


def save_classic_comet_segment_scores(db_path: str, experiment_id: str, rows: list[tuple[int, float]]) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
        rows: List of (row_id, comet_score) tuples.
    """
    if not rows:
        return

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        # Используем INSERT OR REPLACE на случай если scores уже есть
        cursor.executemany(
            """
            INSERT OR REPLACE INTO classic_comet_segment_scores
            (experiment_id, row_id, comet_score, created_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            """,
            [(experiment_id, row_id, score) for row_id, score in rows]
        )
        conn.commit()
        logger.info(f"Saved {len(rows)} COMET segment scores for experiment {experiment_id}")
    except sqlite3.OperationalError as e:
        # Если таблицы нет — игнорируем (старая схема БД)
        logger.warning(f"Table classic_comet_segment_scores may not exist: {e}")
    finally:
        conn.close()


def load_classic_comet_segment_scores(db_path: str, experiment_id: str) -> dict[int, float]:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary mapping row_id -> comet_score. Empty if no scores found or table doesn't exist.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT row_id, comet_score
            FROM classic_comet_segment_scores
            WHERE experiment_id = ?
            ORDER BY row_id
            """,
            (experiment_id,)
        )
        rows = cursor.fetchall()
        return {row_id: score for row_id, score in rows}
    except sqlite3.OperationalError as e:
        # Таблицы нет — возвращаем пустой словарь
        logger.debug(f"Table classic_comet_segment_scores may not exist: {e}")
        return {}
    finally:
        conn.close()


def list_experiments_with_classic_metrics(db_path: str) -> list[str]:
    """
    Args:
        db_path: Path to SQLite database.

    Returns:
        List of experiment IDs.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT experiment_id FROM classic_metrics ORDER BY created_at DESC"
        )
        rows = cursor.fetchall()
        return [row[0] for row in rows]
    finally:
        conn.close()