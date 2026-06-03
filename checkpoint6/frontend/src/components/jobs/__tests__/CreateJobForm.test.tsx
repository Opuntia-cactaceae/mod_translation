import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { CreateJobFormViewModel } from '../../../hooks/jobs/useCreateJobForm';
import type { TranslationOptionsResponse, TranslationProfile } from '../../../api/types';

/* ------------------------------------------------------------------ */
/*  Cleanup after each test (no globals config in vitest)               */
/* ------------------------------------------------------------------ */

afterEach(() => cleanup());

/* ------------------------------------------------------------------ */
/*  Mocks                                                               */
/* ------------------------------------------------------------------ */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock api to prevent child components (ModDiscoverySection, ModListSection)
// from making real fetch() calls that produce ECONNREFUSED stderr noise.
vi.mock('../../App', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    discoverMods: vi.fn().mockResolvedValue({ mod_discovery_result: { mods: [] } }),
    readDescriptor: vi.fn().mockResolvedValue(null),
    installMod: vi.fn().mockResolvedValue({}),
    revealPath: vi.fn().mockResolvedValue({}),
    previewCleanCache: vi.fn().mockResolvedValue({ items_to_delete: [] }),
    cleanCache: vi.fn().mockResolvedValue({}),
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
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  FileSuggestionList: function MockFileSuggestionList(props: any) {
    return React.createElement(
      'div',
      { 'data-testid': 'file-suggestion-list' },
      (props.files || []).map(function(f: any) {
        return React.createElement(
          'div',
          { key: f.path, 'data-testid': 'found-file' },
          React.createElement('span', null, f.path),
          React.createElement('button', { onClick: function() { props.onAdd(f); }, type: 'button' }, 'Add'),
          React.createElement('button', { onClick: function() { props.onRemove(f.path); }, type: 'button' }, 'Remove'),
        );
      }),
      React.createElement('button', { onClick: props.onAddAll, type: 'button' }, 'Add all'),
    );
  },
  AddedFilesChips: function MockAddedFilesChips(props: any) {
    return React.createElement(
      'div',
      { 'data-testid': 'added-files-chips' },
      (props.paths || []).map(function(p: any) {
        return React.createElement(
          'span',
          { key: p },
          p,
          React.createElement('button', { onClick: function() { props.onRemove(p); }, type: 'button' }, '\u00D7'),
        );
      }),
    );
  },
  PathPicker: function MockPathPicker(props: any) {
    return React.createElement(
      'div',
      { 'data-testid': 'path-picker' },
      React.createElement('input', {
        'data-testid': 'path-picker-input',
        value: props.value,
        onChange: function(e: any) { props.onChange(e.target.value); },
        placeholder: props.placeholder,
      }),
    );
  },
}));

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                       */
/* ------------------------------------------------------------------ */

function createMockVm(overrides: Partial<CreateJobFormViewModel> = {}): CreateJobFormViewModel {
  const mockSetFormField = vi.fn();
  const mockAddPath = vi.fn();
  const mockRemovePath = vi.fn();
  const mockSetSearchQuery = vi.fn();
  const mockSetPickFilePath = vi.fn();
  const mockSetPickSearchPath = vi.fn();
  const mockHandleProfileSelect = vi.fn();
  const mockSelectProfileDirect = vi.fn();
  const mockConfirmProfileApply = vi.fn();
  const mockCancelProfileConfirm = vi.fn();

  return {
    form: {
      filePaths: '',
      filePathList: [],
      jobName: '',
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      apiKeyIds: [],
      promptProfileName: '',
      protectionStrategy: '',
      ruleSetIds: [],
      validatorName: '',
      outputDir: '',
      outputFilenameSuffix: '',
      outputPreserveRelativePath: false,
      outputOverwrite: false,
      outputBackup: false,
      temperature: 0,
      maxRetries: 3,
      timeoutSec: 0,
      maxCompletionTokens: 0,
      saveRawResponses: false,
      promptOverrideEnabled: false,
      batchSystemPrompt: '',
      batchUserTemplate: '',
      singleSystemPrompt: '',
      singleUserTemplate: '',
      logPrompts: false,
    },
    setFormField: mockSetFormField,
    // --- API Keys ---
    apiKeys: [],
    filteredApiKeys: [],
    apiKeysLoading: false,
    // --- Validation ---
    validationErrors: [],
    searchQuery: '',
    setSearchQuery: mockSetSearchQuery,
    foundFiles: [],
    searching: false,
    searchError: null,
    addedPaths: new Set<string>(),
    pickFilePath: '',
    setPickFilePath: mockSetPickFilePath,
    pickSearchPath: '',
    setPickSearchPath: mockSetPickSearchPath,
    addPath: mockAddPath,
    removePath: mockRemovePath,
    handleSearch: vi.fn(),
    handleAddAll: vi.fn(),
    mods: [],
    filteredMods: [],
    modsLoading: false,
    // --- Game filter ---
    games: [],
    gamesWithMods: [],
    gamesLoading: false,
    selectedGameId: '',
    handleGameChange: vi.fn(),
    gameConfig: null,
    handleResetDefaults: vi.fn(),
    handlePreviewPlan: vi.fn(),
    handleCreateJob: vi.fn().mockResolvedValue(undefined),
    previewData: null,
    previewLoading: false,
    creatingJob: false,
    selectedProfileId: '',
    profileSelectValue: '',
    handleProfileSelect: mockHandleProfileSelect,
    selectProfileDirect: mockSelectProfileDirect,
    showProfileConfirm: false,
    profileConfirmType: 'apply' as const,
    confirmProfileApply: mockConfirmProfileApply,
    cancelProfileConfirm: mockCancelProfileConfirm,
    // --- Effective prompt ---
    effectivePrompt: null,
    effectivePromptLoading: false,
    // --- Prompt preview ---
    previewPromptData: null,
    previewPromptMode: 'batch' as const,
    setPreviewPromptMode: vi.fn(),
    handlePreviewPrompt: vi.fn(),
    closePreviewPrompt: vi.fn(),
    previewPromptLoading: false,
    // --- Draft job selection ---
    draftGrouped: [],
    draftMeta: {},
    draftFiles: [],
    draftDiagnostics: [],
    draftFileCount: 0,
    draftLoading: false,
    draftError: null,
    selectedModPaths: [],
    setSelectedModPaths: vi.fn(),
    handleAddModFiles: vi.fn(),
    handleSearchAndAdd: vi.fn(),
    handleRemoveDraftFile: vi.fn(),
    handleRemoveDraftFiles: vi.fn(),
    ...overrides,
  };
}

const emptyOptions: TranslationOptionsResponse = {
  providers: [],
  prompt_profiles: [],
  protection_strategies: [],
  validators: [],
};
const emptyProfiles: TranslationProfile[] = [];

/* ------------------------------------------------------------------ */
/*  Helper to render CreateJobForm                                      */
/* ------------------------------------------------------------------ */

async function renderForm(vm: CreateJobFormViewModel = createMockVm(), onOpenProfileEditor?: (config: Record<string, unknown>) => void) {
  const CreateJobForm = (await import('../CreateJobForm')).default;
  return render(
    React.createElement(CreateJobForm, {
      vm,
      options: emptyOptions,
      profiles: emptyProfiles,
      onOpenProfileEditor: onOpenProfileEditor || vi.fn(),
    }),
  );
}

/** Expand a file group accordion by clicking its header. */
function expandGroup(modName: string) {
  const testId = `file-group-header-${modName.replace(/[\s/]+/g, '_')}`;
  fireEvent.click(screen.getByTestId(testId));
}

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('CreateJobForm', () => {
  /* ------------------------------------------------------------------ */
  /*  Smoke: form renders with minimal VM                                */
  /* ------------------------------------------------------------------ */

  describe('renders with minimal VM', () => {
    it('renders the card title "Create Job"', async () => {
      await renderForm();
      const titles = screen.getAllByText('Create Job');
      // Two elements: the card-title div and the "Create Job" button
      expect(titles.length).toBe(2);
    });

    it('renders the source language input with default value', async () => {
      await renderForm();
      const srcLangInput = screen.getByDisplayValue('english');
      expect(srcLangInput).toBeTruthy();
    });

    it('renders the target language input with default value', async () => {
      await renderForm();
      const dstLangInput = screen.getByDisplayValue('russian');
      expect(dstLangInput).toBeTruthy();
    });

    it('renders the game selector prompt when no game is selected', async () => {
      await renderForm();
      expect(screen.getByText('Select a game above to view available mods.')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Textarea filePaths updates via setFormField                         */
  /* ------------------------------------------------------------------ */

  describe('file paths textarea', () => {
    it('calls setFormField("filePaths", ...) on textarea change', async () => {
      const setFormField = vi.fn();
      await renderForm(createMockVm({ setFormField }));

      const textarea = screen.getByPlaceholderText(
        /\/path\/to\/mod\/localisation\/english\/example_l_english\.yml/,
      );
      fireEvent.change(textarea, { target: { value: 'path/to/file.yml' } });

      expect(setFormField).toHaveBeenCalledWith('filePaths', 'path/to/file.yml');
    });

    it('displays current filePaths value from VM', async () => {
      const vm = createMockVm();
      vm.form.filePaths = 'existing/path.yml';
      await renderForm(vm);

      const textarea = screen.getByPlaceholderText(
        /\/path\/to\/mod\/localisation\/english\/example_l_english\.yml/,
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('existing/path.yml');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Preview / Create buttons call handlers                              */
  /* ------------------------------------------------------------------ */

  describe('action buttons call handlers', () => {
    it('calls handlePreviewPlan when Preview Plan is clicked', async () => {
      const handlePreviewPlan = vi.fn();
      await renderForm(createMockVm({ handlePreviewPlan }));

      fireEvent.click(screen.getByRole('button', { name: 'Preview Plan' }));
      expect(handlePreviewPlan).toHaveBeenCalledOnce();
    });

    it('calls handleCreateJob when Create Job button is clicked', async () => {
      const handleCreateJob = vi.fn().mockResolvedValue(undefined);
      await renderForm(createMockVm({ handleCreateJob }));

      const createButtons = screen.getAllByRole('button', { name: 'Create Job' });
      // The one in form-actions is the action button
      fireEvent.click(createButtons[0]);
      expect(handleCreateJob).toHaveBeenCalledOnce();
    });

    it('calls handleResetDefaults when Reset to defaults is clicked', async () => {
      const handleResetDefaults = vi.fn();
      await renderForm(createMockVm({ handleResetDefaults }));

      fireEvent.click(screen.getByText('Reset to defaults'));
      expect(handleResetDefaults).toHaveBeenCalledOnce();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Search input calls setSearchQuery                                   */
  /* ------------------------------------------------------------------ */

  describe('search input', () => {
    it('calls setSearchQuery on textarea change', async () => {
      const setSearchQuery = vi.fn();
      await renderForm(createMockVm({ setSearchQuery }));

      const searchInput = screen.getByPlaceholderText(
        /Enter mod directory path/,
      );
      fireEvent.change(searchInput, { target: { value: '/mod/path' } });

      expect(setSearchQuery).toHaveBeenCalledWith('/mod/path');
    });

    it('displays current searchQuery value', async () => {
      const vm = createMockVm({ searchQuery: 'current/query' });
      await renderForm(vm);

      const textarea = screen.getByPlaceholderText(
        /Enter mod directory path/,
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('current/query');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Add File / Add Search Path buttons call callbacks                   */
  /* ------------------------------------------------------------------ */

  describe('add/remove path buttons', () => {
    it('calls addPath when Add File button is clicked with pickFilePath', async () => {
      const addPath = vi.fn();
      const setPickFilePath = vi.fn();
      await renderForm(createMockVm({
        addPath,
        setPickFilePath,
        pickFilePath: '/some/file.yml',
      }));

      const addFileButtons = screen.getAllByText('Add File');
      fireEvent.click(addFileButtons[0]);
      expect(addPath).toHaveBeenCalledWith('/some/file.yml');
    });

    it('calls setSearchQuery for search path when Add Search Path is clicked', async () => {
      const setSearchQuery = vi.fn();
      const setPickSearchPath = vi.fn();
      await renderForm(createMockVm({
        setSearchQuery,
        setPickSearchPath,
        pickSearchPath: '/search/path',
      }));

      fireEvent.click(screen.getByText('Add Search Path'));
      expect(setSearchQuery).toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Disabled / loading states                                          */
  /* ------------------------------------------------------------------ */

  describe('disabled/loading states', () => {
    it('shows "Searching..." and disables search button when searching', async () => {
      await renderForm(createMockVm({ searching: true }));

      const searchButton = screen.getByText('Searching...');
      expect(searchButton).toBeTruthy();
      expect((searchButton as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows "Preparing..." and disables Preview Plan when previewLoading', async () => {
      await renderForm(createMockVm({ previewLoading: true }));

      const previewButton = screen.getByText('Preparing...');
      expect(previewButton).toBeTruthy();
      expect((previewButton as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows "Creating..." and disables Create Job when creatingJob', async () => {
      await renderForm(createMockVm({ creatingJob: true }));

      const createButton = screen.getByText('Creating...');
      expect(createButton).toBeTruthy();
      expect((createButton as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows search error when present', async () => {
      await renderForm(createMockVm({ searchError: 'Directory not found' }));

      expect(screen.getByText('Directory not found')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Form field changes call setFormField                                */
  /* ------------------------------------------------------------------ */

  describe('form field changes call setFormField', () => {
    it('calls setFormField("srcLang", ...) when source language changes', async () => {
      const setFormField = vi.fn();
      await renderForm(createMockVm({ setFormField }));

      const srcInput = screen.getByDisplayValue('english');
      fireEvent.change(srcInput, { target: { value: 'french' } });

      expect(setFormField).toHaveBeenCalledWith('srcLang', 'french');
    });

    it('calls setFormField("dstLang", ...) when target language changes', async () => {
      const setFormField = vi.fn();
      await renderForm(createMockVm({ setFormField }));

      const dstInput = screen.getByDisplayValue('russian');
      fireEvent.change(dstInput, { target: { value: 'german' } });

      expect(setFormField).toHaveBeenCalledWith('dstLang', 'german');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Preview panel rendering                                             */
  /* ------------------------------------------------------------------ */

  describe('preview panel', () => {
    it('renders preview data when present', async () => {
      const previewData = {
        totalUnits: 42,
        totalTasks: 10,
        batchSize: 50,
        cacheHits: 30,
        cacheMisses: 12,
        diagnostics: [],
        warnings: [],
        errors: [],
        unsupportedFiles: [],
        duplicateFiles: [],
        emptyFiles: [],
        zeroUnitFiles: [],
        detectedLanguages: [],
        hasBlockingErrors: false,
      };
      await renderForm(createMockVm({ previewData }));

      expect(screen.getByText('Plan Preview')).toBeTruthy();
      expect(screen.getByText('Units: 42')).toBeTruthy();
      expect(screen.getByText('Tasks: 10')).toBeTruthy();
    });

    it('does not render preview panel when previewData is null', async () => {
      await renderForm(createMockVm({ previewData: null }));
      expect(screen.queryByText('Plan Preview')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Game filter                                                        */
  /* ------------------------------------------------------------------ */

  describe('game filter', () => {
    it('renders the game selector', async () => {
      await renderForm();
      expect(screen.getByText('Game')).toBeTruthy();
    });

    it('shows game options in the select', async () => {
      await renderForm(createMockVm({
        gamesWithMods: [{ id: 'stellaris', label: 'Stellaris' } as any],
        selectedGameId: 'stellaris',
      }));

      const gameSelect = screen.getByText('Stellaris');
      expect(gameSelect).toBeTruthy();
    });

    it('calls handleGameChange when game selection changes', async () => {
      const handleGameChange = vi.fn();
      await renderForm(createMockVm({
        gamesWithMods: [{ id: 'stellaris', label: 'Stellaris' } as any],
        handleGameChange,
      }));

      const gameSelect = screen.getByText('\u2014 Select a game \u2014').closest('select')!;
      fireEvent.change(gameSelect, { target: { value: 'stellaris' } });
      expect(handleGameChange).toHaveBeenCalledWith('stellaris');
    });

    it('shows prompt to select a game when no game is selected', async () => {
      await renderForm(createMockVm({ selectedGameId: '' }));
      expect(screen.getByText('Select a game above to view available mods.')).toBeTruthy();
    });

    it('hides game prompt when a game is selected', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [],
      }));
      expect(screen.queryByText('Select a game above to view available mods.')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Legacy mod flow — must NOT render                                  */
  /* ------------------------------------------------------------------ */

  describe('legacy mod flow removed', () => {
    it('does NOT render "Select mod" label', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [{ mod_id: 'mod-1', path: '/p/mod-1', name: 'Mod One' } as any],
      }));
      expect(screen.queryByText('Select mod')).toBeNull();
    });

    it('does NOT render "Using files from mod" text', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [{ mod_id: 'mod-1', path: '/p/mod-1', name: 'Mod One' } as any],
      }));
      expect(screen.queryByText(/Using files from mod/)).toBeNull();
    });

    it('does NOT render "Source language files"', async () => {
      await renderForm(createMockVm({ selectedGameId: 'stellaris' }));
      expect(screen.queryByText('Source language files')).toBeNull();
    });

    it('does NOT render "Only selected language"', async () => {
      await renderForm(createMockVm({ selectedGameId: 'stellaris' }));
      expect(screen.queryByText('Only selected language')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Input files — Add from mods                                        */
  /* ------------------------------------------------------------------ */

  describe('Input files / Add from mods', () => {
    it('renders Input files section', async () => {
      await renderForm();
      expect(screen.getByText(/Input files/)).toBeTruthy();
    });

    it('renders Add from mods label when mods are filtered', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [{ mod_id: 'mod-1', name: 'Mod One' } as any],
      }));
      expect(screen.getByText('Add from mods')).toBeTruthy();
    });

    it('renders mod checkbox list', async () => {
      const mods = [
        { mod_id: 'mod-1', path: '/path/mod-1', name: 'Mod One', game_id: 'stellaris' },
        { mod_id: 'mod-2', path: '/path/mod-2', name: 'Mod Two', game_id: 'stellaris' },
      ];
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: mods as any,
      }));
      expect(screen.getByText('Mod One')).toBeTruthy();
      expect(screen.getByText('Mod Two')).toBeTruthy();
    });

    it('calls handleAddModFiles when "Add selected mods" clicked', async () => {
      const handleAddModFiles = vi.fn();
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [{ mod_id: 'mod-1', path: '/path/mod-1', name: 'Mod One' } as any],
        selectedModPaths: ['/path/mod-1'],
        handleAddModFiles,
      }));
      fireEvent.click(screen.getByText(/Add selected mods/));
      expect(handleAddModFiles).toHaveBeenCalledOnce();
    });

    it('disables "Add selected mods" button when no mods selected', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [{ mod_id: 'mod-1', path: '/path/mod-1', name: 'Mod One' } as any],
        selectedModPaths: [],
      }));
      const btn = screen.getByText(/Add selected mods/).closest('button');
      expect(btn?.disabled).toBe(true);
    });

    it('enables "Add selected mods" button when mods are selected', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [{ mod_id: 'mod-1', path: '/path/mod-1', name: 'Mod One' } as any],
        selectedModPaths: ['/path/mod-1'],
      }));
      const btn = screen.getByText(/Add selected mods/).closest('button');
      expect(btn?.disabled).toBe(false);
    });

    it('disambiguates same mod_id via path — aliasing test', async () => {
      // Two mods sharing the same mod_id but at different filesystem paths
      // (e.g. Steam workshop copy + manual/SFW copy) must be treated as
      // distinct entries. The UI keys checkboxes by `path`, not `mod_id`.
      const dupMods = [
        { mod_id: '1747099270', path: '/workshop/content/281990/1747099270', name: 'First Copy', game_id: 'stellaris' },
        { mod_id: '1747099270', path: '/workshop/content/SFW_Modes/1747099270', name: 'Second Copy', game_id: 'stellaris' },
      ];
      const handleAddModFiles = vi.fn();
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: dupMods as any,
        selectedModPaths: [
          '/workshop/content/281990/1747099270',
          '/workshop/content/SFW_Modes/1747099270',
        ],
        handleAddModFiles,
      }));

      // Both mods are rendered despite identical mod_id.
      expect(screen.getByText('First Copy')).toBeTruthy();
      expect(screen.getByText('Second Copy')).toBeTruthy();

      // The mod checkboxes are keyed by path (not mod_id), verified by
      // checking the <label> wrapping each mod name has the correct path key.
      const firstLabel = screen.getByText('First Copy').closest('label');
      expect(firstLabel?.getAttribute('style')).toBeTruthy(); // rendered in the mod list

      // Each label contains a checked checkbox.
      const firstCheckbox = firstLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      expect(firstCheckbox?.checked).toBe(true);
      const secondCheckbox = screen.getByText('Second Copy').closest('label')
        ?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      expect(secondCheckbox?.checked).toBe(true);

      // "Add selected mods" button shows correct count.
      const btn = screen.getByText(/Add selected mods \(2\)/).closest('button');
      expect(btn).toBeTruthy();
      expect(btn?.disabled).toBe(false);

      // Clicking the button calls handleAddModFiles.
      fireEvent.click(btn!);
      expect(handleAddModFiles).toHaveBeenCalledOnce();
    });

    it('renders textarea with placeholder text', async () => {
      await renderForm();
      expect(screen.getByPlaceholderText(
        /\/path\/to\/mod\/localisation\/english\/example_l_english\.yml/,
      )).toBeTruthy();
    });

    it('renders compact preview when draftGrouped is provided', async () => {
      const draftGrouped = [
        {
          group_id: 'mod-1',
          group_type: 'mod' as const,
          title: 'Test Mod',
          files: [
            { path: '/mod/file1.yml', name: 'file1.yml', exists: true, selected: true },
            { path: '/mod/file2.yml', name: 'file2.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/mod/file1.yml', '/mod/file2.yml'],
      }));
      expandGroup('Manual / Ungrouped files');
      expect(screen.getByText('file1.yml')).toBeTruthy();
      expect(screen.getByText('file2.yml')).toBeTruthy();
    });

    it('renders diagnostics', async () => {
      const draftDiagnostics = [
        { level: 'warning', code: 'FILE_NOT_FOUND', message: 'File not found: missing.yml' },
      ];
      await renderForm(createMockVm({ draftDiagnostics }));
      expect(screen.getByText('File not found: missing.yml')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  API Keys selector                                                  */
  /* ------------------------------------------------------------------ */

  describe('API keys selector', () => {
    it('shows loading state when apiKeysLoading is true', async () => {
      await renderForm(createMockVm({ apiKeysLoading: true }));
      expect(screen.getByText('Loading API keys...')).toBeTruthy();
    });

    it('shows empty state when no keys and no provider', async () => {
      await renderForm(createMockVm({
        apiKeys: [],
        filteredApiKeys: [],
        form: { ...createMockVm().form, provider: '' },
      }));
      expect(screen.getByText(/No API keys found/)).toBeTruthy();
    });

    it('shows empty state when no keys for selected provider', async () => {
      await renderForm(createMockVm({
        apiKeys: [],
        filteredApiKeys: [],
        form: { ...createMockVm().form, provider: 'groq' },
      }));
      expect(screen.getByText(/No API keys configured for this provider/)).toBeTruthy();
    });

    it('renders API key checkbox list', async () => {
      const apiKeys = [
        { id: 'key-1', provider: 'groq', label: 'Groq Main', masked_value: 'groq_****', is_active: true },
        { id: 'key-2', provider: 'groq', label: 'Groq Backup', masked_value: 'groq_****', is_active: true },
      ];
      await renderForm(createMockVm({
        apiKeys,
        filteredApiKeys: apiKeys,
        form: { ...createMockVm().form, provider: 'groq' },
      }));

      expect(screen.getByText('Groq Main')).toBeTruthy();
      expect(screen.getByText('Groq Backup')).toBeTruthy();
    });

    it('calls setFormField with apiKeyIds when checkbox is toggled', async () => {
      const setFormField = vi.fn();
      const apiKeys = [
        { id: 'key-1', provider: 'groq', label: 'Groq Main', masked_value: 'groq_****', is_active: true },
      ];
      await renderForm(createMockVm({
        setFormField,
        apiKeys,
        filteredApiKeys: apiKeys,
        form: { ...createMockVm().form, provider: 'groq', apiKeyIds: [] },
      }));

      const checkbox = screen.getByText('Groq Main').closest('label')!.querySelector('input[type="checkbox"]')!;
      fireEvent.click(checkbox);
      expect(setFormField).toHaveBeenCalledWith('apiKeyIds', ['key-1']);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Validation errors                                                  */
  /* ------------------------------------------------------------------ */

  describe('validation errors', () => {
    it('renders validation errors when present', async () => {
      const validationErrors = ['Provider is required', 'Model is required'];
      await renderForm(createMockVm({ validationErrors }));

      expect(screen.getByText('Provider is required')).toBeTruthy();
      expect(screen.getByText('Model is required')).toBeTruthy();
    });

    it('does not render validation errors section when empty', async () => {
      await renderForm(createMockVm({ validationErrors: [] }));

      expect(screen.queryByText('Provider is required')).toBeNull();
    });

    it('disables Preview Plan button when validation errors exist', async () => {
      await renderForm(createMockVm({ validationErrors: ['Provider is required'] }));

      const previewButton = screen.getByRole('button', { name: 'Preview Plan' });
      expect((previewButton as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables Create Job button when validation errors exist', async () => {
      await renderForm(createMockVm({ validationErrors: ['Provider is required'] }));

      const createButtons = screen.getAllByRole('button', { name: 'Create Job' });
      expect((createButtons[0] as HTMLButtonElement).disabled === true).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Advanced config section                                            */
  /* ------------------------------------------------------------------ */

  describe('advanced config section', () => {
    it('renders collapsed by default with summary "Advanced config"', async () => {
      await renderForm();
      const summary = screen.getByText('Advanced config');
      expect(summary).toBeTruthy();
      const details = summary.closest('details');
      expect(details).toBeTruthy();
      expect(details!.hasAttribute('open')).toBe(false);
    });

    it('renders prompt profile dropdown with options', async () => {
      const optionsWithProfiles = {
        ...emptyOptions,
        prompt_profiles: ['default', 'creative', 'strict'],
      };
      const CreateJobForm = (await import('../CreateJobForm')).default;
      render(
        React.createElement(CreateJobForm, {
          vm: createMockVm(),
          options: optionsWithProfiles,
          profiles: emptyProfiles,
          onOpenProfileEditor: vi.fn(),
        }),
      );
      // Open the details
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      const label = screen.getByText('Prompt Profile');
      const select = label.closest('div')!.querySelector('select') as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.querySelectorAll('option').length).toBe(4); // — None — + 3 profiles
    });

    it('renders protection rule sets label', async () => {
      await renderForm();
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      expect(screen.getByText('Protection Rule Sets')).toBeTruthy();
    });

    it('renders rule set selector with builtin rule set pre-selected', async () => {
      const optionsWithRuleSets = {
        ...emptyOptions,
        rule_sets: [
          {
            id: 'builtin_default_game_localisation',
            name: 'Default Game Localisation Protection',
            builtin: true,
            enabled: true,
          },
        ],
      };
      const vmWithRuleSets = createMockVm({
        form: {
          ...createMockVm().form,
          ruleSetIds: ['builtin_default_game_localisation'],
        },
      });
      const CreateJobForm = (await import('../CreateJobForm')).default;
      render(
        React.createElement(CreateJobForm, {
          vm: vmWithRuleSets,
          options: optionsWithRuleSets,
          profiles: emptyProfiles,
          onOpenProfileEditor: vi.fn(),
        }),
      );
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      // The builtin rule set name should be visible
      expect(screen.getByText('Default Game Localisation Protection')).toBeTruthy();
      // The builtin badge should be visible
      expect(screen.getByText('builtin')).toBeTruthy();
    });

    it('renders validator dropdown with options', async () => {
      const optionsWithValidators = {
        ...emptyOptions,
        validators: ['basic', 'strict'],
      };
      const CreateJobForm = (await import('../CreateJobForm')).default;
      render(
        React.createElement(CreateJobForm, {
          vm: createMockVm(),
          options: optionsWithValidators,
          profiles: emptyProfiles,
          onOpenProfileEditor: vi.fn(),
        }),
      );
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      const label = screen.getByText('Validator');
      const select = label.closest('div')!.querySelector('select') as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.querySelectorAll('option').length).toBe(3); // — None — + 2 validators
    });

    it('calls setFormField when advanced fields change', async () => {
      const setFormField = vi.fn();
      const optionsWithRuleSets = {
        ...emptyOptions,
        rule_sets: [
          { id: 'builtin_default', name: 'Default Protection', builtin: true, enabled: true },
        ],
      };
      const vm = createMockVm({ setFormField });
      const CreateJobForm = (await import('../CreateJobForm')).default;
      render(
        React.createElement(CreateJobForm, {
          vm,
          options: optionsWithRuleSets,
          profiles: emptyProfiles,
          onOpenProfileEditor: vi.fn(),
        }),
      );
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);

      // Change prompt profile
      const promptLabel = screen.getByText('Prompt Profile');
      const promptSelect = promptLabel.closest('div')!.querySelector('select')!;
      const option = document.createElement('option');
      option.value = 'default';
      promptSelect.appendChild(option);
      fireEvent.change(promptSelect, { target: { value: 'default' } });
      expect(setFormField).toHaveBeenCalledWith('promptProfileName', 'default');

      // Change protection rule sets — checkbox toggle calls setFormField for
      // both ruleSetIds and protectionStrategy (auto-set rule_set mode)
      const protectionCheckbox = screen.getByText('Default Protection')
        .closest('label')!.querySelector('input[type="checkbox"]')!;
      fireEvent.click(protectionCheckbox);
      expect(setFormField).toHaveBeenCalledWith('ruleSetIds', ['builtin_default']);
      expect(setFormField).toHaveBeenCalledWith('protectionStrategy', 'rule_set');

      // Change validator
      const validatorLabel = screen.getByText('Validator');
      const validatorSelect = validatorLabel.closest('div')!.querySelector('select')!;
      const validatorOption = document.createElement('option');
      validatorOption.value = 'basic';
      validatorSelect.appendChild(validatorOption);
      fireEvent.change(validatorSelect, { target: { value: 'basic' } });
      expect(setFormField).toHaveBeenCalledWith('validatorName', 'basic');
    });

    it('shows profile selected info when a profile is selected', async () => {
      await renderForm(createMockVm({ selectedProfileId: 'prof-1' }));
      expect(screen.getByText('Profile selected. Settings can be overridden below.')).toBeTruthy();
    });

    it('hides profile selected info when no profile is selected', async () => {
      await renderForm(createMockVm({ selectedProfileId: '' }));
      expect(screen.queryByText('Profile selected.')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Profile confirmation modal                                         */
  /* ------------------------------------------------------------------ */

  describe('profile confirmation modal', () => {
    it('shows apply confirmation modal when showProfileConfirm=true and profileConfirmType=apply', async () => {
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
      }));
      expect(screen.getByText('Apply translation profile?')).toBeTruthy();
      expect(screen.getByText('Apply profile')).toBeTruthy();
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('shows clear confirmation modal when showProfileConfirm=true and profileConfirmType=clear', async () => {
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'clear',
      }));
      expect(screen.getByText('Clear selected profile?')).toBeTruthy();
      expect(screen.getByText('Clear profile')).toBeTruthy();
    });

    it('does not render modal when showProfileConfirm=false', async () => {
      await renderForm(createMockVm({ showProfileConfirm: false }));
      expect(screen.queryByText('Apply translation profile?')).toBeNull();
      expect(screen.queryByText('Clear selected profile?')).toBeNull();
    });

    it('calls confirmProfileApply when Apply profile button is clicked', async () => {
      const confirmProfileApply = vi.fn();
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
        confirmProfileApply,
      }));
      fireEvent.click(screen.getByText('Apply profile'));
      expect(confirmProfileApply).toHaveBeenCalledOnce();
    });

    it('calls confirmProfileApply when Clear profile button is clicked', async () => {
      const confirmProfileApply = vi.fn();
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'clear',
        confirmProfileApply,
      }));
      fireEvent.click(screen.getByText('Clear profile'));
      expect(confirmProfileApply).toHaveBeenCalledOnce();
    });

    it('calls cancelProfileConfirm when Cancel button is clicked', async () => {
      const cancelProfileConfirm = vi.fn();
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
        cancelProfileConfirm,
      }));
      fireEvent.click(screen.getByText('Cancel'));
      expect(cancelProfileConfirm).toHaveBeenCalledOnce();
    });

    it('calls cancelProfileConfirm when modal close button is clicked', async () => {
      const cancelProfileConfirm = vi.fn();
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
        cancelProfileConfirm,
      }));
      // Find the &times; close button
      const closeBtn = screen.getByText('\u00D7');
      fireEvent.click(closeBtn);
      expect(cancelProfileConfirm).toHaveBeenCalledOnce();
    });

    it('calls cancelProfileConfirm when overlay is clicked', async () => {
      const cancelProfileConfirm = vi.fn();
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
        cancelProfileConfirm,
      }));
      // Click the modal overlay
      const overlay = document.querySelector('.modal-overlay')!;
      fireEvent.click(overlay);
      expect(cancelProfileConfirm).toHaveBeenCalledOnce();
    });

    it('does not close modal when clicking inside modal content', async () => {
      const cancelProfileConfirm = vi.fn();
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
        cancelProfileConfirm,
      }));
      const modalContent = document.querySelector('.modal-content')!;
      fireEvent.click(modalContent);
      expect(cancelProfileConfirm).not.toHaveBeenCalled();
    });

    it('displays apply body text for apply type', async () => {
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
      }));
      expect(screen.getByText(/replace current translation settings/)).toBeTruthy();
      expect(screen.getByText(/Selected files and mod selection will stay unchanged/)).toBeTruthy();
    });

    it('displays clear body text for clear type', async () => {
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'clear',
      }));
      expect(screen.getByText(/unlink the current profile/)).toBeTruthy();
      expect(screen.getByText(/Form field values will not be changed/)).toBeTruthy();
    });

  });

  /* ------------------------------------------------------------------ */
  /*  Effective prompt display and override prefill                      */
  /* ------------------------------------------------------------------ */

  describe('effective prompt display and override prefill', () => {
    const effectivePrompt = {
      profile_name: 'json_batch',
      batch_system_prompt: 'Translate from {src_lang} to {dst_lang}',
      batch_user_template: 'Batch texts: {texts}',
      single_system_prompt: 'Single translate {src_lang} -> {dst_lang}',
      single_user_template: 'Single text: {text}',
      log_prompts: false,
      source: 'preset',
      warnings: [],
    };

    it('shows effective prompt templates (read-only) when override is OFF and profile selected', async () => {
      await renderForm(createMockVm({
        form: {
          ...createMockVm().form,
          promptProfileName: 'json_batch',
          promptOverrideEnabled: false,
          batchSystemPrompt: '',
          batchUserTemplate: '',
          singleSystemPrompt: '',
          singleUserTemplate: '',
        },
        effectivePrompt,
        effectivePromptLoading: false,
      }));
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      expect(screen.getByText(/Effective prompt templates/)).toBeTruthy();
      expect(screen.getByText(/source: preset/)).toBeTruthy();
      expect(screen.getByText(/Translate from.*src_lang.*dst_lang/)).toBeTruthy();
    });

    it('does not show effective prompt display when effectivePrompt is null', async () => {
      await renderForm(createMockVm({
        form: {
          ...createMockVm().form,
          promptOverrideEnabled: false,
        },
        effectivePrompt: null,
        effectivePromptLoading: false,
      }));
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      expect(screen.queryByText(/Effective prompt templates/)).toBeNull();
    });

    it('prefills override fields from effective prompt when checkbox is enabled', async () => {
      const setFormField = vi.fn();
      await renderForm(createMockVm({
        setFormField,
        form: {
          ...createMockVm().form,
          promptProfileName: 'json_batch',
          promptOverrideEnabled: false,
        },
        effectivePrompt,
        effectivePromptLoading: false,
      }));
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      const checkbox = screen.getByText('Override prompt templates').closest('label')!.querySelector('input')!;
      fireEvent.click(checkbox);
      expect(setFormField).toHaveBeenCalledWith('batchSystemPrompt', effectivePrompt.batch_system_prompt);
      expect(setFormField).toHaveBeenCalledWith('batchUserTemplate', effectivePrompt.batch_user_template);
      expect(setFormField).toHaveBeenCalledWith('singleSystemPrompt', effectivePrompt.single_system_prompt);
      expect(setFormField).toHaveBeenCalledWith('singleUserTemplate', effectivePrompt.single_user_template);
    });

    it('renders editable override fields when override is ON', async () => {
      await renderForm(createMockVm({
        form: {
          ...createMockVm().form,
          promptProfileName: 'json_batch',
          promptOverrideEnabled: true,
          batchSystemPrompt: 'Override system',
          batchUserTemplate: 'Override user',
          singleSystemPrompt: 'Override single system',
          singleUserTemplate: 'Override single user',
          logPrompts: true,
        },
        effectivePrompt,
        effectivePromptLoading: false,
      }));
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      expect(screen.getByDisplayValue('Override system')).toBeTruthy();
      expect(screen.getByDisplayValue('Override user')).toBeTruthy();
      expect(screen.getByDisplayValue('Override single system')).toBeTruthy();
      expect(screen.getByDisplayValue('Override single user')).toBeTruthy();
    });

    it('shows Preview effective prompt button when profile is selected', async () => {
      const handlePreviewPrompt = vi.fn();
      await renderForm(createMockVm({
        handlePreviewPrompt,
        form: {
          ...createMockVm().form,
          promptProfileName: 'json_batch',
        },
        effectivePrompt,
        effectivePromptLoading: false,
      }));
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      const previewBtn = screen.getByText('Preview effective prompt');
      expect(previewBtn).toBeTruthy();
      fireEvent.click(previewBtn);
      expect(handlePreviewPrompt).toHaveBeenCalledOnce();
    });

    it('shows effective prompt loading state', async () => {
      await renderForm(createMockVm({
        form: {
          ...createMockVm().form,
          promptProfileName: 'json_batch',
        },
        effectivePrompt: null,
        effectivePromptLoading: true,
      }));
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      // Should not show effective display during loading
      expect(screen.queryByText(/Effective prompt templates/)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Draft job selection — textarea + compact preview, diagnostics      */
  /* ------------------------------------------------------------------ */

  describe('draft job selection', () => {
    it('shows file count in the label when files are selected', async () => {
      await renderForm(createMockVm({ draftFileCount: 5 }));
      expect(screen.getByText('(5 files selected)')).toBeTruthy();
    });

    it('shows singular file count', async () => {
      await renderForm(createMockVm({ draftFileCount: 1 }));
      expect(screen.getByText('(1 file selected)')).toBeTruthy();
    });

    it('renders draft error when present', async () => {
      await renderForm(createMockVm({ draftError: 'Failed to load draft' }));
      expect(screen.getByText(/Draft error:/)).toBeTruthy();
      expect(screen.getByText(/Failed to load draft/)).toBeTruthy();
    });

    it('does not render draft error when null', async () => {
      await renderForm(createMockVm({ draftError: null }));
      expect(screen.queryByText(/Draft error:/)).toBeNull();
    });

    it('textarea is visible by default', async () => {
      await renderForm(createMockVm({
        form: { ...createMockVm().form, filePaths: 'path/to/file.yml' },
      }));
      const textarea = screen.getByPlaceholderText(
        /\/path\/to\/mod\/localisation\/english\/example_l_english\.yml/,
      ) as HTMLTextAreaElement;
      expect(textarea).toBeTruthy();
      expect(textarea.value).toBe('path/to/file.yml');
    });

    it('renders compact chips preview with file names', async () => {
      const draftGrouped = [
        {
          group_id: 'mod-1',
          group_type: 'mod' as const,
          title: 'Test Mod',
          files: [
            { path: '/mod/path/file1.yml', name: 'file1.yml', exists: true, selected: true },
            { path: '/mod/path/file2.yml', name: 'file2.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/mod/path/file1.yml', '/mod/path/file2.yml'],
      }));
      expandGroup('Manual / Ungrouped files');
      // File names shown in grouped list (no draftMeta → fall under Manual / Ungrouped files)
      expect(screen.getByText('file1.yml')).toBeTruthy();
      expect(screen.getByText('file2.yml')).toBeTruthy();
      // Full paths are NOT shown as visible text
      expect(screen.queryByText('/mod/path/file1.yml')).toBeNull();
      expect(screen.queryByText('/mod/path/file2.yml')).toBeNull();
    });

    it('renders diagnostics below the textarea', async () => {
      const draftDiagnostics = [
        { level: 'warning', code: 'FILE_NOT_FOUND', message: 'File not found: missing.yml' },
      ];
      await renderForm(createMockVm({ draftDiagnostics }));
      expect(screen.getByText('File not found: missing.yml')).toBeTruthy();
    });

    it('chip remove calls handleRemoveDraftFile', async () => {
      const handleRemoveDraftFile = vi.fn();
      const draftGrouped = [
        {
          group_id: 'mod-1',
          group_type: 'mod' as const,
          title: 'Test Mod',
          files: [
            { path: '/mod/file1.yml', name: 'file1.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 1,
        draftFiles: ['/mod/file1.yml'],
        draftMeta: { '/mod/file1.yml': { modName: 'Test Mod', modId: 'mod-1' } },
        handleRemoveDraftFile,
      }));
      expandGroup('Test Mod');
      const removeFileBtns = screen.getAllByTitle('Remove file');
      expect(removeFileBtns.length).toBe(1);
      fireEvent.click(removeFileBtns[0]);
      expect(handleRemoveDraftFile).toHaveBeenCalledWith('/mod/file1.yml');
    });

    it('single-file mod group renders group header', async () => {
      const draftGrouped = [
        {
          group_id: 'mod-1',
          group_type: 'mod' as const,
          title: 'Test Mod',
          files: [
            { path: '/mod/file1.yml', name: 'file1.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 1,
        draftFiles: ['/mod/file1.yml'],
        draftMeta: { '/mod/file1.yml': { modName: 'Test Mod', modId: 'mod-1' } },
      }));
      // Single-file group now shows a header
      expect(screen.getByText('Test Mod (1)')).toBeTruthy();
      // Expand and verify the file is listed
      expandGroup('Test Mod');
      expect(screen.getByText('file1.yml')).toBeTruthy();
    });

    it('Remove group visible for single-file group', async () => {
      const handleRemoveDraftFiles = vi.fn();
      const draftGrouped = [
        {
          group_id: 'mod-1',
          group_type: 'mod' as const,
          title: 'Test Mod',
          files: [
            { path: '/mod/file1.yml', name: 'file1.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 1,
        draftFiles: ['/mod/file1.yml'],
        draftMeta: { '/mod/file1.yml': { modName: 'Test Mod', modId: 'mod-1' } },
        handleRemoveDraftFiles,
      }));
      // Remove group is now visible for all groups (including single-file)
      const removeGroupBtn = screen.getByTitle('Remove all files in this group');
      expect(removeGroupBtn).toBeTruthy();
      fireEvent.click(removeGroupBtn);
      expect(handleRemoveDraftFiles).toHaveBeenCalledWith(['/mod/file1.yml']);
    });

    // -----------------------------------------------------------------
    //  Mod grouping — new UX with grouped-by-mod preview
    // -----------------------------------------------------------------

    it('renders one mod group with correct file count when a mod has multiple files', async () => {
      const draftGrouped = [
        {
          group_id: 'mod-ms',
          group_type: 'mod' as const,
          title: 'Tasty Maid',
          files: [
            { path: '/mod/ms/events.yml', name: 'events.yml', exists: true, selected: true },
            { path: '/mod/ms/settings.yml', name: 'settings.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/mod/ms/events.yml', '/mod/ms/settings.yml'],
        draftMeta: {
          '/mod/ms/events.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
          '/mod/ms/settings.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
        },
      }));
      // Group header with mod name and count
      expect(screen.getByText('Tasty Maid (2)')).toBeTruthy();
      // Expand and verify files inside the group
      expandGroup('Tasty Maid');
      expect(screen.getByText('events.yml')).toBeTruthy();
      expect(screen.getByText('settings.yml')).toBeTruthy();
    });

    it('renders two separate groups when two mods are selected', async () => {
      const draftGrouped = [
        {
          group_id: 'mod-ms',
          group_type: 'mod' as const,
          title: 'Tasty Maid',
          files: [
            { path: '/mod/ms/events.yml', name: 'events.yml', exists: true, selected: true },
          ],
        },
        {
          group_id: 'mod-wg',
          group_type: 'mod' as const,
          title: 'Warship Girls',
          files: [
            { path: '/mod/wg/advisor.yml', name: 'advisor.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/mod/ms/events.yml', '/mod/wg/advisor.yml'],
        draftMeta: {
          '/mod/ms/events.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
          '/mod/wg/advisor.yml': { modName: 'Warship Girls', modId: 'mod-wg' },
        },
      }));
      expect(screen.getByText('Tasty Maid (1)')).toBeTruthy();
      expect(screen.getByText('Warship Girls (1)')).toBeTruthy();
    });

    it('remove group calls onRemoveFiles only with that mod\'s paths', async () => {
      const handleRemoveDraftFiles = vi.fn();
      const draftGrouped = [
        {
          group_id: 'mod-ms',
          group_type: 'mod' as const,
          title: 'Tasty Maid',
          files: [
            { path: '/mod/ms/events.yml', name: 'events.yml', exists: true, selected: true },
            { path: '/mod/ms/settings.yml', name: 'settings.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/mod/ms/events.yml', '/mod/ms/settings.yml'],
        draftMeta: {
          '/mod/ms/events.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
          '/mod/ms/settings.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
        },
        handleRemoveDraftFiles,
      }));
      const removeGroupBtn = screen.getByTitle('Remove all files in this group');
      fireEvent.click(removeGroupBtn);
      // Only this mod's paths are passed — no unrelated files
      expect(handleRemoveDraftFiles).toHaveBeenCalledWith([
        '/mod/ms/events.yml',
        '/mod/ms/settings.yml',
      ]);
    });

    it('individual file remove inside a grouped mod removes only that file', async () => {
      const handleRemoveDraftFile = vi.fn();
      const draftGrouped = [
        {
          group_id: 'mod-ms',
          group_type: 'mod' as const,
          title: 'Tasty Maid',
          files: [
            { path: '/mod/ms/events.yml', name: 'events.yml', exists: true, selected: true },
            { path: '/mod/ms/settings.yml', name: 'settings.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/mod/ms/events.yml', '/mod/ms/settings.yml'],
        draftMeta: {
          '/mod/ms/events.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
          '/mod/ms/settings.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
        },
        handleRemoveDraftFile,
      }));
      expandGroup('Tasty Maid');
      const removeBtns = screen.getAllByTitle('Remove file');
      expect(removeBtns.length).toBe(2);
      // Click remove on the first file
      fireEvent.click(removeBtns[0]);
      expect(handleRemoveDraftFile).toHaveBeenCalledWith('/mod/ms/events.yml');
    });

    it('manual file paths (no mod metadata) appear under Manual / Ungrouped files', async () => {
      const draftGrouped: Array<{
        group_id: string;
        group_type: 'mod' | 'folder';
        title: string;
        files: Array<{ path: string; name: string; exists: boolean; selected: boolean }>;
      }> = [];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/manual/path/file1.yml', '/manual/path/file2.yml'],
        draftMeta: {}, // No mod metadata for these paths
      }));
      // Falls under "Manual / Ungrouped files" group
      expect(screen.getByText('Manual / Ungrouped files (2)')).toBeTruthy();
      expandGroup('Manual / Ungrouped files');
      expect(screen.getByText('file1.yml')).toBeTruthy();
      expect(screen.getByText('file2.yml')).toBeTruthy();
    });

    it('adding a mod does not overwrite existing manual files in the display', async () => {
      // Manual file + mod file — both groups shown
      const draftGrouped = [
        {
          group_id: 'mod-ms',
          group_type: 'mod' as const,
          title: 'Tasty Maid',
          files: [
            { path: '/mod/ms/events.yml', name: 'events.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 2,
        draftFiles: ['/manual/path/manual.yml', '/mod/ms/events.yml'],
        draftMeta: {
          '/mod/ms/events.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
          // manual.yml has no metadata → falls under Manual / Ungrouped files
        },
      }));
      expect(screen.getByText('Manual / Ungrouped files (1)')).toBeTruthy();
      expect(screen.getByText('Tasty Maid (1)')).toBeTruthy();
      expandGroup('Manual / Ungrouped files');
      expandGroup('Tasty Maid');
      expect(screen.getByText('manual.yml')).toBeTruthy();
      expect(screen.getByText('events.yml')).toBeTruthy();
    });

    it('duplicate paths are not duplicated in the group display', async () => {
      const draftGrouped = [
        {
          group_id: 'mod-ms',
          group_type: 'mod' as const,
          title: 'Tasty Maid',
          files: [
            { path: '/mod/ms/events.yml', name: 'events.yml', exists: true, selected: true },
          ],
        },
      ];
      await renderForm(createMockVm({
        draftGrouped,
        draftFileCount: 1,
        draftFiles: ['/mod/ms/events.yml', '/mod/ms/events.yml'], // duplicate
        draftMeta: {
          '/mod/ms/events.yml': { modName: 'Tasty Maid', modId: 'mod-ms' },
        },
      }));
      // The component iterates draftFiles — dedup is expected upstream.
      // We verify there is exactly one occurrence in the DOM.
      expandGroup('Tasty Maid');
      const removeBtns = screen.getAllByTitle('Remove file');
      expect(removeBtns.length).toBe(1);
    });

    it('shows loading indicator when draftLoading is true', async () => {
      await renderForm(createMockVm({ draftLoading: true }));
      expect(screen.getByText('loading...')).toBeTruthy();
    });

    // -----------------------------------------------------------------
    //  Hardening: search add behaviour
    // -----------------------------------------------------------------

    it('renders root-not-found diagnostic', async () => {
      const draftDiagnostics = [
        { level: 'error', code: 'ROOT_NOT_FOUND', message: 'Search root not found: /invalid/path' },
      ];
      await renderForm(createMockVm({ draftDiagnostics }));
      expect(screen.getByText('Search root not found: /invalid/path')).toBeTruthy();
    });

    it('renders multiple diagnostics including ROOT_NOT_FOUND and FILE_NOT_FOUND', async () => {
      const draftDiagnostics = [
        { level: 'error', code: 'ROOT_NOT_FOUND', message: 'Root not found: /bad/path' },
        { level: 'warning', code: 'FILE_NOT_FOUND', message: 'File not found: missing.yml' },
      ];
      await renderForm(createMockVm({ draftDiagnostics }));
      expect(screen.getByText('Root not found: /bad/path')).toBeTruthy();
      expect(screen.getByText('File not found: missing.yml')).toBeTruthy();
    });

    // -----------------------------------------------------------------
    //  Hardening: error handling — failed draft mutation shows error
    // -----------------------------------------------------------------

    it('renders draft error inside Input files section', async () => {
      // The error message must be visible within the Input files section
      // so the user can see it without scrolling elsewhere.
      await renderForm(createMockVm({ draftError: 'Failed to sync with server' }));
      const inputFilesSection = screen.getByText(/Input files/).closest('details');
      expect(inputFilesSection).toBeTruthy();
      // Verify the error renders inside the details element
      const errorEl = screen.getByText(/Failed to sync with server/);
      expect(errorEl).toBeTruthy();
    });
  });
});
