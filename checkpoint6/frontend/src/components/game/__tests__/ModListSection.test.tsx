import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { ModListSection } from '../ModListSection';
import type { ModModel } from '../../../domain';
import { DraftJobSelectionProvider, useDraftJobSelection } from '../../../contexts/DraftJobSelectionContext';

/* ================================================================== */
/*  Cleanup                                                             */
/* ================================================================== */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/* ================================================================== */
/*  Mock DraftJobSelectionContext API client                            */
/*  IMPORTANT: vi.mock factory is HOISTED so vi.fn() MUST be called     */
/*  inside the factory, not at module level.                            */
/* ================================================================== */

vi.mock('../../../api/client', () => {
  const mock = {
    getDraftJobSelection: vi.fn(),
    addDraftFiles: vi.fn(),
    removeDraftFiles: vi.fn(),
    setDraftJobSelection: vi.fn(),
    clearDraftJobSelection: vi.fn(),
  };
  return {
    api: mock,
    ApiError: class ApiError extends Error {
      constructor(msg: string) { super(msg); this.name = 'ApiError'; }
    },
  };
});

/* ================================================================== */
/*  Other mocks                                                        */
/* ================================================================== */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: function MockLink(props: any) {
    return React.createElement('a', { href: props.to }, props.children);
  },
}));

vi.mock('../../../App', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ settings: {} }),
    readDescriptor: vi.fn(),
    installMod: vi.fn(),
    previewTranslationPlan: vi.fn(),
    createJob: vi.fn(),
    startJob: vi.fn(),
    revealPath: vi.fn(),
    previewCleanCache: vi.fn(),
    cleanCache: vi.fn(),
    getDraftJobSelection: vi.fn(),
    addDraftFiles: vi.fn(),
    removeDraftFiles: vi.fn(),
    setDraftJobSelection: vi.fn(),
    clearDraftJobSelection: vi.fn(),
  },
  useToast: () => ({
    showToast: vi.fn(),
  }),
  ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg); }
  },
}));

vi.mock('../../index', () => ({
  PathPicker: function MockPathPicker(props: any) {
    return React.createElement('div', { 'data-testid': 'path-picker' },
      React.createElement('input', {
        value: props.value,
        onChange: (e: any) => props.onChange(e.target.value),
        'data-testid': 'path-input',
      }),
    );
  },
}));

vi.mock('../TranslationPreviewModal', () => ({
  TranslationPreviewModal: function MockPreviewModal() {
    return React.createElement('div', { 'data-testid': 'translation-preview-modal' });
  },
}));

vi.mock('../../../hooks/usePersistentState', () => ({
  usePersistentState: function mockPersistentState<T>(_key: string, initial: T) {
    const [state, setState] = React.useState<T>(initial);
    return [state, setState] as const;
  },
}));

/* ================================================================== */
/*  Test helpers                                                        */
/* ================================================================== */

function makeMod(overrides: Partial<ModModel> = {}): ModModel {
  const id = overrides.id ?? 'mod-1';
  return {
    id,
    name: 'Test Mod',
    path: `/path/to/${id}`,
    descriptorPath: null,
    isValid: true,
    source: 'steam',
    localisationPaths: [
      `/path/to/${id}/localisation/english/test_l_english.yml`,
      `/path/to/${id}/localisation/french/test_l_french.yml`,
      `/path/to/${id}/localisation/german/test_l_german.yml`,
    ],
    installed: false,
    installedPath: null,
    installAction: 'install',
    installConflict: false,
    selfInstalled: false,
    diagnostics: [],
    tags: [],
    supportedVersion: null,
    version: null,
    ...overrides,
  };
}

/** Mod with multiple English files that share the same group prefix. */
function makeModMultiEnglish(): ModModel {
  return makeMod({
    localisationPaths: [
      '/path/to/mod-1/localisation/english/test_prefix_foo_l_english.yml',
      '/path/to/mod-1/localisation/english/test_prefix_bar_l_english.yml',
    ],
  });
}

/**
 * Helper: wraps rendering with DraftJobSelectionProvider.
 * Returns a draftUpdater function that tests can call to simulate
 * external draft changes (e.g. from the Create Job form).
 */
function renderWithProvider(ui: React.ReactElement) {
  return render(
    <DraftJobSelectionProvider>
      {ui}
    </DraftJobSelectionProvider>,
  );
}

/**
 * Expand the mod card so group-level actions are visible.
 */
function expandMod() {
  const expandToggle = screen.getByTitle('Expand');
  fireEvent.click(expandToggle);
}

/**
 * Expand the mod card AND click on a group header to show file rows.
 */
function expandAll() {
  expandMod();

  // Click the first loc-group-header.
  const arrows = screen.getAllByText('\u25B6');
  for (const arrow of arrows) {
    const parent = arrow.closest('.loc-group-header');
    if (parent) {
      fireEvent.click(parent);
      return;
    }
  }
}

/** Import mocked client api for configuring mock responses. */
import { api as appApi } from '../../../App';
import { api as clientApi } from '../../../api/client';

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('ModListSection — draft job file sync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 0,
    });
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) =>
        Promise.resolve({ files: data.file_paths, file_metadata: {}, grouped: [], diagnostics: [], count: data.file_paths.length }),
    );
    vi.mocked(clientApi.removeDraftFiles).mockResolvedValue({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
    vi.mocked(clientApi.setDraftJobSelection).mockImplementation(
      (data: { files: string[] }) =>
        Promise.resolve({ files: data.files, file_metadata: {}, grouped: [], diagnostics: [], count: data.files.length }),
    );
    vi.mocked(clientApi.clearDraftJobSelection).mockResolvedValue({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
  });

  /* ---------------------------------------------------------------- */
  /*  1. draft contains file → Mods button shows Added on mount        */
  /* ---------------------------------------------------------------- */

  it('shows "Added" on mount when file is already in draft', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/path/to/mod-1/localisation/english/test_l_english.yml'],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 1,
    });

    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandAll();

    // The English file button should show "Added"
    expect(screen.getByText('Added')).toBeTruthy();
  });

  /* ---------------------------------------------------------------- */
  /*  2. Path equality: full absolute paths match                      */
  /* ---------------------------------------------------------------- */

  it('matches files in draft when absolute paths are identical', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/path/to/mod-1/localisation/english/test_l_english.yml'],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 1,
    });

    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandAll();

    // The English file should match exactly and show "Added"
    expect(screen.getByText('Added')).toBeTruthy();
  });

  /* ---------------------------------------------------------------- */
  /*  3. Group button shows all-added when all group files selected    */
  /* ---------------------------------------------------------------- */

  it('group button shows "All added" when all group files are in draft', async () => {
    const mod = makeModMultiEnglish();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [
        '/path/to/mod-1/localisation/english/test_prefix_foo_l_english.yml',
        '/path/to/mod-1/localisation/english/test_prefix_bar_l_english.yml',
      ],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 2,
    });

    renderWithProvider(<ModListSection mods={[mod]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandMod();

    // Both the mod-level and group-level buttons show "All added"
    await waitFor(() => {
      const allAddedButtons = screen.getAllByText('All added');
      expect(allAddedButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('group button shows "Add group to Translation Job" when only some group files are in draft', async () => {
    const mod = makeModMultiEnglish();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/path/to/mod-1/localisation/english/test_prefix_foo_l_english.yml'],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 1,
    });

    renderWithProvider(<ModListSection mods={[mod]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandMod();

    // The group button should still show "Add group to Translation Job"
    expect(screen.getByText('Add group to Translation Job')).toBeTruthy();
    expect(screen.queryByText('All added')).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /*  Mod-level "Add all" button shows "All added"                     */
  /* ---------------------------------------------------------------- */

  it('mod-level "Add all" button shows "All added" when all selected language files are in draft', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/path/to/mod-1/localisation/english/test_l_english.yml'],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 1,
    });

    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandMod();

    // Both the mod-level and group-level buttons show "All added"
    await waitFor(() => {
      const allAddedButtons = screen.getAllByText('All added');
      expect(allAddedButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Floating bar shows correct count                                 */
  /* ---------------------------------------------------------------- */

  it('floating bar shows correct file count', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/path/to/mod-1/localisation/english/test_l_english.yml'],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 1,
    });

    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    expect(screen.getByText('1 file(s) selected')).toBeTruthy();
    expect(screen.getByText('Go to job (1)')).toBeTruthy();
  });

  /* ---------------------------------------------------------------- */
  /*  Click toggles file in shared context                             */
  /* ---------------------------------------------------------------- */

  it('calls addDraftFiles when clicking "Add to Translation Job"', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandAll();

    // Click "Add to Translation Job" on a file row
    const addButton = screen.getAllByText('Add to Translation Job')[0];
    fireEvent.click(addButton);

    // The context calls addDraftFiles on the API
    await waitFor(() => {
      expect(vi.mocked(clientApi).addDraftFiles).toHaveBeenCalled();
    });
  });
});

/* ================================================================== */
/*  Integration: cross-component sync via shared context                */
/*  Verifies that Mods and form use the SAME context instance           */
/* ================================================================== */

describe('shared DraftJobSelectionContext — cross-component sync', () => {
  // Shared mutable state so that mutations update the next getDraftJobSelection response.
  let draftState: { files: string[]; file_metadata: Record<string, Record<string, unknown>>; grouped: import('../../../api/types').DraftSelectionGroup[]; diagnostics: Array<{ level: string; code: string; message: string }>; count: number };

  beforeEach(() => {
    draftState = { files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 };
    vi.clearAllMocks();
    // Use mockImplementation so that refresh() after a mutation sees updated state.
    vi.mocked(clientApi.getDraftJobSelection).mockImplementation(() =>
      Promise.resolve({ ...draftState }),
    );
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) => {
        draftState = { files: data.file_paths, file_metadata: {}, grouped: [], diagnostics: [], count: data.file_paths.length };
        return Promise.resolve({ ...draftState });
      },
    );
    vi.mocked(clientApi.removeDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) => {
        const remaining = draftState.files.filter(f => !data.file_paths.includes(f));
        draftState = { files: remaining, file_metadata: {}, grouped: [], diagnostics: [], count: remaining.length };
        return Promise.resolve({ ...draftState });
      },
    );
    vi.mocked(clientApi.setDraftJobSelection).mockImplementation(
      (data: { files: string[] }) => {
        draftState = { files: data.files, file_metadata: {}, grouped: [], diagnostics: [], count: data.files.length };
        return Promise.resolve({ ...draftState });
      },
    );
    vi.mocked(clientApi.clearDraftJobSelection).mockImplementation(() => {
      draftState = { files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 };
      return Promise.resolve({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
    });
  });

  it('two hooks calling useDraftJobSelection share the same state', async () => {
    // Component that reads and displays draft file count
    function DraftCountDisplay() {
      const { fileCount } = useDraftJobSelection();
      return React.createElement('span', { 'data-testid': 'draft-count' }, `Count: ${fileCount}`);
    }

    // Component that can add a file to the draft
    function DraftAdder({ filePath }: { filePath: string }) {
      const { addFile } = useDraftJobSelection();
      return React.createElement('button', {
        'data-testid': 'add-btn',
        onClick: () => addFile(filePath),
      }, 'Add');
    }

    render(
      <DraftJobSelectionProvider>
        <DraftCountDisplay />
        <DraftAdder filePath="/some/file.yml" />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Initially count is 0
    expect(screen.getByTestId('draft-count').textContent).toBe('Count: 0');

    // Click Add — this calls addFile on the shared context
    fireEvent.click(screen.getByTestId('add-btn'));

    // Both components share the same context, so DraftCountDisplay
    // should see the updated count after the API response
    await waitFor(() => {
      expect(screen.getByTestId('draft-count').textContent).toBe('Count: 1');
    });
  });

  it('removing from one consumer updates all other consumers', async () => {
    // Pre-populate draft with one file
    draftState = { files: ['/some/file.yml'], file_metadata: {}, grouped: [], diagnostics: [], count: 1 };

    function DraftCountDisplay() {
      const { fileCount, draftFiles } = useDraftJobSelection();
      return React.createElement('div', {},
        React.createElement('span', { 'data-testid': 'draft-count' }, `Count: ${fileCount}`),
        React.createElement('span', { 'data-testid': 'draft-files' }, draftFiles.join(',')),
      );
    }

    function DraftRemover({ filePath }: { filePath: string }) {
      const { removeFile } = useDraftJobSelection();
      return React.createElement('button', {
        'data-testid': 'remove-btn',
        onClick: () => removeFile(filePath),
      }, 'Remove');
    }

    render(
      <DraftJobSelectionProvider>
        <DraftCountDisplay />
        <DraftRemover filePath="/some/file.yml" />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Initially count is 1
    expect(screen.getByTestId('draft-count').textContent).toBe('Count: 1');

    // Click Remove — calls removeFile on shared context
    fireEvent.click(screen.getByTestId('remove-btn'));

    // The display component should see updated state from the same context
    await waitFor(() => {
      expect(screen.getByTestId('draft-count').textContent).toBe('Count: 0');
    });
  });

  it('clearFiles updates state for all consumers', async () => {
    draftState = { files: ['/a.yml', '/b.yml'], file_metadata: {}, grouped: [], diagnostics: [], count: 2 };

    function DraftStateDisplay() {
      const { fileCount, draftFiles } = useDraftJobSelection();
      return React.createElement('div', {},
        React.createElement('span', { 'data-testid': 'count' }, `Count: ${fileCount}`),
        React.createElement('span', { 'data-testid': 'files' }, `Files: ${draftFiles.length}`),
      );
    }

    function DraftClearer() {
      const { clearFiles } = useDraftJobSelection();
      return React.createElement('button', {
        'data-testid': 'clear-btn',
        onClick: () => clearFiles(),
      }, 'Clear');
    }

    render(
      <DraftJobSelectionProvider>
        <DraftStateDisplay />
        <DraftClearer />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    expect(screen.getByTestId('count').textContent).toBe('Count: 2');

    fireEvent.click(screen.getByTestId('clear-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('Count: 0');
      expect(screen.getByTestId('files').textContent).toBe('Files: 0');
    });
  });
});

/* ================================================================== */
/*  Regression: per-mod install/reinstall loading state                 */
/* ================================================================== */

describe('ModListSection — per-mod installing state', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 0,
    });
  });

  it('only the clicked mod enters loading state on reinstall; other mods remain interactive', async () => {

    // Make installMod return a promise that never settles so the
    // "Installing..." state persists for the duration of the assertion.
    const neverSettle: Promise<{ success: boolean; files_copied: number; warnings: string[]; errors: string[]; backup_path?: string }> = new Promise(() => {});
    vi.mocked(appApi.installMod).mockReturnValue(neverSettle);

    const mod1 = makeMod({ id: 'mod-1', name: 'Mod One', installed: true, installAction: 'reinstall' });
    const mod2 = makeMod({ id: 'mod-2', name: 'Mod Two', installed: true, installAction: 'reinstall' });

    renderWithProvider(<ModListSection mods={[mod1, mod2]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Set a valid install target so handleInstall doesn't bail early
    const pathInput = screen.getByTestId('path-input');
    fireEvent.change(pathInput, { target: { value: '/some/stellaris/mods' } });

    // Both mods show "Reinstall" initially
    const reinstallButtons = screen.getAllByText('Reinstall');
    expect(reinstallButtons.length).toBe(2);

    // Click reinstall on mod 1
    fireEvent.click(reinstallButtons[0]);

    // The clicked mod's button transitions to "Installing..."
    await waitFor(() => {
      expect(screen.getByText('Installing...')).toBeTruthy();
    });

    // The other mod's button must still say "Reinstall"
    const remainingReinstall = screen.getAllByText('Reinstall');
    expect(remainingReinstall.length).toBe(1);
  });
});

/* ================================================================== */
/*  Global source language filter                                       */
/* ================================================================== */

describe('ModListSection — global source language filter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 0,
    });
  });

  it('renders global filter bar when mods have localisation files', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Filter bar elements
    expect(screen.getByText('Source language:')).toBeTruthy();
    expect(screen.getByText('Show only selected source language files')).toBeTruthy();

    // Language selector should have English, French, German
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    const options = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(options).toContain('English');
    expect(options).toContain('French');
    expect(options).toContain('German');
  });

  it('hides filter bar when no mods have localisation files', async () => {
    const modNoLoc = makeMod({ localisationPaths: [] });
    renderWithProvider(<ModListSection mods={[modNoLoc]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    expect(screen.queryByText('Source language:')).toBeNull();
  });

  it('defaults to English filter and shows only English files', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandMod();

    // By default showOnlySelected=true and selectedSourceLanguage='en'
    // So only the English file should be visible
    expect(screen.getByText('Localisation files (English, 1)')).toBeTruthy();

    // French and German files should NOT appear
    expect(screen.queryByText(/test_l_french/)).toBeNull();
    expect(screen.queryByText(/test_l_german/)).toBeNull();
  });

  it('changing language in global selector updates visible files', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandMod();

    // Initially English
    expect(screen.getByText('Localisation files (English, 1)')).toBeTruthy();

    // Switch to French in the global selector
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'fr' } });

    // Now should show French files only
    expect(screen.getByText('Localisation files (French, 1)')).toBeTruthy();
  });

  it('shows empty state when mod has no files in selected language', async () => {
    // Two mods: one with English+French, another with English only.
    // When French is selected globally, the English-only mod shows an empty state.
    const modWithFrench = makeMod({
      id: 'mod-fr',
      name: 'Mod With French',
      localisationPaths: [
        '/path/to/mod1/localisation/english/mod1_l_english.yml',
        '/path/to/mod1/localisation/french/mod1_l_french.yml',
      ],
    });
    const modEnglishOnly = makeMod({
      id: 'mod-en-only',
      name: 'Mod English Only',
      localisationPaths: [
        '/path/to/mod2/localisation/english/mod2_l_english.yml',
      ],
    });

    renderWithProvider(
      <ModListSection mods={[modWithFrench, modEnglishOnly]} onRefreshMods={vi.fn()} />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Expand both mods
    const expandToggles = screen.getAllByTitle('Expand');
    expandToggles.forEach(t => fireEvent.click(t));

    // Initially English — both show English(1)
    const englishHeaders = screen.getAllByText('Localisation files (English, 1)');
    expect(englishHeaders.length).toBe(2);

    // Switch to French globally
    const langSelect = screen.getByRole('combobox');
    fireEvent.change(langSelect, { target: { value: 'fr' } });

    // Mod with French shows French(1)
    expect(screen.getByText('Localisation files (French, 1)')).toBeTruthy();

    // English-only mod shows empty state
    expect(screen.getByText(/No localisation files found for French/)).toBeTruthy();
    expect(screen.getByText('Localisation files (0)')).toBeTruthy();
  });

  it('disabling the filter shows all files across languages', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandMod();

    // Initially filtered — English only
    expect(screen.getByText('Localisation files (English, 1)')).toBeTruthy();

    // Uncheck "Show only selected source language files"
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Now all 3 files should be visible
    expect(screen.getByText('Localisation files (3)')).toBeTruthy();
  });

  it('shows mixed-language confirmation when filter is off and mod has multiple languages', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());
    expandMod();

    // Uncheck filter to show all languages
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Click "Add all to Translation Job" — should trigger mixed-language warning
    const addAllButton = screen.getByText('Add all to Translation Job');
    fireEvent.click(addAllButton);

    // Modal should appear
    expect(screen.getByText('Mixed localisation languages')).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('global filter affects all mods simultaneously', async () => {
    const mod1 = makeMod({ id: 'mod-1', name: 'First Mod' });
    const mod2 = makeMod({
      id: 'mod-2',
      name: 'Second Mod',
      localisationPaths: [
        '/path/to/mod2/localisation/english/mod2_l_english.yml',
        '/path/to/mod2/localisation/french/mod2_l_french.yml',
      ],
    });

    renderWithProvider(<ModListSection mods={[mod1, mod2]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Expand both mods
    const expandToggles = screen.getAllByTitle('Expand');
    expandToggles.forEach(t => fireEvent.click(t));

    // Both mods show English files (default)
    const initialEnglishHeaders = screen.getAllByText('Localisation files (English, 1)');
    expect(initialEnglishHeaders.length).toBe(2);

    // Switch to French globally
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'fr' } });

    // First mod shows French(1), second mod shows French(1)
    const frenchHeaders = screen.getAllByText('Localisation files (French, 1)');
    expect(frenchHeaders.length).toBe(2);
  });

  /* ------------------------------------------------------------------ */
  /*  Badge count variants                                                */
  /* ------------------------------------------------------------------ */

  it('badge shows total count when filter is OFF', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Filter is ON by default — uncheck it
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Badge shows total (3) without language breakdown
    expect(screen.getByText('Has localisation (3)')).toBeTruthy();

    // Expanded section also shows total
    expandMod();
    expect(screen.getByText('Localisation files (3)')).toBeTruthy();
  });

  it('badge shows selected/total when filter is ON', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Default: English selected, filter ON
    expect(screen.getByText('Has localisation (1 / 3)')).toBeTruthy();

    // Switch to French
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'fr' } });

    expect(screen.getByText('Has localisation (1 / 3)')).toBeTruthy();

    // Switch to German
    fireEvent.change(select, { target: { value: 'de' } });

    expect(screen.getByText('Has localisation (1 / 3)')).toBeTruthy();
  });

  it('badge shows warning style when no files match selected language', async () => {
    // Two mods: one has DE files (so German is a valid dropdown option),
    // another only has EN+FR (should show 0/2 when German is selected).
    const modEnFr = makeMod({
      id: 'mod-en-fr',
      localisationPaths: [
        '/path/to/mod-1/localisation/english/test_l_english.yml',
        '/path/to/mod-1/localisation/french/test_l_french.yml',
      ],
    });
    const modDe = makeMod({
      id: 'mod-de',
      name: 'German Mod',
      localisationPaths: [
        '/path/to/mod-1/localisation/german/test_l_german.yml',
      ],
    });

    renderWithProvider(<ModListSection mods={[modEnFr, modDe]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Switch to German
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'de' } });

    // modEnFr badge shows 0 / 2 with warning class
    const badges = screen.getAllByText(/Has localisation/);
    const warningBadge = badges.find(b => b.textContent === 'Has localisation (0 / 2)');
    expect(warningBadge).toBeTruthy();
    expect(warningBadge!.className).toContain('badge-warning');
  });

  it('hides Translate Mod button when no files for selected language', async () => {
    // Two mods: one has FR (so French is a valid option),
    // another only has EN (should hide Translate Mod when French selected).
    const modEnglishOnly = makeMod({
      id: 'mod-en',
      localisationPaths: [
        '/path/to/mod-1/localisation/english/mod_l_english.yml',
      ],
    });
    const modFrench = makeMod({
      id: 'mod-fr',
      name: 'French Mod',
      localisationPaths: [
        '/path/to/mod-1/localisation/french/mod_l_french.yml',
      ],
    });

    renderWithProvider(<ModListSection mods={[modEnglishOnly, modFrench]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Default: English filter ON — only the English mod has Translate Mod
    expect(screen.getAllByText('Translate Mod').length).toBe(1);

    // Switch to French
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'fr' } });

    // English-only mod should NOT have Translate Mod button
    const translateButtons = screen.queryAllByText('Translate Mod');
    expect(translateButtons.length).toBe(1); // only the French mod has it
  });
});

/* ================================================================== */
/*  Translate buttons now add to draft and navigate                    */
/* ================================================================== */

describe('ModListSection — translate buttons', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 0,
    });
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) =>
        Promise.resolve({ files: data.file_paths, file_metadata: {}, grouped: [], diagnostics: [], count: data.file_paths.length }),
    );
    vi.mocked(clientApi.removeDraftFiles).mockResolvedValue({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
    vi.mocked(clientApi.setDraftJobSelection).mockImplementation(
      (data: { files: string[] }) =>
        Promise.resolve({ files: data.files, file_metadata: {}, grouped: [], diagnostics: [], count: data.files.length }),
    );
    vi.mocked(clientApi.clearDraftJobSelection).mockResolvedValue({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
  });

  it('clicking "Translate Mod" does NOT call createJob/startJob/previewTranslationPlan', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Translate Mod'));

    // Old direct job creation flow must never be triggered
    expect(vi.mocked(appApi.createJob)).not.toHaveBeenCalled();
    expect(vi.mocked(appApi.startJob)).not.toHaveBeenCalled();
    expect(vi.mocked(appApi.previewTranslationPlan)).not.toHaveBeenCalled();
  });

  it('clicking "Translate Mod" adds filtered files to draft and navigates to /jobs', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Translate Mod'));

    // With default filter (English ON), only the English file should be added
    await waitFor(() => {
      expect(vi.mocked(clientApi.addDraftFiles)).toHaveBeenCalledWith({
        file_paths: ['/path/to/mod-1/localisation/english/test_l_english.yml'],
        metadata: { mod_id: '/path/to/mod-1', mod_name: 'Test Mod' },
      });
    });

    // Should navigate to the Create Job page
    expect(mockNavigate).toHaveBeenCalledWith('/jobs');
  });

  it('clicking "Translate Mod" with selected-language filter ON adds only matching-language files', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Switch to French filter
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'fr' } });

    fireEvent.click(screen.getByText('Translate Mod'));

    // Only the French file should be added
    await waitFor(() => {
      expect(vi.mocked(clientApi.addDraftFiles)).toHaveBeenCalledWith({
        file_paths: ['/path/to/mod-1/localisation/french/test_l_french.yml'],
        metadata: { mod_id: '/path/to/mod-1', mod_name: 'Test Mod' },
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/jobs');
  });

  it('clicking "Translate Mod" with filter OFF shows mixed-language confirmation, then adds + navigates on confirm', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Turn off the filter to expose all languages
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Click "Translate Mod" — should trigger mixed-language warning
    fireEvent.click(screen.getByText('Translate Mod'));

    // Modal should appear
    expect(screen.getByText('Mixed localisation languages')).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();

    // Files should NOT be added yet
    expect(vi.mocked(clientApi.addDraftFiles)).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    // Confirm the mixed-language action
    fireEvent.click(screen.getByText('Continue'));

    // Now files should be added (all 3 visible files)
    await waitFor(() => {
      expect(vi.mocked(clientApi.addDraftFiles)).toHaveBeenCalled();
    });
    const addCall = vi.mocked(clientApi.addDraftFiles).mock.calls[0][0];
    expect(addCall.file_paths).toHaveLength(3);

    // And navigate to jobs
    expect(mockNavigate).toHaveBeenCalledWith('/jobs');
  });

  it('clicking "Translate group" adds group files and navigates to /jobs', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Expand the mod to reveal group-level buttons
    expandAll();

    // Click "Translate group" — should add group files and navigate
    fireEvent.click(screen.getByText('Translate group'));

    await waitFor(() => {
      expect(vi.mocked(clientApi.addDraftFiles)).toHaveBeenCalled();
    });

    // With default English filter, the single English file in this group should be added
    const addCall = vi.mocked(clientApi.addDraftFiles).mock.calls[0][0];
    expect(addCall.file_paths).toEqual(
      expect.arrayContaining([expect.stringContaining('l_english')]),
    );

    expect(mockNavigate).toHaveBeenCalledWith('/jobs');
  });

  it('clicking "Translate all localisation" in expanded body adds files and navigates to /jobs', async () => {
    renderWithProvider(<ModListSection mods={[makeMod()]} onRefreshMods={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Expand to reveal the "Translate all localisation" button
    expandMod();

    fireEvent.click(screen.getByText('Translate all localisation'));

    // With default English filter, only English file is added
    await waitFor(() => {
      expect(vi.mocked(clientApi.addDraftFiles)).toHaveBeenCalledWith({
        file_paths: ['/path/to/mod-1/localisation/english/test_l_english.yml'],
        metadata: { mod_id: '/path/to/mod-1', mod_name: 'Test Mod' },
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/jobs');
  });
});
