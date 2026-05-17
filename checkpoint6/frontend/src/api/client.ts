/* ------------------------------------------------------------------ */
/*  Typed API client                                                    */
/* ------------------------------------------------------------------ */
import type {
  HealthResponse,
  AppStateResponse,
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
  EditorFileResponse,
  UpdateEntryRequest,
  UpdateEntryResponse,
  SaveFileRequest,
  SaveFileResponse,
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
  OutputFileEditorPayload,
  SaveTranslatedContentRequest,
  SaveTranslatedContentResponse,
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
  RuntimeRawLogLine,
  RuntimeRawLogResponse,
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

  // Editor
  getEditorFile: (fileId: string) => request<EditorFileResponse>('GET', `/editor/files/${fileId}`),
  updateEditorEntry: (fileId: string, entryId: string, data: UpdateEntryRequest) =>
    request<UpdateEntryResponse>('PUT', `/editor/files/${fileId}/entries/${entryId}`, data),
  bulkEditEntries: (fileId: string, changes: { row_id: string; translated_text: string }[]) =>
    request<{ success: boolean; updated_count: number }>('POST', `/editor/files/${fileId}/entries/bulk`, { changes }),
  saveEditorFile: (fileId: string, data: SaveFileRequest) => request<SaveFileResponse>('POST', `/editor/files/${fileId}/save`, data),
  validateEditorFile: (fileId: string) => request<Record<string, unknown>>('POST', `/editor/files/${fileId}/validate`),

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

  // Output File Editor
  getOutputEditorPayload: (outputFileId: string) =>
    request<OutputFileEditorPayload>('GET', `/output-files/${outputFileId}/editor-payload`),
  saveOutputTranslatedContent: (outputFileId: string, data: SaveTranslatedContentRequest) =>
    request<SaveTranslatedContentResponse>('PUT', `/output-files/${outputFileId}/translated-content`, data),
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
};

export { ApiError };
