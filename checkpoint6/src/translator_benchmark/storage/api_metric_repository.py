import sqlite3
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def _ensure_api_metrics_columns(conn: sqlite3.Connection) -> None:
    from . import sqlite_models
    cursor = conn.cursor()
    cursor.execute(sqlite_models.CREATE_API_METRICS_TABLE_SQL)
    token_efficiency_columns = [
        ("created_at", "TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("estimated_source_payload_tokens", "INTEGER"),
        ("estimated_prompt_shell_tokens", "INTEGER"),
        ("input_overhead_ratio", "REAL"),
        ("full_cost_ratio", "REAL"),
        ("payload_to_total_input_ratio", "REAL"),
        ("prompt_shell_ratio", "REAL"),
        ("token_efficiency_note", "TEXT"),
    ]
    for col_name, col_type in token_efficiency_columns:
        try:
            cursor.execute(f"ALTER TABLE api_metrics ADD COLUMN {col_name} {col_type}")
            logger.debug(f"Added column {col_name} to api_metrics table")
        except sqlite3.OperationalError:
            pass
    conn.commit()


def load_api_metrics(db_path: str, experiment_id: str) -> Optional[Dict[str, Any]]:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with API metrics or None if not found.
    """
    conn = sqlite3.connect(db_path)
    try:
        _ensure_api_metrics_columns(conn)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT total_rows, successful_rows, failed_rows,
                   total_attempts, total_api_calls,
                   accepted_without_retry_count, accepted_after_retry_count,
                   repair_applied_count, fallback_count, retry_count,
                   transport_error_count, timeout_count, rate_limit_count,
                   empty_response_count, invalid_json_count,
                   invalid_batch_shape_count, wrong_item_count_count,
                   missing_content_count, total_input_tokens,
                   total_output_tokens, total_tokens,
                   avg_input_tokens_per_success, avg_output_tokens_per_success,
                   avg_total_tokens_per_success,
                   estimated_source_payload_tokens, estimated_prompt_shell_tokens,
                   input_overhead_ratio, full_cost_ratio,
                   payload_to_total_input_ratio, prompt_shell_ratio,
                   token_efficiency_note, created_at
            FROM api_metrics
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        return {
            "experiment_id": experiment_id,
            "total_rows": row[0],
            "successful_rows": row[1],
            "failed_rows": row[2],
            "total_attempts": row[3],
            "total_api_calls": row[4],
            "accepted_without_retry_count": row[5],
            "accepted_after_retry_count": row[6],
            "repair_applied_count": row[7],
            "fallback_count": row[8],
            "retry_count": row[9],
            "transport_error_count": row[10],
            "timeout_count": row[11],
            "rate_limit_count": row[12],
            "empty_response_count": row[13],
            "invalid_json_count": row[14],
            "invalid_batch_shape_count": row[15],
            "wrong_item_count_count": row[16],
            "missing_content_count": row[17],
            "total_input_tokens": row[18],
            "total_output_tokens": row[19],
            "total_tokens": row[20],
            "avg_input_tokens_per_success": row[21],
            "avg_output_tokens_per_success": row[22],
            "avg_total_tokens_per_success": row[23],
            "estimated_source_payload_tokens": row[24],
            "estimated_prompt_shell_tokens": row[25],
            "input_overhead_ratio": row[26],
            "full_cost_ratio": row[27],
            "payload_to_total_input_ratio": row[28],
            "prompt_shell_ratio": row[29],
            "token_efficiency_note": row[30],
            "created_at": row[31],
        }
    finally:
        conn.close()


def list_experiments_with_api_metrics(db_path: str) -> list[str]:
    """
    Args:
        db_path: Path to SQLite database.

    Returns:
        List of experiment IDs.
    """
    conn = sqlite3.connect(db_path)
    try:
        _ensure_api_metrics_columns(conn)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT experiment_id FROM api_metrics ORDER BY created_at DESC"
        )
        rows = cursor.fetchall()
        return [row[0] for row in rows]
    finally:
        conn.close()