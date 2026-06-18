#нифига не моделс правда, но я и не хочу орм для такой нестабильной штуки делать
#я бы тут уже обмигрировался до такой степени что потонул бы
CREATE_EXPERIMENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS experiments (
    experiment_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    prompt_profile TEXT NOT NULL,
    protection_strategy TEXT NOT NULL,
    validator_name TEXT NOT NULL,
    batch_size INTEGER NOT NULL,
    config_json TEXT NOT NULL
);
"""

CREATE_RESULTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS results (
    experiment_id TEXT NOT NULL,
    row_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    reference_text TEXT,
    protected_text TEXT NOT NULL,
    final_translation TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    repair_applied INTEGER NOT NULL DEFAULT 0,
    fallback_used INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER,
    total_output_tokens INTEGER,
    total_tokens INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (experiment_id, row_id),
    FOREIGN KEY (experiment_id) REFERENCES experiments (experiment_id) ON DELETE CASCADE
);
"""

CREATE_ATTEMPTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS attempts (
    experiment_id TEXT NOT NULL,
    row_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    request_kind TEXT NOT NULL,  -- 'batch' or 'single'
    used_model TEXT NOT NULL,
    used_key_index INTEGER,
    raw_request TEXT,
    raw_response TEXT,
    latency_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    error_type TEXT,
    error_message TEXT,
    response_outcome_type TEXT,
    retry_reason TEXT,
    repair_applied INTEGER NOT NULL DEFAULT 0,
    fallback_triggered INTEGER NOT NULL DEFAULT 0,
    input_token_count INTEGER,
    output_token_count INTEGER,
    total_token_count INTEGER,
    PRIMARY KEY (experiment_id, row_id, attempt_no),
    FOREIGN KEY (experiment_id) REFERENCES experiments (experiment_id) ON DELETE CASCADE
);
"""

CREATE_METRICS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS metrics (
    experiment_id TEXT PRIMARY KEY,
    text_score_mean REAL,
    tag_content_score_mean REAL,
    tag_structure_score_mean REAL,
    compilability_rate REAL,
    final_score_mean REAL,
    success_rate REAL,
    valid_response_rate REAL,
    fallback_rate REAL,
    avg_latency_ms REAL,
    FOREIGN KEY (experiment_id) REFERENCES experiments (experiment_id) ON DELETE CASCADE
);
"""

CREATE_API_METRICS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS api_metrics (
    experiment_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_rows INTEGER NOT NULL DEFAULT 0,
    successful_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    total_api_calls INTEGER NOT NULL DEFAULT 0,
    accepted_without_retry_count INTEGER NOT NULL DEFAULT 0,
    accepted_after_retry_count INTEGER NOT NULL DEFAULT 0,
    repair_applied_count INTEGER NOT NULL DEFAULT 0,
    fallback_count INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    transport_error_count INTEGER NOT NULL DEFAULT 0,
    timeout_count INTEGER NOT NULL DEFAULT 0,
    rate_limit_count INTEGER NOT NULL DEFAULT 0,
    empty_response_count INTEGER NOT NULL DEFAULT 0,
    invalid_json_count INTEGER NOT NULL DEFAULT 0,
    invalid_batch_shape_count INTEGER NOT NULL DEFAULT 0,
    wrong_item_count_count INTEGER NOT NULL DEFAULT 0,
    missing_content_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER,
    total_output_tokens INTEGER,
    total_tokens INTEGER,
    avg_input_tokens_per_success REAL,
    avg_output_tokens_per_success REAL,
    avg_total_tokens_per_success REAL,
    estimated_source_payload_tokens INTEGER,
    estimated_prompt_shell_tokens INTEGER,
    input_overhead_ratio REAL,
    full_cost_ratio REAL,
    payload_to_total_input_ratio REAL,
    prompt_shell_ratio REAL,
    token_efficiency_note TEXT,
    FOREIGN KEY (experiment_id) REFERENCES experiments (experiment_id) ON DELETE CASCADE
);
"""

CREATE_CLASSIC_METRICS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS classic_metrics (
    experiment_id TEXT PRIMARY KEY,
    bleu REAL,
    chrf REAL,
    ter REAL,
    comet REAL,
    comet_model_name TEXT,
    num_scored_rows INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (experiment_id) REFERENCES experiments (experiment_id) ON DELETE CASCADE
);
"""

CREATE_CLASSIC_COMET_SEGMENT_SCORES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS classic_comet_segment_scores (
    experiment_id TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    comet_score REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (experiment_id, row_id)
);
"""

CREATE_CACHE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS cache (
    cache_key TEXT PRIMARY KEY,
    translation TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""