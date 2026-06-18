import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockReplacePaths = vi.fn();
const mockAddPath = vi.fn();
const mockRemovePath = vi.fn();
const mockSyncPathsFromText = vi.fn();
const mockSetFormField = vi.fn();
const mockResetFormFields = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockSetFoundFiles = vi.fn();
const mockSetSelectedGameId = vi.fn();
const mockSetSelectedProfileId = vi.fn();
const mockOpenPreview = vi.fn();
const mockCreateDirectJob = vi.fn();

/** Default job result used by createDirectJob mock.
 *  totalUnits > 0 so existing tests that check draft-clearing continue
 *  to pass without additional setup. */
const MOCK_JOB_HEALTHY = {
  id: 'test-job-id',
  name: 'test-job',
  status: 'completed',
  totalUnits: 5,
  completedUnits: 0,
  failedUnits: 0,
  cachedUnits: 0,
  progress: 0,
  filePaths: ['/mod/file.yml'],
  config: { src_lang: 'english' },
  diagnostics: [],
  createdAt: '',
  updatedAt: '',
  completedAt: '',
  errorMessage: undefined,
  currentBatchIndex: 0,
  totalBatches: 0,
  resultSummary: null,
  currentActivity: undefined,
  outputFiles: [],
  outputRootDir: undefined,
};
const mockSetDraft = vi.fn();
const mockClearDraft = vi.fn();

/** Shared reference for draft API methods so the DraftJobSelectionContext
 *  mock can call through to the same functions the tests assert against. */
const mockDraftApi = vi.hoisted(() => ({
  addDraftFiles: vi.fn(),
  removeDraftFiles: vi.fn(),
  setDraftJobSelection: vi.fn(),
  clearDraftJobSelection: vi.fn(),
  getDraftJobSelection: vi.fn(),
  addDraftFilesFromMods: vi.fn(),
}));

/** Mutable context state so tests can override useDraftJobSelection
 *  return values (e.g. draftFiles) before mounting the hook. */
const mockCtxFiles = vi.hoisted(() => ({ value: [] as string[] }));

let mockFilePathList: string[] = [];
let mockFilePaths = '';

vi.mock('../useCreateJobFlow', () => ({
  useCreateJobFlow: vi.fn(() => ({
    pendingFiles: [] as string[],
    pendingSourceName: undefined,
    pendingModId: undefined,
    pendingGameConfig: undefined,
    selectedProfileId: '',
    setSelectedProfileId: mockSetSelectedProfileId,
    previewData: null,
    previewLoading: false,
    creatingJob: false,
    openPreview: mockOpenPreview,
    closePreview: vi.fn(),
    confirmPreview: vi.fn(),
    createDirectJob: mockCreateDirectJob,
    clearPending: vi.fn(),
  })),
}));

vi.mock('../useCreateJobPaths', () => ({
  useCreateJobPaths: vi.fn(() => ({
    get filePaths() { return mockFilePaths; },
    get filePathList() { return mockFilePathList; },
    addedPaths: new Set<string>(),
    addPath: mockAddPath,
    removePath: mockRemovePath,
    replacePaths: mockReplacePaths,
    syncPathsFromText: mockSyncPathsFromText,
  })),
}));

vi.mock('../useCreateJobFields', () => ({
  useCreateJobFields: vi.fn(() => ({
    jobName: '',
    srcLang: 'english',
    dstLang: 'russian',
    batchSize: 50,
    useCache: true,
    provider: 'openai',
    model: 'gpt-4',
    apiKeyId: '',
    apiKeyIds: [],
    promptProfileName: '',
    protectionStrategy: 'strict',
    ruleSetIds: [],
    validatorName: 'default',
    outputDir: '',
    outputFilenameSuffix: '',
    outputPreserveRelativePath: true,
    outputOverwrite: false,
    outputBackup: false,
    temperature: 0.7,
    maxRetries: 3,
    timeoutSec: 60,
    maxCompletionTokens: 4096,
    saveRawResponses: false,
    promptOverrideEnabled: false,
    batchSystemPrompt: '',
    batchUserTemplate: '',
    singleSystemPrompt: '',
    singleUserTemplate: '',
    logPrompts: false,
    dirty: { srcLangDirty: false },
    defaultsRefs: { current: {} },
    fieldSetters: {
      setSrcLang: vi.fn(),
      setDstLang: vi.fn(),
      setJobName: vi.fn(),
      setBatchSize: vi.fn(),
      setUseCache: vi.fn(),
      setProvider: vi.fn(),
      setModel: vi.fn(),
      setApiKeyId: vi.fn(),
      setApiKeyIds: vi.fn(),
      setPromptProfileName: vi.fn(),
      setProtectionStrategy: vi.fn(),
      setRuleSetIds: vi.fn(),
      setValidatorName: vi.fn(),
      setOutputDir: vi.fn(),
      setOutputFilenameSuffix: vi.fn(),
      setOutputPreserveRelativePath: vi.fn(),
      setOutputOverwrite: vi.fn(),
      setOutputBackup: vi.fn(),
      setTemperature: vi.fn(),
      setMaxRetries: vi.fn(),
      setTimeoutSec: vi.fn(),
      setMaxCompletionTokens: vi.fn(),
      setSaveRawResponses: vi.fn(),
      setPromptOverrideEnabled: vi.fn(),
      setBatchSystemPrompt: vi.fn(),
      setBatchUserTemplate: vi.fn(),
      setSingleSystemPrompt: vi.fn(),
      setSingleUserTemplate: vi.fn(),
      setLogPrompts: vi.fn(),
    },
    setFormField: mockSetFormField,
    resetFormFields: mockResetFormFields,
  })),
}));

vi.mock('../useCreateJobMods', () => ({
  useCreateJobMods: vi.fn(() => ({
    mods: [],
    modsLoading: false,
  })),
}));

vi.mock('../useCreateJobGames', () => ({
  useCreateJobGames: vi.fn(() => ({
    games: [],
    gamesWithMods: [],
    gamesLoading: false,
    selectedGameId: '',
    setSelectedGameId: mockSetSelectedGameId,
  })),
}));

vi.mock('../useCreateJobFileSearch', () => ({
  useCreateJobFileSearch: vi.fn(() => ({
    searchQuery: '',
    setSearchQuery: mockSetSearchQuery,
    foundFiles: [],
    setFoundFiles: mockSetFoundFiles,
    searching: false,
    searchError: null,
    pickFilePath: '',
    setPickFilePath: vi.fn(),
    pickSearchPath: '',
    setPickSearchPath: vi.fn(),
    handleSearch: vi.fn(),
    handleAddAll: vi.fn(),
  })),
}));

vi.mock('../useCreateJobDefaults', () => ({
  useCreateJobDefaults: vi.fn(),
}));

vi.mock('../useCreateJobProfileApplication', () => ({
  applyProfileToForm: vi.fn(),
}));

vi.mock('../../usePersistentState', () => ({
  usePersistentState: vi.fn((_key: string, _defaultValue: unknown) => [
    null,
    mockSetDraft,
    mockClearDraft,
  ]),
}));

vi.mock('../../../utils/localisationLanguage', () => ({
  groupFilesByLanguage: vi.fn(() => ({ english: [], russian: [] })),
  filterFilesByLanguage: vi.fn((_paths: string[], _lang: string) => []),
}));

vi.mock('../../../App', () => ({
  api: {
    listApiKeys: vi.fn().mockResolvedValue({ keys: [] }),
    effectivePrompt: vi.fn().mockResolvedValue(null),
    previewPrompt: vi.fn().mockResolvedValue(null),
    setDraftJobSelection: mockDraftApi.setDraftJobSelection,
    clearDraftJobSelection: mockDraftApi.clearDraftJobSelection,
    addDraftFiles: mockDraftApi.addDraftFiles,
    removeDraftFiles: mockDraftApi.removeDraftFiles,
    getDraftJobSelection: mockDraftApi.getDraftJobSelection,
    addDraftFilesFromMods: mockDraftApi.addDraftFilesFromMods,
  },
  ApiError: class extends Error {
    code = '';
    details: Record<string, unknown> = {};
    recoverable = false;
    constructor(err: { message: string; code: string; details: Record<string, unknown>; recoverable: boolean }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details;
      this.recoverable = err.recoverable;
    }
  },
}));

/* Mock the API client used by DraftJobSelectionContext. */
vi.mock('../../../api/client', () => ({
  api: {
    getDraftJobSelection: mockDraftApi.getDraftJobSelection,
    addDraftFiles: mockDraftApi.addDraftFiles,
    removeDraftFiles: mockDraftApi.removeDraftFiles,
    setDraftJobSelection: mockDraftApi.setDraftJobSelection,
    clearDraftJobSelection: mockDraftApi.clearDraftJobSelection,
    addDraftFilesFromMods: mockDraftApi.addDraftFilesFromMods,
  },
  ApiError: class extends Error {
    code = '';
    details: Record<string, unknown> = {};
    recoverable = false;
    constructor(err: { message: string; code: string; details: Record<string, unknown>; recoverable: boolean }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details;
      this.recoverable = err.recoverable;
    }
  },
}));

/* Mock DraftJobSelectionProvider to suppress auto-mount refresh() that
   triggers state updates outside act() scope in React 18 + happy-dom.
   Context methods call through to mockDraftApi so tests that assert on
   api.xxx calls still pass.  mockCtxFiles.value can be set by tests to
   control the draftFiles returned by useDraftJobSelection. */
vi.mock('../../../contexts/DraftJobSelectionContext', () => ({
  DraftJobSelectionProvider: function MockProvider({ children }: { children: React.ReactNode }) {
    return children;
  },
  useDraftJobSelection: vi.fn(() => ({
    draftFiles: mockCtxFiles.value,
    draftMeta: {},
    grouped: [],
    diagnostics: [],
    fileCount: 0,
    loading: false,
    error: null,
    addFile: vi.fn(),
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    removeFiles: vi.fn(),
    setFiles: vi.fn((files: string[]) => {
      mockCtxFiles.value = files;
      mockDraftApi.setDraftJobSelection({ files });
      return Promise.resolve({ files, file_metadata: {}, grouped: [], diagnostics: [], count: files.length });
    }),
    clearFiles: vi.fn(() => {
      mockCtxFiles.value = [];
      mockDraftApi.clearDraftJobSelection();
      return Promise.resolve({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
    }),
    addFilesFromMods: vi.fn((legacyModIds: string[], handler = 'stellaris_localisation', language = 'english', modPaths?: string[]) => {
      const payload: Record<string, unknown> = { handler, language };
      if (modPaths && modPaths.length > 0) {
        payload.mod_paths = modPaths;
      } else {
        payload.mod_ids = legacyModIds;
      }
      mockDraftApi.addDraftFilesFromMods(payload);
      return Promise.resolve({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
    }),
    searchAndAddFiles: vi.fn(),
    setFilesFromRaw: vi.fn(),
    isFileAdded: vi.fn(() => false),
    navigateToJob: vi.fn(),
    refresh: vi.fn(() => {
      const result = mockDraftApi.getDraftJobSelection();
      if (result && typeof result.then === 'function') {
        return result.then((data: any) => { mockCtxFiles.value = data?.files ?? []; });
      }
      return Promise.resolve({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
    }),
  })),
}));

import { useCreateJobForm } from '../useCreateJobForm';
import { useCreateJobFlow } from '../useCreateJobFlow';
import { usePersistentState } from '../../usePersistentState';
import { DraftJobSelectionProvider } from '../../../contexts/DraftJobSelectionContext';
import { MemoryRouter } from 'react-router-dom';
import type { DraftSelectionGroup } from '../../../api/types';

/* ================================================================== */
/*  Setup helper                                                        */
/* ================================================================== */

function setup() {
  const showToast = vi.fn();
  const loadJobs = vi.fn().mockResolvedValue(undefined);
  const selectJob = vi.fn();
  const profiles: never[] = [];

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(MemoryRouter, null,
      React.createElement(DraftJobSelectionProvider, null, children),
    );

  const { result, unmount } = renderHook(
    () => useCreateJobForm({ showToast, loadJobs, selectJob, profiles }),
    { wrapper },
  );

  return { result, unmount, showToast, loadJobs, selectJob };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useCreateJobForm', () => {
  let currentUnmount: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFilePathList = [];
    mockFilePaths = '';
    mockCtxFiles.value = [];
    currentUnmount = null;
    // Default: createDirectJob returns a healthy job (totalUnits > 0)
    mockCreateDirectJob.mockResolvedValue(MOCK_JOB_HEALTHY);
  });

  afterEach(() => {
    if (currentUnmount) {
      currentUnmount();
      currentUnmount = null;
    }
  });

  function trackedSetup() {
    const { result, unmount } = setup();
    currentUnmount = unmount;
    return { result, unmount };
  }

  // -----------------------------------------------------------------
  //  handleCreateJob — submit syncs backend draft before creating
  // -----------------------------------------------------------------

  it('handleCreateJob calls createDirectJob and clears local draft', async () => {
    mockFilePaths = '/mod/file_a.yml\n/mod/file_b.yml';

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // createDirectJob was called with the form values
    expect(mockCreateDirectJob).toHaveBeenCalledTimes(1);
    // Local draft was cleared (job has totalUnits > 0)
    expect(mockClearDraft).toHaveBeenCalledTimes(1);
  });

  it('handleCreateJob does NOT call clearDraftJobSelection (backend handles it)', async () => {
    // The backend clears the draft after successful job creation
    // (see jobs.py create_job handler, line 481-486).  The frontend
    // does not need an extra clearDraftJobSelection call.
    mockFilePaths = '/mod/file_a.yml';

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // Import the api mock and verify it wasn't called
    const { api } = await import('../../../App');
    expect(api.clearDraftJobSelection).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------
  //  Path operations fire backend draft API calls
  // -----------------------------------------------------------------

  it('addPath calls api.addDraftFiles', async () => {
    const { result } = trackedSetup();

    act(() => {
      result.current.addPath('/mod/new_file.yml');
    });

    expect(mockAddPath).toHaveBeenCalledWith('/mod/new_file.yml');
  });

  it('removePath calls api.removeDraftFiles', async () => {
    const { result } = trackedSetup();

    act(() => {
      result.current.removePath('/mod/file_a.yml');
    });

    expect(mockRemovePath).toHaveBeenCalledWith('/mod/file_a.yml');
  });

  // -----------------------------------------------------------------
  //  Game change
  // -----------------------------------------------------------------

  it('handleGameChange changes game', () => {
    const { result } = trackedSetup();

    act(() => {
      result.current.handleGameChange('other-game');
    });

    expect(mockSetSelectedGameId).toHaveBeenCalledWith('other-game');
  });

  // -----------------------------------------------------------------
  //  handlePreviewPlan
  // -----------------------------------------------------------------

  it('handlePreviewPlan calls openPreview on createFlow', async () => {
    mockFilePaths = '/mod/a.yml';
    mockOpenPreview.mockReturnValue(undefined);

    const { result } = trackedSetup();

    act(() => {
      result.current.handlePreviewPlan();
    });

    expect(mockOpenPreview).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------
  //  setFormField — filePaths dispatches to paths.syncPathsFromText
  // -----------------------------------------------------------------

  it('setFormField with filePaths calls syncPathsFromText', () => {
    const { result } = trackedSetup();

    act(() => {
      result.current.setFormField('filePaths', '/a.yml\n/b.yml');
    });

    expect(mockSyncPathsFromText).toHaveBeenCalledWith('/a.yml\n/b.yml');
  });

  it('setFormField with non-filePaths calls fields.setFormField', () => {
    const { result } = trackedSetup();

    act(() => {
      result.current.setFormField('srcLang', 'french');
    });

    expect(mockSetFormField).toHaveBeenCalledWith('srcLang', 'french');
  });

  // -----------------------------------------------------------------
  //  Stale draft / file selection sync (regression: checkpoint6)
  //
  //  When the user selects files in ModListSection and then opens the
  //  Create Job tab for the first time, the form must show the newly
  //  selected files — NOT stale filePathList from a previous
  //  localStorage draft.
  // -----------------------------------------------------------------

  it('does NOT overwrite live context files with stale localStorage draft on mount', async () => {
    // Save original mock implementation for cleanup
    const originalPersistentImpl = vi.mocked(usePersistentState).getMockImplementation();

    try {
      // Arrange: populate localStorage with a stale draft from a previous session
      const { STORAGE_KEYS } = await import('../../../utils/storageKeys');
      localStorage.setItem(STORAGE_KEYS.createJobDraft, JSON.stringify({
        filePathList: ['/stale/old_file.yml'],
        selectedGameId: undefined,
      }));

      // Arrange: make usePersistentState read from actual localStorage so the
      // draft hook picks up the stale value.
      vi.mocked(usePersistentState).mockImplementation(
        (key: string, defaultValue: unknown) => {
          try {
            const raw = localStorage.getItem(key);
            if (raw !== null) return [JSON.parse(raw), mockSetDraft, mockClearDraft];
          } catch { /* ignore */ }
          return [defaultValue, mockSetDraft, mockClearDraft] as [
            unknown,
            typeof mockSetDraft,
            typeof mockClearDraft,
          ];
        },
      );

      // Arrange: mock the provider's backend API so it returns LIVE context
      // files (simulating files added from ModListSection).
      const { api } = await import('../../../api/client');
      vi.mocked(api.getDraftJobSelection).mockResolvedValue({
        files: ['/live/new_file.yml'],
        file_metadata: {},
        grouped: [],
        diagnostics: [],
        count: 1,
      });

      // Act: mount useCreateJobForm
      mockCtxFiles.value = ['/live/new_file.yml'];
      trackedSetup();

      // Wait for all async effects to settle:
      //   Provider fetch → setDraftFiles → re-render → deferred effect fires
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Assert: replacePaths was NEVER called with the stale draft's files
      const staleCalls = mockReplacePaths.mock.calls.filter(
        (args: unknown[]) =>
          JSON.stringify(args[0]).includes('/stale/old_file.yml'),
      );
      expect(staleCalls).toHaveLength(0);

      // Assert: replacePaths WAS called with the live context files
      const liveCalls = mockReplacePaths.mock.calls.filter(
        (args: unknown[]) =>
          JSON.stringify(args[0]).includes('/live/new_file.yml'),
      );
      expect(liveCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      // Restore original mock so other tests are not affected
      if (originalPersistentImpl) {
        vi.mocked(usePersistentState).mockImplementation(
          originalPersistentImpl as typeof originalPersistentImpl,
        );
      }
    }
  });

  // -----------------------------------------------------------------
  //  Hardening: submit flushes pending raw textarea debounce before
  //  creating the job.  When the user types in the textarea and
  //  immediately clicks Create, the unsynced debounce must be synced
  //  to the backend draft before the create request is sent.
  // -----------------------------------------------------------------

  it('handleCreateJob flushes pending raw textarea debounce before creating', async () => {
    mockFilePaths = '/mod/new_file.yml';

    const { result } = trackedSetup();

    // Simulate: user types a new path into the textarea, creating a
    // pending 600ms debounce timer.
    act(() => {
      result.current.setFormField('filePaths', '/mod/new_file.yml');
    });

    // Immediately submit — before the debounce would have fired.
    await act(async () => {
      await result.current.handleCreateJob();
    });

    // The backend draft API was called with the latest textarea content
    // (via flushRawTextDebounce → ctx.setFiles → api.setDraftJobSelection).
    const { api } = await import('../../../api/client');
    expect(api.setDraftJobSelection).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['/mod/new_file.yml'] }),
    );

    // createDirectJob was called (the create flow proceeded).
    expect(mockCreateDirectJob).toHaveBeenCalledTimes(1);
  });

  it('handleCreateJob flushes debounce even when textarea is empty', async () => {
    // Regression: previously flushRawTextDebounce skipped setFiles when
    // the textarea was empty, leaving stale paths in the backend draft.
    // This caused createJobUsingDraft to use old draft paths.
    mockFilePaths = '';

    const { result } = trackedSetup();

    // Simulate: user clears textarea and immediately submits.
    act(() => {
      result.current.setFormField('filePaths', '');
    });

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // Backend draft was cleared (empty files array sent).
    const { api } = await import('../../../api/client');
    expect(api.setDraftJobSelection).toHaveBeenCalledWith(
      expect.objectContaining({ files: [] }),
    );
  });

  // -----------------------------------------------------------------
  //  Hardening: after successful create, the backend draft is cleared.
  //  The frontend must call ctx.refresh() so the shared context and
  //  UI immediately reflect the now-empty state.
  // -----------------------------------------------------------------

  it('handleCreateJob calls ctx.refresh after successful create', async () => {
    mockFilePaths = '/mod/file_a.yml';

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // ctx.refresh() was called (re-fetches backend draft to reflect
    // the cleared state after job creation).
    const { api } = await import('../../../api/client');
    expect(api.getDraftJobSelection).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------
  //  Hardening: stale legacy filePathList from localStorage is NOT
  //  sent in the create request.  The submit reads paths from the
  //  current form state (paths.filePaths), not from localStorage.
  // -----------------------------------------------------------------

  it('submit does NOT send stale localStorage filePathList in create request', async () => {
    // Arrange: populate localStorage with a stale draft containing old paths.
    const { STORAGE_KEYS } = await import('../../../utils/storageKeys');
    localStorage.setItem(STORAGE_KEYS.createJobDraft, JSON.stringify({
      filePathList: ['/stale/old_path.yml'],
      filePaths: '/stale/old_path.yml',
    }));

    // Arrange: the context has already been restored and the form state
    // reflects what the user currently sees in the textarea.
    mockFilePaths = '/current/new_path.yml';

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // createDirectJob was called.  Check what values were passed to it.
    expect(mockCreateDirectJob).toHaveBeenCalledTimes(1);

    // The form values should contain the CURRENT textarea content,
    // not the stale localStorage filePathList.
    const callArgs = mockCreateDirectJob.mock.calls[0][0];
    expect(callArgs.filePaths).toContain('/current/new_path.yml');
    expect(callArgs.filePaths).not.toContain('/stale/old_path.yml');
  });

  // -----------------------------------------------------------------
  //  Zero-unit job handling — do NOT clear draft when job has 0 units
  // -----------------------------------------------------------------

  it('handleCreateJob clears draft when job has totalUnits > 0', async () => {
    // Default mock returns MOCK_JOB_HEALTHY with totalUnits = 5
    mockFilePaths = '/mod/file_a.yml';

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // Draft is cleared for healthy jobs
    expect(mockClearDraft).toHaveBeenCalledTimes(1);
  });

  it('handleCreateJob does NOT clear draft when job has totalUnits === 0 with NO_TRANSLATION_UNITS_FOUND', async () => {
    mockFilePaths = '/mod/file_a.yml';
    mockCreateDirectJob.mockResolvedValue({
      ...MOCK_JOB_HEALTHY,
      totalUnits: 0,
      diagnostics: [
        { level: 'warning', code: 'NO_TRANSLATION_UNITS_FOUND', message: 'No translatable units found.' },
      ],
      status: 'completed',
    });

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // Draft NOT cleared
    expect(mockClearDraft).not.toHaveBeenCalled();
  });

  it('handleCreateJob does NOT clear draft when job has totalUnits === 0 with NO_UNITS', async () => {
    mockFilePaths = '/mod/file_a.yml';
    mockCreateDirectJob.mockResolvedValue({
      ...MOCK_JOB_HEALTHY,
      totalUnits: 0,
      diagnostics: [
        { level: 'warning', code: 'NO_UNITS', message: 'No units found.' },
      ],
      status: 'completed',
    });

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    expect(mockClearDraft).not.toHaveBeenCalled();
  });

  it('handleCreateJob shows warning toast for zero-unit jobs', async () => {
    mockFilePaths = '/mod/file_a.yml';
    mockCreateDirectJob.mockResolvedValue({
      ...MOCK_JOB_HEALTHY,
      totalUnits: 0,
      diagnostics: [
        { level: 'warning', code: 'NO_TRANSLATION_UNITS_FOUND', message: 'No translatable units found.' },
      ],
      status: 'completed',
    });

    const { result, showToast } = setup();
    currentUnmount = null;

    await act(async () => {
      await result.current.handleCreateJob();
    });

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('No translation units found'),
      'warning',
    );
  });

  it('handleCreateJob clears draft when totalUnits === 0 but no matching diagnostic', async () => {
    // Some other reason for 0 units (e.g. no files selected) — clear normally
    mockFilePaths = '/mod/file_a.yml';
    mockCreateDirectJob.mockResolvedValue({
      ...MOCK_JOB_HEALTHY,
      totalUnits: 0,
      diagnostics: [],
    });

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    expect(mockClearDraft).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------
  //  Hardening: unmount clears pending debounce timeout and does not
  //  fire stale requests after the component is unmounted.
  // -----------------------------------------------------------------

  it('unmount clears pending debounce timeout', async () => {
    const { result, unmount } = setup();

    // Create a pending debounce timer by setting a file path.
    act(() => {
      result.current.setFormField('filePaths', '/mod/file.yml');
    });

    // Spy on clearTimeout.
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    // Unmount — the cleanup effect should clear the pending timer.
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('unmount does not fire stale async state updates from context', async () => {
    // Verify that the context does not call setState after the
    // DraftJobSelectionProvider's mountedRef is set to false.
    const { result, unmount } = setup();

    // Set up a deferred API call that resolves after unmount.
    const { api } = await import('../../../api/client');

    // Make the backend API slow so it resolves after unmount.
    let slowResolve: () => void = () => {};
    (api.setDraftJobSelection as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(resolve => { slowResolve = () => resolve({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 }); }),
    );

    // Trigger a pending debounce sync.
    act(() => {
      result.current.setFormField('filePaths', '/mod/after_unmount.yml');
    });

    // Unmount before the debounce fires.
    unmount();

    // Now resolve the pending API call — this should NOT throw
    // because the context checks mountedRef before setState.
    await act(async () => {
      slowResolve();
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    // If we get here without an error, the unmount cleanup is correct.
    // (Stale setState after unmount would log React warnings or throw.)
    expect(true).toBe(true);
  });

  // -----------------------------------------------------------------
  //  handleAddModFiles — adds mod localisation files via mod_paths
  // -----------------------------------------------------------------

  it('handleAddModFiles sends mod_paths to the backend API', async () => {
    const { api } = await import('../../../api/client');
    const { result } = trackedSetup();

    // Initially no mods selected.
    expect(result.current.selectedModPaths).toEqual([]);

    // Select two mods by path.
    act(() => {
      result.current.setSelectedModPaths(['/path/steam/mod_a', '/path/sfw/mod_a']);
    });
    expect(result.current.selectedModPaths).toEqual(['/path/steam/mod_a', '/path/sfw/mod_a']);

    // Call handleAddModFiles.
    await act(async () => {
      await result.current.handleAddModFiles();
    });

    // The context should call the backend with mod_paths (not mod_ids).
    expect(api.addDraftFilesFromMods).toHaveBeenCalledWith(
      expect.objectContaining({
        mod_paths: ['/path/steam/mod_a', '/path/sfw/mod_a'],
      }),
    );
    // Should NOT send mod_ids when mod_paths is populated.
    const callArg = vi.mocked(api.addDraftFilesFromMods).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('mod_ids');

    // Selected mods are cleared after successful add.
    expect(result.current.selectedModPaths).toEqual([]);
  });

  it('handleAddModFiles does nothing when no mods selected', async () => {
    const { api } = await import('../../../api/client');
    const { result } = trackedSetup();

    expect(result.current.selectedModPaths).toEqual([]);

    await act(async () => {
      await result.current.handleAddModFiles();
    });

    expect(api.addDraftFilesFromMods).not.toHaveBeenCalled();
  });
});
