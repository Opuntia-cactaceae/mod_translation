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
export interface ProtectionRule {
  id: string;
  name: string;
  pattern: string;
  rule_kind: string;
  token_type: string;
  enabled: boolean;
  priority: number;
  description?: string;
}

export interface ProtectionRuleSet {
  id: string;
  name: string;
  description?: string;
  builtin: boolean;
  enabled: boolean;
  rules?: ProtectionRule[];
  rule_count?: number;
}

export interface TranslationOptionsResponse {
  providers: string[];
  prompt_profiles: string[];
  protection_strategies: string[];
  validators: string[];
  rule_sets?: ProtectionRuleSet[];
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
  rule_set_ids?: string[];
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
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string;
  file_paths: string[];
  output_files: string[];
  output_file_refs?: Array<{ id: string; path: string }>;
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
  /**
   * When True and file_paths is empty, backend fills paths from the draft
   * job selection state.  If draft is also empty, returns a validation error.
   */
  use_draft_selection?: boolean;
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
  completed_at?: string | null;
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
  self_installed?: boolean;
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
  name?: string;
  mods: Record<string, OutputModNode>;
}

export interface JobTimestampInfo {
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface OutputFileTreeResponse {
  jobs: Record<string, OutputJobNode>;
  job_timestamps: Record<string, JobTimestampInfo>;
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

export interface DraftSelectionFile {
  path: string;
  name: string;
  relative_path?: string;
  parent_folder?: string;
  source?: 'mod' | 'search' | 'manual' | 'raw';
  mod_id?: string;
  mod_name?: string;
  handler?: string;
  exists: boolean;
  selected: boolean;
}

export interface DraftSelectionGroup {
  group_type: 'mod' | 'folder';
  group_id: string;
  title: string;
  subtitle?: string;
  files?: DraftSelectionFile[];
  children?: DraftSelectionGroup[];
}

export interface DraftJobSelectionState {
  files: string[];
  file_metadata: Record<string, Record<string, unknown>>;
  grouped: DraftSelectionGroup[];
  diagnostics: Array<{ level: string; code: string; message: string; details?: Record<string, unknown> }>;
  count: number;
  updated_at?: string;
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

export interface SetDraftFilesFromRawRequest {
  paths_text: string;
  source: string;
}

export interface AddModFilesRequest {
  mod_ids?: string[];
  mod_paths?: string[];
  handler: string;
  language: string;
}

export interface SearchFilesRequest {
  roots: string[];
  handler: string;
  language: string;
  add: boolean;
}

// --- Editor Session ---

export interface EditorSessionSourceFileInfo {
  path: string;
  relative_path: string | null;
  exists: boolean;
}

export interface EditorSessionTranslatedFileInfo {
  path: string;
  relative_path: string | null;
  exists: boolean;
}

export interface EditorSessionEntry {
  key: string;
  source_text: string;
  translated_text: string | null;
  source_line: number;
  translated_line: number;
  entry_type: string;
  translatable: boolean;
  metadata: Record<string, unknown>;
}

export interface EditorSessionMetadata {
  file_name: string;
  file_ext: string;
  source_size_bytes: number;
  translated_size_bytes: number;
  updated_at: string;
  status: string;
  analysis_stale: boolean;
  latest_analysis_state: string;
}

export interface EditorSessionState {
  output_file_id: string;
  job_id: string;
  source_file: EditorSessionSourceFileInfo;
  translated_file: EditorSessionTranslatedFileInfo;
  parser_id: string | null;
  game_id: string | null;
  source_content: string;
  translated_text: string;
  entries: EditorSessionEntry[];
  structured: boolean;
  revision: number;
  dirty: boolean;
  metadata: EditorSessionMetadata;
}

export interface SessionUpdateEntryRequest {
  translated_text: string;
}

export interface SessionUpdateEntryResponse {
  translated_text: string;
  entry: EditorSessionEntry;
  revision: number;
  dirty: boolean;
  entries: EditorSessionEntry[];
}

export interface UpdateRawTextRequest {
  translated_text: string;
}

export interface UpdateRawTextResponse {
  translated_text: string;
  entries: EditorSessionEntry[];
  revision: number;
  dirty: boolean;
  structured: boolean;
  parse_error?: string;
}

export interface SessionSaveFileResponse {
  success: boolean;
  updated_at: string;
  translated_size_bytes: number;
  status: string;
  analysis_stale: boolean;
  revision: number;
  dirty: boolean;
}

// ------------------------------------------------------------------ //
// Provider Models
// ------------------------------------------------------------------ //

export interface ProviderModelEntry {
  id: string;
  provider: string;
  model_id: string;
  display_name?: string | null;
  description?: string | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
  tags: string[];
  is_enabled: boolean;
  is_builtin: boolean;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateProviderModelRequest {
  provider: string;
  model_id: string;
  display_name?: string | null;
  description?: string | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
  tags?: string[];
  is_enabled?: boolean;
  sort_order?: number;
}

export interface UpdateProviderModelRequest {
  display_name?: string | null;
  description?: string | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
  tags?: string[];
  is_enabled?: boolean;
  sort_order?: number;
}

export interface ProviderLink {
  title: string;
  url: string;
}

export interface ProviderGroup {
  provider: string;
  links: ProviderLink[];
  models: ProviderModelEntry[];
}

export interface ProviderModelsResponse {
  providers: Record<string, ProviderGroup>;
}

export interface ResetDefaultsResponse {
  providers: Record<string, ProviderGroup>;
  message: string;
}

// ------------------------------------------------------------------ //
// Protection Rule Validation
// ------------------------------------------------------------------ //

export interface ValidateRuleRequest {
  pattern: string;
  rule_kind: string;
  token_type: string;
  flags?: string[];
  opener_pattern?: string;
  closer_pattern?: string;
  sample_texts?: string[];
}

export interface RuleValidationDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  field?: string;
}

export interface RuleValidationResponse {
  is_valid: boolean;
  diagnostics: RuleValidationDiagnostic[];
}

// ------------------------------------------------------------------ //
// Protection Rules
// ------------------------------------------------------------------ //

export interface CustomProtectionRuleSchema {
  id: string;
  name: string;
  pattern: string;
  rule_kind: string;
  token_type: string;
  description?: string;
  enabled: boolean;
  priority: number;
  flags?: string[];
  opener_pattern?: string;
  closer_pattern?: string;
  sample_text?: string;
  last_validation_error?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateRuleRequest {
  name: string;
  pattern: string;
  rule_kind?: string;
  token_type?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  flags?: string[];
  opener_pattern?: string;
  closer_pattern?: string;
  sample_text?: string;
}

export interface UpdateRuleRequest {
  name?: string;
  pattern?: string;
  rule_kind?: string;
  token_type?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  flags?: string[];
  opener_pattern?: string;
  closer_pattern?: string;
  sample_text?: string;
}

export interface PreviewRequest {
  pattern: string;
  sample_text: string;
  flags?: string[];
}

export interface PreviewMatch {
  index: number;
  start: number;
  end: number;
  matched_text: string;
  length: number;
}

export interface PreviewResponse {
  matches: PreviewMatch[];
  match_count: number;
  error?: string;
}

// --- Protection Analysis ---

export interface ProtectionAnalysisSample {
  source_text: string;
  translations?: Record<string, string>;
}

export interface ProtectionAnalysisInput {
  samples: ProtectionAnalysisSample[];
}

export interface ProtectionCandidate {
  text: string;
  start: number;
  end: number;
  probability: number;
  supporting_methods: string[];
  features: Record<string, number>;
  suggested_pattern: string;
  sample_index: number;
  rule_kind: string;
  token_type: string;
  opener_pattern: string;
  closer_pattern: string;
}

export interface ProtectionAnalysisSummary {
  total_candidates: number;
  top_probability: number;
  avg_probability: number;
  sample_count: number;
}

export interface ProtectionAnalysisResult {
  candidates: ProtectionCandidate[];
  summary: ProtectionAnalysisSummary;
}

// --- Grouped Protection Analysis ---

export interface GroupedCandidate {
  candidate_text: string;
  normalized_form: string;
  occurrence_count: number;
  sample_count: number;
  max_probability: number;
  avg_probability: number;
  supporting_methods: string[];
  suggested_pattern: string;
  pattern_confidence: string;
  examples: string[];
  features_summary: Record<string, number>;
  rule_kind: string;
  token_type: string;
  opener_pattern: string;
  closer_pattern: string;
}

export interface GroupedAnalysisResult {
  grouped_candidates: GroupedCandidate[];
  total_candidates: number;
  total_grouped: number;
  sample_count: number;
  top_probability: number;
  avg_probability: number;
  raw_candidates: ProtectionCandidate[];
}

// Protection Profiles & Learning
export interface ProtectionProfileSchema {
  id: string;
  name: string;
  description?: string;
  game_id?: string | null;
  mod_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProfileRequest {
  name: string;
  description?: string;
  game_id?: string | null;
  mod_id?: string | null;
}

export interface LearnResponse {
  samples_added: number;
  candidates_new: number;
  candidates_updated: number;
  total_candidates: number;
}

export interface LearnedCandidateSchema {
  id: string;
  profile_id: string;
  text: string;
  normalized_text: string;
  suggested_pattern: string;
  confidence: string;
  status: 'suggested' | 'accepted' | 'rejected' | 'ignored';
  occurrence_count: number;
  sample_count: number;
  max_probability: number;
  avg_probability: number;
  rule_kind: string;
  token_type: string;
  opener_pattern: string;
  closer_pattern: string;
  supporting_methods: string[];
  features: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface CandidateStatusUpdate {
  status: 'suggested' | 'accepted' | 'rejected' | 'ignored';
}

export interface ProfileCandidatesResponse {
  candidates: LearnedCandidateSchema[];
  total_count: number;
}

// --- Batch rule creation from candidates ---

export interface CreateRulesFromCandidatesRequest {
  candidate_ids?: string[];
  status_filter?: 'accepted';
  default_enabled?: boolean;
  priority_start?: number;
  name_prefix?: string;
  skip_existing?: boolean;
}

export interface CreatedRuleInfo {
  rule_id: string;
  rule_name: string;
  pattern: string;
  candidate_id: string;
}

export interface SkippedCandidateInfo {
  candidate_id: string;
  reason: string;
}

export interface CreateRulesFromCandidatesResponse {
  created_count: number;
  skipped_count: number;
  created_rules: CreatedRuleInfo[];
  skipped_candidates: SkippedCandidateInfo[];
}

// --- File Source Learning (backend-first) ---

export interface FileSourceMod {
  mod_id: string;
  name: string;
  path: string;
  game_id: string;
}

export interface FileSourceRoot {
  root_id: string;
  label: string;
  path: string;
  exists: boolean;
}

export interface FileSourceItem {
  source_type: string;
  label: string;
  mods: FileSourceMod[];
  roots: FileSourceRoot[];
  message?: string;
}

export interface FileSourcesResponse {
  sources: FileSourceItem[];
}

export interface FileSourcePreviewRequest {
  source_type: string;
  mod_ids?: string[];
  roots?: string[];
  root_ids?: string[];
  include_translated_outputs?: boolean;
}

export interface PreviewSourceFile {
  id: string;
  path: string;
  relative_path: string;
  file_name: string;
  file_type: string;
  estimated_entries: number;
  language?: string;
  mod_id?: string;
  mod_name?: string;
}

export interface PreviewTranslatedFile {
  id: string;
  path: string;
  relative_path: string;
  file_name: string;
  mod_id?: string;
  mod_name?: string;
}

export interface SuggestedPair {
  source_file_id: string;
  translated_file_id: string;
  confidence: number;
}

export interface FileSourcePreviewResponse {
  source_files: PreviewSourceFile[];
  translated_files: PreviewTranslatedFile[];
  suggested_pairs: SuggestedPair[];
  warnings: string[];
}

export interface AnalyzeFilesRequest {
  source_file_ids: string[];
  translated_file_ids?: string[];
  profile_id?: string;
  max_samples?: number;
}

export interface FileAnalysisProvenance {
  source_type: string;
  source_mods: string[];
  source_files: string[];
  analysis_mode: string;
}

export interface AnalyzeFilesResponse {
  samples_added: number;
  candidates_new: number;
  candidates_updated: number;
  total_candidates: number;
  files_processed: number;
  files_skipped: number;
  errors: string[];
  provenance: FileAnalysisProvenance;
  profile_id?: string;
}

// ------------------------------------------------------------------ //
// Protection Rule Set CRUD
// ------------------------------------------------------------------ //

export interface CreateRuleSetRequest {
  name: string;
  description?: string;
}

export interface UpdateRuleSetRequest {
  name?: string;
  description?: string;
  enabled?: boolean;
}

export interface CreateRuleInSetRequest {
  name: string;
  pattern: string;
  rule_kind?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  token_type?: string;
  flags?: string[];
  opener_pattern?: string;
  closer_pattern?: string;
}

export interface UpdateRuleInSetRequest {
  name?: string;
  pattern?: string;
  rule_kind?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  token_type?: string;
  flags?: string[];
  opener_pattern?: string;
  closer_pattern?: string;
}

// ------------------------------------------------------------------ //
// Pairing Projects
// ------------------------------------------------------------------ //

export interface PairingProject {
  id: string;
  name: string;
  root_path: string;
  source_language?: string | null;
  target_language?: string | null;
  created_at: string;
  updated_at: string;
  last_scanned_at?: string | null;
  status: string;
  notes?: string | null;
}

export interface CreatePairingProjectRequest {
  name: string;
  root_path: string;
  source_language?: string | null;
  target_language?: string | null;
  notes?: string | null;
}

export interface UpdatePairingProjectRequest {
  name?: string;
  status?: string;
  notes?: string | null;
  root_path?: string;
  source_language?: string | null;
  target_language?: string | null;
}

export interface ScanResponse {
  project_id: string;
  total_files: number;
  new_files: number;
  updated_files: number;
  ignored_files: number;
}

export interface PairingProjectFile {
  id: string;
  project_id: string;
  relative_path: string;
  file_name: string;
  extension: string;
  parent_dir: string;
  size_bytes: number;
  content_hash?: string | null;
  modified_at?: string | null;
  detected_language?: string | null;
  detected_role: string;
  group_key?: string | null;
  is_ignored: boolean;
  created_at: string;
  updated_at: string;
}

export interface FileContentResponse {
  file_id: string;
  relative_path: string;
  content: string;
  encoding: string;
  line_count: number;
  content_hash?: string | null;
  modified_at?: string | null;
  size_bytes: number;
}

export interface FileGroupResponse {
  group_key: string;
  display_name: string;
  relative_dir: string;
  files_count: number;
  source_like_count: number;
  translated_like_count: number;
  children: FileGroupResponse[];
  files: PairingProjectFile[];
}

export interface PairingProjectPair {
  id: string;
  project_id: string;
  source_file_id?: string | null;
  translated_file_id?: string | null;
  source_file?: PairingProjectFile | null;
  translated_file?: PairingProjectFile | null;
  status: string;
  confidence: number;
  reason?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  notes?: string | null;
}

export interface CreatePairRequest {
  source_file_id?: string | null;
  translated_file_id?: string | null;
  notes?: string | null;
}

export interface UpdatePairRequest {
  source_file_id?: string | null;
  translated_file_id?: string | null;
  status?: string;
  notes?: string | null;
}

export interface PairPreviewResponse {
  pair: PairingProjectPair;
  source_file?: FileContentResponse | null;
  translated_file?: FileContentResponse | null;
}

export interface PairSuggestionResponse {
  source_file_id: string;
  translated_file_id: string;
  confidence: number;
  reason: string;
}

export interface AlignmentResponse {
  id: string;
  pair_id: string;
  mode: string;
  source_revision_hash?: string | null;
  translated_revision_hash?: string | null;
  operations_json: string;
  created_at: string;
  updated_at: string;
}

export interface SaveAlignmentRequest {
  operations_json: string;
  source_revision_hash?: string | null;
  translated_revision_hash?: string | null;
}

export interface NormalizationOperation {
  type: string;
  max?: number;
  size?: number;
}

export interface PreviewAlignmentRequest {
  operations: NormalizationOperation[];
}

export interface AlignmentPreviewResponse {
  pair_id: string;
  operations: NormalizationOperation[];
  source_preview?: Record<string, unknown> | null;
  translated_preview?: Record<string, unknown> | null;
}

export interface LearnFromPairsRequest {
  profile_id: string;
  pair_ids?: string[] | null;
  include_accepted_pairs: boolean;
  include_manual_pairs: boolean;
  use_alignment: boolean;
}

export interface LearnFromPairsResponse {
  profile_id: string;
  samples_collected: number;
  samples_added: number;
  candidates_new: number;
  candidates_updated: number;
  total_candidates: number;
  files_processed: number;
  error?: string | null;
}
