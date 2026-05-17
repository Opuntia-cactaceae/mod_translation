/* ------------------------------------------------------------------ */
/*  API Types — mirrors backend Pydantic schemas                      */
/* ------------------------------------------------------------------ */

// --- Common ---
export interface HealthResponse {
  status: string;
  app_version: string;
  backend_ready: boolean;
}

export interface AppStateResponse {
  settings: Record<string, unknown>;
  active_jobs: unknown[];
  available_file_types: string[];
  available_strategies: Record<string, string[]>;
  warnings: string[];
}

export interface ErrorDetail {
  code: string;
  message: string;
  details: Record<string, unknown>;
  recoverable: boolean;
}

export interface ErrorResponse {
  error: ErrorDetail;
}

// --- Settings ---
export interface SettingsResponse {
  settings: Record<string, unknown>;
}

export interface SettingsUpdateRequest {
  settings: Record<string, unknown>;
}

export interface ValidatePathRequest {
  path: string;
  expected_type?: string;
  need_read?: boolean;
  need_write?: boolean;
  create_if_missing?: boolean;
}

export interface ValidatePathResponse {
  is_valid: boolean;
  message: string;
  exists?: boolean;
  is_directory?: boolean;
  can_read?: boolean;
  can_write?: boolean;
  errors: string[];
  warnings: string[];
}

// --- Secrets ---
export interface ApiKeyResponse {
  id: string;
  provider: string;
  label: string;
  masked_value: string;
  created_at?: string;
  last_used_at?: string;
  is_active: boolean;
}

export interface ApiKeyCreateRequest {
  provider: string;
  value: string;
  label?: string;
}

export interface ApiKeyListResponse {
  keys: ApiKeyResponse[];
  total: number;
}

export interface DeleteKeyResponse {
  deleted: boolean;
}

export interface TestKeyRequest {
  provider: string;
  value: string;
  model?: string;
}

export interface TestKeyResponse {
  valid: boolean;
  message: string;
  auth_ok?: boolean;
  provider_reachable?: boolean;
}

// --- Files ---
export interface FileInfo {
  path: string;
  name: string;
  detected_type: string;
  size: number;
  translatable_entries: number;
}

export interface FileListRequest {
  directory: string;
}

export interface FileListResponse {
  files: FileInfo[];
}

export interface FileReadResponse {
  content: string;
  path: string;
  size: number;
}

export interface PreviewOutputPathRequest {
  original_path: string;
  output_dir?: string;
  suffix?: string;
}

export interface PreviewOutputPathResponse {
  output_path: string;
}

// --- Translation Config ---
export interface TranslationOptionsResponse {
  providers: string[];
  prompt_profiles: string[];
  protection_strategies: string[];
  validators: string[];
}

export interface ValidateConfigRequest {
  provider?: string;
  model?: string;
  api_key_id?: string;
  batch_size?: number;
  src_lang?: string;
  dst_lang?: string;
  use_cache?: boolean;
  save_raw_responses?: boolean;
  prompt_preset_id?: string;
  temperature?: number;
  timeout_sec?: number;
  max_retries?: number;
  protection_strategy?: string;
  validator_name?: string;
}

export interface ValidateConfigResponse {
  is_valid: boolean;
  errors: { code: string; message: string; field: string }[];
}

export interface PreviewConfigRequest extends ValidateConfigRequest {}
export interface PreviewConfigResponse {
  config: Record<string, unknown>;
}

// --- Prompt Preview (Part 6) ---
export interface PreviewPromptRequest {
  prompt: Record<string, unknown>;
  src_lang: string;
  dst_lang: string;
  mode: 'batch' | 'single';
  sample_texts: string[];
}

export interface PreviewPromptResponse {
  system_message: string;
  user_message: string;
  warnings: string[];
  errors: string[];
}

// --- Effective Prompt (resolve prompt templates) ---
export interface EffectivePromptRequest {
  prompt: Record<string, unknown>;
  src_lang: string;
  dst_lang: string;
}

export interface EffectivePromptResponse {
  profile_name: string;
  batch_system_prompt: string;
  batch_user_template: string;
  single_system_prompt: string;
  single_user_template: string;
  log_prompts: boolean;
  source: string;
  warnings: string[];
}

// --- Translation Plan ---
export interface TranslationPlanPreviewRequest {
  file_paths: string[];
  config?: Record<string, unknown>;
}

export interface TranslationPlanPreviewResponse {
  total_units: number;
  total_tasks: number;
  batch_size: number;
  cache_hits: number;
  cache_misses: number;
  diagnostics: Record<string, unknown>[];
  // --- Preflight diagnostics ---
  warnings?: string[];
  errors?: string[];
  unsupported_files?: string[];
  duplicate_files?: string[];
  empty_files?: string[];
  zero_unit_files?: string[];
  detected_languages?: string[];
  has_blocking_errors?: boolean;
}

// --- Jobs ---
export interface JobResponse {
  id: string;
  name: string;
  status: string;
  source_job_id?: string | null;
  progress: number;
  total_units: number;
  completed_units: number;
  failed_units: number;
  cached_units: number;
  current_batch_index: number;
  total_batches: number;
  created_at: string;
  updated_at?: string;
  error_message?: string;
  file_paths: string[];
  output_files: string[];
  output_root_dir?: string | null;
  progress_detail?: JobProgressResponse;
  task_plan_summary?: TaskPlanSummary;
  diagnostics?: JobDiagnosticResponse[];
  result_summary?: {
    output_files?: Array<{
      output_path?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  current_activity?: string | null;
  config?: Record<string, unknown>;
}

export interface JobProgressResponse {
  total_units: number;
  processed_units: number;
  failed_units: number;
  cached_units: number;
  current_batch_index: number;
  total_batches: number;
  percent: number;
  eta_seconds?: number;
}

export interface TaskPlanSummary {
  total_units: number;
  total_tasks: number;
  batch_size: number;
  cache_hits: number;
  cache_misses: number;
}

export interface JobDiagnosticResponse {
  level: string;
  code: string;
  message: string;
  batch_index?: number;
  details?: Record<string, unknown>;
}

export interface FileJobMetadata {
  /** Per-file mod identifier. */
  mod_id?: string;
  /** Per-file mod display name. */
  mod_name?: string;
}

export interface CreateJobRequest {
  file_paths: string[];
  name?: string;
  priority?: number;
  config?: Record<string, unknown>;
  autostart?: boolean;
  /** Legacy job-level mod context (one mod per job). */
  mod_id?: string;
  /** Legacy job-level mod name. */
  mod_name?: string;
  /** Per-file metadata keyed by file path. */
  file_metadata?: Record<string, FileJobMetadata>;
}

export interface JobActionResponse {
  success: boolean;
  job?: JobResponse;
  message: string;
}

export interface JobSummaryResponse {
  id: string;
  status: string;
  progress: number;
  total_units: number;
  completed_units: number;
  failed_units: number;
  cached_units: number;
  current_batch_index: number;
  total_batches: number;
  updated_at?: string;
  active_worker: boolean;
  error_message?: string;
}

export interface UpdateConfigRequest {
  config: Record<string, unknown>;
}

// --- Cache ---
export interface CacheStatsResponse {
  total_requests: number;
  hits: number;
  misses: number;
  hit_rate: number;
  size: number;
  enabled: boolean;
}

export interface CacheClearResponse {
  success: boolean;
  message: string;
  removed: number;
}

// --- Editor ---
export interface EditorRowSchema {
  row_id: string;
  line_no: number;
  entry_type: string;
  key: string;
  source_text: string;
  translated_text?: string;
  status: string;
  warnings: string[];
  errors: string[];
  raw_line: string;
  editable: boolean;
}

export interface EditorStatsSchema {
  total_rows: number;
  translated_rows: number;
  edited_rows: number;
  warnings_count: number;
  errors_count: number;
}

export interface EditorFileResponse {
  file_id: string;
  content: string;
  entries: unknown[];
  language: string;
  rows: EditorRowSchema[];
  stats?: EditorStatsSchema;
}

export interface UpdateEntryRequest {
  translated: string;
}

export interface UpdateEntryResponse {
  success: boolean;
  entry_id: string;
  row?: EditorRowSchema;
}

export interface SaveFileRequest {
  output_path?: string;
  overwrite?: boolean;
  backup?: boolean;
}

export interface SaveFileResponse {
  success: boolean;
  file_id: string;
  output_path: string;
  message: string;
  validation?: Record<string, unknown>;
}

// --- Mods ---
export interface DiagnosticSchema {
  level: string;
  code: string;
  message: string;
  file_path?: string;
  details?: string;
}

export interface ModInfoSchema {
  name: string;
  mod_id: string;
  path: string;
  game_id: string;
  version: string;
  supported_version: string;
  tags: string[];
  descriptor_path?: string;
  is_valid: boolean;
  source: string;
  localisation_paths: string[];
  diagnostics: DiagnosticSchema[];
  installed: boolean;
  installed_path?: string;
  install_action: string;
  install_conflict: boolean;
}

export interface ModDiscoveryRequest {
  paths: string[];
}

export interface ModDiscoveryResponse {
  mods: ModInfoSchema[];
  scanned_paths: string[];
  diagnostics: DiagnosticSchema[];
}

// --- Stellaris Cache ---
export interface StellarisCacheItemSchema {
  path: string;
  type: string;
  size_bytes: number;
  reason: string;
}

export interface StellarisCachePreviewResponse {
  success: boolean;
  cache_path: string;
  items_to_delete: StellarisCacheItemSchema[];
  total_size_bytes: number;
  warnings: string[];
  errors: string[];
}

export interface StellarisCacheCleanResponse {
  success: boolean;
  cache_path: string;
  deleted_items: StellarisCacheItemSchema[];
  skipped_items: StellarisCacheItemSchema[];
  backup_path?: string;
  total_size_bytes: number;
  warnings: string[];
  errors: string[];
}

// --- Descriptors ---
export interface DescriptorReadResponse {
  name: string;
  path: string;
  supported_version: string;
  tags: string[];
  picture: string;
  remote_file_id: string;
  raw_fields: Record<string, string>;
  source_path?: string;
  descriptor_text: string;
  warnings: string[];
  errors: string[];
}

// --- Trace ---
export interface TraceEvent {
  id: string;
  job_id?: string;
  event_type: string;
  timestamp: string;
  severity?: 'info' | 'warn' | 'error' | 'debug';
  message?: string;
  data?: Record<string, unknown>;
  batch_index?: number;
}

export interface TraceSnapshot {
  job_id: string;
  status: string;
  current_batch_index: number;
  total_batches: number;
  processed_units: number;
  total_units: number;
  recent_events: TraceEvent[];
  current_activity?: string;
  stats?: TraceStats;
}

export interface TraceStats {
  total_events: number;
  unit_translated: number;
  retries: number;
  fallbacks: number;
  errors: number;
  failed_units?: number;
  cache_hits?: number;
}

export interface TraceUnitResponse {
  unit_id: string;
  file_path: string;
  key: string;
  source_text: string;
  translated_text: string;
  status: 'pending' | 'sent' | 'translated' | 'failed' | 'cached';
  error_message: string;
  batch_index: number;
  updated_at: string;
}

// --- System / Path Picker ---
export interface PathInfoRequest {
  path: string;
}

export interface PathInfoResponse {
  path: string;
  exists: boolean;
  is_file: boolean;
  is_directory: boolean;
  can_read: boolean;
  can_write: boolean;
  parent: string | null;
  name: string;
}

export interface ListDirectoryRequest {
  path: string;
  mode: 'files' | 'directories' | 'both';
  extensions?: string[];
  show_hidden?: boolean;
}

export interface DirectoryItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size_bytes: number | null;
  modified_at: string | null;
}

export interface ListDirectoryResponse {
  path: string;
  parent: string | null;
  items: DirectoryItem[];
  diagnostics: string[];
}

export interface HomeResponse {
  home: string;
}

export interface RevealPathRequest {
  path: string;
}

export interface RevealPathResponse {
  success: boolean;
  message: string;
}

// --- Games Options ---
export interface GameOption {
  id: string;
  label: string;
  vendor: string | null;
  features?: Record<string, boolean>;
  supports_mod_discovery: boolean;
  supports_descriptors: boolean;
  supports_install: boolean;
  file_handlers: string[];
}

export interface FileHandlerOption {
  id: string;
  label: string;
  extensions: string[];
  description: string;
}

export interface GamesOptionsResponse {
  games: GameOption[];
  file_handlers: FileHandlerOption[];
}

// --- Find Localisation ---
export interface FindLocalisationRequest {
  root_paths: string[];
}

export interface LocalisationFileInfo {
  path: string;
  file_type: string;
  language: string;
  translatable_entries: number;
}

export interface FindLocalisationResponse {
  files: LocalisationFileInfo[];
  diagnostics: string[];
}

// --- Translation Profiles ---
export interface TranslationProfile {
  id: string;
  name: string;
  description: string;
  game: string;
  file_handler: string | null;
  config: Record<string, unknown>;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileListResponse {
  profiles: TranslationProfile[];
  total: number;
}

export interface CreateProfileRequest {
  name: string;
  description?: string;
  game?: string;
  file_handler?: string | null;
  config?: Record<string, unknown>;
}

export interface UpdateProfileRequest {
  name?: string;
  description?: string;
  game?: string;
  file_handler?: string | null;
  config?: Record<string, unknown>;
}

export interface CopyProfileRequest {
  new_name: string;
}

export interface ValidateProfileRequest {
  name?: string;
  description?: string;
  game?: string;
  file_handler?: string | null;
  config?: Record<string, unknown>;
}

export interface ProfileDiagnostic {
  level: string;
  code: string;
  message: string;
  field: string;
}

export interface ValidateProfileResponse {
  is_valid: boolean;
  diagnostics: ProfileDiagnostic[];
}

export interface ImportProfileRequest {
  data: Record<string, unknown>;
}

// --- Storage Paths ---
export interface StoragePathsResponse {
  data_dir: string;
  config_path: string;
  secrets_path: string | null;
  profiles_path: string;
  prompt_presets_path: string;
  db_path: string;
  cache_path: string | null;
  trace_path: string | null;
  discovery_cache_path: string | null;
  raw_responses_dir: string | null;
  output_dir: string | null;
}

// --- Output Files ---
export interface OutputFileAnalysisSummary {
  id: string;
  status: string;
  compilability_score: number | null;
  placeholders_score: number | null;
  errors_count: number;
  warnings_count: number;
  created_at: string;
  source_hash: string | null;
  translated_hash: string | null;
}

export interface OutputFile {
  id: string;
  job_id: string;
  mod_id: string | null;
  mod_name: string | null;
  source_file_path: string;
  translated_file_path: string;
  relative_source_path: string | null;
  relative_translated_path: string | null;
  file_name: string;
  file_ext: string | null;
  game_id: string | null;
  parser_id: string | null;
  aggregation_key: string | null;
  group_key: string | null;
  group_label: string | null;
  source_size_bytes: number | null;
  translated_size_bytes: number | null;
  created_at: string;
  updated_at: string;
  last_analyzed_at: string | null;
  editor_available: boolean;
  status: string;
  analysis_stale: boolean;
  latest_analysis: OutputFileAnalysisSummary | null;
  latest_analysis_state: string;
  output_metadata: Record<string, unknown> | null;
}

export interface OutputFileListItem {
  id: string;
  file_name: string;
  source_file_name: string | null;
  source_file_path: string;
  relative_source_path: string | null;
  relative_translated_path: string | null;
  status: string;
}

export interface OutputFileListResponse {
  items: OutputFile[];
  total: number;
  limit: number;
  offset: number;
}

export interface OutputGroupNode {
  group_key: string;
  group_label: string;
  files: OutputFileListItem[];
}

export interface OutputModNode {
  mod_id: string;
  mod_name: string;
  groups: Record<string, OutputGroupNode>;
}

export interface OutputJobNode {
  job_id: string;
  mods: Record<string, OutputModNode>;
}

export interface OutputFileTreeResponse {
  jobs: Record<string, OutputJobNode>;
}

export interface OutputFilesSummaryResponse {
  files_count: number;
  mods_count: number;
  groups_count: number;
  analyzed_count: number;
  passed_count: number;
  warning_count: number;
  failed_count: number;
  error_count: number;
  missing_count: number;
  stale_count: number;
}

export interface ScanDiagnosticResponse {
  severity: string;
  code: string;
  message: string;
  path: string | null;
  details: Record<string, unknown> | null;
}

export interface OutputReindexRequest {
  force?: boolean;
}

export interface OutputScanResultResponse {
  job_id: string;
  scanned_count: number;
  indexed_count: number;
  updated_count: number;
  skipped_count: number;
  missing_source_count: number;
  errors_count: number;
  diagnostics: ScanDiagnosticResponse[];
  manifest_found: boolean;
  manifest_mode: string;
}

// --- Output File Analysis ---
export interface OutputAnalysisDiagnostic {
  severity: string;
  code: string;
  message: string;
  source: string;
  line: number | null;
  column: number | null;
  key: string | null;
  details: Record<string, unknown>;
}

export interface OutputAnalysisResult {
  id: string;
  output_file_id: string;
  job_id: string;
  analyzer_version: string;
  status: string;
  compilability_score: number | null;
  placeholders_score: number | null;
  errors_count: number;
  warnings_count: number;
  source_hash: string | null;
  translated_hash: string | null;
  diagnostics: OutputAnalysisDiagnostic[];
  created_at: string;
}

export interface OutputAnalyzeRequest {
  checks?: string[];
  save?: boolean;
}

export interface OutputBatchAnalyzeRequest {
  job_id?: string;
  mod_id?: string;
  group_key?: string;
  output_file_ids?: string[];
  checks?: string[];
  save?: boolean;
  only_stale?: boolean;
}

export interface OutputBatchAnalysisResult {
  requested_count: number;
  analyzed_count: number;
  skipped_count: number;
  passed_count: number;
  warning_count: number;
  failed_count: number;
  error_count: number;
  results: OutputAnalysisResult[];
}

// --- Output File Editor ---
export interface OutputEditorSourceFileInfo {
  path: string;
  relative_path: string | null;
  exists: boolean;
}

export interface OutputEditorTranslatedFileInfo {
  path: string;
  relative_path: string | null;
  exists: boolean;
}

export interface OutputEditorEntry {
  key: string;
  source_text: string;
  translated_text: string | null;
  source_line: number;
  translated_line: number;
  entry_type: string;
  translatable: boolean;
  metadata: Record<string, unknown>;
}

export interface OutputEditorMetadata {
  file_name: string;
  file_ext: string;
  source_size_bytes: number;
  translated_size_bytes: number;
  updated_at: string;
  status: string;
  analysis_stale: boolean;
  latest_analysis_state: string;
}

export interface OutputFileEditorPayload {
  output_file_id: string;
  job_id: string;
  source_file: OutputEditorSourceFileInfo;
  translated_file: OutputEditorTranslatedFileInfo;
  parser_id: string | null;
  game_id: string | null;
  source_content: string;
  translated_content: string;
  structured: boolean;
  entries: OutputEditorEntry[];
  metadata: OutputEditorMetadata;
}

export interface SaveTranslatedContentRequest {
  translated_content: string;
  expected_updated_at?: string;
}

export interface SaveTranslatedContentResponse {
  success: boolean;
  updated_at: string;
  translated_size_bytes: number;
  status: string;
  analysis_stale: boolean;
}

export interface FileContentsResponse {
  source_path: string;
  translated_path: string;
  source_content: string;
  translated_content: string;
  source_exists: boolean;
  translated_exists: boolean;
}

// --- Output Analysis Jobs (async) ---
export interface CreateOutputAnalysisJobRequest {
  scope_type: 'job' | 'mod' | 'group' | 'selected';
  job_id?: string;
  mod_id?: string;
  group_key?: string;
  output_file_ids?: string[];
  checks?: string[];
  only_stale?: boolean;
}

export interface OutputAnalysisJob {
  id: string;
  scope_type: string;
  scope: Record<string, unknown>;
  checks: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_count: number;
  processed_count: number;
  skipped_count: number;
  passed_count: number;
  warning_count: number;
  failed_count: number;
  error_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested: boolean;
  error_message: string | null;
}

export interface OutputAnalysisJobListResponse {
  items: OutputAnalysisJob[];
  total: number;
  limit: number;
  offset: number;
}

// --- Output Debug Types ---
export interface ManifestDebugInfo {
  manifest_path: string | null;
  manifest_mode: string;
  is_complete: boolean;
  missing_files: string[];
  undeclared_files: string[];
  files_declared: number;
  files_found: number;
}

export interface ScannerDebugInfo {
  manifest_mode: string;
  manifest_found: boolean;
  manifest_path: string | null;
  scan_diagnostics: Record<string, unknown>[];
  last_scan_event_id: string | null;
  last_scan_at: string | null;
}

export interface AnalysisDebugInfo {
  latest_analysis_id: string | null;
  latest_analysis_status: string | null;
  latest_analysis_at: string | null;
  analysis_source_hash: string | null;
  analysis_translated_hash: string | null;
  validity_state: string;
  diagnostics: Record<string, unknown>[];
  history_count: number;
}

export interface IntegrityDebugInfo {
  current_source_hash: string | null;
  current_translated_hash: string | null;
  analysis_source_hash: string | null;
  analysis_translated_hash: string | null;
  hash_match: boolean | null;
  file_exists_on_disk: boolean;
  source_exists_on_disk: boolean;
}

export interface AnalysisJobDebugInfo {
  job_id: string;
  scope_type: string;
  status: string;
  total_count: number;
  processed_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface OutputFileDebugSnapshot {
  file_id: string;
  job_id: string;
  file_name: string;
  relative_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_analyzed_at: string | null;
  current_source_hash: string | null;
  current_translated_hash: string | null;
  analysis_stale: boolean;
  stale_reason: string | null;
  latest_analysis_state: string;
  manifest: ManifestDebugInfo;
  scanner: ScannerDebugInfo;
  analysis: AnalysisDebugInfo;
  integrity: IntegrityDebugInfo;
  recent_analysis_jobs: AnalysisJobDebugInfo[];
}

export interface ScanEventResponse {
  id: string;
  job_id: string;
  output_root: string;
  manifest_mode: string;
  manifest_found: boolean;
  files_indexed: number;
  files_updated: number;
  files_skipped: number;
  files_missing_source: number;
  errors_count: number;
  diagnostics: Record<string, unknown>[];
  created_at: string;
}

export interface OutputAnalysisJobDebugResponse {
  analysis_job_id: string;
  linked_file_count: number;
  linked_file_ids: string[];
}

// --- Runtime Raw Log (ephemeral, in-memory, no DB persistence)
export interface RuntimeRawLogLine {
  ts: string;
  level: string;
  message: string;
}

export interface RuntimeRawLogResponse {
  job_id: string;
  lines: RuntimeRawLogLine[];
  count: number;
}

// --- Draft Job Selection ---
export interface DraftJobSelectionState {
  files: string[];
  file_metadata: Record<string, Record<string, unknown>>;
  count: number;
}

export interface AddDraftFilesRequest {
  file_paths: string[];
  metadata?: Record<string, unknown>;
}

export interface RemoveDraftFilesRequest {
  file_paths: string[];
}

export interface SetDraftFilesRequest {
  files: string[];
  file_metadata?: Record<string, Record<string, unknown>>;
}
