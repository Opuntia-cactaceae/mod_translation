import json
import sqlite3
from typing import Optional, Dict, Any
from ..domain.entities import ExperimentRun


def create_experiment_run(db_path: str, experiment_run: ExperimentRun) -> None:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_run: ExperimentRun object.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO experiments
            (experiment_id, created_at, dataset_id, model_name, prompt_profile,
             protection_strategy, validator_name, batch_size, config_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                experiment_run.experiment_id,
                experiment_run.created_at,
                experiment_run.config_snapshot.get("dataset", {}).get("dataset_id", ""),
                experiment_run.config_snapshot.get("runtime", {}).get("model_name", ""),
                experiment_run.config_snapshot.get("prompt", {}).get("profile_name", ""),
                experiment_run.config_snapshot.get("protection", {}).get("strategy_name", ""),
                experiment_run.config_snapshot.get("validation", {}).get("validator_name", ""),
                experiment_run.config_snapshot.get("batch_size", 10),
                json.dumps(experiment_run.config_snapshot),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_experiment_run(db_path: str, experiment_id: str) -> Optional[Dict[str, Any]]:
    """
    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with experiment data or None.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT experiment_id, created_at, config_json FROM experiments WHERE experiment_id = ?",
            (experiment_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "experiment_id": row[0],
            "created_at": row[1],
            "config_snapshot": json.loads(row[2]),
        }
    finally:
        conn.close()