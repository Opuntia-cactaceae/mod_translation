/* ------------------------------------------------------------------ */
/*  OutputFileActions tests                                             */
/*  Verifies saved diagnostics are fetched and displayed on mount       */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import type { OutputFile, OutputAnalysisResult } from '../../../api/types';
import type { OutputAnalysisDiagnostic } from '../../../api/types';

/* ================================================================== */
/*  Mock API client (same approach as ModListSection test)              */
/*  vi.mock factories are HOISTED — vi.fn() called inside the factory   */
/* ================================================================== */

vi.mock('../../../api/client', () => {
  const mocks = {
    getOutputFileLatestAnalysis: vi.fn(),
    analyzeOutputFile: vi.fn(),
  };
  return { api: mocks, ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ApiError'; }
  }};
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Import after mocks
import OutputFileActions from '../OutputFileActions';
import { ToastContext } from '../../../App';
import { api as clientApi } from '../../../api/client';

/* ================================================================== */
/*  Test Data                                                           */
/* ================================================================== */

const SAMPLE_DIAGNOSTICS: OutputAnalysisDiagnostic[] = [
  {
    severity: 'error',
    code: 'SNAPSHOT_UNAVAILABLE',
    message: 'Protection snapshot not available for this file',
    source: 'snapshot',
    line: null,
    column: null,
    key: null,
    details: {},
  },
  {
    severity: 'error',
    code: 'MISSING_PLACEHOLDER',
    message: 'Placeholder $some_key$ missing in translation',
    source: 'placeholders',
    line: 42,
    column: null,
    key: 'some_key',
    details: {},
  },
  {
    severity: 'warning',
    code: 'CHANGED_PLACEHOLDER',
    message: 'Placeholder order changed in translated text',
    source: 'placeholders',
    line: 15,
    column: null,
    key: 'other_key',
    details: {},
  },
];

function makeFile(overrides: Partial<OutputFile> = {}): OutputFile {
  return {
    id: 'file-1',
    job_id: 'job-1',
    mod_id: 'mod-1',
    mod_name: 'Test Mod',
    source_file_path: '/tmp/source/file-1.yml',
    translated_file_path: '/tmp/output/file-1.yml',
    relative_source_path: 'source/file-1.yml',
    relative_translated_path: 'output/file-1.yml',
    file_name: 'file-1.yml',
    file_ext: '.yml',
    game_id: 'stellaris',
    parser_id: 'stellaris_localisation',
    aggregation_key: null,
    group_key: 'group_a',
    group_label: 'Group A',
    source_size_bytes: 100,
    translated_size_bytes: 120,
    created_at: '2026-05-01T12:00:00Z',
    updated_at: '2026-05-01T12:00:00Z',
    last_analyzed_at: '2026-05-01T12:30:00Z',
    editor_available: true,
    status: 'ready',
    analysis_stale: false,
    latest_analysis: {
      id: 'analysis-1',
      status: 'failed',
      compilability_score: 0.5,
      placeholders_score: 0.5,
      errors_count: 2,
      warnings_count: 1,
      created_at: '2026-05-01T12:30:00Z',
      source_hash: 'abc',
      translated_hash: 'def',
    },
    latest_analysis_state: 'current',
    output_metadata: null,
    ...overrides,
  };
}

function makeAnalysisResult(overrides: Partial<OutputAnalysisResult> = {}): OutputAnalysisResult {
  return {
    id: 'analysis-1',
    output_file_id: 'file-1',
    job_id: 'job-1',
    analyzer_version: '2.0.0',
    status: 'failed',
    compilability_score: 0.5,
    placeholders_score: 0.5,
    errors_count: 2,
    warnings_count: 1,
    source_hash: 'abc',
    translated_hash: 'def',
    diagnostics: SAMPLE_DIAGNOSTICS,
    created_at: '2026-05-01T12:30:00Z',
    ...overrides,
  };
}

/** Helper to wrap the component with a toast context */
function renderWithToast(ui: React.ReactElement) {
  return render(
    React.createElement(ToastContext.Provider, { value: { toast: null, showToast: vi.fn() } },
      ui,
    ),
  );
}

/* ================================================================== */
/*  Cleanup                                                             */
/* ================================================================== */

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('OutputFileActions — saved diagnostics display', () => {

  it('fetches and displays saved diagnostics on mount', async () => {
    const file = makeFile();
    const savedResult = makeAnalysisResult();
    vi.mocked(clientApi.getOutputFileLatestAnalysis).mockResolvedValue(savedResult);

    renderWithToast(React.createElement(OutputFileActions, {
      file,
      onClose: vi.fn(),
    }));

    // Should show loading indicator
    expect(screen.getByText('Loading saved diagnostics...')).toBeTruthy();

    // Wait for diagnostics to appear
    await waitFor(() => {
      expect(screen.getByText('Diagnostics (3)')).toBeTruthy();
    });

    // Verify diagnostics content
    expect(screen.getByText('SNAPSHOT_UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('MISSING_PLACEHOLDER')).toBeTruthy();
    expect(screen.getByText('CHANGED_PLACEHOLDER')).toBeTruthy();

    // Verify severity badges
    const errorBadges = screen.getAllByText('ERROR');
    expect(errorBadges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('WARNING')).toBeTruthy();

    // Verify line numbers and keys are displayed
    expect(screen.getByText('line: 42')).toBeTruthy();
    expect(screen.getByText('line: 15')).toBeTruthy();
    expect(screen.getByText('key: some_key')).toBeTruthy();
    expect(screen.getByText('key: other_key')).toBeTruthy();

    // Verify API was called with correct file ID
    expect(clientApi.getOutputFileLatestAnalysis).toHaveBeenCalledWith('file-1');
  });

  it('shows "No saved analysis result" when no analysis exists', async () => {
    const file = makeFile({ latest_analysis: null, last_analyzed_at: null, latest_analysis_state: 'not_analyzed' });
    vi.mocked(clientApi.getOutputFileLatestAnalysis).mockResolvedValue(null);

    renderWithToast(React.createElement(OutputFileActions, {
      file,
      onClose: vi.fn(),
    }));

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByText(/No saved analysis result/)).toBeTruthy();
    });
  });

  it('shows "No diagnostics found" when analysis has no diagnostics', async () => {
    const file = makeFile();
    const savedResult = makeAnalysisResult({ diagnostics: [], errors_count: 0, warnings_count: 0 });
    vi.mocked(clientApi.getOutputFileLatestAnalysis).mockResolvedValue(savedResult);

    renderWithToast(React.createElement(OutputFileActions, {
      file,
      onClose: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.getByText('Diagnostics (0)')).toBeTruthy();
    });

    expect(screen.getByText('No diagnostics found.')).toBeTruthy();
  });

  it('manual Analyze replaces saved diagnostics', async () => {
    const file = makeFile();
    const savedResult = makeAnalysisResult({
      diagnostics: [SAMPLE_DIAGNOSTICS[0]], // 1 error
      errors_count: 1,
      warnings_count: 0,
    });
    const freshResult = makeAnalysisResult({
      diagnostics: [SAMPLE_DIAGNOSTICS[1]], // different diag
      errors_count: 1,
      warnings_count: 0,
    });

    vi.mocked(clientApi.getOutputFileLatestAnalysis).mockResolvedValue(savedResult);
    vi.mocked(clientApi.analyzeOutputFile).mockResolvedValue(freshResult);

    renderWithToast(React.createElement(OutputFileActions, {
      file,
      onClose: vi.fn(),
    }));

    // Wait for saved diagnostics to load
    await waitFor(() => {
      expect(screen.getByText('Diagnostics (1)')).toBeTruthy();
    });
    expect(screen.getByText('SNAPSHOT_UNAVAILABLE')).toBeTruthy();

    // Click Analyze
    fireEvent.click(screen.getByText('Analyze'));

    // Should now show fresh result (MISSING_PLACEHOLDER, not SNAPSHOT_UNAVAILABLE)
    await waitFor(() => {
      expect(screen.getByText('MISSING_PLACEHOLDER')).toBeTruthy();
    });
    expect(screen.queryByText('SNAPSHOT_UNAVAILABLE')).toBeNull();
  });

  it('handles API error gracefully', async () => {
    const file = makeFile();
    vi.mocked(clientApi.getOutputFileLatestAnalysis).mockRejectedValue(new Error('Network error'));

    renderWithToast(React.createElement(OutputFileActions, {
      file,
      onClose: vi.fn(),
    }));

    // After loading fails, should show the no-analysis message
    await waitFor(() => {
      expect(screen.getByText(/No saved analysis result/)).toBeTruthy();
    });
  });

  it('displays analysis summary from saved result', async () => {
    const file = makeFile();
    const savedResult = makeAnalysisResult({
      status: 'warning',
      compilability_score: 0.75,
      placeholders_score: 0.5,
      errors_count: 0,
      warnings_count: 2,
    });
    vi.mocked(clientApi.getOutputFileLatestAnalysis).mockResolvedValue(savedResult);

    renderWithToast(React.createElement(OutputFileActions, {
      file,
      onClose: vi.fn(),
    }));

    // Wait for the analysis section to appear with saved data
    await waitFor(() => {
      expect(screen.getByText('Diagnostics (3)')).toBeTruthy();
    });
  });
});
