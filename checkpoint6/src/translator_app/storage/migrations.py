"""MigrationManager — schema version tracking and migration support.

Provides:
    * Schema version query (get_current_version)
    * Migration runner with version checks
    * Hooks for future schema migrations
"""

from typing import Optional

from translator_app.storage.db import DatabaseService


CURRENT_SCHEMA_VERSION = 14

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
    5: [
        # Phase 5: protection snapshots table
        """CREATE TABLE IF NOT EXISTS protection_snapshots (
            snapshot_hash TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            strategy_name TEXT NOT NULL,
            profile_id TEXT,
            schema_hash TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_protection_snapshots_job_id ON protection_snapshots(job_id)",
        "CREATE INDEX IF NOT EXISTS idx_protection_snapshots_schema_hash ON protection_snapshots(schema_hash)",
    ],
    6: [
        # Phase 6E: persisted divergence for migration readiness metrics
        """CREATE TABLE IF NOT EXISTS analysis_divergence (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            output_file_id TEXT NOT NULL,
            divergence_type TEXT NOT NULL,
            legacy_status TEXT,
            snapshot_status TEXT,
            legacy_failed INTEGER NOT NULL DEFAULT 0,
            snapshot_failed INTEGER,
            legacy_issue_codes TEXT NOT NULL DEFAULT '[]',
            snapshot_issue_codes TEXT NOT NULL DEFAULT '[]',
            details_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_divergence_job_file ON analysis_divergence(job_id, output_file_id)",
        "CREATE INDEX IF NOT EXISTS idx_analysis_divergence_job_id ON analysis_divergence(job_id)",
        "CREATE INDEX IF NOT EXISTS idx_analysis_divergence_output_file_id ON analysis_divergence(output_file_id)",
        "CREATE INDEX IF NOT EXISTS idx_analysis_divergence_type ON analysis_divergence(divergence_type)",
    ],
    7: [
        # Phase 7: protection rule sets (replaces legacy strategies)
        """CREATE TABLE IF NOT EXISTS protection_rule_sets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            builtin INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS protection_rule_set_rules (
            id TEXT PRIMARY KEY,
            rule_set_id TEXT NOT NULL REFERENCES protection_rule_sets(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            pattern TEXT NOT NULL,
            token_type TEXT NOT NULL DEFAULT 'game_token',
            enabled INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 100,
            flags TEXT DEFAULT '[]',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_protection_rule_set_rules_set_id ON protection_rule_set_rules(rule_set_id)",
    ],
    8: [
        # Phase 8: explicit rule_kind for semantic separation
        # protection_rule_set_rules
        "ALTER TABLE protection_rule_set_rules ADD COLUMN rule_kind TEXT NOT NULL DEFAULT 'atomic'",
        # custom_protection_rules
        "ALTER TABLE custom_protection_rules ADD COLUMN rule_kind TEXT NOT NULL DEFAULT 'atomic'",
        "ALTER TABLE custom_protection_rules ADD COLUMN token_type TEXT NOT NULL DEFAULT 'custom_token'",
        "ALTER TABLE custom_protection_rules ADD COLUMN opener_pattern TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE custom_protection_rules ADD COLUMN closer_pattern TEXT NOT NULL DEFAULT ''",
    ],
    9: [
        # Phase 9: persisted semantic ranking for learned protection candidates
        "ALTER TABLE learned_protection_candidates ADD COLUMN semantic_rank INTEGER NOT NULL DEFAULT 10",
        "ALTER TABLE learned_protection_candidates ADD COLUMN is_markup_fragment INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE learned_protection_candidates ADD COLUMN shadowed_by_paired_candidate TEXT",
    ],
    10: [
        # Phase 10: opener_pattern/closer_pattern for rule-set rules
        "ALTER TABLE protection_rule_set_rules ADD COLUMN opener_pattern TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE protection_rule_set_rules ADD COLUMN closer_pattern TEXT NOT NULL DEFAULT ''",
    ],
    11: [
        # Phase 11: sync builtin rules from source (defensive ALTER TABLE
        # in case v8/v10 were skipped for existing databases) + delete
        # stale ``builtin_color_section`` rule that was removed from
        # ``builtin_rules.py`` but persisted in some databases.
        "ALTER TABLE protection_rule_set_rules ADD COLUMN rule_kind TEXT NOT NULL DEFAULT 'atomic'",
        "DELETE FROM protection_rule_set_rules WHERE id = 'builtin_color_section'",
    ],
    12: [
        # Phase 12: Pairing Project workspace tables
        """CREATE TABLE IF NOT EXISTS pairing_projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            source_language TEXT,
            target_language TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_scanned_at TEXT,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
            notes TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS pairing_project_files (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES pairing_projects(id) ON DELETE CASCADE,
            relative_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            extension TEXT NOT NULL DEFAULT '',
            parent_dir TEXT NOT NULL DEFAULT '',
            size_bytes INTEGER NOT NULL DEFAULT 0,
            content_hash TEXT,
            modified_at TEXT,
            detected_language TEXT,
            detected_role TEXT NOT NULL DEFAULT 'unknown'
                CHECK (detected_role IN ('source', 'translated', 'unknown')),
            group_key TEXT,
            is_ignored INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS pairing_project_pairs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES pairing_projects(id) ON DELETE CASCADE,
            source_file_id TEXT REFERENCES pairing_project_files(id) ON DELETE SET NULL,
            translated_file_id TEXT REFERENCES pairing_project_files(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'suggested'
                CHECK (status IN ('suggested', 'accepted', 'rejected', 'manual', 'ignored')),
            confidence REAL NOT NULL DEFAULT 0.0,
            reason TEXT,
            created_by TEXT NOT NULL DEFAULT 'auto'
                CHECK (created_by IN ('auto', 'user')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            notes TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS pairing_project_alignments (
            id TEXT PRIMARY KEY,
            pair_id TEXT NOT NULL REFERENCES pairing_project_pairs(id) ON DELETE CASCADE,
            mode TEXT NOT NULL DEFAULT 'raw'
                CHECK (mode IN ('raw', 'structured')),
            source_revision_hash TEXT,
            translated_revision_hash TEXT,
            operations_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_pairing_files_project ON pairing_project_files(project_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pairing_files_project_path ON pairing_project_files(project_id, relative_path)",
        "CREATE INDEX IF NOT EXISTS idx_pairing_files_hash ON pairing_project_files(project_id, content_hash)",
        "CREATE INDEX IF NOT EXISTS idx_pairing_files_group ON pairing_project_files(project_id, group_key)",
        "CREATE INDEX IF NOT EXISTS idx_pairing_pairs_project ON pairing_project_pairs(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_pairing_pairs_status ON pairing_project_pairs(project_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_pairing_pairs_source ON pairing_project_pairs(project_id, source_file_id)",
        "CREATE INDEX IF NOT EXISTS idx_pairing_pairs_translated ON pairing_project_pairs(project_id, translated_file_id)",
        "CREATE INDEX IF NOT EXISTS idx_pairing_alignments_pair ON pairing_project_alignments(pair_id)",
    ],
    13: [
        "ALTER TABLE pairing_project_alignments ADD COLUMN last_applied_at TEXT",
    ],
    14: [
        # Phase 14: add rule_kind / token_type / opener_pattern /
        # closer_pattern to learned_protection_candidates for databases
        # created before the table DDL included them.  The discovery
        # pipeline (learn_from_line_pairs) writes these columns via
        # upsert_candidate_by_normalized and crashes on old databases.
        "ALTER TABLE learned_protection_candidates ADD COLUMN rule_kind TEXT NOT NULL DEFAULT 'atomic'",
        "ALTER TABLE learned_protection_candidates ADD COLUMN token_type TEXT NOT NULL DEFAULT 'custom_token'",
        "ALTER TABLE learned_protection_candidates ADD COLUMN opener_pattern TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE learned_protection_candidates ADD COLUMN closer_pattern TEXT NOT NULL DEFAULT ''",
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
