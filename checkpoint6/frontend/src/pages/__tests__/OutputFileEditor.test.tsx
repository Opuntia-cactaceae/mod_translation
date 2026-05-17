import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import type { OutputFileEditorPayload, OutputAnalysisResult, FileContentsResponse } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockNavigate = vi.fn();
const mockGetOutputEditorPayload = vi.fn();
const mockGetOutputFileLatestAnalysis = vi.fn();
const mockAnalyzeOutputFile = vi.fn();
const mockSaveOutputTranslatedContent = vi.fn();
const mockGetFileContents = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ outputFileId: 'test-file-id' }),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../App', () => ({
  api: {
    getOutputEditorPayload: (...args: unknown[]) => mockGetOutputEditorPayload(...args),
    getOutputFileLatestAnalysis: (...args: unknown[]) => mockGetOutputFileLatestAnalysis(...args),
    analyzeOutputFile: (...args: unknown[]) => mockAnalyzeOutputFile(...args),
    saveOutputTranslatedContent: (...args: unknown[]) => mockSaveOutputTranslatedContent(...args),
    getFileContents: (...args: unknown[]) => mockGetFileContents(...args),
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
  useToast: () => ({ showToast: vi.fn() }),
  ToastContext: {
    Provider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Consumer: ({ children }: { children: (value: unknown) => React.ReactNode }) => children({ showToast: vi.fn() }),
  },
}));

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makePayload(overrides: Partial<OutputFileEditorPayload> = {}): OutputFileEditorPayload {
  return {
    output_file_id: 'test-file-id',
    job_id: 'test-job-id',
    source_file: { path: '/src/file.yml', relative_path: 'file.yml', exists: true },
    translated_file: { path: '/dst/file.yml', relative_path: 'file.yml', exists: true },
    parser_id: 'stellaris_localisation',
    game_id: 'stellaris',
    source_content: 'l_english:\n key:0 "Hello"',
    translated_content: 'l_english:\n key:0 "Привет"',
    structured: true,
    entries: [
      { key: 'key', source_text: 'Hello', translated_text: 'Привет', source_line: 2, translated_line: 2, entry_type: 'translatable', translatable: true, metadata: {} },
    ],
    metadata: {
      file_name: 'file.yml',
      file_ext: '.yml',
      source_size_bytes: 100,
      translated_size_bytes: 100,
      updated_at: '2025-01-01T00:00:00Z',
      status: 'completed',
      analysis_stale: false,
      latest_analysis_state: 'valid',
    },
    ...overrides,
  };
}

function makeAnalysisResult(overrides: Partial<OutputAnalysisResult> = {}): OutputAnalysisResult {
  return {
    id: 'analysis-1',
    output_file_id: 'test-file-id',
    job_id: 'test-job-id',
    analyzer_version: '1.0',
    status: 'failed',
    compilability_score: 0.5,
    placeholders_score: 0.8,
    errors_count: 1,
    warnings_count: 1,
    source_hash: 'abc',
    translated_hash: 'def',
    diagnostics: [
      {
        severity: 'error',
        code: 'CHANGED_PLACEHOLDER',
        message: "Placeholder identity changed: expected '§B', got '§W' for source placeholder '§B'",
        source: 'placeholders',
        line: 2,
        column: null,
        key: 'key',
        details: {},
      },
      {
        severity: 'warning',
        code: 'COMPILABILITY_FAILED',
        message: 'Translated content has mismatched tags',
        source: 'compilability',
        line: 3,
        column: null,
        key: 'other_key',
        details: {},
      },
      {
        severity: 'info',
        code: 'INFO_TEST',
        message: 'Some informational diagnostic',
        source: 'test',
        line: null,
        column: null,
        key: null,
        details: {},
      },
    ],
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

async function renderEditor(payload?: OutputFileEditorPayload, analysis?: OutputAnalysisResult) {
  mockGetOutputEditorPayload.mockResolvedValue(payload ?? makePayload());
  mockGetOutputFileLatestAnalysis.mockResolvedValue(analysis ?? makeAnalysisResult());
  mockSaveOutputTranslatedContent.mockResolvedValue({ success: true, updated_at: '2025-01-01T00:00:01Z', translated_size_bytes: 100, status: 'completed', analysis_stale: true });

  const OutputFileEditor = (await import('../OutputFileEditor')).default;
  return render(React.createElement(OutputFileEditor));
}

/* ================================================================== */
/*  Diagnostics Panel Tests                                            */
/* ================================================================== */

describe('OutputFileEditor diagnostics panel', () => {

  it('renders loading state initially', async () => {
    // Keep payload promise pending
    mockGetOutputEditorPayload.mockReturnValue(new Promise(() => {}));
    mockGetOutputFileLatestAnalysis.mockResolvedValue(null);

    const OutputFileEditor = (await import('../OutputFileEditor')).default;
    render(React.createElement(OutputFileEditor));

    await waitFor(() => {
      expect(screen.getByText(/Loading editor/)).toBeTruthy();
    });
  });

  it('renders diagnostics panel with severity badges, code, message, and meta', async () => {
    await renderEditor();

    // Check status badge (appears in diagnostics panel + file info)
    await waitFor(() => {
      expect(screen.getAllByText('failed').length).toBeGreaterThanOrEqual(1);
    });

    // Check diagnostics panel header
    expect(screen.getByText(/^Diagnostics/)).toBeTruthy();

    // Check severity badges
    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(screen.getByText('WARNING')).toBeTruthy();
    expect(screen.getByText('INFO')).toBeTruthy();

    // Check error code is rendered as monospace token
    expect(screen.getByText('CHANGED_PLACEHOLDER')).toBeTruthy();
    expect(screen.getByText('COMPILABILITY_FAILED')).toBeTruthy();
    expect(screen.getByText('INFO_TEST')).toBeTruthy();

    // Check messages
    expect(screen.getByText(/Placeholder identity changed/)).toBeTruthy();
    expect(screen.getByText(/mismatched tags/)).toBeTruthy();
    expect(screen.getByText(/informational diagnostic/)).toBeTruthy();

    // Check meta chips
    expect(screen.getByText(/key: key/)).toBeTruthy();
    expect(screen.getByText(/line: 2/)).toBeTruthy();
    expect(screen.getByText(/placeholders/)).toBeTruthy();
  });

  it('renders filter buttons with correct counts', async () => {
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText(/All \(3\)/)).toBeTruthy();
    });

    expect(screen.getByText(/Errors \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Warnings \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Info \(1\)/)).toBeTruthy();
  });

  it('shows affected-only checkbox for structured mode', async () => {
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText('Affected only')).toBeTruthy();
    });

    const checkbox = screen.getByLabelText('Affected only') as HTMLInputElement;
    expect(checkbox).toBeDefined();
  });

  it('affected-only checkbox toggles', async () => {
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText('Affected only')).toBeTruthy();
    });

    const checkbox = screen.getByLabelText('Affected only') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('renders group headers for each severity', async () => {
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText('error (1)')).toBeTruthy();
      expect(screen.getByText('warning (1)')).toBeTruthy();
      expect(screen.getByText('info (1)')).toBeTruthy();
    });
  });

  it('shows empty state when no diagnostics match filter', async () => {
    const analysisWithNoErrors = makeAnalysisResult({
      diagnostics: [
        { severity: 'info', code: 'INFO_TEST', message: 'Info only', source: '', line: null, column: null, key: null, details: {} },
      ],
      errors_count: 0,
      warnings_count: 0,
    });

    await renderEditor(makePayload(), analysisWithNoErrors);

    // Click Errors filter
    await waitFor(() => {
      expect(screen.getByText(/Info \(1\)/)).toBeTruthy();
    });

    // Click the Errors filter button
    const errorsBtn = screen.getByText(/Errors \(0\)/);
    fireEvent.click(errorsBtn);

    // Should see empty message
    await waitFor(() => {
      expect(screen.getByText(/No error diagnostics/)).toBeTruthy();
    });
  });

  it('renders compilability and placeholders scores', async () => {
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText(/C:0.5/)).toBeTruthy();
      expect(screen.getByText(/P:0.8/)).toBeTruthy();
    });
  });

  it('renders diagnostics panel only when diagnostics exist', async () => {
    const noDiagResult = makeAnalysisResult({ diagnostics: [], errors_count: 0, warnings_count: 0 });
    await renderEditor(makePayload(), noDiagResult);

    await waitFor(() => {
      // Diagnostics panel should not appear
      expect(screen.queryByText(/Diagnostics \(0\)/)).toBeNull();
    });
  });

  it('renders diagnostics in OutputFileActions modal style', async () => {
    // Verify the diagnostic CSS classes are applied by checking rendered structure
    const analysis = makeAnalysisResult();
    await renderEditor(makePayload(), analysis);

    await waitFor(() => {
      expect(screen.getByText('ERROR')).toBeTruthy();
    });

    // Verify diagnostic rows have proper structure
    const errorBadge = screen.getByText('ERROR');
    expect(errorBadge.className).toContain('diagnostic-severity-badge');
    expect(errorBadge.className).toContain('diag-error');

    // Check code class
    const codeEl = screen.getByText('CHANGED_PLACEHOLDER');
    expect(codeEl.className).toContain('diagnostic-code');

    // Check meta chip classes
    const keyChip = screen.getByText(/key: key/);
    expect(keyChip.className).toContain('diagnostic-meta-chip');
  });
});

/* ================================================================== */
/*  Side-by-Side Table Layout Tests                                   */
/* ================================================================== */

describe('OutputFileEditor side-by-side table layout', () => {

  it('renders structured mode table with correct class', async () => {
    await renderEditor();
    await waitFor(() => {
      const table = document.querySelector('table.side-by-side-editor-table');
      expect(table).toBeTruthy();
    });
  });

  it('renders source cell with pre-wrap and word-break styles', async () => {
    await renderEditor();
    await waitFor(() => {
      const cells = document.querySelectorAll('td');
      // Find the source cell (4th td, after marker, #, and key)
      const sourceCell = cells[3]; // 0-indexed: 0=marker, 1=#, 2=key, 3=source
      expect(sourceCell).toBeTruthy();
      expect(sourceCell.style.whiteSpace).toBe('pre-wrap');
      expect(sourceCell.style.wordBreak).toBe('break-word');
      expect(sourceCell.style.overflowWrap).toBe('anywhere');
    });
  });

  it('renders translation cell with textarea instead of input', async () => {
    await renderEditor();
    await waitFor(() => {
      // Check there is at least one textarea in the table body
      const textareas = document.querySelectorAll('table.side-by-side-editor-table textarea');
      expect(textareas.length).toBeGreaterThanOrEqual(1);
      // Check there is no input in the table body
      const inputs = document.querySelectorAll('table.side-by-side-editor-table input[type="text"], table.side-by-side-editor-table input:not([type="checkbox"])');
      // No editable inputs (checkbox for affected-only is outside the table)
      const editableInputs = Array.from(inputs).filter(el => (el as HTMLInputElement).type !== 'checkbox');
      expect(editableInputs.length).toBe(0);
    });
  });

  it('renders key cell with title attribute', async () => {
    await renderEditor();
    await waitFor(() => {
      const keyCell = document.querySelectorAll('td')[2];
      expect(keyCell).toBeTruthy();
      expect(keyCell.getAttribute('title')).toBe('key');
    });
  });

  it('renders key cell with em dash placeholder when key is empty', async () => {
    const payload = makePayload({
      entries: [
        { key: '', source_text: 'Hello', translated_text: 'Привет', source_line: 2, translated_line: 2, entry_type: 'raw_unknown', translatable: false, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      // Key cell should contain the em dash visual placeholder
      const keyCell = document.querySelectorAll('td')[2];
      expect(keyCell).toBeTruthy();
      expect(keyCell.textContent).toContain('\u2014');
    });
  });

  it('renders long source text with wrapping styles', async () => {
    const longText = 'A very long source text that should wrap properly without horizontal truncation ' + 'x'.repeat(200);
    const payload = makePayload({
      entries: [
        { key: 'long_key', source_text: longText, translated_text: 'Short translation', source_line: 2, translated_line: 2, entry_type: 'translation_entry', translatable: true, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      const sourceCell = document.querySelectorAll('td')[3];
      expect(sourceCell).toBeTruthy();
      expect(sourceCell.textContent).toBe(longText);
    });
  });

  it('renders table with Translation column header', async () => {
    await renderEditor();
    await waitFor(() => {
      expect(screen.getByText('Translation')).toBeTruthy();
    });
  });

  it('renders type badge compactly for translation_entry', async () => {
    const payload = makePayload({
      entries: [
        { key: 'k1', source_text: 'Hello', translated_text: 'Hola', source_line: 2, translated_line: 2, entry_type: 'translation_entry', translatable: true, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      expect(screen.getByText('entry')).toBeTruthy();
    });
  });

  it('renders raw_unknown rows with read-only placeholder instead of textarea', async () => {
    const payload = makePayload({
      entries: [
        { key: '', source_text: '', translated_text: null, source_line: 2, translated_line: 2, entry_type: 'raw_unknown', translatable: false, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      // Should have no textarea in the table for raw_unknown row
      const textareas = document.querySelectorAll('table.side-by-side-editor-table textarea');
      expect(textareas.length).toBe(0);
      // Should render a read-only placeholder instead
      const placeholders = document.querySelectorAll('.editor-readonly-placeholder');
      expect(placeholders.length).toBe(1);
    });
  });

  it('renders table with # column for row numbering', async () => {
    await renderEditor();
    await waitFor(() => {
      expect(screen.getByText('#')).toBeTruthy();
    });
  });
});

/* ================================================================== */
/*  RAW_UNKNOWN / Non-Translatable Row Tests                           */
/* ================================================================== */

describe('OutputFileEditor non-editable rows', () => {

  it('shows read-only placeholder for raw_unknown rows instead of textarea', async () => {
    const payload = makePayload({
      entries: [
        { key: 'k1', source_text: 'Hello', translated_text: 'Hola', source_line: 2, translated_line: 2, entry_type: 'translation_entry', translatable: true, metadata: {} },
        { key: '', source_text: '\u2014', translated_text: null, source_line: 3, translated_line: 3, entry_type: 'raw_unknown', translatable: false, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      // Should have exactly one textarea (only for the translatable entry)
      const textareas = document.querySelectorAll('table.side-by-side-editor-table textarea');
      expect(textareas.length).toBe(1);
      // Should have exactly one read-only placeholder
      const placeholders = document.querySelectorAll('.editor-readonly-placeholder');
      expect(placeholders.length).toBe(1);
      expect(placeholders[0].textContent).toBe('Raw line');
    });
  });

  it('shows read-only placeholder with "Not translatable" for non-translatable entries', async () => {
    const payload = makePayload({
      entries: [
        { key: 'nt', source_text: 'Some text', translated_text: null, source_line: 2, translated_line: 2, entry_type: 'comment', translatable: false, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      const placeholders = document.querySelectorAll('.editor-readonly-placeholder');
      expect(placeholders.length).toBe(1);
      expect(placeholders[0].textContent).toBe('Not translatable');
    });
  });

  it('marks non-editable rows with row-non-editable class', async () => {
    const payload = makePayload({
      entries: [
        { key: 'k1', source_text: 'Hello', translated_text: 'Hola', source_line: 2, translated_line: 2, entry_type: 'translation_entry', translatable: true, metadata: {} },
        { key: '', source_text: 'raw', translated_text: null, source_line: 3, translated_line: 3, entry_type: 'raw_unknown', translatable: false, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      const rows = document.querySelectorAll('tr.row-non-editable');
      expect(rows.length).toBe(1);
    });
  });

  it('renders key as muted em dash with "No key" tooltip for empty-key entries', async () => {
    const payload = makePayload({
      entries: [
        { key: '', source_text: 'raw line', translated_text: null, source_line: 2, translated_line: 2, entry_type: 'raw_unknown', translatable: false, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      const keyCell = document.querySelectorAll('td')[2];
      expect(keyCell).toBeTruthy();
      expect(keyCell.getAttribute('title')).toBe('No key');
      expect(keyCell.textContent).toContain('\u2014');
    });
  });

  it('shows muted badge for non-editable rows', async () => {
    const payload = makePayload({
      entries: [
        { key: '', source_text: 'raw', translated_text: null, source_line: 2, translated_line: 2, entry_type: 'raw_unknown', translatable: false, metadata: {} },
      ],
    });
    await renderEditor(payload);
    await waitFor(() => {
      const badges = document.querySelectorAll('table.side-by-side-editor-table .badge');
      expect(badges.length).toBe(1);
      expect(badges[0].className).toContain('badge-muted');
    });
  });
});

/* ================================================================== */
/*  Collapsible Sections Tests                                         */
/* ================================================================== */

describe('OutputFileEditor collapsible sections', () => {

  it('renders side-by-side editor as a collapsible section', async () => {
    await renderEditor();
    await waitFor(() => {
      const sections = document.querySelectorAll('.collapsible-section');
      expect(sections.length).toBeGreaterThanOrEqual(1);
      const headers = document.querySelectorAll('.collapsible-header');
      const editorHeader = Array.from(headers).find(h => h.textContent?.includes('Side-by-Side Editor'));
      expect(editorHeader).toBeTruthy();
    });
  });

  it('collapse/expand side-by-side editor hides/shows content', async () => {
    await renderEditor();
    await waitFor(() => {
      expect(document.querySelector('table.side-by-side-editor-table')).toBeTruthy();
    });

    // Click the side-by-side editor header to collapse
    const headers = document.querySelectorAll('.collapsible-header');
    const editorHeader = Array.from(headers).find(h => h.textContent?.includes('Side-by-Side Editor'));
    expect(editorHeader).toBeTruthy();
    fireEvent.click(editorHeader!);

    // Table should be hidden
    await waitFor(() => {
      expect(document.querySelector('table.side-by-side-editor-table')).toBeNull();
    });

    // Click again to expand
    fireEvent.click(editorHeader!);
    await waitFor(() => {
      expect(document.querySelector('table.side-by-side-editor-table')).toBeTruthy();
    });
  });

  it('renders Disk File View collapsible section', async () => {
    await renderEditor();
    await waitFor(() => {
      expect(screen.getByText('Disk File View')).toBeTruthy();
    });
  });

  it('expanding Disk File View loads and shows file contents', async () => {
    mockGetFileContents.mockResolvedValue({
      source_path: '/src/file.txt',
      translated_path: '/dst/file.txt',
      source_content: 'line1\nline2\nline3',
      translated_content: 'translated1\ntranslated2',
      source_exists: true,
      translated_exists: true,
    });
    await renderEditor();
    await waitFor(() => {
      expect(screen.getByText('Disk File View')).toBeTruthy();
    });

    // Click Disk File View header button to expand and trigger load
    const viewerBtn = screen.getByText('Disk File View').closest('button');
    expect(viewerBtn).toBeTruthy();
    fireEvent.click(viewerBtn!);

    // Wait for file viewer panels to render
    await waitFor(() => {
      expect(screen.getByText('Source file')).toBeTruthy();
      expect(screen.getByText('Translated file')).toBeTruthy();
    });
  });
});

/* ================================================================== */
/*  File Viewer Tests                                                  */
/* ================================================================== */

describe('OutputFileEditor file viewer', () => {
  /** Helper: wait for Disk File View header and click it. */
  async function expandFileViewer() {
    await waitFor(() => {
      expect(screen.getByText('Disk File View')).toBeTruthy();
    });
    const btn = screen.getByText('Disk File View').closest('button');
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
  }

  it('renders two file viewer panels when expanded', async () => {
    mockGetFileContents.mockResolvedValue({
      source_path: '/src/file.txt',
      translated_path: '/dst/file.txt',
      source_content: 'line1\nline2',
      translated_content: 'translated1',
      source_exists: true,
      translated_exists: true,
    });
    await renderEditor();
    await expandFileViewer();

    await waitFor(() => {
      const panels = document.querySelectorAll('.file-viewer-panel');
      expect(panels.length).toBe(2);
    });
  });

  it('renders line numbers for both panels', async () => {
    mockGetFileContents.mockResolvedValue({
      source_path: '/src/file.txt',
      translated_path: '/dst/file.txt',
      source_content: 'a\nb\nc',
      translated_content: 'x\ny',
      source_exists: true,
      translated_exists: true,
    });
    await renderEditor();
    await expandFileViewer();

    await waitFor(() => {
      const lineNums = document.querySelectorAll('.code-line-no');
      // 3 source lines + 2 translated lines = 5 line numbers
      expect(lineNums.length).toBe(5);
    });
  });

  it('preserves whitespace in file content', async () => {
    mockGetFileContents.mockResolvedValue({
      source_path: '/src/file.txt',
      translated_path: '/dst/file.txt',
      source_content: '  indented\n\t tabbed',
      translated_content: 'normal',
      source_exists: true,
      translated_exists: true,
    });
    await renderEditor();
    await expandFileViewer();

    await waitFor(() => {
      const codeLines = document.querySelectorAll('.code-line-text');
      expect(codeLines.length).toBe(3); // 2 source + 1 translated
    });
  });

  it('shows missing state when source file does not exist', async () => {
    mockGetFileContents.mockResolvedValue({
      source_path: '/src/missing.txt',
      translated_path: '/dst/exists.txt',
      source_content: '',
      translated_content: 'content',
      source_exists: false,
      translated_exists: true,
    });
    await renderEditor();
    await expandFileViewer();

    await waitFor(() => {
      expect(screen.getByText('Source file does not exist on disk.')).toBeTruthy();
    });
  });

  it('shows missing state when translated file does not exist', async () => {
    mockGetFileContents.mockResolvedValue({
      source_path: '/src/exists.txt',
      translated_path: '/dst/missing.txt',
      source_content: 'content',
      translated_content: '',
      source_exists: true,
      translated_exists: false,
    });
    await renderEditor();
    await expandFileViewer();

    await waitFor(() => {
      expect(screen.getByText('Translated file does not exist on disk.')).toBeTruthy();
    });
  });
});
