import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import type { EditorFileResponse } from '../../api/types';

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
const mockSearchParams = new URLSearchParams();
let mockGetEditorFile = vi.fn();

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
}));

vi.mock('../../App', () => ({
  api: {
    getEditorFile: (...args: unknown[]) => mockGetEditorFile(...args),
    saveEditorFile: vi.fn(),
    updateEditorEntry: vi.fn(),
    validateEditorFile: vi.fn(),
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

function makeEditorFileResponse(overrides: Partial<EditorFileResponse> = {}): EditorFileResponse {
  return {
    file_id: '/path/to/file.yml',
    content: 'l_english:\n key:0 "Hello"',
    entries: [],
    language: 'english',
    rows: [
      {
        row_id: 'row-1',
        line_no: 1,
        entry_type: 'translatable',
        key: 'key',
        source_text: 'Hello',
        translated_text: 'Привет',
        status: 'translated',
        warnings: [],
        errors: [],
        raw_line: ' key:0 "Hello"',
        editable: true,
      },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

async function renderEditor() {
  const Editor = (await import('../Editor')).default;
  return render(React.createElement(Editor));
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('Editor page auto-load', () => {
  beforeEach(() => {
    mockSearchParams.delete('filePath');
    vi.clearAllMocks();
  });

  it('auto-loads file from ?filePath query param', async () => {
    const editorData = makeEditorFileResponse({ file_id: '/custom/file.yml' });
    mockGetEditorFile.mockResolvedValue(editorData);

    mockSearchParams.set('filePath', '/custom/file.yml');
    await renderEditor();

    // Should call getEditorFile with the path from query param
    await waitFor(() => {
      expect(mockGetEditorFile).toHaveBeenCalledWith('/custom/file.yml');
    });

    // Editor table should appear with the loaded data
    await waitFor(() => {
      expect(screen.getByText(/Editor:/)).toBeTruthy();
    });
  });

  it('shows loading indicator while fetching', async () => {
    // Keep the promise pending
    mockGetEditorFile.mockReturnValue(new Promise(() => {}));

    mockSearchParams.set('filePath', '/some/file.yml');
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText(/Loading\.\.\./)).toBeTruthy();
    });
  });

  it('shows error when auto-load fails', async () => {
    const ApiError = (await import('../../App')).ApiError;
    mockGetEditorFile.mockRejectedValue(
      new ApiError({ code: 'FILE_NOT_FOUND', message: 'File not found: /bad/file.yml', details: {}, recoverable: false })
    );

    mockSearchParams.set('filePath', '/bad/file.yml');
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText(/File not found/)).toBeTruthy();
    });
  });

  it('shows generic error on non-API failure', async () => {
    mockGetEditorFile.mockRejectedValue(new Error('Network error'));

    mockSearchParams.set('filePath', '/broken/file.yml');
    await renderEditor();

    await waitFor(() => {
      expect(screen.getByText('Failed to load editor data')).toBeTruthy();
    });
  });

  it('does not auto-load when filePath param is absent', async () => {
    // No filePath param set
    await renderEditor();

    // Wait briefly to ensure no API call was made
    await new Promise(r => setTimeout(r, 50));
    expect(mockGetEditorFile).not.toHaveBeenCalled();
  });

  it('does not auto-load twice (autoLoaded guard)', async () => {
    const editorData = makeEditorFileResponse();
    mockGetEditorFile.mockResolvedValue(editorData);

    mockSearchParams.set('filePath', '/first/file.yml');
    await renderEditor();

    await waitFor(() => {
      expect(mockGetEditorFile).toHaveBeenCalledTimes(1);
    });

    // Change the param — should NOT trigger another load (autoLoaded is true)
    mockSearchParams.set('filePath', '/second/file.yml');
    await new Promise(r => setTimeout(r, 50));
    expect(mockGetEditorFile).toHaveBeenCalledTimes(1);
  });
});
