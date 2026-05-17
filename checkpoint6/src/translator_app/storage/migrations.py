"""MigrationManager — schema version tracking and migration support.

Provides:
    * Schema version query (get_current_version)
    * Migration runner with version checks
    * Hooks for future schema migrations
"""

from typing import Optional

from translator_app.storage.db import DatabaseService


CURRENT_SCHEMA_VERSION = 4

# Migration registry: version -> list of SQL statements
_MIGRATIONS: dict[int, list[str]] = {
    2: [
        "ALTER TABLE diagnostics ADD COLUMN user_message TEXT DEFAULT ''",
    ],
    3: [
        "ALTER TABLE jobs ADD COLUMN output_files TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE jobs ADD COLUMN output_root_dir TEXT",
    ],
    4: [
        # P0-06: trace persistence tables
        """CREATE TABLE IF NOT EXISTS trace_events (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            batch_index INTEGER NOT NULL DEFAULT 0,
            message TEXT NOT NULL DEFAULT '',
            data_json TEXT,
            provider TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            src_lang TEXT NOT NULL DEFAULT '',
            dst_lang TEXT NOT NULL DEFAULT '',
            timestamp TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS trace_units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            unit_id TEXT NOT NULL,
            file_path TEXT NOT NULL DEFAULT '',
            key TEXT NOT NULL DEFAULT '',
            source_text TEXT NOT NULL DEFAULT '',
            translated_text TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT NOT NULL DEFAULT '',
            batch_index INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_trace_events_job_id ON trace_events(job_id)",
        "CREATE INDEX IF NOT EXISTS idx_trace_units_job_id ON trace_units(job_id)",
    ],
}


class MigrationManager:
    """Manages database schema migrations."""

    def __init__(self, db: Optional[DatabaseService] = None, db_path: str = ":memory:"):
        if db is not None:
            self.db = db
        else:
            self.db = DatabaseService(db_path)

    def run(self) -> None:
        """Run pending migrations up to CURRENT_SCHEMA_VERSION.

        Safe to call multiple times — only applies unapplied versions.
        """
        self.db.ensure_schema()
        current = self.get_current_version()
        conn = self.db.connect()

        for version in range(current + 1, CURRENT_SCHEMA_VERSION + 1):
            statements = _MIGRATIONS.get(version, [])
            for sql in statements:
                try:
                    conn.execute(sql)
                except Exception:
                    # Gracefully skip statements that fail (e.g. ALTER TABLE
                    # ADD COLUMN when the column already exists).
                    pass
            conn.execute(
                "INSERT OR REPLACE INTO schema_version (version, applied_at) "
                "VALUES (?, datetime('now'))",
                (version,),
            )
        conn.commit()

    def get_current_version(self) -> int:
        """Get the current schema version from the database.

        Returns 0 if the schema_version table does not exist yet.
        """
        conn = self.db.connect()
        try:
            row = conn.execute(
                "SELECT MAX(version) as v FROM schema_version"
            ).fetchone()
            return row["v"] if row and row["v"] else 0
        except Exception:
            return 0
