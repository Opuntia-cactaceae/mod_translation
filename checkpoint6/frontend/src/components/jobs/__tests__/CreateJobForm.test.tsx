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
  Link: function MockLink(props: any) {
    return React.createElement('a', { href: props.to }, props.children);
  },
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
    selectedMod: null,
    handleSelectMod: vi.fn(),
    handleClearSelection: vi.fn(),
    // --- Game filter ---
    games: [],
    gamesWithMods: [],
    gamesLoading: false,
    selectedGameId: '',
    handleGameChange: vi.fn(),
    // --- Language filter ---
    showOnlySelectedLanguage: true,
    setShowOnlySelectedLanguage: vi.fn(),
    selectedLanguage: 'en',
    setSelectedLanguage: vi.fn(),
    availableLanguages: [],
    modFromQuery: null,
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
    profileGameWarning: '',
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

    it('renders the mod select with default option when a game is selected', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [],
      }));
      expect(screen.getByText('\u2014 No mod selected \u2014')).toBeTruthy();
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

    it('calls removePath when a file chip remove button is clicked', async () => {
      const removePath = vi.fn();
      const vm = createMockVm({
        removePath,
        form: {
          ...createMockVm().form,
          filePathList: ['added/file.yml'],
        },
        addedPaths: new Set(['added/file.yml']),
      });
      await renderForm(vm);

      const removeButtons = screen.getAllByText('\u00D7');
      expect(removeButtons.length).toBeGreaterThan(0);
      fireEvent.click(removeButtons[0]);
      expect(removePath).toHaveBeenCalledWith('added/file.yml');
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

    it('shows mod loading state', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        modsLoading: true,
        filteredMods: [],
      }));

      expect(screen.getByText('Loading mods...')).toBeTruthy();
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

    it('shows no mods message when game has no discovered mods', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        filteredMods: [],
        mods: [],
      }));
      expect(screen.getByText(/No mods discovered yet/)).toBeTruthy();
    });

    it('shows filtered mods in the select dropdown', async () => {
      const mods = [
        { mod_id: 'mod-1', name: 'Mod One', version: '1.0', game_id: 'stellaris', localisation_paths: [] },
        { mod_id: 'mod-2', name: 'Mod Two', version: '2.0', game_id: 'stellaris', localisation_paths: [] },
      ];
      const { container } = await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        gamesWithMods: [{ id: 'stellaris', label: 'Stellaris', supports_mod_discovery: true } as any],
        filteredMods: mods as any,
      }));

      // Check the mod select is rendered
      expect(screen.getByText('Select mod')).toBeTruthy();

      // Check mod options are present in the mod select
      const allOptions = container.querySelectorAll('select option');
      const optionTexts = Array.from(allOptions).map(o => o.textContent);
      expect(optionTexts.some(t => t?.includes('Mod One'))).toBe(true);
      expect(optionTexts.some(t => t?.includes('Mod Two'))).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Language filter toggle                                             */
  /* ------------------------------------------------------------------ */

  describe('language filter toggle', () => {
    const multiLangMod = {
      mod_id: 'test-mod',
      name: 'Test Mod',
      game_id: 'stellaris',
      localisation_paths: [
        '/mod/localisation/english/test_l_english.yml',
        '/mod/localisation/french/test_l_french.yml',
        '/mod/localisation/german/test_l_german.yml',
      ],
    };

    const singleLangMod = {
      mod_id: 'single-mod',
      name: 'Single Lang Mod',
      game_id: 'stellaris',
      localisation_paths: [
        '/mod/localisation/english/test_l_english.yml',
      ],
    };

    it('does NOT render language toggle when no mod is selected', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: null,
        filteredMods: [],
      }));

      expect(screen.queryByText('Source language files')).toBeNull();
      expect(screen.queryByText('Only selected language')).toBeNull();
    });

    it('does NOT render language toggle when mod has only 1 language', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: singleLangMod as any,
        availableLanguages: [],
      }));

      expect(screen.queryByText('Source language files')).toBeNull();
    });

    it('renders language selector and toggle when mod has multiple languages', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: multiLangMod as any,
        availableLanguages: ['en', 'fr', 'de'],
      }));

      expect(screen.getByText('Source language files')).toBeTruthy();
      expect(screen.getByText('Only selected language')).toBeTruthy();
    });

    it('renders language options in the select', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: multiLangMod as any,
        availableLanguages: ['en', 'fr', 'de'],
      }));

      // The language select is rendered near "Source language files:"
      const langSection = screen.getByText('Source language files').closest('div');
      expect(langSection).toBeTruthy();
      const selects = langSection!.querySelectorAll('select');
      expect(selects.length).toBe(1);
      expect(selects[0].querySelectorAll('option').length).toBe(3);
    });

    it('calls setShowOnlySelectedLanguage when toggle is clicked', async () => {
      const setShowOnlySelectedLanguage = vi.fn();
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: multiLangMod as any,
        availableLanguages: ['en', 'fr', 'de'],
        showOnlySelectedLanguage: true,
        setShowOnlySelectedLanguage,
      }));

      // Find the checkbox inside the language filter section
      const langSection = screen.getByText('Source language files').closest('div');
      const checkboxes = langSection!.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(1);
      fireEvent.click(checkboxes[0]);
      expect(setShowOnlySelectedLanguage).toHaveBeenCalledWith(false);
    });

    it('calls setSelectedLanguage when language selector changes', async () => {
      const setSelectedLanguage = vi.fn();
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: multiLangMod as any,
        availableLanguages: ['en', 'fr', 'de'],
        setSelectedLanguage,
      }));

      const langSection = screen.getByText('Source language files').closest('div');
      const select = langSection!.querySelector('select')!;
      fireEvent.change(select, { target: { value: 'fr' } });
      expect(setSelectedLanguage).toHaveBeenCalledWith('fr');
    });

    it('shows advanced mode warning when toggle is OFF', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: multiLangMod as any,
        availableLanguages: ['en', 'fr', 'de'],
        showOnlySelectedLanguage: false,
      }));

      expect(screen.getByText(/Mixed languages selected/)).toBeTruthy();
    });

    it('does NOT show advanced mode warning when toggle is ON', async () => {
      await renderForm(createMockVm({
        selectedGameId: 'stellaris',
        selectedMod: multiLangMod as any,
        availableLanguages: ['en', 'fr', 'de'],
        showOnlySelectedLanguage: true,
      }));

      expect(screen.queryByText(/Mixed languages selected/)).toBeNull();
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

    it('renders protection strategy dropdown with options', async () => {
      const optionsWithProtection = {
        ...emptyOptions,
        protection_strategies: ['strict', 'lenient'],
      };
      const CreateJobForm = (await import('../CreateJobForm')).default;
      render(
        React.createElement(CreateJobForm, {
          vm: createMockVm(),
          options: optionsWithProtection,
          profiles: emptyProfiles,
          onOpenProfileEditor: vi.fn(),
        }),
      );
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);
      const label = screen.getByText('Protection Strategy');
      const select = label.closest('div')!.querySelector('select') as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.querySelectorAll('option').length).toBe(3); // — None — + 2 strategies
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
      await renderForm(createMockVm({ setFormField }));
      const summary = screen.getByText('Advanced config');
      fireEvent.click(summary);

      // Change prompt profile
      const promptLabel = screen.getByText('Prompt Profile');
      const promptSelect = promptLabel.closest('div')!.querySelector('select')!;
      // Need a real option value to fire change
      // Add an option dynamically via DOM manipulation
      const option = document.createElement('option');
      option.value = 'default';
      promptSelect.appendChild(option);
      fireEvent.change(promptSelect, { target: { value: 'default' } });
      expect(setFormField).toHaveBeenCalledWith('promptProfileName', 'default');

      // Change protection strategy
      const protectionLabel = screen.getByText('Protection Strategy');
      const protectionSelect = protectionLabel.closest('div')!.querySelector('select')!;
      const protectionOption = document.createElement('option');
      protectionOption.value = 'strict';
      protectionSelect.appendChild(protectionOption);
      fireEvent.change(protectionSelect, { target: { value: 'strict' } });
      expect(setFormField).toHaveBeenCalledWith('protectionStrategy', 'strict');

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

    /* -------------------------------------------------------------- */
    /*  Profile game warning                                           */
    /* -------------------------------------------------------------- */

    it('renders profile game warning when profileGameWarning is non-empty in apply mode', async () => {
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
        profileGameWarning: 'This profile targets a different game/parser. Mod-specific game settings will not be applied.',
      }));
      expect(
        screen.getByText('This profile targets a different game/parser. Mod-specific game settings will not be applied.')
      ).toBeTruthy();
    });

    it('does not render profile game warning when profileGameWarning is empty', async () => {
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'apply',
        profileGameWarning: '',
      }));
      expect(
        screen.queryByText('This profile targets a different game/parser. Mod-specific game settings will not be applied.')
      ).toBeNull();
    });

    it('does not render profile game warning in clear mode', async () => {
      await renderForm(createMockVm({
        showProfileConfirm: true,
        profileConfirmType: 'clear',
        profileGameWarning: 'This profile targets a different game/parser. Mod-specific game settings will not be applied.',
      }));
      // Only the "unlink" and "unchanged" text should appear, not the warning
      expect(screen.getByText(/unlink the current profile/)).toBeTruthy();
      expect(
        screen.queryByText('This profile targets a different game/parser. Mod-specific game settings will not be applied.')
      ).toBeNull();
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
});
