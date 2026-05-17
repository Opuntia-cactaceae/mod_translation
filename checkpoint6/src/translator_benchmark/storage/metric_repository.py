import sqlite3
from typing import Optional, Dict, Any


def save_experiment_metrics(db_path: str, experiment_id: str, metrics: Dict[str, Any]) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
        metrics: Dictionary of metric values.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO metrics
            (experiment_id, text_score_mean, tag_content_score_mean, tag_structure_score_mean,
             compilability_rate, final_score_mean, success_rate, valid_response_rate,
             fallback_rate, avg_latency_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                experiment_id,
                metrics.get("text_score_mean"),
                metrics.get("tag_content_score_mean"),
                metrics.get("tag_structure_score_mean"),
                metrics.get("compilability_rate"),
                metrics.get("final_score_mean"),
                metrics.get("success_rate"),
                metrics.get("valid_response_rate"),
                metrics.get("fallback_rate"),
                metrics.get("avg_latency_ms"),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def load_experiment_metrics(db_path: str, experiment_id: str) -> Optional[Dict[str, Any]]:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary of metrics or None.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT text_score_mean, tag_content_score_mean, tag_structure_score_mean,
                   compilability_rate, final_score_mean, success_rate, valid_response_rate,
                   fallback_rate, avg_latency_ms
            FROM metrics
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "text_score_mean": row[0],
            "tag_content_score_mean": row[1],
            "tag_structure_score_mean": row[2],
            "compilability_rate": row[3],
            "final_score_mean": row[4],
            "success_rate": row[5],
            "valid_response_rate": row[6],
            "fallback_rate": row[7],
            "avg_latency_ms": row[8],
        }
    finally:
        conn.close()