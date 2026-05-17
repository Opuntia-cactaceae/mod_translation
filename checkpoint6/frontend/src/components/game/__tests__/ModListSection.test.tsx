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
  return {
    id: 'mod-1',
    name: 'Test Mod',
    path: '/path/to/mod',
    descriptorPath: null,
    isValid: true,
    source: 'steam',
    localisationPaths: [
      '/path/to/mod/localisation/english/test_l_english.yml',
      '/path/to/mod/localisation/french/test_l_french.yml',
      '/path/to/mod/localisation/german/test_l_german.yml',
    ],
    installed: false,
    installedPath: null,
    installAction: 'install',
    installConflict: false,
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
      '/path/to/mod/localisation/english/test_prefix_foo_l_english.yml',
      '/path/to/mod/localisation/english/test_prefix_bar_l_english.yml',
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
      count: 0,
    });
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) =>
        Promise.resolve({ files: data.file_paths, file_metadata: {}, count: data.file_paths.length }),
    );
    vi.mocked(clientApi.removeDraftFiles).mockResolvedValue({ files: [], file_metadata: {}, count: 0 });
    vi.mocked(clientApi.setDraftJobSelection).mockImplementation(
      (data: { files: string[] }) =>
        Promise.resolve({ files: data.files, file_metadata: {}, count: data.files.length }),
    );
    vi.mocked(clientApi.clearDraftJobSelection).mockResolvedValue({ files: [], file_metadata: {}, count: 0 });
  });

  /* ---------------------------------------------------------------- */
  /*  1. draft contains file → Mods button shows Added on mount        */
  /* ---------------------------------------------------------------- */

  it('shows "Added" on mount when file is already in draft', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/path/to/mod/localisation/english/test_l_english.yml'],
      file_metadata: {},
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
      files: ['/path/to/mod/localisation/english/test_l_english.yml'],
      file_metadata: {},
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
        '/path/to/mod/localisation/english/test_prefix_foo_l_english.yml',
        '/path/to/mod/localisation/english/test_prefix_bar_l_english.yml',
      ],
      file_metadata: {},
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
      files: ['/path/to/mod/localisation/english/test_prefix_foo_l_english.yml'],
      file_metadata: {},
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
      files: ['/path/to/mod/localisation/english/test_l_english.yml'],
      file_metadata: {},
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
      files: ['/path/to/mod/localisation/english/test_l_english.yml'],
      file_metadata: {},
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
  let draftState: { files: string[]; file_metadata: Record<string, unknown>; count: number };

  beforeEach(() => {
    draftState = { files: [], file_metadata: {}, count: 0 };
    vi.clearAllMocks();
    // Use mockImplementation so that refresh() after a mutation sees updated state.
    vi.mocked(clientApi.getDraftJobSelection).mockImplementation(() =>
      Promise.resolve({ ...draftState }),
    );
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) => {
        draftState = { files: data.file_paths, file_metadata: {}, count: data.file_paths.length };
        return Promise.resolve({ ...draftState });
      },
    );
    vi.mocked(clientApi.removeDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) => {
        const remaining = draftState.files.filter(f => !data.file_paths.includes(f));
        draftState = { files: remaining, file_metadata: {}, count: remaining.length };
        return Promise.resolve({ ...draftState });
      },
    );
    vi.mocked(clientApi.setDraftJobSelection).mockImplementation(
      (data: { files: string[] }) => {
        draftState = { files: data.files, file_metadata: {}, count: data.files.length };
        return Promise.resolve({ ...draftState });
      },
    );
    vi.mocked(clientApi.clearDraftJobSelection).mockImplementation(() => {
      draftState = { files: [], file_metadata: {}, count: 0 };
      return Promise.resolve({ files: [], file_metadata: {}, count: 0 });
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
    draftState = { files: ['/some/file.yml'], file_metadata: {}, count: 1 };

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
    draftState = { files: ['/a.yml', '/b.yml'], file_metadata: {}, count: 2 };

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
