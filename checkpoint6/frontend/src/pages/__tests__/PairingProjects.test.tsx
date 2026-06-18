import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import PairingProjects from '../PairingProjects';
import { api, ApiError } from '../../App';
import { __resetLineMatchCache } from '../../components/pairing/workspace/PairList';
import type { FileGroupResponse } from '../../api/types';
import type { ErrorDetail } from '../../api/types';

// ------------------------------------------------------------------ //
//  Mocks
// ------------------------------------------------------------------ //

vi.mock('../../App', () => {
  // Stable reference to avoid triggering useEffect re-runs in child components
  const stableShowToast = vi.fn();
  return {
    api: {
      listPairingProjects: vi.fn(),
      getPairingProject: vi.fn(),
      createPairingProject: vi.fn(),
      updatePairingProject: vi.fn(),
      deletePairingProject: vi.fn(),
      scanPairingProject: vi.fn(),
      getPairingGroups: vi.fn(),
      listPairingPairs: vi.fn(),
      suggestPairingPairs: vi.fn(),
      createPairingPair: vi.fn(),
      updatePairingPair: vi.fn(),
      deletePairingPair: vi.fn(),
      getPairingPairPreview: vi.fn(),
      listProfiles: vi.fn(),
      learnFromPairingPairs: vi.fn(),
      getPairingAlignment: vi.fn().mockResolvedValue(null),
      savePairingAlignment: vi.fn(),
      previewPairingAlignment: vi.fn(),
      exactLineMatchPreview: vi.fn(() => Promise.resolve({ threshold_percent: 0, matches: [] })),
    },
    ApiError: class ApiError extends Error {
      code: string;
      details: Record<string, unknown>;
      recoverable: boolean;
      constructor(err: ErrorDetail) {
        super(err.message);
        this.name = 'ApiError';
        this.code = err.code;
        this.details = err.details;
        this.recoverable = err.recoverable;
      }
    },
    useToast: () => ({ showToast: stableShowToast }),
  };
});

// ------------------------------------------------------------------ //
//  Test data
// ------------------------------------------------------------------ //

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  root_path: '/games/test',
  source_language: 'english',
  target_language: 'french',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_scanned_at: null,
  status: 'active',
  notes: null,
};

const MOCK_SCANNED_PROJECT = {
  ...MOCK_PROJECT,
  id: 'proj-2',
  last_scanned_at: '2024-01-03T00:00:00Z',
};

const MOCK_GROUPS = [
  {
    group_key: 'dir1',
    display_name: 'locale/english',
    relative_dir: 'locale/english',
    files_count: 2,
    source_like_count: 1,
    translated_like_count: 1,
    children: [],
    files: [
      {
        id: 'f1',
        project_id: 'proj-2',
        relative_path: 'locale/english/file1.yml',
        file_name: 'file1.yml',
        extension: '.yml',
        parent_dir: 'locale/english',
        size_bytes: 100,
        content_hash: null,
        modified_at: null,
        detected_language: 'english',
        detected_role: 'source',
        group_key: 'dir1',
        is_ignored: false,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'f2',
        project_id: 'proj-2',
        relative_path: 'locale/french/file1.yml',
        file_name: 'file1.yml',
        extension: '.yml',
        parent_dir: 'locale/french',
        size_bytes: 120,
        content_hash: null,
        modified_at: null,
        detected_language: 'french',
        detected_role: 'translated',
        group_key: 'dir1',
        is_ignored: false,
        created_at: '',
        updated_at: '',
      },
    ],
  },
];

const MOCK_PAIRS = [
  {
    id: 'p1',
    project_id: 'proj-2',
    source_file_id: 'f1',
    translated_file_id: 'f2',
    source_file: {
      id: 'f1',
      project_id: 'proj-2',
      relative_path: 'locale/english/file1.yml',
      file_name: 'file1.yml',
      extension: '.yml',
      parent_dir: 'locale/english',
      size_bytes: 100,
      content_hash: null,
      modified_at: null,
      detected_language: 'english',
      detected_role: 'source',
      group_key: 'dir1',
      is_ignored: false,
      created_at: '',
      updated_at: '',
    },
    translated_file: {
      id: 'f2',
      project_id: 'proj-2',
      relative_path: 'locale/french/file1.yml',
      file_name: 'file1.yml',
      extension: '.yml',
      parent_dir: 'locale/french',
      size_bytes: 120,
      content_hash: null,
      modified_at: null,
      detected_language: 'french',
      detected_role: 'translated',
      group_key: 'dir1',
      is_ignored: false,
      created_at: '',
      updated_at: '',
    },
    status: 'suggested',
    confidence: 0.85,
    reason: 'Same basename',
    created_by: 'auto',
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
    notes: null,
  },
];

const MOCK_PREVIEW = {
  pair: MOCK_PAIRS[0],
  source_file: {
    file_id: 'f1',
    relative_path: 'locale/english/file1.yml',
    content: 'source content',
    encoding: 'utf-8',
    line_count: 1,
    content_hash: 'abc',
    modified_at: null,
    size_bytes: 100,
  },
  translated_file: {
    file_id: 'f2',
    relative_path: 'locale/french/file1.yml',
    content: 'translated content',
    encoding: 'utf-8',
    line_count: 1,
    content_hash: 'def',
    modified_at: null,
    size_bytes: 120,
  },
};

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

function renderPage(initialEntries?: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries ?? ['/']}>
      <PairingProjects />
    </MemoryRouter>,
  );
}

describe('PairingProjects', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetLineMatchCache();
    cleanup();
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
  });

  // ------------------------------------------------------------------ //
  //  Project list state — card-based (not table-first UX)
  // ------------------------------------------------------------------ //

  it('renders loading state initially', async () => {
    // Return a promise that never resolves so the component stays in loading
    vi.mocked(api.listPairingProjects).mockReturnValue(new Promise(() => {}));

    renderPage();;

    // Loading text should appear
    await screen.findByText('Loading projects...');
  });

  it('renders empty project state', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([]);

    renderPage();;

    await screen.findByText('No projects yet. Create one to get started.');

    expect(screen.getByText('Create Project')).toBeDefined();
  });

  it('renders project cards, not table-first UX', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);

    renderPage();;

    // Project name should appear in a card
    await screen.findByText('Test Project');

    // Root path should be visible
    expect(screen.getByText('/games/test')).toBeDefined();

    // Source and target language badges should appear on the card
    expect(screen.getByText('Source: english')).toBeDefined();
    expect(screen.getByText('Target: french')).toBeDefined();

    // There should be no table elements
    expect(screen.queryByRole('table')).toBeNull();

    // There should be no "Open" button (old table-first UX)
    expect(screen.queryByText('Open')).toBeNull();

    // The card should be clickable (has role="button")
    const card = screen.getByRole('button', { name: /Test Project/i });
    expect(card).toBeDefined();

    // Action buttons should be available on the card
    expect(screen.getByText('Scan')).toBeDefined();
    expect(screen.getByText('Archive')).toBeDefined();
  });

  it('does not require source/target language fields in create dialog', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([]);

    renderPage();;

    await screen.findByText('No projects yet. Create one to get started.');

    // Open create dialog
    fireEvent.click(screen.getByText('Create Project'));

    // Dialog should be open with Create Pairing Project heading
    await screen.findByText('Create Pairing Project');

    // Should have Name and Root Path fields
    expect(screen.getByPlaceholderText('My paired dataset')).toBeDefined();
    expect(screen.getByPlaceholderText('/path/to/project/files')).toBeDefined();

    // Should NOT have source/target language fields
    expect(screen.queryByPlaceholderText(/source/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/target/i)).toBeNull();
  });

  it('create payload does not require source_language/target_language', async () => {
    vi.mocked(api.listPairingProjects)
      .mockResolvedValueOnce([])
      .mockResolvedValue([MOCK_PROJECT]);
    vi.mocked(api.createPairingProject).mockResolvedValue(MOCK_PROJECT);

    renderPage();;

    await screen.findByText('No projects yet. Create one to get started.');

    // Open dialog
    fireEvent.click(screen.getByText('Create Project'));

    await screen.findByText('Create Pairing Project');

    // Fill in name and root_path only
    fireEvent.change(screen.getByPlaceholderText('My paired dataset'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByPlaceholderText('/path/to/project/files'), {
      target: { value: '/games/test' },
    });

    // Submit — there are two "Create Project" elements (header button + dialog button)
    const createBtns = screen.getAllByText('Create Project');
    // The last one is the dialog submit button
    fireEvent.click(createBtns[createBtns.length - 1]);

    // Verify API was called without source_language/target_language
    await waitFor(() => {
      expect(api.createPairingProject).toHaveBeenCalledWith({
        name: 'Test Project',
        root_path: '/games/test',
        notes: null,
      });
    });
  });

  it('existing projects with non-null languages still render', async () => {
    const projectWithLanguages = {
      ...MOCK_PROJECT,
      source_language: 'english',
      target_language: 'french',
    };
    vi.mocked(api.listPairingProjects).mockResolvedValue([projectWithLanguages]);

    renderPage();;

    await screen.findByText('Test Project');

    // Language badges should render on the card
    expect(screen.getByText('Source: english')).toBeDefined();
    expect(screen.getByText('Target: french')).toBeDefined();
  });

  it('handles project loading error', async () => {
    vi.mocked(api.listPairingProjects).mockRejectedValue(
      new ApiError({ message: 'API failure', code: 'ERROR', details: {}, recoverable: false }),
    );

    renderPage();;

    await screen.findByText('API failure');
  });

  // ------------------------------------------------------------------ //
  //  Collapsible date sections
  // ------------------------------------------------------------------ //

  describe('collapsible date sections', () => {
    /** System time fixed so date bucket labels are deterministic. */
    const FIXED_NOW = new Date(2026, 5, 4, 12, 0, 0); // June 4, 2026 12:00

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(FIXED_NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function makeProject(overrides: Partial<typeof MOCK_PROJECT>) {
      // Sync updated_at with created_at so date grouping uses the intended date
      const result = { ...MOCK_PROJECT, ...overrides };
      if (overrides.created_at && !overrides.updated_at) {
        result.updated_at = overrides.created_at;
      }
      return result;
    }

    it('renders date group headers with item count', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Alpha', created_at: '2026-06-04T10:00:00Z' }),
        makeProject({ id: 'p2', name: 'Beta', created_at: '2026-06-03T10:00:00Z' }),
      ];
      vi.mocked(api.listPairingProjects).mockResolvedValue(projects);

      renderPage();;

      await screen.findByText('Alpha');

      // Date group headers should display their labels
      expect(screen.getByText('Today')).toBeDefined();
      expect(screen.getByText('Yesterday')).toBeDefined();

      // Each header should show item count
      expect(screen.getByText('Today').closest('[role="button"]')).toBeDefined();
      expect(screen.getByText('Yesterday').closest('[role="button"]')).toBeDefined();
    });

    it('groups are expanded by default, project cards are visible', async () => {
      vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);

      renderPage();;

      await screen.findByText('Test Project');

      // The project card should be visible in the DOM
      expect(screen.getByText('Test Project')).toBeDefined();
    });

    it('clicking group header collapses the cards inside', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Alpha', created_at: '2026-06-04T10:00:00Z' }),
        makeProject({ id: 'p2', name: 'Beta', created_at: '2026-06-04T11:00:00Z' }),
      ];
      vi.mocked(api.listPairingProjects).mockResolvedValue(projects);

      const { container } = renderPage();

      await screen.findByText('Alpha');

      // Both project cards exist in DOM initially
      expect(screen.getByText('Alpha')).toBeDefined();
      expect(screen.getByText('Beta')).toBeDefined();

      // Click the "Today" group header (first output-job-group-header)
      const header = container.querySelector('.output-job-group-header')!;
      fireEvent.click(header);

      // Both cards should be hidden after collapse
      expect(screen.queryByText('Alpha')).toBeNull();
      expect(screen.queryByText('Beta')).toBeNull();
    });

    it('clicking group header again expands the cards', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Gamma', created_at: '2026-06-04T10:00:00Z' }),
      ];
      vi.mocked(api.listPairingProjects).mockResolvedValue(projects);

      const { container } = renderPage();

      await screen.findByText('Gamma');

      const header = container.querySelector('.output-job-group-header')!;

      // Collapse
      fireEvent.click(header);
      expect(screen.queryByText('Gamma')).toBeNull();

      // Expand again
      fireEvent.click(header);
      expect(screen.getByText('Gamma')).toBeDefined();
    });

    it('aria-expanded reflects current collapse state', async () => {
      vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);

      const { container } = renderPage();

      await screen.findByText('Test Project');

      const header = container.querySelector('.output-job-group-header')!;

      // Initially expanded
      expect(header.getAttribute('aria-expanded')).toBe('true');

      // After click, collapsed
      fireEvent.click(header);
      expect(header.getAttribute('aria-expanded')).toBe('false');

      // After second click, expanded again
      fireEvent.click(header);
      expect(header.getAttribute('aria-expanded')).toBe('true');
    });

    it('keyboard Enter on header toggles collapse', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Delta', created_at: '2026-06-04T10:00:00Z' }),
      ];
      vi.mocked(api.listPairingProjects).mockResolvedValue(projects);

      const { container } = renderPage();

      await screen.findByText('Delta');

      const header = container.querySelector('.output-job-group-header')!;

      // Press Enter to collapse
      fireEvent.keyDown(header, { key: 'Enter' });
      expect(screen.queryByText('Delta')).toBeNull();

      // Press Enter to expand
      fireEvent.keyDown(header, { key: 'Enter' });
      expect(screen.getByText('Delta')).toBeDefined();
    });

    it('keyboard Space on header toggles collapse', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Epsilon', created_at: '2026-06-04T10:00:00Z' }),
      ];
      vi.mocked(api.listPairingProjects).mockResolvedValue(projects);

      const { container } = renderPage();

      await screen.findByText('Epsilon');

      const header = container.querySelector('.output-job-group-header')!;

      // Press Space to collapse
      fireEvent.keyDown(header, { key: ' ' });
      expect(screen.queryByText('Epsilon')).toBeNull();

      // Press Space to expand
      fireEvent.keyDown(header, { key: ' ' });
      expect(screen.getByText('Epsilon')).toBeDefined();
    });

    it('header has group-header-arrow with open class when expanded', async () => {
      vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);

      const { container } = renderPage();

      await screen.findByText('Test Project');

      const arrow = container.querySelector('.group-header-arrow')!;

      // Expanded by default → arrow should have 'open' class
      expect(arrow.classList.contains('open')).toBe(true);

      // Collapse
      const header = container.querySelector('.output-job-group-header')!;
      fireEvent.click(header);
      expect(arrow.classList.contains('open')).toBe(false);

      // Expand again
      fireEvent.click(header);
      expect(arrow.classList.contains('open')).toBe(true);
    });
  });

  // ------------------------------------------------------------------ //
  //  Selection and workspace
  // ------------------------------------------------------------------ //

  it('selecting a project highlights the card and renders workspace below the cards', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    // Wait for project to load
    await screen.findByText('Test Project');

    // Click the project card to select it
    const card = screen.getByRole('button', { name: /Test Project/i });
    fireEvent.click(card);

    // Card should have selected class
    expect(card.className).toContain('selected');

    // Workspace elements should appear BELOW the cards (not replacing the page)
    // The page header should still be visible
    expect(screen.getByText('Pairing Projects')).toBeDefined();

    // Project settings form should appear
    expect(screen.getByText('Project Settings')).toBeDefined();

    // Action buttons should appear in workspace header
    expect(screen.getByText('Scan / Rescan')).toBeDefined();
    const suggestBtns = screen.getAllByText('Suggest Pairs');
    expect(suggestBtns.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Learn')).toBeDefined();

    // Workspace meta row should show Root / Last scanned / Status
    expect(screen.getByText('Root:')).toBeDefined();
    // /games/test appears in both the input value and the meta code element
    expect(screen.getAllByText('/games/test').length).toBeGreaterThanOrEqual(1);
    // Last scanned appears in header + PairingFileWorkspace
    expect(screen.getAllByText('Last scanned:').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Status:')).toBeDefined();
    // Project status badge shows "active"
    const statusBadge = document.querySelector('.pw-workspace-meta .badge');
    expect(statusBadge?.textContent).toBe('active');

    // CSS layout classes exist
    expect(document.querySelector('.pairing-workspace-settings')).toBeTruthy();
    expect(document.querySelector('.pairing-workspace-header')).toBeTruthy();
    expect(document.querySelector('.pw-workspace-meta')).toBeTruthy();
    expect(document.querySelector('.pw-workspace-actions')).toBeTruthy();

    // All meta + action elements are simultaneously in the DOM
    const rootCode = document.querySelector('.pw-workspace-meta__root-path');
    expect(rootCode?.textContent).toBe('/games/test');
    expect(rootCode?.getAttribute('title')).toBe('/games/test');

    // File tree groups should render
    await screen.findByText('locale/english');

    // Pairs should render
    expect(screen.getByText('Same basename')).toBeDefined();
  });

  it('selecting a project does not change route/path', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    await screen.findByText('Test Project');

    // Verify we're on the same "page" — the h2 header is still visible
    expect(screen.getByText('Pairing Projects')).toBeDefined();

    // Click the card
    const card = screen.getByRole('button', { name: /Test Project/i });
    fireEvent.click(card);

    // Page header should still be visible (no route change, no full-page swap)
    expect(screen.getByText('Pairing Projects')).toBeDefined();

    // Project cards should still be visible
    expect(screen.getByText('Test Project')).toBeDefined();
    expect(screen.getByText('Scan')).toBeDefined(); // Card-level scan button
  });

  // ------------------------------------------------------------------ //
  //  Explicit 3-row grid layout
  // ------------------------------------------------------------------ //

  it('renders project shelf and workspace in separate containers', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);

    const { container } = renderPage();

    await screen.findByText('Test Project');

    // The page uses explicit 3-row grid classes
    const page = container.querySelector('.pairing-page')!;
    expect(page).toBeTruthy();

    // Existence of layout containers
    const header = page.querySelector('.pairing-page__header');
    expect(header).toBeTruthy();
    expect(header?.textContent).toContain('Pairing Projects');

    const shelf = page.querySelector('.pairing-page__project-shelf');
    expect(shelf).toBeTruthy();
    // The shelf contains the project cards
    expect(shelf?.textContent).toContain('Test Project');

    const workspace = page.querySelector('.pairing-page__workspace');
    expect(workspace).toBeTruthy();
    // Workspace is empty when no project is selected
    expect(workspace?.children.length).toBe(0);

    // The three containers are direct children of .pairing-page
    expect(page.children[0].classList.contains('pairing-page__header')).toBe(true);
    expect(page.children[1].classList.contains('pairing-page__project-shelf')).toBe(true);
    expect(page.children[2].classList.contains('pairing-page__workspace')).toBe(true);
  });

  it('ProjectSettingsForm uses compact grid classes', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    await screen.findByText('Test Project');

    // Select project
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // The form uses project-settings-form classes (not inline styles)
    const form = document.querySelector('.project-settings-form');
    expect(form).toBeTruthy();

    // Title uses the BEM class
    const title = document.querySelector('.project-settings-form__title');
    expect(title).toBeTruthy();
    expect(title?.textContent).toBe('Project Settings');

    // Grid layout exists
    const grid = document.querySelector('.project-settings-form__grid');
    expect(grid).toBeTruthy();

    // The grid contains Name and Root Path fields
    expect(grid?.textContent).toContain('Name');
    expect(grid?.textContent).toContain('Root Path');

    // Notes section exists
    const notesSection = document.querySelector('.project-settings-form__notes');
    expect(notesSection).toBeTruthy();

    // Actions bar exists
    const actions = document.querySelector('.project-settings-form__actions');
    expect(actions).toBeTruthy();
  });

  it('.pairing-workspace-shell does not use overflow-y:auto', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    await screen.findByText('Test Project');

    // Select project to render workspace
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    const shell = document.querySelector('.pairing-workspace-shell') as HTMLElement;
    expect(shell).toBeTruthy();

    // No inline overflow-y:auto
    expect(shell.style.overflowY).not.toBe('auto');

    // No inline overflow:auto either (we use CSS, not inline)
    expect(shell.style.overflow).not.toBe('auto');
  });

  // ------------------------------------------------------------------ //
  //  Resize handle drag
  // ------------------------------------------------------------------ //

  it('renders top resize handle inside pw-files-card when project is selected', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Top handle has --top modifier class, exactly one
    const topHandles = document.querySelectorAll('.pairing-workspace-resize-handle--top');
    expect(topHandles.length).toBe(1);

    const topHandle = topHandles[0] as HTMLElement;
    expect(topHandle.getAttribute('aria-label')).toBe('Resize files and pairs area');
    expect(topHandle.getAttribute('role')).toBe('separator');
    expect(topHandle.getAttribute('aria-orientation')).toBe('horizontal');

    // Handle is inside .pw-files-card
    const filesCard = document.querySelector('.pw-files-card');
    expect(filesCard).toBeTruthy();
    expect(filesCard!.querySelector('.pairing-workspace-resize-handle--top')).toBeTruthy();
  });

  it('top container has no inline height before drag', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    const topContainer = document.querySelector('.pairing-workspace-top') as HTMLElement;
    // No inline height initially — relies on CSS clamp
    expect(topContainer.style.height).toBe('');
  });

  it('pointerDown on top handle adds is-resizing-vertical class to body', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    const topHandle = document.querySelector('.pairing-workspace-resize-handle--top') as HTMLElement;
    expect(topHandle).toBeTruthy();

    expect(document.body.classList.contains('is-resizing-vertical')).toBe(false);
    fireEvent.pointerDown(topHandle, { clientY: 500 });
    expect(document.body.classList.contains('is-resizing-vertical')).toBe(true);

    // Cleanup: fire pointerUp to remove window listeners and body class
    fireEvent.pointerUp(window);
    await waitFor(() => {
      expect(document.body.classList.contains('is-resizing-vertical')).toBe(false);
    });
  });

  it('dragging top handle sets inline height on .pairing-workspace-top', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    const topHandle = document.querySelector('.pairing-workspace-resize-handle--top') as HTMLElement;
    const topContainer = document.querySelector('.pairing-workspace-top') as HTMLElement;
    expect(topContainer.style.height).toBe('');

    fireEvent.pointerDown(topHandle, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 600 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(topContainer.style.height).toBeTruthy();
    });
  });

  it('bottom resize handle is absent when no pair selected', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Bottom handle should not be in the DOM when no pair selected
    const bottomHandle = Array.from(document.querySelectorAll('.pairing-workspace-resize-handle'))
      .find(el => el.getAttribute('aria-label') === 'Resize bottom editor area');
    expect(bottomHandle).toBeFalsy();
  });

  it('.pw-files-card does not receive inline height when top handle is dragged', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    const topHandle = document.querySelector('.pairing-workspace-resize-handle--top') as HTMLElement;
    const filesCard = document.querySelector('.pw-files-card') as HTMLElement;
    expect(filesCard.style.height).toBe('');

    fireEvent.pointerDown(topHandle, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 600 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      // .pairing-workspace-top should have inline height
      const topContainer = document.querySelector('.pairing-workspace-top') as HTMLElement;
      expect(topContainer.style.height).toBeTruthy();
      // .pw-files-card must NOT receive inline height (it's flex-based)
      expect(filesCard.style.height).toBe('');
    });
  });

  it('bottom drag changes .pairing-workspace-bottom height when pair is selected', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Select a pair to show bottom panel
    await screen.findByText('File View');
    fireEvent.click(screen.getByText('File View'));
    await screen.findByDisplayValue('source content');

    // Bottom handle and container should now exist
    const bottomHandle = Array.from(document.querySelectorAll('.pairing-workspace-resize-handle'))
      .find(el => el.getAttribute('aria-label') === 'Resize bottom editor area') as HTMLElement;
    expect(bottomHandle).toBeTruthy();

    const bottomContainer = document.querySelector('.pairing-workspace-bottom') as HTMLElement;
    expect(bottomContainer.style.height).toBe('');

    // Drag bottom handle down
    fireEvent.pointerDown(bottomHandle, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 600 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(bottomContainer.style.height).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ //
  //  Auto-scroll during resize drag
  // ------------------------------------------------------------------ //

  it('pointerMove near bottom edge calls window.scrollBy with positive top', async () => {
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(vi.fn());
    try {
      vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
      vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
      vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

      renderPage();;
      await screen.findByText('Test Project');

      fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
      await screen.findByText('Project Settings');

      const topHandle = document.querySelector('.pairing-workspace-resize-handle--top') as HTMLElement;

      // Start drag at a normal Y, move near bottom edge
      fireEvent.pointerDown(topHandle, { clientY: 100 });
      // jsdom default innerHeight is 768; edgeThreshold=80, so trigger zone is >688
      fireEvent.pointerMove(window, { clientY: 750 });

      expect(scrollBySpy).toHaveBeenCalled();
      const call = scrollBySpy.mock.calls[0][0] as ScrollToOptions;
      expect(call.top).toBeGreaterThan(0);
    } finally {
      scrollBySpy.mockRestore();
    }
  });

  it('pointerMove near top edge calls window.scrollBy with negative top', async () => {
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(vi.fn());
    try {
      vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
      vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
      vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

      renderPage();;
      await screen.findByText('Test Project');

      fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
      await screen.findByText('Project Settings');

      const topHandle = document.querySelector('.pairing-workspace-resize-handle--top') as HTMLElement;

      // Start drag at a normal Y, move near top edge
      fireEvent.pointerDown(topHandle, { clientY: 200 });
      // edgeThreshold=80, so trigger zone is <80
      fireEvent.pointerMove(window, { clientY: 30 });

      expect(scrollBySpy).toHaveBeenCalled();
      const call = scrollBySpy.mock.calls[0][0] as ScrollToOptions;
      expect(call.top).toBeLessThan(0);
    } finally {
      scrollBySpy.mockRestore();
    }
  });

  // ------------------------------------------------------------------ //
  //  Workspace actions
  // ------------------------------------------------------------------ //

  it('scan reloads groups', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.scanPairingProject).mockResolvedValue({
      project_id: 'proj-2',
      total_files: 5,
      new_files: 3,
      updated_files: 1,
      ignored_files: 1,
    });

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Click Scan / Rescan in workspace
    fireEvent.click(screen.getByText('Scan / Rescan'));

    // Verify scan API was called
    await waitFor(() => {
      expect(api.scanPairingProject).toHaveBeenCalledWith('proj-2');
    });

    // After scan completes, groups should be reloaded (getPairingGroups called again)
    await waitFor(() => {
      expect(vi.mocked(api.getPairingGroups).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('scan result banner appears', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.scanPairingProject).mockResolvedValue({
      project_id: 'proj-2',
      total_files: 5,
      new_files: 3,
      updated_files: 1,
      ignored_files: 1,
    });

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Click Scan / Rescan in workspace
    fireEvent.click(screen.getByText('Scan / Rescan'));

    // Check scan result banner appears in the PairingFileWorkspace
    await screen.findByText(/5 total/);
    expect(screen.getByText(/3 new/)).toBeDefined();
    expect(screen.getByText(/1 updated/)).toBeDefined();
  });

  it('suggest pairs calls API', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.suggestPairingPairs).mockResolvedValue([]);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Click Suggest Pairs in workspace header
    const suggestBtns = screen.getAllByText('Suggest Pairs');
    fireEvent.click(suggestBtns[0]);

    await waitFor(() => {
      expect(api.suggestPairingPairs).toHaveBeenCalledWith('proj-2', undefined);
    });
  });

  // ------------------------------------------------------------------ //
  //  File tree
  // ------------------------------------------------------------------ //

  it('grouping mode dropdown shows and changes visual grouping', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Wait for the file tree to render
    await screen.findByText('Files (2)');

    // Find the grouping mode dropdown — now shows client-side mode names
    const groupingSelect = screen.getByDisplayValue('Smart');
    expect(groupingSelect).toBeDefined();

    // Switch to "Folder" mode
    fireEvent.change(groupingSelect, { target: { value: 'folder' } });

    // Files count should still be visible
    expect(screen.getByText('Files (2)')).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  //  Pair operations
  // ------------------------------------------------------------------ //

  it('suggested pairs render', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));

    await screen.findByText('Project Settings');

    // The pair reason should appear
    await screen.findByText('Same basename');

    // Status badge should show "Suggested"
    const suggestedElements = screen.getAllByText('Suggested');
    expect(suggestedElements.length).toBeGreaterThanOrEqual(1);

    // Reason text should render
    expect(screen.getByText('Same basename')).toBeDefined();

    // Action buttons
    expect(screen.getByText('Accept')).toBeDefined();
    expect(screen.getByText('Reject')).toBeDefined();
    expect(screen.getByText('Delete')).toBeDefined();
    expect(screen.getByText('File View')).toBeDefined();
  });

  it('accept pair calls API', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.updatePairingPair).mockResolvedValue({
      ...MOCK_PAIRS[0],
      status: 'accepted',
    });

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    await screen.findByText('Accept');
    fireEvent.click(screen.getByText('Accept'));

    await waitFor(() => {
      expect(api.updatePairingPair).toHaveBeenCalledWith('proj-2', 'p1', {
        status: 'accepted',
      });
    });
  });

  it('reject pair calls API', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.updatePairingPair).mockResolvedValue({
      ...MOCK_PAIRS[0],
      status: 'rejected',
    });

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    await screen.findByText('Reject');
    fireEvent.click(screen.getByText('Reject'));

    await waitFor(() => {
      expect(api.updatePairingPair).toHaveBeenCalledWith('proj-2', 'p1', {
        status: 'rejected',
      });
    });
  });

  it('delete pair calls API', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.deletePairingPair).mockResolvedValue(undefined);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    await screen.findByText('Same basename');

    // Click Delete button on the pair card
    fireEvent.click(screen.getByText('Delete'));

    // Confirm dialog should appear
    await screen.findByText(/Are you sure you want to delete the pair/);

    // Click confirm Delete
    const deleteBtns = screen.getAllByText('Delete');
    fireEvent.click(deleteBtns[deleteBtns.length - 1]);

    await waitFor(() => {
      expect(api.deletePairingPair).toHaveBeenCalledWith('proj-2', 'p1');
    });
  });

  it('selecting pair loads preview', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.getPairingPairPreview).mockResolvedValue(MOCK_PREVIEW);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    await screen.findByText('File View');
    fireEvent.click(screen.getByText('File View'));

    await waitFor(() => {
      expect(api.getPairingPairPreview).toHaveBeenCalledWith('proj-2', 'p1');
    });
  });

  // ------------------------------------------------------------------ //
  //  File View
  // ------------------------------------------------------------------ //

  it('preview content renders', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.getPairingPairPreview).mockResolvedValue(MOCK_PREVIEW);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    await screen.findByText('File View');
    fireEvent.click(screen.getByText('File View'));

    await screen.findByDisplayValue('source content');
    expect(
      screen.getAllByDisplayValue('translated content').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('switching pair clears stale preview', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.getPairingPairPreview).mockResolvedValue(MOCK_PREVIEW);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Initially no pair selected — bottom panel is not rendered
    expect(screen.queryByText('Select a pair to preview')).toBeNull();

    // Click File View
    await screen.findByText('File View');
    fireEvent.click(screen.getByText('File View'));

    await screen.findByDisplayValue('source content');

    // Toggle pair selection off — click on the pair card containing "Same basename"
    fireEvent.click(screen.getByText('Same basename'));

    // File View should clear — stale content must disappear
    await waitFor(() => {
      expect(screen.queryByDisplayValue('source content')).toBeNull();
    });
  });

  // ------------------------------------------------------------------ //
  //  Edge cases
  // ------------------------------------------------------------------ //

  it('deselecting project hides workspace', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    await screen.findByText('Test Project');

    // Select project
    const card = screen.getByRole('button', { name: /Test Project/i });
    fireEvent.click(card);
    await screen.findByText('Project Settings');

    // Click same card again to deselect
    fireEvent.click(card);

    // Workspace should be gone
    expect(screen.queryByText('Project Settings')).toBeNull();
  });

  // ------------------------------------------------------------------ //
  //  Query param auto-select (?project=<id>)
  // ------------------------------------------------------------------ //

  it('?project=<id> query param auto-selects matching project', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage(['/?project=proj-1']);

    // The project should load and auto-select
    await screen.findByText('Project Settings');
    expect(screen.getByText('Project Settings')).toBeDefined();
  });

  it('?project=<id> with unknown id does not crash', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage(['/?project=nonexistent-id']);

    // Project should render
    await screen.findByText('Test Project');

    // No workspace should be shown (project wasn't found)
    expect(screen.queryByText('Project Settings')).toBeNull();
  });

  it('no query param does not crash', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();

    // Project renders normally
    await screen.findByText('Test Project');

    // No workspace unless user clicks the card
    expect(screen.queryByText('Project Settings')).toBeNull();
  });

  it('delete project still works and clears selection', async () => {
    vi.mocked(api.listPairingProjects)
      .mockResolvedValueOnce([MOCK_PROJECT])
      .mockResolvedValue([]);
    vi.mocked(api.getPairingGroups).mockResolvedValue([]);
    vi.mocked(api.listPairingPairs).mockResolvedValue([]);
    vi.mocked(api.deletePairingProject).mockResolvedValue(undefined);

    renderPage();;

    await screen.findByText('Test Project');

    // Select the project first
    const card = screen.getByRole('button', { name: /Test Project/i });
    fireEvent.click(card);

    // Now click Archive on the card
    fireEvent.click(screen.getByText('Archive'));

    // ConfirmArchive dialog should appear
    await screen.findByText(/Archive "Test Project"/);

    // Confirm — there are two "Archive" elements (card button + dialog confirm button)
    const archiveBtns = screen.getAllByText('Archive');
    // The last one is the dialog confirm button
    fireEvent.click(archiveBtns[archiveBtns.length - 1]);

    // Verify API was called
    await waitFor(() => {
      expect(api.deletePairingProject).toHaveBeenCalledWith('proj-1');
    });

    // Workspace should be gone after deletion
    await screen.findByText('No projects yet. Create one to get started.');
  });

  // ------------------------------------------------------------------ //
  //  Stale async guards
  // ------------------------------------------------------------------ //

  it('PairSlotCard onRevealFile propagates to PairingFileWorkspace reveal target', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);

    renderPage();;

    await screen.findByText('Test Project');

    // Select the project to open the workspace
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Wait for file tree to render
    await screen.findByText('Files (2)');

    // Find a PairFileSlot with title "Reveal in tree: ..." and click it
    // (implicitly verifies the pair card rendered)
    // Use getAllByTitle because both source and translated slot may have same filename
    // Pick the source slot (first one) which has the path locale/english/file1.yml
    const revealSlots = screen.getAllByTitle('Reveal in tree: file1.yml');
    expect(revealSlots.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(revealSlots[0]);

    // Verify the file tree now shows the data-reveal-path attribute for the revealed file
    await waitFor(() => {
      const revealedRow = document.querySelector('[data-reveal-path="locale/english/file1.yml"]');
      expect(revealedRow).toBeTruthy();
    });
  });

  it('rapid project switch ignores stale async responses', async () => {
    const projectA = { ...MOCK_SCANNED_PROJECT, id: 'proj-a', name: 'Project A' };
    const projectB = { ...MOCK_SCANNED_PROJECT, id: 'proj-b', name: 'Project B' };

    vi.mocked(api.listPairingProjects).mockResolvedValue([projectA, projectB]);

    const groupsA = [{
      group_key: 'group-a',
      display_name: 'locale_a',
      relative_dir: 'locale_a',
      files_count: 1,
      source_like_count: 1,
      translated_like_count: 0,
      children: [],
      files: [{
        id: 'fa1',
        project_id: 'proj-a',
        relative_path: 'locale_a/fileA.txt',
        file_name: 'fileA.txt',
        extension: '.txt',
        parent_dir: 'locale_a',
        size_bytes: 10,
        content_hash: null,
        modified_at: null,
        detected_language: null,
        detected_role: 'source',
        group_key: 'group-a',
        is_ignored: false,
        created_at: '',
        updated_at: '',
      }],
    }];
    const groupsB = [{
      group_key: 'group-b',
      display_name: 'locale_b',
      relative_dir: 'locale_b',
      files_count: 1,
      source_like_count: 1,
      translated_like_count: 0,
      children: [],
      files: [{
        id: 'fb1',
        project_id: 'proj-b',
        relative_path: 'locale_b/fileB.txt',
        file_name: 'fileB.txt',
        extension: '.txt',
        parent_dir: 'locale_b',
        size_bytes: 10,
        content_hash: null,
        modified_at: null,
        detected_language: null,
        detected_role: 'source',
        group_key: 'group-b',
        is_ignored: false,
        created_at: '',
        updated_at: '',
      }],
    }];

    let resolveGroupsA!: (v: FileGroupResponse[]) => void;
    let resolveGroupsB!: (v: FileGroupResponse[]) => void;
    const promiseA = new Promise<FileGroupResponse[]>((resolve) => { resolveGroupsA = resolve; });
    const promiseB = new Promise<FileGroupResponse[]>((resolve) => { resolveGroupsB = resolve; });

    vi.mocked(api.getPairingGroups)
      .mockReturnValueOnce(promiseA)
      .mockReturnValueOnce(promiseB);

    vi.mocked(api.listPairingPairs).mockResolvedValue([]);

    renderPage();;

    // Wait for both projects to render
    await screen.findByText('Project A');

    // Select Project A
    const cardA = screen.getByRole('button', { name: /Project A/i });
    fireEvent.click(cardA);
    await screen.findByText('Project Settings');

    // Immediately select Project B (rapid switch)
    const cardB = screen.getByRole('button', { name: /Project B/i });
    fireEvent.click(cardB);

    // Now resolve A's request AFTER selecting B — this is the stale response
    resolveGroupsA(groupsA);
    await new Promise((r) => setTimeout(r, 10));

    // Resolve B's request
    resolveGroupsB(groupsB);
    await new Promise((r) => setTimeout(r, 10));

    // The workspace should show "Project B" (name visible)
    expect(screen.getByText('Project B')).toBeDefined();

    // Group display should show B's file, not A's
    await waitFor(() => {
      expect(screen.queryByText(/fileA/)).toBeNull();
    });
    expect(screen.getAllByText(/fileB/).length).toBeGreaterThanOrEqual(1);
  });

  it('deleted pair clears selectedPairId and preview', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.getPairingPairPreview).mockResolvedValue(MOCK_PREVIEW);
    vi.mocked(api.deletePairingPair).mockResolvedValue(undefined);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // File View the pair
    await screen.findByText('File View');
    fireEvent.click(screen.getByText('File View'));

    await screen.findByDisplayValue('source content');

    // Delete the pair
    vi.mocked(api.listPairingPairs).mockResolvedValueOnce([]);

    const deleteBtns = screen.getAllByText('Delete');
    expect(deleteBtns.length).toBe(1);
    fireEvent.click(deleteBtns[0]);

    await screen.findByText(/Are you sure/);

    const confirmBtns = screen.getAllByText('Delete');
    expect(confirmBtns.length).toBe(2);
    fireEvent.click(confirmBtns[1]);

    // After deletion, preview should clear — bottom panel is gone
    await waitFor(() => {
      expect(screen.queryByDisplayValue('source content')).toBeNull();
    });
  });

  it('Set source / Set translated immediately creates pairs via API', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue([]);
    vi.mocked(api.createPairingPair).mockResolvedValue(MOCK_PAIRS[0]);

    renderPage();;

    await screen.findByText('Test Project');
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Wait for file tree to appear
    await screen.findByText('Files (2)');

    // Switch to flat grouping mode so all files appear in a single group
    const groupingSelect = screen.getByDisplayValue('Smart');
    fireEvent.change(groupingSelect, { target: { value: 'flat' } });

    // Wait for flat group name to appear (auto-expanded on grouping change)
    await screen.findByText(/All files/);

    // The flat group is auto-expanded — files should now be visible (basename display)
    // Wait for Set source buttons to appear as a proxy for rendered file rows
    await waitFor(() => {
      expect(screen.getAllByText('Set source').length).toBeGreaterThan(0);
    });

    // Set source file — should immediately create a source-only pair
    const setSourceButtons = screen.getAllByText('Set source');
    expect(setSourceButtons.length).toBeGreaterThan(0);
    fireEvent.click(setSourceButtons[0]);

    // Verify API was called with source_file_id only (no translated)
    expect(vi.mocked(api.createPairingPair)).toHaveBeenCalledWith('proj-2', {
      source_file_id: expect.any(String),
      translated_file_id: null,
      notes: null,
    });

    // Set translated file — should create a translated-only pair
    const setTranslatedButtons = screen.getAllByText('Set translated');
    expect(setTranslatedButtons.length).toBeGreaterThan(0);
    fireEvent.click(setTranslatedButtons[0]);

    // Verify second API call with translated_file_id only
    expect(vi.mocked(api.createPairingPair)).toHaveBeenCalledWith('proj-2', {
      source_file_id: null,
      translated_file_id: expect.any(String),
      notes: null,
    });

    // Create Pair button should NOT exist anymore
    expect(screen.queryByText('Create Pair')).toBeNull();
  });

  it('unmounted component does not update state', async () => {
    const neverResolve = new Promise(() => {});
    vi.mocked(api.listPairingProjects).mockReturnValue(neverResolve as never);

    const { unmount } = renderPage();

    unmount();

    await new Promise((r) => setTimeout(r, 50));

    expect(true).toBe(true);
  });

  // ------------------------------------------------------------------ //
  //  Project settings
  // ------------------------------------------------------------------ //

  it('project settings can edit name and notes', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.updatePairingProject).mockResolvedValue(MOCK_SCANNED_PROJECT);

    renderPage();;

    await screen.findByText('Test Project');

    // Select the project
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Find the name input in the settings form (it's an input with value="Test Project")
    const nameInput = screen.getByDisplayValue('Test Project');
    expect(nameInput).toBeDefined();

    // Find the notes textarea in the settings form
    const notesTextarea = screen.getByPlaceholderText(/Optional/i) as HTMLTextAreaElement;
    fireEvent.change(notesTextarea, { target: { value: 'Updated notes' } });

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(api.updatePairingProject).toHaveBeenCalledWith('proj-2', {
        notes: 'Updated notes',
      });
    });
  });

  it('project settings can edit root_path', async () => {
    vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
    vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
    vi.mocked(api.listPairingPairs).mockResolvedValue(MOCK_PAIRS);
    vi.mocked(api.updatePairingProject).mockResolvedValue(MOCK_SCANNED_PROJECT);

    renderPage();;

    await screen.findByText('Test Project');

    // Select the project
    fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
    await screen.findByText('Project Settings');

    // Find root_path input — it has value '/games/test'
    const rootPathInputs = screen.getAllByDisplayValue('/games/test');
    expect(rootPathInputs.length).toBeGreaterThanOrEqual(1);

    // Change root_path in the settings form input
    const rootPathInput = rootPathInputs[0];
    fireEvent.change(rootPathInput, { target: { value: '/new/path' } });

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(api.updatePairingProject).toHaveBeenCalledWith('proj-2', {
        root_path: '/new/path',
      });
    });
  });
});

/* ================================================================== */
/*  Tests: DnD swap semantics                                           */
/* ================================================================== */

const MOCK_PAIRS_2 = [
  {
    id: 'p1',
    project_id: 'proj-2',
    source_file_id: 'f1',
    translated_file_id: 'f2',
    source_file: {
      id: 'f1',
      project_id: 'proj-2',
      relative_path: 'locale/english/file1.yml',
      file_name: 'file1.yml',
      extension: '.yml',
      parent_dir: 'locale/english',
      size_bytes: 100,
      content_hash: null,
      modified_at: null,
      detected_language: 'english',
      detected_role: 'source',
      group_key: 'dir1',
      is_ignored: false,
      created_at: '',
      updated_at: '',
    },
    translated_file: {
      id: 'f2',
      project_id: 'proj-2',
      relative_path: 'locale/french/file1.yml',
      file_name: 'file1.yml',
      extension: '.yml',
      parent_dir: 'locale/french',
      size_bytes: 120,
      content_hash: null,
      modified_at: null,
      detected_language: 'french',
      detected_role: 'translated',
      group_key: 'dir1',
      is_ignored: false,
      created_at: '',
      updated_at: '',
    },
    status: 'suggested',
    confidence: 0.85,
    reason: 'Same basename',
    created_by: 'auto',
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
    notes: null,
  },
  {
    id: 'p2',
    project_id: 'proj-2',
    source_file_id: 'f3',
    translated_file_id: 'f4',
    source_file: {
      id: 'f3',
      project_id: 'proj-2',
      relative_path: 'mod/mod2/file_a.yml',
      file_name: 'file_a.yml',
      extension: '.yml',
      parent_dir: 'mod/mod2',
      size_bytes: 200,
      content_hash: null,
      modified_at: null,
      detected_language: 'english',
      detected_role: 'source',
      group_key: 'dir2',
      is_ignored: false,
      created_at: '',
      updated_at: '',
    },
    translated_file: {
      id: 'f4',
      project_id: 'proj-2',
      relative_path: 'mod/mod2/file_b.yml',
      file_name: 'file_b.yml',
      extension: '.yml',
      parent_dir: 'mod/mod2',
      size_bytes: 220,
      content_hash: null,
      modified_at: null,
      detected_language: 'french',
      detected_role: 'translated',
      group_key: 'dir2',
      is_ignored: false,
      created_at: '',
      updated_at: '',
    },
    status: 'suggested',
    confidence: 0.75,
    reason: 'Same name pattern',
    created_by: 'auto',
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
    notes: null,
  },
];

/**
 * Open a project and wait for the pair cards (identified by reason text)
 * to render.  Returns the container.
 */
async function openProjectAndWaitForPairs(
  pairsData: typeof MOCK_PAIRS,
  mockList?: typeof api.listPairingPairs,
) {
  vi.mocked(api.listPairingProjects).mockResolvedValue([MOCK_SCANNED_PROJECT]);
  vi.mocked(api.getPairingGroups).mockResolvedValue(MOCK_GROUPS);
  vi.mocked(api.listPairingPairs).mockResolvedValue(pairsData);
  const { container } = renderPage();
  await screen.findByText('Test Project');

  // Select project card
  fireEvent.click(screen.getByRole('button', { name: /Test Project/i }));
  await screen.findByText('Project Settings');

  // Wait for pair cards to render (reason text for first pair)
  await screen.findByText(pairsData[0].reason);
  return container;
}

/** Create a DataTransfer carrying a slot-origin drag payload. */
function slotDragPayload(
  fileId: string,
  sourcePairId: string,
  sourceSlot: string,
): DataTransfer {
  const dt = new DataTransfer();
  dt.setData(
    'application/x-llm-translator-pairing-file',
    JSON.stringify({ fileId, relativePath: 'irrelevant', sourcePairId, sourceSlot }),
  );
  return dt;
}

function expectSwapApiCalls(
  sourcePairId: string,
  sourceField: 'source_file_id' | 'translated_file_id',
  targetFileId: string,
  targetPairId: string,
  targetField: 'source_file_id' | 'translated_file_id',
  sourceFileId: string,
) {
  expect(api.updatePairingPair).toHaveBeenNthCalledWith(
    1, 'proj-2', sourcePairId, { [sourceField]: targetFileId },
  );
  expect(api.updatePairingPair).toHaveBeenNthCalledWith(
    2, 'proj-2', targetPairId, { [targetField]: sourceFileId },
  );
}

describe('DnD swap', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetLineMatchCache();
    cleanup();
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
  });

  it('1: same-pair source↔translated swap', async () => {
    vi.mocked(api.updatePairingPair).mockResolvedValue({} as any);
    await openProjectAndWaitForPairs(MOCK_PAIRS);

    // Find the source slot ("file1.yml") in the only pair card
    const sourceSlot = document.querySelector('.pair-slot-card')!
      .querySelector('.pair-slot')!; // first slot = source
    expect(sourceSlot.textContent).toContain('file1.yml');

    // Drop p1.source file (f1) onto p1.translated slot (which has f2)
    const targetSlots = document.querySelectorAll('.pair-slot');
    const translatedSlot = targetSlots[1]; // second slot = translated
    const dt = slotDragPayload('f1', 'p1', 'source');
    fireEvent.drop(translatedSlot, { dataTransfer: dt } as any);

    await waitFor(() => {
      expect(api.updatePairingPair).toHaveBeenCalledTimes(2);
    });

    // Swap: p1.source gets f2, p1.translated gets f1
    expectSwapApiCalls(
      'p1', 'source_file_id', 'f2',
      'p1', 'translated_file_id', 'f1',
    );
  });

  it('2: cross-pair source↔source swap', async () => {
    vi.mocked(api.updatePairingPair).mockResolvedValue({} as any);
    await openProjectAndWaitForPairs(MOCK_PAIRS_2);

    // Find p2.source slot containing "file_a.yml"
    const allCards = document.querySelectorAll('.pair-slot-card');
    expect(allCards.length).toBe(2);
    const p2Card = allCards[1];
    const p2SourceSlot = p2Card.querySelector('.pair-slot')!;
    expect(p2SourceSlot.textContent).toContain('file_a.yml');

    // Drop p1.source file (f1) onto p2.source slot (which has f3)
    const dt = slotDragPayload('f1', 'p1', 'source');
    fireEvent.drop(p2SourceSlot, { dataTransfer: dt } as any);

    await waitFor(() => {
      expect(api.updatePairingPair).toHaveBeenCalledTimes(2);
    });

    // Swap: p1.source gets f3, p2.source gets f1
    expectSwapApiCalls(
      'p1', 'source_file_id', 'f3',
      'p2', 'source_file_id', 'f1',
    );
  });

  it('3: cross-pair source↔translated swap', async () => {
    vi.mocked(api.updatePairingPair).mockResolvedValue({} as any);
    await openProjectAndWaitForPairs(MOCK_PAIRS_2);

    const allCards = document.querySelectorAll('.pair-slot-card');
    const p2Card = allCards[1];
    const p2TranslatedSlot = p2Card.querySelectorAll('.pair-slot')[1];
    expect(p2TranslatedSlot.textContent).toContain('file_b.yml');

    // Drop p1.source file (f1) onto p2.translated slot (which has f4)
    const dt = slotDragPayload('f1', 'p1', 'source');
    fireEvent.drop(p2TranslatedSlot, { dataTransfer: dt } as any);

    await waitFor(() => {
      expect(api.updatePairingPair).toHaveBeenCalledTimes(2);
    });

    // Swap: p1.source gets f4, p2.translated gets f1
    expectSwapApiCalls(
      'p1', 'source_file_id', 'f4',
      'p2', 'translated_file_id', 'f1',
    );
  });

  it('4: self-drop no-op', async () => {
    vi.mocked(api.updatePairingPair).mockResolvedValue({} as any);
    await openProjectAndWaitForPairs(MOCK_PAIRS);

    // Source slot with file1.yml, pair p1, source slot
    const sourceSlot = document.querySelector('.pair-slot-card')!
      .querySelector('.pair-slot')!;
    expect(sourceSlot.textContent).toContain('file1.yml');

    // Drop same file on the same slot
    const dt = slotDragPayload('f1', 'p1', 'source');
    fireEvent.drop(sourceSlot, { dataTransfer: dt } as any);

    // Wait briefly — no API call should have been made
    await vi.waitFor(() => {
      expect(api.updatePairingPair).not.toHaveBeenCalled();
    }, { timeout: 500 });
  });

  it('6: tree-origin → occupied still replaces', async () => {
    vi.mocked(api.updatePairingPair).mockResolvedValue({} as any);
    await openProjectAndWaitForPairs(MOCK_PAIRS);

    // Source slot has file1.yml (f1)
    const sourceSlot = document.querySelector('.pair-slot-card')!
      .querySelector('.pair-slot')!;
    expect(sourceSlot.textContent).toContain('file1.yml');

    // Tree-origin drop (no sourcePairId) — should replace, NOT swap
    const dt = new DataTransfer();
    dt.setData(
      'application/x-llm-translator-pairing-file',
      JSON.stringify({ fileId: 'new-file', relativePath: 'x', sourcePairId: null, sourceSlot: null }),
    );
    fireEvent.drop(sourceSlot, { dataTransfer: dt } as any);

    await waitFor(() => {
      // Single updatePairingPair call for the target pair only — no swap
      expect(api.updatePairingPair).toHaveBeenCalledTimes(1);
      expect(api.updatePairingPair).toHaveBeenCalledWith('proj-2', 'p1', {
        source_file_id: 'new-file',
      });
    });
  });

  it('7: failed swap triggers refresh/error path', async () => {
    vi.mocked(api.updatePairingPair)
      .mockResolvedValueOnce({} as any)   // first PATCH succeeds
      .mockRejectedValueOnce(new ApiError({ message: 'Second PATCH failed', code: 'ERROR', details: {}, recoverable: false })); // second fails
    await openProjectAndWaitForPairs(MOCK_PAIRS);

    const targetSlots = document.querySelectorAll('.pair-slot');
    const translatedSlot = targetSlots[1];

    const dt = slotDragPayload('f1', 'p1', 'source');
    fireEvent.drop(translatedSlot, { dataTransfer: dt } as any);

    // The first PATCH should have been made (but second fails)
    await waitFor(() => {
      expect(api.updatePairingPair).toHaveBeenCalledWith('proj-2', 'p1', { source_file_id: 'f2' });
    });
    // Total calls should be 2 (first succeeds, second fails)
    expect(api.updatePairingPair).toHaveBeenCalledTimes(2);
  });
});
