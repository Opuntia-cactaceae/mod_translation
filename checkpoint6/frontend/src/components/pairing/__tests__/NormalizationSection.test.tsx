/* ------------------------------------------------------------------ */
/*  Tests: NormalizationSection — embedded normalization controls       */
/*  in File View. Tests cover:                                         */
/*  - collapsible toggle                                               */
/*  - button adds correct operation type name                          */
/*  - preview renders normalized_content not JSON                      */
/*  - save toast says "settings saved"                                 */
/*  - warnings from unknown operations displayed                       */
/*  - Apply to File confirmation modal                                 */
/*  - hasUnsavedEdits blocks Apply and shows warning                   */
/*  - autoExpandKey auto-expands                                       */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import NormalizationSection from '../NormalizationSection';

/* ================================================================== */
/*  Mock api + toast                                                   */
/* ================================================================== */

const { mockGetAlignment, mockPreviewAlignment, mockSaveAlignment, mockApplyAlignment, mockShowToast } = vi.hoisted(() => ({
  mockGetAlignment: vi.fn(),
  mockPreviewAlignment: vi.fn(),
  mockSaveAlignment: vi.fn(),
  mockApplyAlignment: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('../../../App', () => {
  function MockApiError(message: string) {
    const err = new Error(message);
    err.name = 'ApiError';
    return err;
  }
  MockApiError.prototype = Object.create(Error.prototype);

  return {
    api: {
      getPairingAlignment: mockGetAlignment,
      previewPairingAlignment: mockPreviewAlignment,
      savePairingAlignment: mockSaveAlignment,
      applyPairingAlignment: mockApplyAlignment,
    },
    ApiError: MockApiError,
    useToast: () => ({ showToast: mockShowToast }),
  };
});

/* ================================================================== */
/*  Setup                                                              */
/* ================================================================== */

function renderSection(pairId: string | null = 'pair-abc', overrides: Record<string, any> = {}) {
  return render(
    <NormalizationSection
      projectId="proj-1"
      pairId={pairId}
      {...overrides}
    />,
  );
}

/** Expand the collapsible section so tests can interact with controls. */
function expandSection() {
  fireEvent.click(screen.getByText('Normalization Operations'));
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('NormalizationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAlignment.mockResolvedValue(null);
    mockPreviewAlignment.mockResolvedValue({
      pair_id: 'pair-abc',
      operations: [],
      source_preview: { normalized_content: 'norm src content', original_line_count: 3, normalized_line_count: 3 },
      translated_preview: { normalized_content: 'norm tgt content', original_line_count: 4, normalized_line_count: 3 },
      warnings: [],
    });
    mockSaveAlignment.mockResolvedValue({});
    mockApplyAlignment.mockResolvedValue({
      pair_id: 'pair-abc',
      source_applied: true,
      translated_applied: true,
      source_result: { file_id: 'src-1', file_name: 'source.txt', old_content_hash: 'abc', new_content_hash: 'def', old_line_count: 3, new_line_count: 3, line_count_changed: false, size_bytes: 100 },
      translated_result: { file_id: 'tgt-1', file_name: 'translated.txt', old_content_hash: 'ghi', new_content_hash: 'jkl', old_line_count: 4, new_line_count: 3, line_count_changed: true, size_bytes: 80 },
      operations_applied: [],
      warnings: [],
      last_applied_at: '2025-01-01T00:00:00Z',
    });
  });

  afterEach(() => {
    cleanup();
  });

  /* ---- Collapsible behavior ---- */

  it('shows collapsed toggle header by default', () => {
    renderSection();
    expect(screen.getByText('Normalization Operations')).toBeTruthy();
    // Body should not be visible
    expect(screen.queryByText('Operations (JSON)')).toBeNull();
  });

  it('expands body when toggle is clicked', () => {
    renderSection();
    expandSection();
    expect(screen.getByText('Operations (JSON)')).toBeTruthy();
    expect(screen.getByText('Preview Normalization')).toBeTruthy();
  });

  it('collapses body when toggle is clicked again', () => {
    renderSection();
    expandSection();
    expect(screen.getByText('Operations (JSON)')).toBeTruthy();
    fireEvent.click(screen.getByText('Normalization Operations'));
    expect(screen.queryByText('Operations (JSON)')).toBeNull();
  });

  it('auto-expands when autoExpandKey changes', () => {
    const { rerender } = renderSection('pair-abc', { autoExpandKey: 0 });
    // Initially collapsed
    expect(screen.queryByText('Operations (JSON)')).toBeNull();

    // Update autoExpandKey to a positive value
    rerender(
      <NormalizationSection
        projectId="proj-1"
        pairId="pair-abc"
        autoExpandKey={1}
      />,
    );

    // Should now be expanded
    expect(screen.getByText('Operations (JSON)')).toBeTruthy();
  });

  /* ---- No pair selected ---- */

  it('renders nothing when pairId is null', () => {
    const { container } = renderSection(null);
    expect(container.innerHTML).toBe('');
  });

  /* ---- Quick-add buttons ---- */

  it('adds trim_trailing_spaces when Trim trailing spaces button is clicked', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const parsed = JSON.parse(textarea.value);
    expect(parsed).toEqual([{ type: 'trim_trailing_spaces' }]);
  });

  it('adds normalize_line_endings when button is clicked', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Normalize line endings'));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const parsed = JSON.parse(textarea.value);
    expect(parsed).toEqual([{ type: 'normalize_line_endings' }]);
  });

  it('adds collapse_blank_lines with max:1 when button is clicked', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Collapse blank lines (max 1)'));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const parsed = JSON.parse(textarea.value);
    expect(parsed).toEqual([{ type: 'collapse_blank_lines', max: 1 }]);
  });

  it('adds normalize_indentation with size:4 when button is clicked', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Normalize indentation (4 spaces)'));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const parsed = JSON.parse(textarea.value);
    expect(parsed).toEqual([{ type: 'normalize_indentation', size: 4 }]);
  });

  /* ---- Preview ---- */

  it('preview renders normalized content from source_preview', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));
    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(mockPreviewAlignment).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('norm src content')).toBeTruthy();
    });
    expect(screen.getByText('norm tgt content')).toBeTruthy();
  });

  it('preview shows line count change: original → normalized', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));
    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(screen.getByText(/3.*→.*3.*lines/)).toBeTruthy();
    });
    expect(screen.getByText(/4.*→.*3.*lines/)).toBeTruthy();
  });

  it('preview does NOT show raw JSON for preview data', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));
    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(screen.queryByText('normalized_content')).toBeNull();
    });
  });

  /* ---- Save ---- */

  it('save shows toast "Normalization settings saved"', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockSaveAlignment).toHaveBeenCalledTimes(1);
    });
    expect(mockShowToast).toHaveBeenCalledWith('Normalization settings saved', 'success');
  });

  /* ---- Invalid JSON ---- */

  it('shows error toast for invalid operations JSON on preview', async () => {
    renderSection();
    expandSection();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'invalid json{' } });

    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Invalid operations JSON', 'error');
    });
  });

  it('shows error toast for invalid operations JSON on save', async () => {
    renderSection();
    expandSection();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'not json' } });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Invalid operations JSON', 'error');
    });
  });

  /* ---- Warnings ---- */

  it('displays warnings from preview response', async () => {
    mockPreviewAlignment.mockResolvedValue({
      pair_id: 'pair-abc',
      operations: [{ type: 'unknown_op' }],
      source_preview: { normalized_content: 'src', original_line_count: 1, normalized_line_count: 1 },
      translated_preview: { normalized_content: 'tgt', original_line_count: 1, normalized_line_count: 1 },
      warnings: ['Unknown normalization operation: "unknown_op"'],
    });

    renderSection();
    expandSection();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '[{"type": "unknown_op"}]' } });
    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(screen.getByText(/Unknown normalization operation/)).toBeTruthy();
    });
  });

  /* ---- onNormalizationSaved callback ---- */

  it('calls onNormalizationSaved when Save Settings succeeds', async () => {
    const onNormalizationSaved = vi.fn();
    renderSection('pair-abc', { onNormalizationSaved });

    expandSection();
    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockSaveAlignment).toHaveBeenCalledTimes(1);
    });
    expect(onNormalizationSaved).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onNormalizationSaved when save fails', async () => {
    mockSaveAlignment.mockRejectedValue(new Error('API error'));
    const onNormalizationSaved = vi.fn();
    renderSection('pair-abc', { onNormalizationSaved });

    expandSection();
    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockSaveAlignment).toHaveBeenCalledTimes(1);
    });
    expect(onNormalizationSaved).not.toHaveBeenCalled();
  });

  /* ---- Apply to File ---- */

  it('renders Apply to File button disabled when no preview exists', () => {
    renderSection();
    expandSection();
    const btn = screen.getByText('Apply to File') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  it('enables Apply to File button after preview succeeds', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));
    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(mockPreviewAlignment).toHaveBeenCalledTimes(1);
    });

    const btn = screen.getByText('Apply to File') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('opens confirmation modal when Apply to File is clicked', async () => {
    renderSection();
    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));
    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(mockPreviewAlignment).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText('Apply to File'));

    await waitFor(() => {
      expect(screen.getByText(/rewrite files on disk/)).toBeTruthy();
    });
    expect(screen.getByText('Source file')).toBeTruthy();
    expect(screen.getByText('Translated file')).toBeTruthy();
  });

  it('calls onNormalizationApplied when apply succeeds via modal', async () => {
    const onNormalizationApplied = vi.fn();
    renderSection('pair-abc', { onNormalizationApplied });

    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));
    fireEvent.click(screen.getByText('Preview Normalization'));
    await waitFor(() => {
      expect(mockPreviewAlignment).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText('Apply to File'));
    await waitFor(() => {
      expect(screen.getByText(/rewrite files on disk/)).toBeTruthy();
    });

    const applyBtns = screen.getAllByText('Apply to File');
    fireEvent.click(applyBtns[applyBtns.length - 1]);

    await waitFor(() => {
      expect(mockApplyAlignment).toHaveBeenCalledTimes(1);
    });
    expect(onNormalizationApplied).toHaveBeenCalledTimes(1);
  });

  /* ---- hasUnsavedEdits safety ---- */

  it('shows warning when hasUnsavedEdits is true', () => {
    renderSection('pair-abc', { hasUnsavedEdits: true });
    expandSection();
    expect(screen.getByText(/Save or revert file edits/)).toBeTruthy();
  });

  it('disables Apply to File when hasUnsavedEdits is true', async () => {
    renderSection('pair-abc', { hasUnsavedEdits: true });
    expandSection();
    fireEvent.click(screen.getByText('Trim trailing spaces'));
    fireEvent.click(screen.getByText('Preview Normalization'));

    await waitFor(() => {
      expect(mockPreviewAlignment).toHaveBeenCalledTimes(1);
    });

    const btn = screen.getByText('Apply to File') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('does not show warning when hasUnsavedEdits is false', () => {
    renderSection('pair-abc', { hasUnsavedEdits: false });
    expandSection();
    expect(screen.queryByText(/Save or revert file edits/)).toBeNull();
  });
});
