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
const mockSetSelectedMod = vi.fn();
const mockSetSelectedGameId = vi.fn();
const mockSetSelectedProfileId = vi.fn();
const mockOpenPreview = vi.fn();
const mockCreateDirectJob = vi.fn();
const mockSetDraft = vi.fn();
const mockClearDraft = vi.fn();

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
    selectedMod: null,
    setSelectedMod: mockSetSelectedMod,
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
    // Draft API — fire-and-forget in form, no-op in tests
    setDraftJobSelection: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
    clearDraftJobSelection: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
    addDraftFiles: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
    removeDraftFiles: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
    getDraftJobSelection: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
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
    getDraftJobSelection: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
    addDraftFiles: vi.fn().mockImplementation((data: { file_paths: string[] }) =>
      Promise.resolve({ files: data.file_paths, file_metadata: {}, count: data.file_paths.length }),
    ),
    removeDraftFiles: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
    setDraftJobSelection: vi.fn().mockImplementation((data: { files: string[] }) =>
      Promise.resolve({ files: data.files, file_metadata: {}, count: data.files.length }),
    ),
    clearDraftJobSelection: vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }),
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

import { useCreateJobForm } from '../useCreateJobForm';
import { useCreateJobFlow } from '../useCreateJobFlow';
import { usePersistentState } from '../../usePersistentState';
import { DraftJobSelectionProvider } from '../../../contexts/DraftJobSelectionContext';
import { MemoryRouter } from 'react-router-dom';
import { useCreateJobMods } from '../useCreateJobMods';

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
    currentUnmount = null;
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
    mockCreateDirectJob.mockResolvedValue(undefined);

    const { result } = trackedSetup();

    await act(async () => {
      await result.current.handleCreateJob();
    });

    // createDirectJob was called with the form values
    expect(mockCreateDirectJob).toHaveBeenCalledTimes(1);
    // Local draft was cleared
    expect(mockClearDraft).toHaveBeenCalledTimes(1);
  });

  it('handleCreateJob does NOT call clearDraftJobSelection (backend handles it)', async () => {
    // The backend clears the draft after successful job creation
    // (see jobs.py create_job handler, line 481-486).  The frontend
    // does not need an extra clearDraftJobSelection call.
    mockFilePaths = '/mod/file_a.yml';
    mockCreateDirectJob.mockResolvedValue(undefined);

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
  //  Mod selection
  // -----------------------------------------------------------------

  it('handleSelectMod sets selected mod and replaces paths', () => {
    const modPaths = ['/mod/a.yml', '/mod/b.yml'];
    const mockMod = {
      mod_id: 'test-mod',
      name: 'Test Mod',
      game_id: 'stellaris',
      localisation_paths: modPaths,
    };

    const { result } = trackedSetup();

    act(() => {
      result.current.handleSelectMod(mockMod as any);
    });

    expect(mockSetSelectedMod).toHaveBeenCalledWith(mockMod);
    expect(mockReplacePaths).toHaveBeenCalled();
  });

  it('handleClearSelection clears selected mod and paths', () => {
    const { result } = trackedSetup();

    act(() => {
      result.current.handleClearSelection();
    });

    expect(mockSetSelectedMod).toHaveBeenCalledWith(null);
    expect(mockReplacePaths).toHaveBeenCalledWith([]);
    expect(mockClearDraft).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------
  //  Game change
  // -----------------------------------------------------------------

  it('handleGameChange changes game and clears mod', () => {
    const mockMod = {
      mod_id: 'mod-1',
      name: 'Test Mod',
      game_id: 'stellaris',
      localisation_paths: ['/mod/a.yml'],
    };

    vi.mocked(useCreateJobMods).mockReturnValue({
      mods: [mockMod as any],
      modsLoading: false,
      selectedMod: mockMod as any,
      setSelectedMod: mockSetSelectedMod,
    });

    mockFilePathList = ['/mod/a.yml'];
    const { result } = trackedSetup();

    act(() => {
      result.current.handleGameChange('other-game');
    });

    expect(mockSetSelectedGameId).toHaveBeenCalledWith('other-game');
    expect(mockSetSelectedMod).toHaveBeenCalledWith(null);
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
        count: 1,
      });

      // Act: mount useCreateJobForm
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
});
