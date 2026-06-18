import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

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

const mockGetExportOptions = vi.fn();
const mockCreateExportPackage = vi.fn();
const mockPreviewImport = vi.fn();
const mockApplyImport = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../App', () => ({
  api: {
    getExportOptions: (...args: unknown[]) => mockGetExportOptions(...args),
    createExportPackage: (...args: unknown[]) => mockCreateExportPackage(...args),
    previewImport: (...args: unknown[]) => mockPreviewImport(...args),
    applyImport: (...args: unknown[]) => mockApplyImport(...args),
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

function makeExportOptions() {
  return {
    rule_sets: [
      { id: 'rs-1', name: 'Stellaris Rules', description: 'Custom stellaris rules' },
      { id: 'rs-2', name: 'Generic Rules', description: '' },
    ],
    translation_profiles: [
      { id: 'p-1', name: 'EN to RU', description: 'English to Russian' },
      { id: 'p-2', name: 'EN to DE', description: '' },
      { id: 'p-3', name: 'EN to FR', description: 'English to French' },
    ],
    total: 5,
  };
}

function makeImportPreviewResponse(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        original_id: '',
        name: 'Stellaris Rules',
        kind: 'rule_set',
        action: 'create',
        diagnostics: [],
      },
      {
        original_id: '',
        name: 'EN to RU',
        kind: 'translation_profile',
        action: 'create',
        diagnostics: [],
      },
    ],
    total: 2,
    create_count: 2,
    skip_count: 0,
    overwrite_count: 0,
    import_as_copy_count: 0,
    warnings: [],
    errors: [],
    rule_set_id_map: {},
    ...overrides,
  };
}

function makeImportApplyResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    imported: 2,
    skipped: 0,
    overwritten: 0,
    imported_as_copy: 0,
    errors: [],
    warnings: [],
    rule_set_id_map: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

async function renderSection() {
  mockGetExportOptions.mockResolvedValue(makeExportOptions());
  const Section = (await import('../ImportExportSection')).default;
  return render(React.createElement(Section));
}

/* ------------------------------------------------------------------ */
/*  Tests: Export                                                      */
/* ------------------------------------------------------------------ */

describe('ImportExportSection - Export', () => {
  it('renders section heading', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Import / Export')).toBeTruthy();
    });
  });

  it('loads export options on mount', async () => {
    await renderSection();
    await waitFor(() => {
      expect(mockGetExportOptions).toHaveBeenCalled();
    });
  });

  it('displays rule set checkboxes', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Stellaris Rules')).toBeTruthy();
      expect(screen.getByText('Generic Rules')).toBeTruthy();
    });
  });

  it('displays profile checkboxes', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('EN to RU')).toBeTruthy();
      expect(screen.getByText('EN to DE')).toBeTruthy();
      expect(screen.getByText('EN to FR')).toBeTruthy();
    });
  });

  it('shows correct selection count', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getByText(/2 of 2 selected/)).toBeTruthy();
      expect(screen.getByText(/3 of 3 selected/)).toBeTruthy();
    });
  });

  it('has Select All and Clear buttons for rule sets', async () => {
    await renderSection();
    await waitFor(() => {
      const selectAllBtns = screen.getAllByText('Select All');
      expect(selectAllBtns.length).toBeGreaterThanOrEqual(1);
      const clearBtns = screen.getAllByText('Clear');
      expect(clearBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('has Export Selected button', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Export Selected')).toBeTruthy();
    });
  });

  it('calls createExportPackage on export click', async () => {
    mockCreateExportPackage.mockResolvedValue({
      schema: 'translator-app-transfer',
      version: 1,
      exported_at: '2026-06-04T00:00:00',
      app: 'Stellaris Translator',
      payload: { rule_sets: [], translation_profiles: [] },
    });

    // Mock URL.createObjectURL and URL.revokeObjectURL
    const mockCreateObjectURL = vi.fn(() => 'blob:test');
    const mockRevokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = mockCreateObjectURL;
    URL.revokeObjectURL = mockRevokeObjectURL;

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Export Selected')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export Selected'));

    await waitFor(() => {
      expect(mockCreateExportPackage).toHaveBeenCalledWith({
        rule_set_ids: ['rs-1', 'rs-2'],
        profile_ids: ['p-1', 'p-2', 'p-3'],
      });
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('shows warning on empty selection export', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getAllByText('Clear').length).toBeGreaterThanOrEqual(2);
    });

    // Click both Clear buttons to deselect all
    const clearBtns = screen.getAllByText('Clear');
    clearBtns.forEach(btn => fireEvent.click(btn));

    fireEvent.click(screen.getByText('Export Selected'));

    await waitFor(() => {
      expect(screen.getByText('Select at least one item to export.')).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Helper: simulate file upload                                       */
/* ------------------------------------------------------------------ */

function uploadFile(contents: string) {
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  if (!fileInput) throw new Error('File input not found');
  const file = new File([contents], 'export.json', { type: 'application/json' });

  // jsdom workaround: define property + dispatch change
  Object.defineProperty(fileInput, 'files', {
    value: [file],
    writable: false,
  });
  fireEvent.change(fileInput);
}

/* ------------------------------------------------------------------ */
/*  Tests: Import - Preview                                            */
/* ------------------------------------------------------------------ */

describe('ImportExportSection - Import Preview', () => {
  it('renders Import section with file input', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });
  });

  it('shows conflict policy dropdown after file loaded', async () => {
    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(JSON.stringify({
      schema: 'translator-app-transfer',
      version: 1,
      payload: { rule_sets: [], translation_profiles: [] },
    }));

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
      const select = document.querySelector('select');
      expect(select).not.toBeNull();
    });
  });

  it('selecting a valid JSON file enables preview button', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(JSON.stringify({
      schema: 'translator-app-transfer',
      version: 1,
      exported_at: '2026-06-04T00:00:00',
      app: 'Stellaris Translator',
      payload: { rule_sets: [], translation_profiles: [] },
    }));

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
      expect(screen.getByText('Preview Import')).toBeTruthy();
    });
  });

  it('Preview Import button calls previewImport API', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(JSON.stringify({
      schema: 'translator-app-transfer',
      version: 1,
      payload: { rule_sets: [], translation_profiles: [] },
    }));

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Preview Import'));

    await waitFor(() => {
      expect(mockPreviewImport).toHaveBeenCalled();
    });
  });

  it('preview shows summary bar with action counts', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse({
      total: 2,
      create_count: 2,
      skip_count: 0,
      overwrite_count: 0,
      import_as_copy_count: 0,
    }));

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(JSON.stringify({
      schema: 'translator-app-transfer',
      version: 1,
      payload: { rule_sets: [{ name: 'Test' }], translation_profiles: [{ name: 'Test Profile' }] },
    }));

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Preview Import'));

    await waitFor(() => {
      expect(screen.getByText(/2 items:/)).toBeTruthy();
      expect(screen.getByText(/2 create/)).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: Import - Apply                                              */
/* ------------------------------------------------------------------ */

describe('ImportExportSection - Import Apply', () => {
  const PAYLOAD = JSON.stringify({
    schema: 'translator-app-transfer',
    version: 1,
    payload: { rule_sets: [], translation_profiles: [] },
  });

  it('shows Proceed with Import button after preview', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(PAYLOAD);

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Preview Import'));

    await waitFor(() => {
      expect(screen.getByText('Proceed with Import')).toBeTruthy();
    });
  });

  it('calls applyImport on Proceed with Import', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());
    mockApplyImport.mockResolvedValue(makeImportApplyResponse());

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(PAYLOAD);

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
    });

    // Preview
    fireEvent.click(screen.getByText('Preview Import'));
    await waitFor(() => {
      expect(screen.getByText('Proceed with Import')).toBeTruthy();
    });

    // Apply
    fireEvent.click(screen.getByText('Proceed with Import'));

    await waitFor(() => {
      expect(mockApplyImport).toHaveBeenCalled();
    });
  });

  it('shows import summary after apply', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());
    mockApplyImport.mockResolvedValue(makeImportApplyResponse({
      imported: 2,
      skipped: 0,
      overwritten: 0,
      imported_as_copy: 0,
    }));

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(PAYLOAD);

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
    });

    // Preview then apply
    fireEvent.click(screen.getByText('Preview Import'));
    await waitFor(() => {
      expect(screen.getByText('Proceed with Import')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Proceed with Import'));

    await waitFor(() => {
      expect(screen.getByText('Import completed')).toBeTruthy();
      expect(screen.getByText(/2 imported/)).toBeTruthy();
    });
  });

  it('shows Done button after import', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());
    mockApplyImport.mockResolvedValue(makeImportApplyResponse());

    await renderSection();
    await waitFor(() => {
      expect(screen.getByText('Select Export File')).toBeTruthy();
    });

    uploadFile(PAYLOAD);

    await waitFor(() => {
      expect(screen.getByText(/File loaded/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Preview Import'));
    await waitFor(() => {
      expect(screen.getByText('Proceed with Import')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Proceed with Import'));

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Status message tests                                            */
  /* ---------------------------------------------------------------- */

  it('shows green "Import completed" when imported > 0, errors = 0', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());
    mockApplyImport.mockResolvedValue(makeImportApplyResponse({
      success: true,
      imported: 2,
      skipped: 0,
      overwritten: 0,
      imported_as_copy: 0,
      errors: [],
    }));

    await renderSection();
    await waitFor(() => expect(screen.getByText('Select Export File')).toBeTruthy());
    uploadFile(PAYLOAD);
    await waitFor(() => expect(screen.getByText(/File loaded/)).toBeTruthy());

    fireEvent.click(screen.getByText('Preview Import'));
    await waitFor(() => expect(screen.getByText('Proceed with Import')).toBeTruthy());
    fireEvent.click(screen.getByText('Proceed with Import'));

    await waitFor(() => {
      const msg = screen.getByText('Import completed');
      expect(msg).toBeTruthy();
      // Green color
      expect(msg.style.color).toBe('#50fa7b');
    });
  });

  it('shows green "Import completed: all items were skipped" when skipped=all, errors=0', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());
    mockApplyImport.mockResolvedValue(makeImportApplyResponse({
      success: false,
      imported: 0,
      skipped: 7,
      overwritten: 0,
      imported_as_copy: 0,
      errors: [],
    }));

    await renderSection();
    await waitFor(() => expect(screen.getByText('Select Export File')).toBeTruthy());
    uploadFile(PAYLOAD);
    await waitFor(() => expect(screen.getByText(/File loaded/)).toBeTruthy());

    fireEvent.click(screen.getByText('Preview Import'));
    await waitFor(() => expect(screen.getByText('Proceed with Import')).toBeTruthy());
    fireEvent.click(screen.getByText('Proceed with Import'));

    await waitFor(() => {
      const msg = screen.getByText('Import completed: all items were skipped');
      expect(msg).toBeTruthy();
      // Green, not red — skip-only is not an error
      expect(msg.style.color).toBe('#50fa7b');
    });
  });

  it('shows red "Import completed with errors" when errors > 0', async () => {
    mockPreviewImport.mockResolvedValue(makeImportPreviewResponse());
    mockApplyImport.mockResolvedValue(makeImportApplyResponse({
      success: false,
      imported: 0,
      skipped: 0,
      overwritten: 0,
      imported_as_copy: 0,
      errors: ['Failed to import rule set X: DB write error'],
    }));

    await renderSection();
    await waitFor(() => expect(screen.getByText('Select Export File')).toBeTruthy());
    uploadFile(PAYLOAD);
    await waitFor(() => expect(screen.getByText(/File loaded/)).toBeTruthy());

    fireEvent.click(screen.getByText('Preview Import'));
    await waitFor(() => expect(screen.getByText('Proceed with Import')).toBeTruthy());
    fireEvent.click(screen.getByText('Proceed with Import'));

    await waitFor(() => {
      const msg = screen.getByText('Import completed with errors');
      expect(msg).toBeTruthy();
      // Red color
      expect(msg.style.color).toBe('#ff5555');
    });
  });
});
