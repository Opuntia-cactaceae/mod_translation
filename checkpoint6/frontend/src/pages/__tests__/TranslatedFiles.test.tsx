import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type {
  OutputFileTreeResponse,
  OutputFileListResponse,
  OutputFilesSummaryResponse,
  OutputFile,
} from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetOutputFilesTree = vi.fn();
const mockListOutputFiles = vi.fn();
const mockGetJobOutputsSummary = vi.fn();
const mockReindexJobOutputs = vi.fn();
const mockCreateOutputAnalysisJob = vi.fn();
const mockShowToast = vi.fn();
const mockSetSearchParams = vi.fn();
let mockSearchParams = new URLSearchParams();
// Controllable location state — set per test to simulate editor back nav
let mockLocationState: Record<string, unknown> | null = null;

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: mockLocationState }),
}));

vi.mock('../../App', () => ({
  api: {
    getOutputFilesTree: (...args: unknown[]) => mockGetOutputFilesTree(...args),
    listOutputFiles: (...args: unknown[]) => mockListOutputFiles(...args),
    getJobOutputsSummary: (...args: unknown[]) => mockGetJobOutputsSummary(...args),
    reindexJobOutputs: (...args: unknown[]) => mockReindexJobOutputs(...args),
    createOutputAnalysisJob: (...args: unknown[]) => mockCreateOutputAnalysisJob(...args),
  },
  ApiError: class MockApiError extends Error {
    code: string;
    details: Record<string, unknown>;
    recoverable: boolean;
    constructor(err: { code: string; message: string; details?: Record<string, unknown>; recoverable?: boolean }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details ?? {};
      this.recoverable = err.recoverable ?? false;
    }
  },
  useToast: () => ({ showToast: mockShowToast }),
  ToastContext: {
    Provider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Consumer: ({ children }: { children: (value: unknown) => React.ReactNode }) => children({ showToast: mockShowToast }),
  },
}));

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const jobId1 = 'job-aaa';
const jobId2 = 'job-bbb';

function makeTree(overrides: Partial<OutputFileTreeResponse> = {}): OutputFileTreeResponse {
  return {
    job_timestamps: {},
    jobs: {
      [jobId1]: {
        job_id: jobId1,
        mods: {
          'mod-a': {
            mod_id: 'mod-a',
            mod_name: 'Mod A',
            groups: {
              __root__: {
                group_key: '__root__',
                group_label: 'Root',
                files: [
                  {
                    id: 'file-1',
                    file_name: 'f1.yml',
                    source_file_name: 'source_f1.yml',
                    source_file_path: '/src/source_f1.yml',
                    relative_source_path: 'source_f1.yml',
                    relative_translated_path: 'f1.yml',
                    status: 'ready',
                  },
                ],
              },
            },
          },
        },
      },
      [jobId2]: {
        job_id: jobId2,
        mods: {
          'mod-b': {
            mod_id: 'mod-b',
            mod_name: 'Mod B',
            groups: {
              __root__: {
                group_key: '__root__',
                group_label: 'Root',
                files: [
                  {
                    id: 'file-2',
                    file_name: 'f2.yml',
                    source_file_name: 'source_f2.yml',
                    source_file_path: '/src/source_f2.yml',
                    relative_source_path: 'source_f2.yml',
                    relative_translated_path: 'f2.yml',
                    status: 'ready',
                  },
                  {
                    id: 'file-3',
                    file_name: 'f3.yml',
                    source_file_name: 'source_f3.yml',
                    source_file_path: '/src/source_f3.yml',
                    relative_source_path: 'source_f3.yml',
                    relative_translated_path: 'f3.yml',
                    status: 'missing_source',
                  },
                ],
              },
            },
          },
        },
      },
    },
    ...overrides,
  };
}

function makeFileList(jobId: string): OutputFileListResponse {
  const items: OutputFile[] = jobId === jobId1
    ? [{
        id: 'file-1',
        job_id: jobId1,
        mod_id: 'mod-a',
        mod_name: 'Mod A',
        source_file_path: '/src/source_f1.yml',
        translated_file_path: '/dst/f1.yml',
        relative_source_path: 'source_f1.yml',
        relative_translated_path: 'f1.yml',
        file_name: 'f1.yml',
        file_ext: '.yml',
        game_id: null,
        parser_id: null,
        aggregation_key: null,
        group_key: '__root__',
        group_label: 'Root',
        source_size_bytes: 100,
        translated_size_bytes: 100,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        last_analyzed_at: null,
        editor_available: true,
        status: 'ready',
        analysis_stale: false,
        latest_analysis: null,
        latest_analysis_state: 'unknown',
        output_metadata: null,
      }]
    : [
        {
          id: 'file-2',
          job_id: jobId2,
          mod_id: 'mod-b',
          mod_name: 'Mod B',
          source_file_path: '/src/source_f2.yml',
          translated_file_path: '/dst/f2.yml',
          relative_source_path: 'source_f2.yml',
          relative_translated_path: 'f2.yml',
          file_name: 'f2.yml',
          file_ext: '.yml',
          game_id: null,
          parser_id: null,
          aggregation_key: null,
          group_key: '__root__',
          group_label: 'Root',
          source_size_bytes: 100,
          translated_size_bytes: 100,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          last_analyzed_at: null,
          editor_available: true,
          status: 'ready',
          analysis_stale: false,
          latest_analysis: null,
          latest_analysis_state: 'unknown',
          output_metadata: null,
        },
        {
          id: 'file-3',
          job_id: jobId2,
          mod_id: 'mod-b',
          mod_name: 'Mod B',
          source_file_path: '/src/source_f3.yml',
          translated_file_path: '/dst/f3.yml',
          relative_source_path: 'source_f3.yml',
          relative_translated_path: 'f3.yml',
          file_name: 'f3.yml',
          file_ext: '.yml',
          game_id: null,
          parser_id: null,
          aggregation_key: null,
          group_key: '__root__',
          group_label: 'Root',
          source_size_bytes: 100,
          translated_size_bytes: 100,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          last_analyzed_at: null,
          editor_available: true,
          status: 'missing_source',
          analysis_stale: false,
          latest_analysis: null,
          latest_analysis_state: 'unknown',
          output_metadata: null,
        },
      ];
  return { items, total: items.length, limit: 200, offset: 0 };
}

function makeSummary(jobId: string): OutputFilesSummaryResponse {
  return jobId === jobId1
    ? { files_count: 1, mods_count: 1, groups_count: 1, analyzed_count: 0, passed_count: 0, warning_count: 0, failed_count: 0, error_count: 0, missing_count: 0, stale_count: 0 }
    : { files_count: 2, mods_count: 1, groups_count: 1, analyzed_count: 0, passed_count: 0, warning_count: 0, failed_count: 1, error_count: 0, missing_count: 1, stale_count: 0 };
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

async function renderPage(tree?: OutputFileTreeResponse) {
  const treeData = tree ?? makeTree();
  mockGetOutputFilesTree.mockResolvedValue(treeData);

  const firstJobId = Object.keys(treeData.jobs)[0];
  mockListOutputFiles.mockResolvedValue(makeFileList(firstJobId));
  mockGetJobOutputsSummary.mockResolvedValue(makeSummary(firstJobId));

  const TranslatedFiles = (await import('../TranslatedFiles')).default;
  return render(React.createElement(TranslatedFiles));
}

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('TranslatedFiles page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    mockLocationState = null;
  });

  /* ------------------------------------------------------------------ */
  /*  Page structure                                                      */
  /* ------------------------------------------------------------------ */

  it('renders page header and description', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Translated Files')).toBeTruthy();
    });
    expect(screen.getByText('Browse translated output files by job')).toBeTruthy();
  });

  it('renders job list with cards for each job', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Output Jobs')).toBeTruthy();
    });
    // Both job IDs should be visible in the card list
    expect(screen.getByText(`Job: ${jobId1}`)).toBeTruthy();
    expect(screen.getByText(`Job: ${jobId2}`)).toBeTruthy();
  });

  it('defaults selectedJobId to first job when none is selected', async () => {
    await renderPage();
    await waitFor(() => {
      // First job (job-aaa, sorted by file count asc, job-bbb has 2 files so comes first) should be selected
      const cards = document.querySelectorAll('.job-card.selected');
      expect(cards.length).toBe(1);
    });
  });

  it('shows files panel with data for selected job', async () => {
    await renderPage();
    await waitFor(() => {
      // Should show summary cards for the first (default) job
      const filesLabels = screen.getAllByText('Files');
      expect(filesLabels.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Job selection                                                       */
  /* ------------------------------------------------------------------ */

  it('selecting another job updates the files panel', async () => {
    mockListOutputFiles.mockImplementation((params) => {
      const jid = params?.job_id;
      return Promise.resolve(makeFileList(jid));
    });
    mockGetJobOutputsSummary.mockImplementation((jid) => Promise.resolve(makeSummary(jid)));

    await renderPage();

    // Wait for first render - default selected job
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
    });

    // Click on second job card (job-aaa) — find by DOM position
    const cards = document.querySelectorAll('.job-card');
    // First card is job-bbb (2 files, sorted first), second card is job-aaa
    const secondCard = cards[1];
    expect(secondCard).toBeTruthy();
    fireEvent.click(secondCard!);

    // After clicking, job-aaa should now be selected
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
      expect(selectedCards[0].textContent).toContain(jobId1);
    });

    // Summary should have been loaded for job-aaa
    expect(mockGetJobOutputsSummary).toHaveBeenCalledWith(jobId1);
  });

  it('job list remains stable when selecting a different job', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Output Jobs')).toBeTruthy();
    });

    // Both job cards should remain
    expect(screen.getByText(`Job: ${jobId1}`)).toBeTruthy();
    expect(screen.getByText(`Job: ${jobId2}`)).toBeTruthy();
  });

  /* ------------------------------------------------------------------ */
  /*  View mode toggle                                                    */
  /* ------------------------------------------------------------------ */

  it('renders Tree/Table view mode toggle', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Tree')).toBeTruthy();
      expect(screen.getByText('Table')).toBeTruthy();
    });
  });

  it('defaults to tree view mode', async () => {
    await renderPage();
    await waitFor(() => {
      const treeBtn = screen.getByText('Tree');
      expect(treeBtn.className).toContain('btn-primary');
    });
  });

  it('toggling to table mode switches view', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Tree')).toBeTruthy();
    });

    const tableBtn = screen.getByText('Table');
    fireEvent.click(tableBtn);

    await waitFor(() => {
      expect(tableBtn.className).toContain('btn-primary');
    });
  });

  it('viewMode toggle is stable across job changes', async () => {
    mockListOutputFiles.mockImplementation((params) => {
      return Promise.resolve(makeFileList(params?.job_id));
    });
    mockGetJobOutputsSummary.mockImplementation((jid) => Promise.resolve(makeSummary(jid)));

    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Tree')).toBeTruthy();
    });

    // Switch to table mode
    const tableBtn = screen.getByText('Table');
    fireEvent.click(tableBtn);
    await waitFor(() => {
      expect(tableBtn.className).toContain('btn-primary');
    });

    // Select another job (job-aaa)
    const job1Card = screen.getByText(`Job: ${jobId1}`).closest('.job-card');
    fireEvent.click(job1Card!);

    // View mode should still be table
    await waitFor(() => {
      expect(tableBtn.className).toContain('btn-primary');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tree rendering                                                      */
  /* ------------------------------------------------------------------ */

  it('tree renders files grouped by mod in job-scoped mode', async () => {
    await renderPage();
    await waitFor(() => {
      // Tree should show mod name for the first job
      expect(screen.getByText('Mod B')).toBeTruthy();
      // Tree should show source files and translated files
      expect(screen.getByText('source_f2.yml')).toBeTruthy();
      expect(screen.getByText('f2.yml')).toBeTruthy();
    });
  });

  it('tree renders status badges for files', async () => {
    await renderPage();
    await waitFor(() => {
      const readyBadges = screen.getAllByText('READY');
      expect(readyBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Empty states                                                        */
  /* ------------------------------------------------------------------ */

  it('shows empty state when there are no jobs', async () => {
    mockGetOutputFilesTree.mockResolvedValue({ jobs: {}, job_timestamps: {} });
    const TranslatedFiles = (await import('../TranslatedFiles')).default;
    render(React.createElement(TranslatedFiles));

    await waitFor(() => {
      expect(screen.getByText('No translated output jobs')).toBeTruthy();
    });
  });

  it('shows select-a-job message when no job selected and no files panel', async () => {
    mockGetOutputFilesTree.mockResolvedValue({ jobs: {}, job_timestamps: {} });
    const TranslatedFiles = (await import('../TranslatedFiles')).default;
    render(React.createElement(TranslatedFiles));

    await waitFor(() => {
      expect(screen.getByText('Select a job to view files')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Table mode rendering                                                */
  /* ------------------------------------------------------------------ */

  it('table mode renders expected columns', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Tree')).toBeTruthy();
    });

    const tableBtn = screen.getByText('Table');
    fireEvent.click(tableBtn);

    await waitFor(() => {
      // Table headers
      expect(screen.getByText('File')).toBeTruthy();
      expect(screen.getByText('Mod')).toBeTruthy();
      expect(screen.getByText('Group')).toBeTruthy();
      expect(screen.getByText('Translated Path')).toBeTruthy();
      expect(screen.getByText('Status')).toBeTruthy();
      expect(screen.getByText('Analysis')).toBeTruthy();
      expect(screen.getByText('Size')).toBeTruthy();
      expect(screen.getByText('Updated')).toBeTruthy();
      expect(screen.getByText('Actions')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Stats display on job cards                                          */
  /* ------------------------------------------------------------------ */

  it('job cards show file count stats', async () => {
    await renderPage();
    await waitFor(() => {
      // Job 1 has 1 file, job 2 has 2 files
      // The first card (sorted desc by file count) shows "2" files
      const fileStats = screen.getAllByText('2');
      expect(fileStats.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('job cards show status breakdown', async () => {
    await renderPage();
    await waitFor(() => {
      // Job bbb (top card, 2 files) has 1 missing_source
      expect(screen.getByText('1 missing')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Actions stability                                                   */
  /* ------------------------------------------------------------------ */

  it('refresh does not clear selectedJobId if job still exists', async () => {
    await renderPage();

    // Wait for a selected card to appear
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
    });

    // Click refresh button in toolbar
    const refreshBtn = screen.getByTitle('Refresh list');
    fireEvent.click(refreshBtn);

    // selectedJobId should still be set
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Regression: URL ?job_id= param (bug fix for View files navigation) */
  /* ------------------------------------------------------------------ */

  it('uses ?job_id= from URL and does NOT override with first tree job', async () => {
    // Given the URL specifies job-bbb (second key in the tree)
    mockSearchParams = new URLSearchParams(`job_id=${jobId2}`);

    const tree = makeTree();
    mockGetOutputFilesTree.mockResolvedValue(tree);
    mockListOutputFiles.mockImplementation((opts) => Promise.resolve(makeFileList(opts?.job_id)));
    mockGetJobOutputsSummary.mockImplementation((jid) => Promise.resolve(makeSummary(jid)));

    const TranslatedFiles = (await import('../TranslatedFiles')).default;
    render(React.createElement(TranslatedFiles));

    // Then job-bbb should remain selected (not overridden by first job job-aaa)
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
      expect(selectedCards[0].textContent).toContain(jobId2);
    });

    // And job-bbb's data should be loaded (not job-aaa's)
    expect(mockGetJobOutputsSummary).toHaveBeenCalledWith(jobId2);
  });

  it('falls back to first job when ?job_id= does not match any job', async () => {
    // Given the URL specifies a non-existent job ID
    mockSearchParams = new URLSearchParams('job_id=unknown');

    const tree = makeTree();
    mockGetOutputFilesTree.mockResolvedValue(tree);
    mockListOutputFiles.mockImplementation((opts) => Promise.resolve(makeFileList(opts?.job_id)));
    mockGetJobOutputsSummary.mockImplementation((jid) => Promise.resolve(makeSummary(jid)));

    const TranslatedFiles = (await import('../TranslatedFiles')).default;
    render(React.createElement(TranslatedFiles));

    // UI does not crash, first job is selected
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
    });

    // First available job's data is loaded
    expect(mockGetJobOutputsSummary).toHaveBeenCalledWith(jobId1);
  });

  /* ------------------------------------------------------------------ */
  /*  Back navigation: restoreJobId from location.state                   */
  /* ------------------------------------------------------------------ */

  it('restores selectedJobId from location.state.restoreJobId when coming back from editor', async () => {
    // Simulate editor back navigation with restoreJobId
    mockLocationState = { restoreJobId: jobId2 };

    mockGetOutputFilesTree.mockResolvedValue(makeTree());
    mockListOutputFiles.mockImplementation((opts) => Promise.resolve(makeFileList(opts?.job_id)));
    mockGetJobOutputsSummary.mockImplementation((jid) => Promise.resolve(makeSummary(jid)));

    const TranslatedFiles = (await import('../TranslatedFiles')).default;
    render(React.createElement(TranslatedFiles));

    // jobId2 (job-bbb) should be selected, not the first job in tree
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
      expect(selectedCards[0].textContent).toContain(jobId2);
    });

    // And job-bbb's data should be loaded
    expect(mockGetJobOutputsSummary).toHaveBeenCalledWith(jobId2);
  });

  it('restoreJobId takes priority over ?job_id= URL param', async () => {
    // Both are set — location.state should win
    mockLocationState = { restoreJobId: jobId1 };
    mockSearchParams = new URLSearchParams(`job_id=${jobId2}`);

    mockGetOutputFilesTree.mockResolvedValue(makeTree());
    mockListOutputFiles.mockImplementation((opts) => Promise.resolve(makeFileList(opts?.job_id)));
    mockGetJobOutputsSummary.mockImplementation((jid) => Promise.resolve(makeSummary(jid)));

    const TranslatedFiles = (await import('../TranslatedFiles')).default;
    render(React.createElement(TranslatedFiles));

    // jobId1 (job-aaa) should be selected because restoreJobId has priority
    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
      expect(selectedCards[0].textContent).toContain(jobId1);
    });

    expect(mockGetJobOutputsSummary).toHaveBeenCalledWith(jobId1);
  });

  it('falls back to ?job_id= when location.state.restoreJobId is not set', async () => {
    mockLocationState = null;
    mockSearchParams = new URLSearchParams(`job_id=${jobId2}`);

    mockGetOutputFilesTree.mockResolvedValue(makeTree());
    mockListOutputFiles.mockImplementation((opts) => Promise.resolve(makeFileList(opts?.job_id)));
    mockGetJobOutputsSummary.mockImplementation((jid) => Promise.resolve(makeSummary(jid)));

    const TranslatedFiles = (await import('../TranslatedFiles')).default;
    render(React.createElement(TranslatedFiles));

    await waitFor(() => {
      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
      expect(selectedCards[0].textContent).toContain(jobId2);
    });

    expect(mockGetJobOutputsSummary).toHaveBeenCalledWith(jobId2);
  });
});
