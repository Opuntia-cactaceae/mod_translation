import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React, { useState, useEffect } from 'react';
import { usePersistentState } from '../../../hooks/usePersistentState';
import { GenericFileSection } from '../GenericFileSection';
import type { GameModel, FileHandlerModel } from '../../../domain';
import { DraftJobSelectionProvider } from '../../../contexts/DraftJobSelectionContext';

/* ================================================================== */
/*  Test wrapper — provides lifted scan state                          */
/* ================================================================== */

function TestGenericFileSection({
  game,
  handlerOptions,
  initialFiles = [],
  initialScanning = false,
  initialScanError = null,
}: {
  game: GameModel;
  handlerOptions: FileHandlerModel[];
  initialFiles?: string[];
  initialScanning?: boolean;
  initialScanError?: string | null;
}) {
  const [scannedFiles, setScannedFiles] = useState(initialFiles);
  const [scanning, setScanning] = useState(initialScanning);
  const [scanError, setScanError] = useState<string | null>(initialScanError);
  return (
    <GenericFileSection
      game={game}
      handlerOptions={handlerOptions}
      scannedFiles={scannedFiles}
      setScannedFiles={setScannedFiles}
      scanning={scanning}
      setScanning={setScanning}
      scanError={scanError}
      setScanError={setScanError}
    />
  );
}

/* ================================================================== */
/*  Cleanup                                                             */
/* ================================================================== */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/* ================================================================== */
/*  Mock DraftJobSelectionContext API client                            */
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

// These mock fns are created at module level but vi.mock factories
// use the same variable names — vitest hoisting handles the fn factory.
// We export via the module-level mock references.
vi.mock('../../../App', () => {
  // Create the mock fns inside the factory (hoisted-safe)
  return {
    api: {
      getSettings: vi.fn().mockResolvedValue({ settings: {} }),
      listDirectory: vi.fn(),
      listJobs: vi.fn().mockResolvedValue([]),
      createJob: vi.fn(),
      startJob: vi.fn(),
      revealPath: vi.fn(),
    },
    useToast: () => ({
      showToast: vi.fn(),
    }),
    ApiError: class ApiError extends Error {
      constructor(msg: string) { super(msg); }
    },
  };
});

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

/* ================================================================== */
/*  Test fixtures                                                      */
/* ================================================================== */

const mockGame: GameModel = {
  id: 'generic',
  label: 'Other Game',
  vendor: null,
  features: { generic_file_scan: true },
  supportsModDiscovery: false,
  supportsDescriptors: false,
  supportsInstall: false,
  fileHandlers: ['plain_text', 'yaml'],
};

const mockHandlers: FileHandlerModel[] = [
  { id: 'plain_text', label: 'Plain Text', extensions: ['.txt'] },
  { id: 'yaml', label: 'YAML', extensions: ['.yml', '.yaml'] },
];

import { api as clientApi } from '../../../api/client';
import { api as appApi } from '../../../App';

/* ================================================================== */
/*  Helper: render with DraftJobSelectionProvider and optional scan     */
/* ================================================================== */

function renderGeneric() {
  return render(
    <DraftJobSelectionProvider>
      <TestGenericFileSection game={mockGame} handlerOptions={mockHandlers} />
    </DraftJobSelectionProvider>,
  );
}

async function renderAndScan(items: Array<{ name: string; path: string; type: 'file' | 'directory'; size_bytes: number | null; modified_at: string | null }>) {
  vi.mocked(appApi.listDirectory).mockResolvedValue({
    path: '/games/other',
    parent: null,
    items,
    diagnostics: [],
  });

  render(
    <DraftJobSelectionProvider>
      <TestGenericFileSection game={mockGame} handlerOptions={mockHandlers} />
    </DraftJobSelectionProvider>,
  );

  await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

  const pathInputs = screen.getAllByTestId('path-input');
  fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
  fireEvent.click(screen.getByText('Scan files'));
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('GenericFileSection — grouping mode selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) =>
        Promise.resolve({ files: data.file_paths, file_metadata: {}, grouped: [], diagnostics: [], count: data.file_paths.length }),
    );
    vi.mocked(clientApi.removeDraftFiles).mockResolvedValue({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
  });

  it('does not render grouping mode selector before scan', () => {
    renderGeneric();
    expect(screen.queryByText('Grouping Mode')).toBeNull();
  });

  it('renders grouping mode selector after scan', async () => {
    await renderAndScan([
      { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    await waitFor(() => {
      expect(screen.getByText('Grouping Mode')).toBeTruthy();
    });

    // Smart grouping is the default
    const select = screen.getByDisplayValue('Smart (filename families)') as HTMLSelectElement;
    expect(select).toBeTruthy();

    // All options exist
    const options = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(options).toContain('Smart (filename families)');
    expect(options).toContain('Folder');
    expect(options).toContain('File name');
    expect(options).toContain('Language marker');
  });

  it('select shows file count', async () => {
    await renderAndScan([
      { name: 'readme.txt', path: '/games/other/readme.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });
  });
});

describe('GenericFileSection — grouping actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) =>
        Promise.resolve({ files: data.file_paths, file_metadata: {}, grouped: [], diagnostics: [], count: data.file_paths.length }),
    );
    vi.mocked(clientApi.removeDraftFiles).mockResolvedValue({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
  });

  it('add group to Translation Job calls draftAddFiles', async () => {
    await renderAndScan([
      { name: 'wsg_affection_l_english.txt', path: '/games/other/wsg_affection_l_english.txt', type: 'file', size_bytes: 100, modified_at: null },
      { name: 'wsg_boss_l_english.txt', path: '/games/other/wsg_boss_l_english.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    // Wait for files to appear after scan
    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    await waitFor(() => {
      // Two files create 2 separate groups (different basename families)
      const addButtons = screen.getAllByText('Add group to Translation Job');
      expect(addButtons.length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getAllByText('Add group to Translation Job')[0]);

    await waitFor(() => {
      expect(clientApi.addDraftFiles).toHaveBeenCalled();
    });
  });

  it('translate group calls addDraftFiles and navigates to /jobs', async () => {
    await renderAndScan([
      { name: 'wsg_affection_l_english.txt', path: '/games/other/wsg_affection_l_english.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    // Wait for files to appear after scan
    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('Translate group')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Translate group'));

    await waitFor(() => {
      expect(clientApi.addDraftFiles).toHaveBeenCalled();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/jobs');
  });

  it('open group folder calls api.revealPath', async () => {
    vi.mocked(appApi.revealPath).mockResolvedValue({ success: true, message: '' });

    await renderAndScan([
      { name: 'wsg_affection_l_english.txt', path: '/games/other/wsg_affection_l_english.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getAllByText('Open folder').length).toBeGreaterThan(0);
    });

    // Click group-level "Open folder" (first match)
    fireEvent.click(screen.getAllByText('Open folder')[0]);

    await waitFor(() => {
      expect(appApi.revealPath).toHaveBeenCalled();
    });
  });

  it('changing grouping mode re-groups files', async () => {
    await renderAndScan([
      { name: 'en_readme.txt', path: '/games/other/en_readme.txt', type: 'file', size_bytes: 100, modified_at: null },
      { name: 'ru_readme.txt', path: '/games/other/ru_readme.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('Grouping Mode')).toBeTruthy();
    });

    // Switch to Language marker mode
    const select = screen.getByDisplayValue('Smart (filename families)') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'language_marker' } });

    // With flattenSingletons, language groups are flattened to FileRows.
    // Files still render by their relative paths (not group header labels).
    await waitFor(() => {
      expect(screen.getByText('en_readme.txt')).toBeTruthy();
      expect(screen.getByText('ru_readme.txt')).toBeTruthy();
    });
  });
});

describe('GenericFileSection — file-level actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) =>
        Promise.resolve({ files: data.file_paths, file_metadata: {}, grouped: [], diagnostics: [], count: data.file_paths.length }),
    );
    vi.mocked(clientApi.removeDraftFiles).mockResolvedValue({ files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0 });
  });

  it('file-level "Add to Translation Job" calls addDraftFiles', async () => {
    await renderAndScan([
      { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getAllByText('Add to Translation Job').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText('Add to Translation Job')[0]);

    await waitFor(() => {
      expect(clientApi.addDraftFiles).toHaveBeenCalled();
    });
  });

  it('file-level "Open folder" calls api.revealPath', async () => {
    vi.mocked(appApi.revealPath).mockResolvedValue({ success: true, message: '' });

    await renderAndScan([
      { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getAllByText('Open folder').length).toBeGreaterThan(0);
    });

    // Last "Open folder" is the file-level one (group-level appears first)
    const openFolderButtons = screen.getAllByText('Open folder');
    fireEvent.click(openFolderButtons[openFolderButtons.length - 1]);

    await waitFor(() => {
      expect(appApi.revealPath).toHaveBeenCalled();
    });
  });
});

describe('GenericFileSection — translate all flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(clientApi.addDraftFiles).mockImplementation(
      (data: { file_paths: string[] }) =>
        Promise.resolve({ files: data.file_paths, file_metadata: {}, grouped: [], diagnostics: [], count: data.file_paths.length }),
    );
    vi.mocked(appApi.listJobs).mockResolvedValue([]);
  });

  it('translate all adds files to draft and navigates to /jobs', async () => {
    await renderAndScan([
      { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    // Wait for files to appear first
    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('Translate all')).toBeTruthy();
    });

    // Click "Translate all" button in header
    fireEvent.click(screen.getByText('Translate all'));

    // Should check for existing jobs (duplicate detection)
    await waitFor(() => {
      expect(appApi.listJobs).toHaveBeenCalled();
    });

    // Should navigate to /jobs
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/jobs');
    });
  });
});

describe('GenericFileSection — dedup and performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('duplicate file paths do not produce duplicate rows', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other',
      parent: null,
      items: [
        { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
        { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });

    renderGeneric();

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));
    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('1 file')).toBeTruthy();
    });
  });

  it('floating job bar appears when draft files are present', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/games/other/existing.txt'],
      file_metadata: { '/games/other/existing.txt': { mod_id: 'generic', mod_name: 'Other Game' } },
      grouped: [], diagnostics: [], count: 1,
    });

    renderGeneric();

    await waitFor(() => {
      expect(screen.getByText('1 file(s) selected')).toBeTruthy();
      expect(screen.getByText('Go to job (1)')).toBeTruthy();
    });
  });

  it('already-added files are detected through normalized paths', async () => {
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: ['/games/other/file.txt'],
      file_metadata: { '/games/other/file.txt': { mod_id: 'generic', mod_name: 'Other Game' } },
      grouped: [], diagnostics: [], count: 1,
    });
    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other',
      parent: null,
      items: [
        { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });

    renderGeneric();

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    await waitFor(() => {
      // File should show as "Added" since it's already in the draft
      expect(screen.getByText('Added')).toBeTruthy();
    });
  });
});

/* ================================================================== */
/*  Persistence tests                                                   */
/* ================================================================== */

describe('GenericFileSection — persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other',
      parent: null,
      items: [
        { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });
  });

  it('restores groupingMode from localStorage on remount', async () => {
    // Set localStorage before mount
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('flat'),
    );

    await renderAndScan([
      { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    // Should read flat mode from storage
    const select = screen.getByDisplayValue('Flat (no grouping)') as HTMLSelectElement;
    expect(select).toBeTruthy();
  });

  it('restores rootDir from localStorage', async () => {
    localStorage.setItem(
      'stellaris_translator.discovery.rootDir.generic',
      JSON.stringify('/games/other'),
    );

    render(
      <DraftJobSelectionProvider>
        <TestGenericFileSection game={mockGame} handlerOptions={mockHandlers} />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    const pathInputs = screen.getAllByTestId('path-input');
    expect((pathInputs[0] as HTMLInputElement).value).toBe('/games/other');
  });

  it('different game ids have isolated rootDir state', async () => {
    // Store values for game "game-a"
    localStorage.setItem(
      'stellaris_translator.discovery.rootDir.game-a',
      JSON.stringify('/games/a'),
    );

    // Render with different game id
    const otherGame: GameModel = {
      ...mockGame,
      id: 'game-b',
    };

    render(
      <DraftJobSelectionProvider>
        <TestGenericFileSection game={otherGame} handlerOptions={mockHandlers} />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Should NOT see game-a's values
    const pathInputs = screen.getAllByTestId('path-input');
    expect((pathInputs[0] as HTMLInputElement).value).not.toBe('/games/a');
  });

  it('invalid grouping mode in localStorage falls back to smart', async () => {
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('invalid_mode'),
    );

    await renderAndScan([
      { name: 'file.txt', path: '/games/other/file.txt', type: 'file', size_bytes: 100, modified_at: null },
    ]);

    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    // Should fall back to smart due to validation effect
    const select = screen.getByDisplayValue('Smart (filename families)') as HTMLSelectElement;
    expect(select).toBeTruthy();
  });
});

/* ================================================================== */
/*  Flat mode tests                                                     */
/* ================================================================== */

describe('GenericFileSection — flat mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other',
      parent: null,
      items: [
        { name: 'a.txt', path: '/games/other/a.txt', type: 'file', size_bytes: 100, modified_at: null },
        { name: 'b.txt', path: '/games/other/b.txt', type: 'file', size_bytes: 100, modified_at: null },
        { name: 'c.txt', path: '/games/other/c.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });
  });

  async function renderInFlatMode() {
    // Preset flat mode in localStorage
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('flat'),
    );

    render(
      <DraftJobSelectionProvider>
        <TestGenericFileSection game={mockGame} handlerOptions={mockHandlers} />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    await waitFor(() => {
      expect(screen.getByText('Files (3)')).toBeTruthy();
    });
  }

  it('renders all files in a single flat group', async () => {
    await renderInFlatMode();

    // Flat mode should show "All files (3)" as the only group
    expect(screen.getByText('All files (3)')).toBeTruthy();
  });

  it('flat mode "Add group to Translation Job" adds all files', async () => {
    await renderInFlatMode();

    await waitFor(() => {
      expect(screen.getByText('Add group to Translation Job')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Add group to Translation Job'));

    await waitFor(() => {
      expect(clientApi.addDraftFiles).toHaveBeenCalled();
    });
  });

  it('flat mode "Translate group" translates all files', async () => {
    await renderInFlatMode();

    await waitFor(() => {
      expect(screen.getByText('Translate group')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Translate group'));

    await waitFor(() => {
      expect(clientApi.addDraftFiles).toHaveBeenCalled();
    });
  });
});

/* ================================================================== */
/*  Tab-switching regression test — scan state survives tab switches    */
/* ================================================================== */

describe('GenericFileSection — tab-switching persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other',
      parent: null,
      items: [
        { name: 'a.txt', path: '/games/other/a.txt', type: 'file', size_bytes: 100, modified_at: null },
        { name: 'b.txt', path: '/games/other/b.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });
  });

  function TabTestWrapper() {
    const [tab, setTab] = useState<'discovery' | 'other'>('discovery');
    const [scannedFiles, setScannedFiles] = useState<string[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);

    return (
      <DraftJobSelectionProvider>
        <div>
          <button data-testid="tab-discovery" onClick={() => setTab('discovery')}>
            Discovery Tab
          </button>
          <button data-testid="tab-other" onClick={() => setTab('other')}>
            Other Tab
          </button>
          {tab === 'discovery' && (
            <GenericFileSection
              game={mockGame}
              handlerOptions={mockHandlers}
              scannedFiles={scannedFiles}
              setScannedFiles={setScannedFiles}
              scanning={scanning}
              setScanning={setScanning}
              scanError={scanError}
              setScanError={setScanError}
            />
          )}
          {tab === 'other' && <div data-testid="other-tab-content">Other tab</div>}
        </div>
      </DraftJobSelectionProvider>
    );
  }

  it('preserves scanned files when switching tabs and switching back', async () => {
    render(<TabTestWrapper />);

    // Wait for draft init
    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Set root dir and scan
    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    // Verify discovered files are rendered (header shows count)
    expect(screen.getByText('Files (2)')).toBeTruthy();

    // Count how many times listDirectory has been called so far (should be 1 — the scan)
    expect(appApi.listDirectory).toHaveBeenCalledTimes(1);

    // Switch to "Other" tab — GenericFileSection unmounts
    fireEvent.click(screen.getByTestId('tab-other'));
    await waitFor(() => {
      expect(screen.getByTestId('other-tab-content')).toBeTruthy();
    });

    // GenericFileSection should not be in the DOM
    expect(screen.queryByText('Files (2)')).toBeNull();

    // Switch back to discovery tab — GenericFileSection remounts
    fireEvent.click(screen.getByTestId('tab-discovery'));

    // Wait for remount — draft API is called again on remount
    await waitFor(() => {
      // The files should still be showing because state is lifted to TabTestWrapper
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    // Assert NO new scan was triggered (listDirectory should still have been called only once)
    expect(appApi.listDirectory).toHaveBeenCalledTimes(1);
  });

  it('preserves flat mode grouping after tab switch', async () => {
    // Set flat mode in localStorage
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('flat'),
    );

    render(<TabTestWrapper />);

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Set root dir and scan
    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText('All files (2)')).toBeTruthy();
    });

    // Switch to other tab then back
    fireEvent.click(screen.getByTestId('tab-other'));
    await waitFor(() => {
      expect(screen.getByTestId('other-tab-content')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('tab-discovery'));

    // Flat mode grouping should still be applied after remount
    await waitFor(() => {
      expect(screen.getByText('All files (2)')).toBeTruthy();
    });

    // No re-scan
    expect(appApi.listDirectory).toHaveBeenCalledTimes(1);
  });

  it('preserves scanned files when switching tabs after selecting all', async () => {
    render(<TabTestWrapper />);

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Set root dir and scan
    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    // Switch to other tab and back
    fireEvent.click(screen.getByTestId('tab-other'));
    await waitFor(() => {
      expect(screen.getByTestId('other-tab-content')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('tab-discovery'));

    // Wait for remount — files should still show
    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });
  });
});

/* ================================================================== */
/*  Cross-route persistence tests — state survives full unmount/remount */
/*  (e.g. navigating from /games/generic to /protection-rules and back) */
/* ================================================================== */

describe('GenericFileSection — cross-route persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [], file_metadata: {}, grouped: [], diagnostics: [], count: 0,
    });
    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other',
      parent: null,
      items: [
        { name: 'a.txt', path: '/games/other/a.txt', type: 'file', size_bytes: 100, modified_at: null },
        { name: 'b.txt', path: '/games/other/b.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });
  });

  /** Wrapper that mirrors GamePage's pattern: usePersistentState for
   *  scannedFiles / scanError, useState for scanning. */
  function PersistentTestWrapper({
    game = mockGame,
    handlerOptions = mockHandlers,
  }: {
    game?: GameModel;
    handlerOptions?: FileHandlerModel[];
  }) {
    const [scannedFiles, setScannedFiles] = usePersistentState<string[]>(
      `stellaris_translator.discovery.scannedFiles.${game.id}`,
      [],
    );
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = usePersistentState<string | null>(
      `stellaris_translator.discovery.scanError.${game.id}`,
      null,
    );

    return (
      <GenericFileSection
        game={game}
        handlerOptions={handlerOptions}
        scannedFiles={scannedFiles}
        setScannedFiles={setScannedFiles}
        scanning={scanning}
        setScanning={setScanning}
        scanError={scanError}
        setScanError={setScanError}
      />
    );
  }

  /** Controller that can fully unmount/remount its children. */
  function MountController({ children }: { children: React.ReactNode }) {
    const [mounted, setMounted] = useState(true);
    return (
      <div>
        <button data-testid="toggle-mount" onClick={() => setMounted(m => !m)}>Toggle Mount</button>
        {mounted && children}
      </div>
    );
  }

  // --- Test A: scanned files restored after unmount/remount ---
  it('restores scanned files after unmount/remount', async () => {
    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    // Unmount the wrapper (simulates navigating away from /games/:gameId)
    fireEvent.click(screen.getByTestId('toggle-mount'));
    expect(screen.queryByText('Files (2)')).toBeNull();

    // Remount (simulates navigating back)
    fireEvent.click(screen.getByTestId('toggle-mount'));

    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    // No re-scan triggered
    expect(appApi.listDirectory).toHaveBeenCalledTimes(1);
  });

  // --- Test B: (removed — checkbox selection removed from GenericFileSection) ---

  // --- Test C: scanning is NOT restored as true after remount ---
  it('scanning is NOT restored as true after remount', async () => {
    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Initial state: scanning=false
    expect(screen.getByText('Scan files')).toBeTruthy();

    // Unmount and remount
    fireEvent.click(screen.getByTestId('toggle-mount'));
    fireEvent.click(screen.getByTestId('toggle-mount'));

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // scanning must always be false — never restored from localStorage
    expect(screen.getByText('Scan files')).toBeTruthy();
    expect(screen.queryByText('Scanning...')).toBeNull();
  });

  // --- Test D: handler change clears persisted state (scannedFiles) ---
  it('handler change clears persisted scanned files', async () => {
    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Scan files
    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    await waitFor(() => {
      expect(screen.getByText('Files (2)')).toBeTruthy();
    });

    // Change file handler — clears scannedFiles
    const handlerSelect = screen.getByDisplayValue('Plain Text (1)') as HTMLSelectElement;
    fireEvent.change(handlerSelect, { target: { value: 'yaml' } });

    // Files should be cleared from the UI
    await waitFor(() => {
      expect(screen.queryByText('Files (2)')).toBeNull();
    });

    // Fully unmount and remount to verify persistence was also cleared
    fireEvent.click(screen.getByTestId('toggle-mount'));
    fireEvent.click(screen.getByTestId('toggle-mount'));

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Files should still be gone — the empty arrays were persisted
    expect(screen.queryByText('Files (2)')).toBeNull();
    expect(screen.getByText(/No files scanned/)).toBeTruthy();
  });

  // --- Test E: (removed — checkbox selection removed from GenericFileSection) ---

  // --- Test F: (removed — checkbox selection removed from GenericFileSection) ---

  // --- Test G: expanded directory group survives unmount/remount ---
  it('expanded directory group survives unmount/remount', async () => {
    // Pre-set scannedFiles with files in a subdirectory to create a dir group.
    // Must also set rootDir so the grouping engine computes relative paths correctly.
    localStorage.setItem(
      'stellaris_translator.discovery.rootDir.generic',
      JSON.stringify('/games/other'),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/subdir/a.txt']),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('folder'),
    );
    // Both the directory node and the leaf file node must be in the expanded
    // list for the file row to be rendered.
    localStorage.setItem(
      'stellaris_translator.discovery.expandedGroups.generic',
      JSON.stringify(['dir:subdir', 'file:subdir/a.txt']),
    );

    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Files header should show restored count
    expect(screen.getByText('Files (1)')).toBeTruthy();

    // The dir group label "subdir" should be visible (may appear multiple
    // times — once as the loc-group-label and once as the relativePath span)
    expect(screen.getAllByText('subdir').length).toBeGreaterThanOrEqual(1);

    // The leaf file group label "a.txt" should be visible inside the expanded dir
    expect(screen.getByText('a.txt')).toBeTruthy();

    // Unmount
    fireEvent.click(screen.getByTestId('toggle-mount'));

    // Remount
    fireEvent.click(screen.getByTestId('toggle-mount'));

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Files still visible
    expect(screen.getByText('Files (1)')).toBeTruthy();

    // Both group headers still visible — persisted expandedGroupList was preserved
    expect(screen.getAllByText('subdir').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('a.txt')).toBeTruthy();
  });

  // --- Test H: expanded nested directory survives unmount/remount ---
  it('expanded nested directory survives unmount/remount', async () => {
    // Files in nested directories: /games/other/a/b/file.txt
    localStorage.setItem(
      'stellaris_translator.discovery.rootDir.generic',
      JSON.stringify('/games/other'),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/a/b/file.txt']),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('folder'),
    );
    // Expand all levels: parent dir, child dir, and leaf file node
    localStorage.setItem(
      'stellaris_translator.discovery.expandedGroups.generic',
      JSON.stringify(['dir:a', 'dir:a/b', 'file:a/b/file.txt']),
    );

    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Files header shows restored count
    expect(screen.getByText('Files (1)')).toBeTruthy();

    // Both dir labels visible (may appear twice: label + relativePath)
    expect(screen.getAllByText('a').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('b')).toBeTruthy();

    // Leaf file group label visible
    expect(screen.getByText('file.txt')).toBeTruthy();

    // Unmount
    fireEvent.click(screen.getByTestId('toggle-mount'));

    // Remount
    fireEvent.click(screen.getByTestId('toggle-mount'));

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Both dirs should still be expanded after remount
    expect(screen.getAllByText('a').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText('file.txt')).toBeTruthy();
  });

  // --- Test I: handler change clears expandedGroupList ---
  it('handler change clears expanded groups', async () => {
    // Pre-set state with files and expanded groups
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/a.txt', '/games/other/b.txt']),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('smart'),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.expandedGroups.generic',
      JSON.stringify(['smart::a', 'smart::b']),
    );

    render(
      <DraftJobSelectionProvider>
        <PersistentTestWrapper />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // State restored
    expect(screen.getByText('Files (2)')).toBeTruthy();

    // Change handler — clears scannedFiles and (via effect) expandedGroupList
    const handlerSelect = screen.getByDisplayValue('Plain Text (1)') as HTMLSelectElement;
    fireEvent.change(handlerSelect, { target: { value: 'yaml' } });

    // Files cleared
    await waitFor(() => {
      expect(screen.queryByText('Files (2)')).toBeNull();
    });
    expect(screen.getByText(/No files scanned/)).toBeTruthy();

    // Persisted scannedFiles is an empty array
    expect(JSON.parse(localStorage.getItem('stellaris_translator.discovery.scannedFiles.generic')!)).toEqual([]);
  });

  // --- Test J: explicit rescan clears stale scanned files and expanded groups ---
  it('explicit rescan clears stale scanned files and expanded groups', async () => {
    // Mock listDirectory to return a single new file
    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other',
      parent: null,
      items: [
        { name: 'new.txt', path: '/games/other/new.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });

    // Pre-set stale state (from previous session)
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/a.txt', '/games/other/b.txt']),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('flat'),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.expandedGroups.generic',
      JSON.stringify(['flat:all']),
    );

    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // Stale state restored
    expect(screen.getByText('Files (2)')).toBeTruthy();

    // Click Scan files — this calls handleScan which clears state then rescans
    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    // After rescan, only the new file should appear
    await waitFor(() => {
      expect(screen.getByText('Files (1)')).toBeTruthy();
    });

    // Old files gone
    expect(screen.queryByText('a.txt')).toBeNull();
    expect(screen.queryByText('b.txt')).toBeNull();
    expect(screen.getByText('new.txt')).toBeTruthy();

    // Verify persisted state updated
    expect(JSON.parse(localStorage.getItem('stellaris_translator.discovery.scannedFiles.generic')!)).toEqual(['/games/other/new.txt']);
  });

  // --- Test K: Deep expanded directory chain (4+ levels) survives unmount/remount ---
  it('deep expanded directory chain (4+ levels) survives unmount/remount', async () => {
    // Simulate a user having scanned files in a deeply nested structure
    // and expanded every level: 1121692237 → localisation → braz_por → random_names
    localStorage.setItem(
      'stellaris_translator.discovery.rootDir.generic',
      JSON.stringify('/games/other'),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/1121692237/localisation/braz_por/random_names/some_file.txt']),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.groupingMode.generic',
      JSON.stringify('folder'),
    );
    localStorage.setItem(
      'stellaris_translator.discovery.expandedGroups.generic',
      JSON.stringify([
        'dir:1121692237',
        'dir:1121692237/localisation',
        'dir:1121692237/localisation/braz_por',
        'dir:1121692237/localisation/braz_por/random_names',
        'file:1121692237/localisation/braz_por/random_names/some_file.txt',
      ]),
    );

    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // All 4 directory levels expanded
    expect(screen.getByText('Files (1)')).toBeTruthy();
    expect(screen.getByText('localisation')).toBeTruthy();
    expect(screen.getByText('braz_por')).toBeTruthy();
    expect(screen.getByText('random_names')).toBeTruthy();

    // Verify the full chain survives unmount + remount
    fireEvent.click(screen.getByTestId('toggle-mount'));
    fireEvent.click(screen.getByTestId('toggle-mount'));

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    expect(screen.getByText('Files (1)')).toBeTruthy();
    expect(screen.getByText('localisation')).toBeTruthy();
    expect(screen.getByText('braz_por')).toBeTruthy();
    expect(screen.getByText('random_names')).toBeTruthy();

    // Verify the persisted list was never truncated
    const stored = JSON.parse(
      localStorage.getItem('stellaris_translator.discovery.expandedGroups.generic')!,
    );
    expect(stored).toContain('dir:1121692237');
    expect(stored).toContain('dir:1121692237/localisation');
    expect(stored).toContain('dir:1121692237/localisation/braz_por');
    expect(stored).toContain('dir:1121692237/localisation/braz_por/random_names');
    expect(stored).toContain('file:1121692237/localisation/braz_por/random_names/some_file.txt');
  });

  // --- Test L: Full cycle — scan → expand deep → unmount → remount preserves all levels ---
  it('full cycle scan -> expand deep -> unmount -> remount preserves expansion', async () => {
    // Set up rootDir and groupingMode so the scan produces a known tree
    localStorage.setItem('stellaris_translator.discovery.rootDir.generic', JSON.stringify('/games/other'));
    localStorage.setItem('stellaris_translator.discovery.groupingMode.generic', JSON.stringify('folder'));

    vi.mocked(appApi.listDirectory).mockResolvedValue({
      path: '/games/other', parent: null,
      items: [
        { name: 'some_file.txt', path: '/games/other/1121692237/localisation/braz_por/random_names/some_file.txt', type: 'file', size_bytes: 100, modified_at: null },
      ],
      diagnostics: [],
    });

    render(
      <DraftJobSelectionProvider>
        <MountController>
          <PersistentTestWrapper />
        </MountController>
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // --- Scan ---
    const pathInputs = screen.getAllByTestId('path-input');
    fireEvent.change(pathInputs[0], { target: { value: '/games/other' } });
    fireEvent.click(screen.getByText('Scan files'));

    await waitFor(() => { expect(screen.getByText('Files (1)')).toBeTruthy(); });

    // After scan, auto-expand should have added the top-level dir
    let stored = JSON.parse(
      localStorage.getItem('stellaris_translator.discovery.expandedGroups.generic')!,
    );
    expect(stored).toContain('dir:1121692237');

    // --- Expand all 4 levels ---
    fireEvent.click(screen.getByText('localisation'));
    fireEvent.click(screen.getByText('braz_por'));
    fireEvent.click(screen.getByText('random_names'));

    stored = JSON.parse(
      localStorage.getItem('stellaris_translator.discovery.expandedGroups.generic')!,
    );
    expect(stored).toContain('dir:1121692237/localisation');
    expect(stored).toContain('dir:1121692237/localisation/braz_por');
    expect(stored).toContain('dir:1121692237/localisation/braz_por/random_names');

    // --- Unmount & Remount (simulates navigation away and back) ---
    fireEvent.click(screen.getByTestId('toggle-mount'));
    expect(screen.queryByText('Files (1)')).toBeNull();

    fireEvent.click(screen.getByTestId('toggle-mount'));
    await waitFor(() => { expect(screen.getByText('Files (1)')).toBeTruthy(); });

    // All 4 dir levels still expanded
    stored = JSON.parse(
      localStorage.getItem('stellaris_translator.discovery.expandedGroups.generic')!,
    );
    expect(stored).toContain('dir:1121692237');
    expect(stored).toContain('dir:1121692237/localisation');
    expect(stored).toContain('dir:1121692237/localisation/braz_por');
    expect(stored).toContain('dir:1121692237/localisation/braz_por/random_names');

    // DOM confirms deep expansion
    expect(screen.getByText('localisation')).toBeTruthy();
    expect(screen.getByText('braz_por')).toBeTruthy();
    expect(screen.getByText('random_names')).toBeTruthy();
  });

  // --- Test M: Restored expandedGroupList is not overwritten by auto-expand ---
  it('restored expandedGroupList with 4+ nested IDs is not overwritten by auto-expand', async () => {
    // Pre-set state as if restored from a previous session
    localStorage.setItem('stellaris_translator.discovery.rootDir.generic', JSON.stringify('/games/other'));
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/a/b/c/d/e/file.txt']),
    );
    localStorage.setItem('stellaris_translator.discovery.groupingMode.generic', JSON.stringify('folder'));
    localStorage.setItem('stellaris_translator.discovery.expandedGroups.generic', JSON.stringify([
      'dir:a',
      'dir:a/b',
      'dir:a/b/c',
      'dir:a/b/c/d',
      'dir:a/b/c/d/e',
      'file:a/b/c/d/e/file.txt',
    ]));

    render(
      <DraftJobSelectionProvider>
        <PersistentTestWrapper />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    // The persisted expanded groups must NOT have been truncated to top-level only
    const stored = JSON.parse(
      localStorage.getItem('stellaris_translator.discovery.expandedGroups.generic')!,
    );
    expect(stored).toEqual([
      'dir:a',
      'dir:a/b',
      'dir:a/b/c',
      'dir:a/b/c/d',
      'dir:a/b/c/d/e',
      'file:a/b/c/d/e/file.txt',
    ]);

    // All levels visible in DOM
    expect(screen.getByText('Files (1)')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText('c')).toBeTruthy();
    expect(screen.getByText('d')).toBeTruthy();
    expect(screen.getByText('e')).toBeTruthy();
  });

  // --- Test N: Persisted expandedGroupList survives GamePage-like loading delay ---
  it('persisted expandedGroupList survives GamePage-like loading delay', async () => {
    // Pre-set state as if restored
    localStorage.setItem('stellaris_translator.discovery.rootDir.generic', JSON.stringify('/games/other'));
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/a/b/c/file.txt']),
    );
    localStorage.setItem('stellaris_translator.discovery.groupingMode.generic', JSON.stringify('folder'));
    localStorage.setItem('stellaris_translator.discovery.expandedGroups.generic', JSON.stringify([
      'dir:a',
      'dir:a/b',
      'dir:a/b/c',
      'file:a/b/c/file.txt',
    ]));

    // Wrapper that mimics GamePage's loading-then-render pattern
    function GamePageLoadingWrapper() {
      const [loaded, setLoaded] = useState(false);
      useEffect(() => { const t = setTimeout(() => setLoaded(true), 10); return () => clearTimeout(t); }, []);
      if (!loaded) return <div data-testid="loading">Loading...</div>;
      return (
        <DraftJobSelectionProvider>
          <PersistentTestWrapper />
        </DraftJobSelectionProvider>
      );
    }

    render(<GamePageLoadingWrapper />);

    // First: loading state
    expect(screen.getByTestId('loading')).toBeTruthy();

    // Wait for load + mount
    await waitFor(() => { expect(screen.getByText('Files (1)')).toBeTruthy(); });

    // All levels expanded
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText('c')).toBeTruthy();

    // Expanded groups intact
    const stored = JSON.parse(
      localStorage.getItem('stellaris_translator.discovery.expandedGroups.generic')!,
    );
    expect(stored).toEqual(['dir:a', 'dir:a/b', 'dir:a/b/c', 'file:a/b/c/file.txt']);
  });

  // --- Test O: grouping mode change resets expansion to top-level only ---
  it('grouping mode change resets expansion to top-level only', async () => {
    localStorage.setItem('stellaris_translator.discovery.rootDir.generic', JSON.stringify('/games/other'));
    localStorage.setItem(
      'stellaris_translator.discovery.scannedFiles.generic',
      JSON.stringify(['/games/other/a.txt', '/games/other/b.txt']),
    );
    localStorage.setItem('stellaris_translator.discovery.groupingMode.generic', JSON.stringify('smart'));
    // Pre-set expanded groups that match smart mode
    localStorage.setItem('stellaris_translator.discovery.expandedGroups.generic', JSON.stringify([
      'smart::a',
      'smart::b',
    ]));

    render(
      <DraftJobSelectionProvider>
        <PersistentTestWrapper />
      </DraftJobSelectionProvider>,
    );

    await waitFor(() => expect(clientApi.getDraftJobSelection).toHaveBeenCalled());

    expect(screen.getByText('Files (2)')).toBeTruthy();

    // Switch grouping mode — this should auto-expand top-level IDs for new mode
    const select = screen.getByDisplayValue('Smart (filename families)') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'flat' } });

    await waitFor(() => {
      // Flat mode shows a single group: "All files (2)"
      expect(screen.getByText('All files (2)')).toBeTruthy();
    });

    // expandedGroupList should now contain only top-level flat mode ID
    const stored = JSON.parse(
      localStorage.getItem('stellaris_translator.discovery.expandedGroups.generic')!,
    );
    expect(stored).toEqual(['flat:all']);
  });
});
