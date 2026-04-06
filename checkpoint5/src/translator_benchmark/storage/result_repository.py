import json
import sqlite3
from typing import List, Dict, Any
from ..domain.results import RowProcessingResult
from ..domain.entities import AcceptedTranslation


def save_row_processing_result(db_path: str, experiment_id: str, result: RowProcessingResult) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
        result: RowProcessingResult object.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        final_translation = None
        protected_text = ""
        if result.accepted_translation:
            final_translation = result.accepted_translation.final_text
            protected_text = result.accepted_translation.protected_text
        cursor.execute(
            """
            INSERT OR REPLACE INTO results
            (experiment_id, row_id, source_text, reference_text, protected_text,
             final_translation, status, error_message, attempt_count, retry_count,
             repair_applied, fallback_used, total_input_tokens, total_output_tokens,
             total_tokens, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """,
            (
                experiment_id,
                result.row_id,
                result.source_text or "",
                result.reference_text or "",
                protected_text,
                final_translation,
                result.status,
                result.error_message,
                result.attempt_count,
                result.retry_count,
                1 if result.repair_applied else 0,
                1 if result.fallback_used else 0,
                result.total_input_tokens,
                result.total_output_tokens,
                result.total_tokens,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_next_attempt_no(db_path: str, experiment_id: str, row_id: str) -> int:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
        row_id: Dataset row identifier.

    Returns:
        Next attempt number (max existing + 1, or 1 if none).
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT MAX(attempt_no) FROM attempts WHERE experiment_id = ? AND row_id = ?",
            (experiment_id, row_id)
        )
        max_no = cursor.fetchone()[0]
        return (max_no or 0) + 1
    finally:
        conn.close()


def save_runtime_attempt(db_path: str, experiment_id: str, row_id: str, attempt_data: Dict[str, Any]) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.
        row_id: Dataset row identifier.
        attempt_data: Dictionary with attempt fields.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT MAX(attempt_no) FROM attempts WHERE experiment_id = ? AND row_id = ?",
            (experiment_id, row_id)
        )
        max_no = cursor.fetchone()[0]
        next_attempt_no = (max_no or 0) + 1

        cursor.execute(
            """
            INSERT INTO attempts
            (experiment_id, row_id, attempt_no, request_kind, used_model, used_key_index,
             raw_request, raw_response, latency_ms, status, error_type, error_message,
             response_outcome_type, retry_reason, repair_applied, fallback_triggered,
             input_token_count, output_token_count, total_token_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                experiment_id,
                row_id,
                next_attempt_no,
                attempt_data.get("request_kind", "single"),
                attempt_data.get("used_model", ""),
                attempt_data.get("used_key_index"),
                json.dumps(attempt_data.get("raw_request", "")),
                json.dumps(attempt_data.get("raw_response", "")),
                attempt_data.get("latency_ms", 0),
                attempt_data.get("status", "unknown"),
                attempt_data.get("error_type"),
                attempt_data.get("error_message"),
                attempt_data.get("response_outcome_type"),  # store as string
                attempt_data.get("retry_reason"),
                1 if attempt_data.get("repair_applied", False) else 0,
                1 if attempt_data.get("fallback_triggered", False) else 0,
                attempt_data.get("input_token_count"),
                attempt_data.get("output_token_count"),
                attempt_data.get("total_token_count"),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def load_experiment_translations(db_path: str, experiment_id: str) -> List[Dict[str, Any]]:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        List of dicts with source, reference, candidate texts.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT source_text, reference_text, final_translation
            FROM results
            WHERE experiment_id = ? AND final_translation IS NOT NULL
            """,
            (experiment_id,),
        )
        rows = cursor.fetchall()
        return [
            {
                "source_text": row[0],
                "reference_text": row[1],
                "candidate_text": row[2],
            }
            for row in rows
        ]
    finally:
        conn.close()