import json
import sqlite3
from typing import List
from .base import DatasetLoader
from ..config.schema import DatasetConfig
from ..domain.entities import DatasetRow

#sqlite основное место хранения строк для перевода (и результатов по совместительству)
#на каждую пару языков можно взять свой датасет - можно и под разные эксперименты собрать свои

class SqliteDatasetLoader(DatasetLoader):

    def load_rows(self, dataset_config: DatasetConfig) -> List[DatasetRow]:
        """
        загружаем строки с базы

        Args:
            dataset_config: Dataset configuration.

        Returns:
            List of DatasetRow objects.
        """
        query, params = build_dataset_query(dataset_config)
        conn = sqlite3.connect(dataset_config.sqlite_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        result = []
        for db_row in rows:
            metadata = {}
            metadata_raw = db_row["metadata"] if "metadata" in db_row.keys() else None
            if metadata_raw:
                try:
                    metadata = json.loads(metadata_raw)
                except:
                    metadata = {}

            result.append(DatasetRow(
                row_id=str(db_row["row_id"]),
                source_text=db_row["source_text"],
                reference_text=db_row["reference_text"] if "reference_text" in db_row.keys() else None,
                src_lang=db_row["src_lang"] if "src_lang" in db_row.keys() else "en",
                dst_lang=db_row["dst_lang"] if "dst_lang" in db_row.keys() else "ru",
                metadata=metadata,
            ))
        return result


def load_rows_from_sqlite(dataset_config: DatasetConfig) -> List[DatasetRow]:
    """
    Args:
        dataset_config: Dataset configuration.

    Returns:
        List of DatasetRow objects.
    """
    loader = SqliteDatasetLoader()
    return loader.load_rows(dataset_config)


def build_dataset_query(dataset_config: DatasetConfig) -> tuple[str, dict[str, object]]:
    """
    делаем запрос по параметрам - особенность в том что базы должны иметь строго одинаковую структуру

    Args:
        dataset_config: Dataset configuration.

    Returns:
        Tuple of (SQL string, parameter dict).
    """
    # таблица translations и колонки
    # row_id, source_text, reference_text, src_lang, dst_lang, metadata (JSON)
    base_query = "SELECT row_id, source_text, reference_text, src_lang, dst_lang, metadata FROM translations"
    where_clauses = []
    params = {}

    if dataset_config.filters:
        for i, (key, value) in enumerate(dataset_config.filters.items()):
            param_name = f"filter_{i}"
            where_clauses.append(f"{key} = :{param_name}")
            params[param_name] = value

    if where_clauses:
        where_str = " WHERE " + " AND ".join(where_clauses)
    else:
        where_str = ""

    query = base_query + where_str

    if dataset_config.limit is not None:
        query += " LIMIT :limit"
        params["limit"] = dataset_config.limit

    return query, params