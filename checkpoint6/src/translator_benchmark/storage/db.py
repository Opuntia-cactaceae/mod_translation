import sqlite3
from . import sqlite_models


def init_benchmark_db(db_path: str) -> None:
    """
    Args:
        db_path: Path to SQLite database file.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(sqlite_models.CREATE_EXPERIMENTS_TABLE_SQL)
        cursor.execute(sqlite_models.CREATE_RESULTS_TABLE_SQL)
        cursor.execute(sqlite_models.CREATE_ATTEMPTS_TABLE_SQL)
        cursor.execute(sqlite_models.CREATE_METRICS_TABLE_SQL)
        cursor.execute(sqlite_models.CREATE_API_METRICS_TABLE_SQL)
        cursor.execute(sqlite_models.CREATE_CLASSIC_METRICS_TABLE_SQL)
        cursor.execute(sqlite_models.CREATE_CLASSIC_COMET_SEGMENT_SCORES_TABLE_SQL)
        cursor.execute(sqlite_models.CREATE_CACHE_TABLE_SQL)
        try:
            cursor.execute("ALTER TABLE classic_metrics ADD COLUMN comet_model_name TEXT")
        except sqlite3.OperationalError:
            pass

        token_efficiency_columns = [
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
            except sqlite3.OperationalError:
                pass

        conn.commit()
    finally:
        conn.close()


def get_connection(db_path: str) -> sqlite3.Connection:
    """
    Args:
        db_path: Path to SQLite database file.

    Returns:
        sqlite3.Connection object.
    """
    return sqlite3.connect(db_path)