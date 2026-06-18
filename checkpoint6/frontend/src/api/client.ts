/* ------------------------------------------------------------------ */
/*  Typed API client                                                    */
/* ------------------------------------------------------------------ */
import type {
  HealthResponse,
  AppStateResponse,
  ProtectionRule,
  ProtectionRuleSet,
  ValidateRuleRequest,
  RuleValidationResponse,
  SettingsResponse,
  SettingsUpdateRequest,
  ValidatePathRequest,
  ValidatePathResponse,
  ApiKeyListResponse,
  ApiKeyCreateRequest,
  ApiKeyResponse,
  DeleteKeyResponse,
  TestKeyRequest,
  TestKeyResponse,
  FileListRequest,
  FileListResponse,
  FileReadResponse,
  PreviewOutputPathRequest,
  PreviewOutputPathResponse,
  TranslationOptionsResponse,
  ValidateConfigRequest,
  ValidateConfigResponse,
  PreviewConfigResponse,
  PreviewPromptRequest,
  PreviewPromptResponse,
  EffectivePromptRequest,
  EffectivePromptResponse,
  TranslationPlanPreviewRequest,
  TranslationPlanPreviewResponse,
  JobResponse,
  JobSummaryResponse,
  CreateJobRequest,
  JobActionResponse,
  UpdateConfigRequest,
  CacheStatsResponse,
  CacheClearResponse,
  ModDiscoveryRequest,
  ModDiscoveryResponse,
  DescriptorReadResponse,
  StellarisCachePreviewResponse,
  StellarisCacheCleanResponse,
  TraceEvent,
  TraceSnapshot,
  TraceStats,
  TraceUnitResponse,
  ErrorResponse,
  FindLocalisationRequest,
  FindLocalisationResponse,
  PathInfoRequest,
  PathInfoResponse,
  ListDirectoryRequest,
  ListDirectoryResponse,
  HomeResponse,
  RevealPathRequest,
  RevealPathResponse,
  GamesOptionsResponse,
  TranslationProfile,
  ProfileListResponse,
  CreateProfileRequest,
  UpdateProfileRequest,
  CopyProfileRequest,
  ValidateProfileRequest,
  ValidateProfileResponse,
  ImportProfileRequest,
  StoragePathsResponse,
  OutputFileListResponse,
  OutputFileTreeResponse,
  OutputFile,
  OutputFilesSummaryResponse,
  OutputReindexRequest,
  OutputScanResultResponse,
  FileContentsResponse,
  OutputAnalysisResult,
  OutputAnalyzeRequest,
  OutputBatchAnalyzeRequest,
  OutputBatchAnalysisResult,
  CreateOutputAnalysisJobRequest,
  OutputAnalysisJob,
  OutputAnalysisJobListResponse,
  OutputFileDebugSnapshot,
  ScanEventResponse,
  OutputAnalysisJobDebugResponse,
  DraftJobSelectionState,
  AddDraftFilesRequest,
  RemoveDraftFilesRequest,
  SetDraftFilesRequest,
  SetDraftFilesFromRawRequest,
  AddModFilesRequest,
  SearchFilesRequest,
  RuntimeRawLogLine,
  RuntimeRawLogResponse,
  EditorSessionState,
  SessionUpdateEntryRequest,
  SessionUpdateEntryResponse,
  UpdateRawTextRequest,
  UpdateRawTextResponse,
  SessionSaveFileResponse,
  ProviderModelsResponse,
  ProviderGroup,
  ProviderModelEntry,
  CreateProviderModelRequest,
  UpdateProviderModelRequest,
  ResetDefaultsResponse,
  ProtectionAnalysisInput,
  ProtectionAnalysisResult,
  GroupedAnalysisResult,
  CreateRulesFromCandidatesRequest,
  CreateRulesFromCandidatesResponse,
  CustomProtectionRuleSchema,
  CreateRuleRequest,
  UpdateRuleRequest,
  PreviewRequest,
  PreviewResponse,
  ProtectionProfileSchema,
  LearnResponse,
  ProfileCandidatesResponse,
  CandidateStatusUpdate,
  LearnedCandidateSchema,
  FileSourcesResponse,
  FileSourcePreviewRequest,
  FileSourcePreviewResponse,
  AnalyzeFilesRequest,
  AnalyzeFilesResponse,
  CreateRuleSetRequest,
  UpdateRuleSetRequest,
  CreateRuleInSetRequest,
  UpdateRuleInSetRequest,
  PairingProject,
  CreatePairingProjectRequest,
  UpdatePairingProjectRequest,
  ScanResponse,
  PairingProjectFile,
  FileContentResponse,
  FileGroupResponse,
  PairingProjectPair,
  CreatePairRequest,
  UpdatePairRequest,
  PairPreviewResponse,
  PairSuggestionResponse,
  SuggestFilterScope,
  SuggestPairsRequest,
  AlignmentResponse,
  SaveAlignmentRequest,
  SavePairingFileContentRequest,
  SavePairingFileContentResponse,
  PreviewAlignmentRequest,
  AlignmentPreviewResponse,
  ApplyAlignmentRequest,
  ApplyAlignmentResponse,
  LearnFromPairsRequest,
  LearnFromPairsResponse,
  BulkDeleteRequest,
  BulkDeleteResponse,
  BulkUpdateRequest,
  BulkUpdateResponse,
  FindIdenticalRequest,
  FindIdenticalResponse,
  PreviewFilenameRequest,
  PreviewFilenameResponse,
  ExactLineMatchPreviewRequest,
  ExactLineMatchPreviewResponse,
  ExactLineMatchDeleteRequest,
  ExactLineMatchDeleteResponse,
  TransferExportOptionsResponse,
  TransferCreateExportPackageRequest,
  TransferImportPreviewRequest,
  TransferImportPreviewResponse,
  TransferImportApplyRequest,
  TransferImportApplyResponse,
} from './types';

const BASE_URL = '/api';

class ApiError extends Error {
  code: string;
  details: Record<string, unknown>;
  recoverable: boolean;

  constructor(err: ErrorResponse['error']) {
    super(err.message);
    this.code = err.code;
    this.details = err.details;
    this.recoverable = err.recoverable;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let errPayload: ErrorResponse | null = null;
    try {
      errPayload = await res.json() as ErrorResponse;
    } catch {
      // ignore parse errors
    }
    if (errPayload?.error) {
      throw new ApiError(errPayload.error);
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------ //
//  Client                                                             //
// ------------------------------------------------------------------ //

export const api = {
  // Health
  getHealth: () => request<HealthResponse>('GET', '/health'),

  // App state
  getAppState: () => request<AppStateResponse>('GET', '/app-state'),

  // Settings
  getSettings: () => request<SettingsResponse>('GET', '/settings'),
  updateSettings: (data: SettingsUpdateRequest) => request<SettingsResponse>('PUT', '/settings', data),
  validatePath: (data: ValidatePathRequest) => request<ValidatePathResponse>('POST', '/settings/validate-path', data),

  // Secrets
  listApiKeys: () => request<ApiKeyListResponse>('GET', '/secrets/api-keys'),
  createApiKey: (data: ApiKeyCreateRequest) => request<ApiKeyResponse>('POST', '/secrets/api-keys', data),
  deleteApiKey: (keyId: string) => request<DeleteKeyResponse>('DELETE', `/secrets/api-keys/${keyId}`),
  testApiKey: (data: TestKeyRequest) => request<TestKeyResponse>('POST', '/secrets/test-key', data),

  // Files
  listFiles: (data: FileListRequest) => request<FileListResponse>('POST', '/files/list', data),
  readFile: (data: { path: string }) => request<FileReadResponse>('POST', '/files/read', data),
  previewOutputPath: (data: PreviewOutputPathRequest) => request<PreviewOutputPathResponse>('POST', '/files/preview-output-path', data),

  // Translation config
  getTranslationOptions: () => request<TranslationOptionsResponse>('GET', '/translation-config/options'),
  validateConfig: (data: ValidateConfigRequest) => request<ValidateConfigResponse>('POST', '/translation-config/validate', data),
  previewConfig: (data: PreviewConfigResponse) => request<PreviewConfigResponse>('POST', '/translation-config/preview', data),
  previewPrompt: (data: PreviewPromptRequest) => request<PreviewPromptResponse>('POST', '/translation-config/preview-prompt', data),
  effectivePrompt: (data: EffectivePromptRequest) => request<EffectivePromptResponse>('POST', '/translation-config/effective-prompt', data),

  // Translation plan
  previewTranslationPlan: (data: TranslationPlanPreviewRequest) => request<TranslationPlanPreviewResponse>('POST', '/translation-plan/preview', data),

  // Jobs
  listJobs: () => request<JobResponse[]>('GET', '/translation-jobs'),
  getJobsSummary: () => request<{ jobs: JobSummaryResponse[] }>('GET', '/translation-jobs/summary'),
  getJob: (jobId: string) => request<JobResponse>('GET', `/translation-jobs/${jobId}`),
  createJob: (data: CreateJobRequest) => request<JobResponse>('POST', '/translation-jobs', data),
  startJob: (jobId: string) => request<JobActionResponse>('POST', `/translation-jobs/${jobId}/start`),
  pauseJob: (jobId: string) => request<JobActionResponse>('POST', `/translation-jobs/${jobId}/pause`),
  resumeJob: (jobId: string) => request<JobActionResponse>('POST', `/translation-jobs/${jobId}/resume`),
  cancelJob: (jobId: string) => request<JobActionResponse>('POST', `/translation-jobs/${jobId}/cancel`),
  updateJobConfig: (jobId: string, data: UpdateConfigRequest) => request<JobActionResponse>('POST', `/translation-jobs/${jobId}/update-config`, data),
  retryFailed: (jobId: string) => request<JobActionResponse>('POST', `/translation-jobs/${jobId}/retry-failed`),
  restartJob: (jobId: string) => request<JobActionResponse>('POST', `/translation-jobs/${jobId}/restart`),

  // Cache
  getCacheStats: () => request<CacheStatsResponse>('GET', '/cache/stats'),
  clearCache: () => request<CacheClearResponse>('POST', '/cache/clear'),

  // Mods discovery
  discoverMods: (data: ModDiscoveryRequest) => request<ModDiscoveryResponse>('POST', '/mods/discover', data),
  getDiscoveredMods: () => request<ModDiscoveryResponse>('GET', '/mods/discovered'),

  // Mod install
  previewInstall: (data: { source_path: string; target_dir: string; mode?: string; overwrite?: boolean }) =>
    request<{ operation: string; conflict: boolean; estimated_files: number }>('POST', '/mods/install/preview', data),
  installMod: (data: { source_path: string; target_dir: string; mode?: string; overwrite?: boolean; backup_on_overwrite?: boolean }) =>
    request<{ success: boolean; files_copied: number; warnings: string[]; errors: string[]; backup_path?: string }>('POST', '/mods/install', data),

  // Descriptors
  readDescriptor: (params: { path: string }) => request<DescriptorReadResponse>('GET', `/descriptors/read?path=${encodeURIComponent(params.path)}`),
  validateDescriptor: (data: { descriptor_path: string }) => request<{ is_valid: boolean; warnings: string[]; errors: string[] }>('POST', '/descriptors/validate', data),

  // Stellaris cache
  previewCleanCache: () => request<StellarisCachePreviewResponse>('GET', '/stellaris-cache/preview-clean'),
  cleanCache: (data: { cache_path: string; mode?: string; backup?: boolean }) =>
    request<StellarisCacheCleanResponse>('POST', '/stellaris-cache/clean', data),

  // Trace
  getTraceEvents: (jobId: string) => request<TraceEvent[]>('GET', `/translation-trace/jobs/${jobId}/events`),
  getTraceSnapshot: (jobId: string) => request<TraceSnapshot>('GET', `/translation-trace/jobs/${jobId}/snapshot`),
  getTraceStats: (jobId: string) => request<TraceStats>('GET', `/translation-trace/jobs/${jobId}/stats`),
  getRecentTraceEvents: () => request<TraceEvent[]>('GET', '/translation-trace/recent'),
  getTraceUnits: (jobId: string, limit?: number) =>
    request<TraceUnitResponse[]>('GET', `/translation-trace/jobs/${jobId}/units${limit ? `?limit=${limit}` : ''}`),
  getTraceBatchUnits: (jobId: string, batchNo: number) =>
    request<TraceUnitResponse[]>('GET', `/translation-trace/jobs/${jobId}/batches/${batchNo}/units`),
  getTraceRuntimeEvents: (jobId: string, limit?: number) =>
    request<TraceEvent[]>('GET', `/translation-trace/jobs/${jobId}/runtime-events${limit ? `?limit=${limit}` : ''}`),
  getRuntimeRawLog: (jobId: string) =>
    request<RuntimeRawLogResponse>('GET', `/translation-trace/jobs/${jobId}/runtime-raw-log`),

  // Files - find localisation
  findLocalisationFiles: (data: FindLocalisationRequest) => request<FindLocalisationResponse>('POST', '/files/find-localisation', data),

  // Games Options
  getGameOptions: () => request<GamesOptionsResponse>('GET', '/games/options'),

  // Translation Profiles
  listProfiles: () => request<ProfileListResponse>('GET', '/translation-profiles'),
  getProfile: (profileId: string) => request<TranslationProfile>('GET', `/translation-profiles/${profileId}`),
  createProfile: (data: CreateProfileRequest) => request<TranslationProfile>('POST', '/translation-profiles', data),
  updateProfile: (profileId: string, data: UpdateProfileRequest) => request<TranslationProfile>('PUT', `/translation-profiles/${profileId}`, data),
  deleteProfile: (profileId: string) => request<{ deleted: boolean }>('DELETE', `/translation-profiles/${profileId}`),
  copyProfile: (profileId: string, data: CopyProfileRequest) => request<TranslationProfile>('POST', `/translation-profiles/${profileId}/copy`, data),
  validateProfile: (data: ValidateProfileRequest) => request<ValidateProfileResponse>('POST', '/translation-profiles/validate', data),
  exportProfile: (profileId: string) => request<Record<string, unknown>>('GET', `/translation-profiles/${profileId}/export`),
  importProfile: (data: ImportProfileRequest) => request<TranslationProfile>('POST', '/translation-profiles/import', data),
  cleanupDuplicateProfiles: () => request<{ removed: number; remaining: number }>('POST', '/translation-profiles/cleanup-duplicates'),

  // System / Path Picker
  pathInfo: (data: PathInfoRequest) => request<PathInfoResponse>('POST', '/system/path-info', data),
  listDirectory: (data: ListDirectoryRequest) => request<ListDirectoryResponse>('POST', '/system/list-directory', data),
  getHome: () => request<HomeResponse>('GET', '/system/home'),
  revealPath: (data: RevealPathRequest) => request<RevealPathResponse>('POST', '/system/reveal-path', data),

  // Storage Paths
  getStoragePaths: () => request<StoragePathsResponse>('GET', '/storage/paths'),

  // Output Files
  listOutputFiles: (params?: { job_id?: string; mod_id?: string; group_key?: string; status?: string; q?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.job_id) searchParams.set('job_id', params.job_id);
    if (params?.mod_id) searchParams.set('mod_id', params.mod_id);
    if (params?.group_key) searchParams.set('group_key', params.group_key);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.q) searchParams.set('q', params.q);
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return request<OutputFileListResponse>('GET', `/output-files${qs ? `?${qs}` : ''}`);
  },
  getOutputFilesTree: (params?: { job_id?: string }) => {
    const qs = params?.job_id ? `?job_id=${encodeURIComponent(params.job_id)}` : '';
    return request<OutputFileTreeResponse>('GET', `/output-files/tree${qs}`);
  },
  getOutputFile: (outputFileId: string) => request<OutputFile>('GET', `/output-files/${outputFileId}`),
  getJobOutputsSummary: (jobId: string) => request<OutputFilesSummaryResponse>('GET', `/translation-jobs/${jobId}/outputs-summary`),
  reindexJobOutputs: (jobId: string, body?: OutputReindexRequest) =>
    request<OutputScanResultResponse>('POST', `/translation-jobs/${jobId}/outputs/reindex`, body || {}),

  getFileContents: (outputFileId: string) =>
    request<FileContentsResponse>('GET', `/output-files/${outputFileId}/file-contents`),

  // Output File Analysis
  analyzeOutputFile: (outputFileId: string, data?: OutputAnalyzeRequest) =>
    request<OutputAnalysisResult>('POST', `/output-files/${outputFileId}/analyze`, data || {}),
  analyzeOutputFilesBatch: (data: OutputBatchAnalyzeRequest) =>
    request<OutputBatchAnalysisResult>('POST', '/output-files/analyze-batch', data),
  getOutputFileLatestAnalysis: (outputFileId: string) =>
    request<OutputAnalysisResult | null>('GET', `/output-files/${outputFileId}/analysis/latest`),
  getOutputFileAnalysisHistory: (outputFileId: string, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString();
    return request<OutputAnalysisResult[]>('GET', `/output-files/${outputFileId}/analysis/history${qs ? `?${qs}` : ''}`);
  },

  // Output Analysis Jobs (async)
  createOutputAnalysisJob: (data: CreateOutputAnalysisJobRequest) =>
    request<OutputAnalysisJob>('POST', '/output-analysis-jobs', data),
  listOutputAnalysisJobs: (params?: { status?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return request<OutputAnalysisJobListResponse>('GET', `/output-analysis-jobs${qs ? `?${qs}` : ''}`);
  },
  getOutputAnalysisJob: (jobId: string) =>
    request<OutputAnalysisJob>('GET', `/output-analysis-jobs/${jobId}`),
  cancelOutputAnalysisJob: (jobId: string) =>
    request<OutputAnalysisJob>('POST', `/output-analysis-jobs/${jobId}/cancel`),
  startOutputAnalysisJob: (jobId: string) =>
    request<OutputAnalysisJob>('POST', `/output-analysis-jobs/${jobId}/start`),

  // Output File Open Folder
  openSourceFolder: (outputFileId: string) =>
    request<{ success: boolean; message: string }>('POST', `/output-files/${outputFileId}/open-source-folder`),
  openTranslatedFolder: (outputFileId: string) =>
    request<{ success: boolean; message: string }>('POST', `/output-files/${outputFileId}/open-translated-folder`),

  // Output Debug
  getOutputFileDebug: (outputFileId: string) =>
    request<OutputFileDebugSnapshot>('GET', `/output-files/${outputFileId}/debug`),
  getOutputFileScanHistory: (outputFileId: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : '';
    return request<ScanEventResponse[]>('GET', `/output-files/${outputFileId}/scan-history${qs}`);
  },
  getOutputAnalysisJobDebug: (analysisJobId: string) =>
    request<OutputAnalysisJobDebugResponse>('GET', `/output-analysis-jobs/${analysisJobId}/debug`),

  // Draft Job Selection
  getDraftJobSelection: () => request<DraftJobSelectionState>('GET', '/draft-job-selection'),
  addDraftFiles: (data: AddDraftFilesRequest) => request<DraftJobSelectionState>('POST', '/draft-job-selection/files', data),
  removeDraftFiles: (data: RemoveDraftFilesRequest) => request<DraftJobSelectionState>('DELETE', '/draft-job-selection/files', data),
  setDraftJobSelection: (data: SetDraftFilesRequest) => request<DraftJobSelectionState>('PUT', '/draft-job-selection', data),
  clearDraftJobSelection: () => request<DraftJobSelectionState>('DELETE', '/draft-job-selection'),
  // NEW: full replacement from raw textarea
  setDraftFilesFromRaw: (data: SetDraftFilesFromRawRequest) => request<DraftJobSelectionState>('PUT', '/draft-job-selection/files', data),
  // NEW: add mod localisation files
  addDraftFilesFromMods: (data: AddModFilesRequest) => request<DraftJobSelectionState>('POST', '/draft-job-selection/mods', data),
  // NEW: search localisation files (optionally add to draft)
  searchAndAddDraftFiles: (data: SearchFilesRequest) => request<DraftJobSelectionState>('POST', '/draft-job-selection/search', data),
  // NEW: POST variant of clear
  clearDraftJobSelectionPost: () => request<DraftJobSelectionState>('POST', '/draft-job-selection/clear'),

  // --- Editor Session ---
  openEditorSession: (outputFileId: string) =>
    request<EditorSessionState>('POST', `/editor/session/${outputFileId}/open`),
  getEditorSession: (outputFileId: string) =>
    request<EditorSessionState>('GET', `/editor/session/${outputFileId}`),
  updateSessionEntry: (outputFileId: string, entryKey: string, data: SessionUpdateEntryRequest) =>
    request<SessionUpdateEntryResponse>('PUT', `/editor/session/${outputFileId}/entries/${encodeURIComponent(entryKey)}`, data),
  updateEditorRawText: (outputFileId: string, data: UpdateRawTextRequest) =>
    request<UpdateRawTextResponse>('PUT', `/editor/session/${outputFileId}/raw-text`, data),
  saveEditorSessionToDisk: (outputFileId: string) =>
    request<SessionSaveFileResponse>('POST', `/editor/session/${outputFileId}/save-file`),
  revertEditorSession: (outputFileId: string) =>
    request<EditorSessionState>('POST', `/editor/session/${outputFileId}/revert`),
  closeEditorSession: (outputFileId: string) =>
    request<void>('POST', `/editor/session/${outputFileId}/close`),

  // Provider Models
  getProviderModels: (params?: { provider?: string; include_disabled?: boolean; include_builtin?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.provider) sp.set('provider', params.provider);
    if (params?.include_disabled) sp.set('include_disabled', 'true');
    if (params?.include_builtin === false) sp.set('include_builtin', 'false');
    const qs = sp.toString();
    return request<ProviderModelsResponse>('GET', `/provider-models${qs ? `?${qs}` : ''}`);
  },
  getProviderModelsForProvider: (provider: string, params?: { include_disabled?: boolean; include_builtin?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.include_disabled) sp.set('include_disabled', 'true');
    if (params?.include_builtin === false) sp.set('include_builtin', 'false');
    const qs = sp.toString();
    return request<ProviderGroup>('GET', `/provider-models/${encodeURIComponent(provider)}${qs ? `?${qs}` : ''}`);
  },
  createProviderModel: (data: CreateProviderModelRequest) =>
    request<ProviderModelEntry>('POST', '/provider-models', data),
  updateProviderModel: (id: string, data: UpdateProviderModelRequest) =>
    request<ProviderModelEntry>('PUT', `/provider-models/${id}`, data),
  deleteProviderModel: (id: string) =>
    request<void>('DELETE', `/provider-models/${id}`),
  resetProviderModelDefaults: () =>
    request<ResetDefaultsResponse>('POST', '/provider-models/reset-defaults'),

  // Protection Rules
  getProtectionRules: () =>
    request<CustomProtectionRuleSchema[]>('GET', '/protection-rules'),
  getProtectionRule: (id: string) =>
    request<CustomProtectionRuleSchema>('GET', `/protection-rules/${id}`),
  createProtectionRule: (data: CreateRuleRequest) =>
    request<CustomProtectionRuleSchema>('POST', '/protection-rules', data),
  updateProtectionRule: (id: string, data: UpdateRuleRequest) =>
    request<CustomProtectionRuleSchema>('PUT', `/protection-rules/${id}`, data),
  deleteProtectionRule: (id: string) =>
    request<void>('DELETE', `/protection-rules/${id}`),
  previewProtectionRule: (data: PreviewRequest) =>
    request<PreviewResponse>('POST', '/protection-rules/preview', data),

  // Protection Analysis
  analyzeProtectionSamples: (data: ProtectionAnalysisInput) =>
    request<ProtectionAnalysisResult>('POST', '/protection-rules/analyze', data),

  // Grouped Protection Analysis
  analyzeGroupedProtectionSamples: (data: ProtectionAnalysisInput) =>
    request<GroupedAnalysisResult>('POST', '/protection-rules/analyze-grouped', data),

  // Protection Profiles & Learning
  getProtectionProfiles: () =>
    request<ProtectionProfileSchema[]>('GET', '/protection-profiles'),
  getProtectionProfile: (id: string) =>
    request<ProtectionProfileSchema>('GET', `/protection-profiles/${id}`),
  createProtectionProfile: (data: CreateProfileRequest) =>
    request<ProtectionProfileSchema>('POST', '/protection-profiles', data),
  deleteProtectionProfile: (id: string) =>
    request<void>('DELETE', `/protection-profiles/${id}`),
  learnFromSamples: (id: string, data: ProtectionAnalysisInput) =>
    request<LearnResponse>('POST', `/protection-profiles/${id}/learn`, data),
  getProfileCandidates: (id: string, status?: string) =>
    request<ProfileCandidatesResponse>('GET', `/protection-profiles/${id}/candidates${status ? `?status=${status}` : ''}`),
  updateCandidateStatus: (profileId: string, candidateId: string, data: CandidateStatusUpdate) =>
    request<LearnedCandidateSchema>('PUT', `/protection-profiles/${profileId}/candidates/${candidateId}/status`, data),

  // Batch rule creation from candidates
  createRulesFromCandidates: (profileId: string, data: CreateRulesFromCandidatesRequest) =>
    request<CreateRulesFromCandidatesResponse>('POST', `/protection-profiles/${profileId}/candidates/create-rules`, data),

  // --- File Source Learning (backend-first) ---
  discoverFileSources: () =>
    request<FileSourcesResponse>('GET', '/protection-learning/file-sources'),
  previewFileSources: (data: FileSourcePreviewRequest) =>
    request<FileSourcePreviewResponse>('POST', '/protection-learning/file-sources/preview', data),
  analyzeFilesFromSources: (data: AnalyzeFilesRequest) =>
    request<AnalyzeFilesResponse>('POST', '/protection-learning/analyze-files', data),

  // Rule Sets
  getRuleSets: () =>
    request<ProtectionRuleSet[]>('GET', '/rule-sets'),
  getRuleSet: (id: string) =>
    request<ProtectionRuleSet>('GET', `/rule-sets/${id}`),
  createRuleSet: (data: CreateRuleSetRequest) =>
    request<ProtectionRuleSet>('POST', '/rule-sets', data),
  updateRuleSet: (id: string, data: UpdateRuleSetRequest) =>
    request<ProtectionRuleSet>('PUT', `/rule-sets/${id}`, data),
  deleteRuleSet: (id: string) =>
    request<void>('DELETE', `/rule-sets/${id}`),
  addRuleToSet: (setId: string, data: CreateRuleInSetRequest) =>
    request<ProtectionRule>('POST', `/rule-sets/${setId}/rules`, data),
  updateRuleInSet: (setId: string, ruleId: string, data: UpdateRuleInSetRequest) =>
    request<ProtectionRule>('PUT', `/rule-sets/${setId}/rules/${ruleId}`, data),
  deleteRuleFromSet: (setId: string, ruleId: string) =>
    request<void>('DELETE', `/rule-sets/${setId}/rules/${ruleId}`),

  // Protection Rule Validation
  validateProtectionRule: (data: ValidateRuleRequest) =>
    request<RuleValidationResponse>('POST', '/protection/rules/validate', data),

  // --- Pairing Projects ---
  listPairingProjects: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<PairingProject[]>('GET', `/pairing-projects${qs}`);
  },
  getPairingProject: (projectId: string) =>
    request<PairingProject>('GET', `/pairing-projects/${projectId}`),
  createPairingProject: (data: CreatePairingProjectRequest) =>
    request<PairingProject>('POST', '/pairing-projects', data),
  updatePairingProject: (projectId: string, data: UpdatePairingProjectRequest) =>
    request<PairingProject>('PATCH', `/pairing-projects/${projectId}`, data),
  deletePairingProject: (projectId: string) =>
    request<void>('DELETE', `/pairing-projects/${projectId}`),

  scanPairingProject: (projectId: string) =>
    request<ScanResponse>('POST', `/pairing-projects/${projectId}/scan`),

  listPairingFiles: (projectId: string, params?: { group_key?: string; role?: string; extension?: string; ignored?: boolean; search?: string }) => {
    const sp = new URLSearchParams();
    if (params?.group_key) sp.set('group_key', params.group_key);
    if (params?.role) sp.set('role', params.role);
    if (params?.extension) sp.set('extension', params.extension);
    if (params?.ignored !== undefined) sp.set('ignored', String(params.ignored));
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    return request<PairingProjectFile[]>('GET', `/pairing-projects/${projectId}/files${qs ? `?${qs}` : ''}`);
  },

  getPairingFileContent: (projectId: string, fileId: string) =>
    request<FileContentResponse>('GET', `/pairing-projects/${projectId}/files/${fileId}/content`),

  getPairingGroups: (projectId: string, groupingMode?: string) => {
    const qs = groupingMode ? `?grouping_mode=${encodeURIComponent(groupingMode)}` : '';
    return request<FileGroupResponse[]>('GET', `/pairing-projects/${projectId}/groups${qs}`);
  },

  suggestPairingPairs: (projectId: string, body?: SuggestPairsRequest) =>
    request<PairSuggestionResponse[]>('POST', `/pairing-projects/${projectId}/suggest-pairs`, body),

  listPairingPairs: (projectId: string, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<PairingProjectPair[]>('GET', `/pairing-projects/${projectId}/pairs${qs}`);
  },
  createPairingPair: (projectId: string, data: CreatePairRequest) =>
    request<PairingProjectPair>('POST', `/pairing-projects/${projectId}/pairs`, data),
  updatePairingPair: (projectId: string, pairId: string, data: UpdatePairRequest) =>
    request<PairingProjectPair>('PATCH', `/pairing-projects/${projectId}/pairs/${pairId}`, data),
  deletePairingPair: (projectId: string, pairId: string) =>
    request<void>('DELETE', `/pairing-projects/${projectId}/pairs/${pairId}`),
  clearPairingPairs: (projectId: string) =>
    request<void>('DELETE', `/pairing-projects/${projectId}/pairs`),
  getPairingPairPreview: (projectId: string, pairId: string) =>
    request<PairPreviewResponse>('GET', `/pairing-projects/${projectId}/pairs/${pairId}/preview`),

  // Alignment
  getPairingAlignment: (projectId: string, pairId: string) =>
    request<AlignmentResponse | null>('GET', `/pairing-projects/${projectId}/pairs/${pairId}/alignment`),
  savePairingAlignment: (projectId: string, pairId: string, data: SaveAlignmentRequest) =>
    request<AlignmentResponse>('POST', `/pairing-projects/${projectId}/pairs/${pairId}/alignment`, data),
  previewPairingAlignment: (projectId: string, pairId: string, data: PreviewAlignmentRequest) =>
    request<AlignmentPreviewResponse>('POST', `/pairing-projects/${projectId}/pairs/${pairId}/alignment/preview`, data),
  applyPairingAlignment: (projectId: string, pairId: string, data: ApplyAlignmentRequest) =>
    request<ApplyAlignmentResponse>('POST', `/pairing-projects/${projectId}/pairs/${pairId}/alignment/apply`, data),

  // File content save
  savePairingFileContent: (projectId: string, fileId: string, content: string) =>
    request<SavePairingFileContentResponse>('PUT', `/pairing-projects/${projectId}/files/${fileId}/content`, { content } as SavePairingFileContentRequest),

  // Learning
  learnFromPairingPairs: (projectId: string, data: LearnFromPairsRequest) =>
    request<LearnFromPairsResponse>('POST', `/pairing-projects/${projectId}/learn`, data),

  // Bulk cleanup
  bulkDeletePairs: (projectId: string, data: BulkDeleteRequest) =>
    request<BulkDeleteResponse>('POST', `/pairing-projects/${projectId}/pairs/bulk-delete`, data),
  bulkAcceptPairs: (projectId: string, data: BulkUpdateRequest) =>
    request<BulkUpdateResponse>('POST', `/pairing-projects/${projectId}/pairs/bulk-accept`, data),
  bulkRejectPairs: (projectId: string, data: BulkUpdateRequest) =>
    request<BulkUpdateResponse>('POST', `/pairing-projects/${projectId}/pairs/bulk-reject`, data),
  findIdenticalPairs: (projectId: string, data: FindIdenticalRequest) =>
    request<FindIdenticalResponse>('POST', `/pairing-projects/${projectId}/pairs/find-identical`, data),
  previewFilenamePairs: (projectId: string, data: PreviewFilenameRequest) =>
    request<PreviewFilenameResponse>('POST', `/pairing-projects/${projectId}/pairs/preview-filename`, data),
  exactLineMatchPreview: (projectId: string, data: ExactLineMatchPreviewRequest) =>
    request<ExactLineMatchPreviewResponse>('POST', `/pairing-projects/${projectId}/pairs/exact-line-match/preview`, data),
  exactLineMatchDelete: (projectId: string, data: ExactLineMatchDeleteRequest) =>
    request<ExactLineMatchDeleteResponse>('POST', `/pairing-projects/${projectId}/pairs/exact-line-match/delete`, data),

  // === Import / Export Transfer ===
  getExportOptions: () =>
    request<TransferExportOptionsResponse>('GET', '/transfer/export/options'),
  createExportPackage: (data: TransferCreateExportPackageRequest) =>
    request<Record<string, unknown>>('POST', '/transfer/export/package', data),
  previewImport: (data: TransferImportPreviewRequest) =>
    request<TransferImportPreviewResponse>('POST', '/transfer/import/preview', data),
  applyImport: (data: TransferImportApplyRequest) =>
    request<TransferImportApplyResponse>('POST', '/transfer/import/apply', data),
};

export { ApiError };
