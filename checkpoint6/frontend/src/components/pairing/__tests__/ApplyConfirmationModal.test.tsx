/* ------------------------------------------------------------------ */
/*  Tests: ApplyConfirmationModal                                       */
/*  - renders checkboxes, line counts, danger warnings from preview     */
/*  - calls applyPairingAlignment on confirm                            */
/*  - shows success toast and fires onApplied callback                  */
/*  - handles API failure with error message                            */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import ApplyConfirmationModal from '../ApplyConfirmationModal';
import type { AlignmentPreviewResponse } from '../../../api/types';

/* ================================================================== */
/*  Mock api + toast                                                   */
/* ================================================================== */

const { mockApplyAlignment, mockShowToast } = vi.hoisted(() => ({
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
      applyPairingAlignment: mockApplyAlignment,
    },
    ApiError: MockApiError,
    useToast: () => ({ showToast: mockShowToast }),
  };
});

/* ================================================================== */
/*  Test data                                                          */
/* ================================================================== */

const BASE_PREVIEW: AlignmentPreviewResponse = {
  pair_id: 'pair-abc',
  operations: [{ type: 'trim_trailing_spaces' }],
  source_preview: {
    normalized_content: 'src norm content',
    original_line_count: 10,
    normalized_line_count: 10,
  },
  translated_preview: {
    normalized_content: 'tgt norm content',
    original_line_count: 15,
    normalized_line_count: 14,
  },
  warnings: [],
};

const PREVIEW_WITH_DANGEROUS_OPS: AlignmentPreviewResponse = {
  ...BASE_PREVIEW,
  operations: [
    { type: 'trim_trailing_spaces' },
    { type: 'collapse_blank_lines', max: 1 },
    { type: 'normalize_indentation', size: 4 },
  ],
};

const PREVIEW_WITH_MISSING_SIDE: AlignmentPreviewResponse = {
  ...BASE_PREVIEW,
  translated_preview: null,
};

/* ================================================================== */
/*  Setup                                                              */
/* ================================================================== */

const defaultProps = {
  projectId: 'proj-1',
  pairId: 'pair-abc',
  onClose: vi.fn(),
  onApplied: vi.fn(),
};

function renderModal(preview: AlignmentPreviewResponse = BASE_PREVIEW, props: Record<string, unknown> = {}) {
  return render(
    <ApplyConfirmationModal
      {...defaultProps}
      previewResult={preview}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('ApplyConfirmationModal', () => {
  /* ---- Render structure ---- */

  it('renders danger warning about rewriting files', () => {
    renderModal();
    expect(screen.getByText(/rewrite files on disk/)).toBeTruthy();
  });

  it('renders source and translated checkboxes with line counts', () => {
    renderModal();
    expect(screen.getByText('Source file')).toBeTruthy();
    expect(screen.getByText('Translated file')).toBeTruthy();
    expect(screen.getByText(/10.*→.*10.*lines/)).toBeTruthy();
    expect(screen.getByText(/15.*→.*14.*lines/)).toBeTruthy();
  });

  it('renders Cancel and Apply to File buttons', () => {
    renderModal();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Apply to File')).toBeTruthy();
  });

  /* ---- Checkbox interaction ---- */

  it('both checkboxes are checked by default', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
  });

  it('checkbox is disabled when its side has no data', () => {
    renderModal(PREVIEW_WITH_MISSING_SIDE);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].disabled).toBe(false); // source has data
    expect(checkboxes[1].disabled).toBe(true); // translated has no data
  });

  /* ---- Dangerous operation warnings ---- */

  it('shows dangerous ops warning when collapse_blank_lines present', () => {
    renderModal(PREVIEW_WITH_DANGEROUS_OPS);
    expect(screen.getByText(/Dangerous operations detected/)).toBeTruthy();
    expect(screen.getByText(/Collapse blank lines/)).toBeTruthy();
    expect(screen.getByText(/Normalize indentation/)).toBeTruthy();
  });

  it('does NOT show dangerous ops warning for safe operations only', () => {
    renderModal(BASE_PREVIEW);
    expect(screen.queryByText(/Dangerous operations detected/)).toBeNull();
  });

  /* ---- Line count change warning ---- */

  it('shows line count change warning when line counts differ', () => {
    renderModal();
    expect(screen.getByText(/Line counts will change/)).toBeTruthy();
  });

  it('hides line count change warning when line counts match', () => {
    const sameLinePreview: AlignmentPreviewResponse = {
      ...BASE_PREVIEW,
      source_preview: {
        normalized_content: 'src',
        original_line_count: 10,
        normalized_line_count: 10,
      },
      translated_preview: {
        normalized_content: 'tgt',
        original_line_count: 15,
        normalized_line_count: 15,
      },
    };
    renderModal(sameLinePreview);
    expect(screen.queryByText(/Line counts will change/)).toBeNull();
  });

  /* ---- Apply action ---- */

  it('calls applyPairingAlignment on confirm with default checkboxes', async () => {
    mockApplyAlignment.mockResolvedValue({
      pair_id: 'pair-abc',
      source_applied: true,
      translated_applied: true,
      source_result: { file_id: 'src-1', file_name: 's.txt', old_content_hash: 'a', new_content_hash: 'b', old_line_count: 10, new_line_count: 10, line_count_changed: false, size_bytes: 100 },
      translated_result: { file_id: 'tgt-1', file_name: 't.txt', old_content_hash: 'c', new_content_hash: 'd', old_line_count: 15, new_line_count: 14, line_count_changed: true, size_bytes: 80 },
      operations_applied: [],
      warnings: [],
      last_applied_at: '2025-01-01T00:00:00Z',
    });

    renderModal();
    fireEvent.click(screen.getByText('Apply to File'));

    await waitFor(() => {
      expect(mockApplyAlignment).toHaveBeenCalledTimes(1);
    });
    expect(mockApplyAlignment).toHaveBeenCalledWith('proj-1', 'pair-abc', {
      apply_source: true,
      apply_translated: true,
      expected_source_hash: null,
      expected_translated_hash: null,
    });
  });

  it('passes unchecked flags when user unchecks a checkbox', async () => {
    mockApplyAlignment.mockResolvedValue({
      pair_id: 'pair-abc',
      source_applied: true,
      translated_applied: false,
      source_result: { file_id: 'src-1', file_name: 's.txt', old_content_hash: 'a', new_content_hash: 'b', old_line_count: 10, new_line_count: 10, line_count_changed: false, size_bytes: 100 },
      operations_applied: [],
      warnings: [],
      last_applied_at: '2025-01-01T00:00:00Z',
    });

    renderModal();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // uncheck translated

    fireEvent.click(screen.getByText('Apply to File'));

    await waitFor(() => {
      expect(mockApplyAlignment).toHaveBeenCalledTimes(1);
    });
    expect(mockApplyAlignment).toHaveBeenCalledWith('proj-1', 'pair-abc', {
      apply_source: true,
      apply_translated: false,
      expected_source_hash: null,
      expected_translated_hash: null,
    });
  });

  it('disables Apply button when both checkboxes are unchecked', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[0]); // uncheck source
    fireEvent.click(checkboxes[1]); // uncheck translated

    const btn = screen.getByText('Apply to File') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(mockApplyAlignment).not.toHaveBeenCalled();
  });

  /* ---- Success / error behavior ---- */

  it('shows success toast after apply succeeds', async () => {
    mockApplyAlignment.mockResolvedValue({
      pair_id: 'pair-abc',
      source_applied: true,
      translated_applied: true,
      source_result: { file_id: 'src-1', file_name: 's.txt', old_content_hash: 'a', new_content_hash: 'b', old_line_count: 10, new_line_count: 10, line_count_changed: false, size_bytes: 100 },
      translated_result: { file_id: 'tgt-1', file_name: 't.txt', old_content_hash: 'c', new_content_hash: 'd', old_line_count: 15, new_line_count: 14, line_count_changed: true, size_bytes: 80 },
      operations_applied: [],
      warnings: [],
      last_applied_at: '2025-01-01T00:00:00Z',
    });

    renderModal();
    fireEvent.click(screen.getByText('Apply to File'));

    await waitFor(() => {
      expect(mockApplyAlignment).toHaveBeenCalledTimes(1);
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('Normalization applied to'),
      'success',
    );
  });

  it('calls onApplied callback after apply succeeds', async () => {
    const onApplied = vi.fn();
    const applyResult = {
      pair_id: 'pair-abc',
      source_applied: true,
      translated_applied: true,
      source_result: { file_id: 'src-1', file_name: 's.txt', old_content_hash: 'a', new_content_hash: 'b', old_line_count: 10, new_line_count: 10, line_count_changed: false, size_bytes: 100 },
      translated_result: { file_id: 'tgt-1', file_name: 't.txt', old_content_hash: 'c', new_content_hash: 'd', old_line_count: 15, new_line_count: 14, line_count_changed: true, size_bytes: 80 },
      operations_applied: [],
      warnings: [],
      last_applied_at: '2025-01-01T00:00:00Z',
    };
    mockApplyAlignment.mockResolvedValue(applyResult);

    renderModal(BASE_PREVIEW, { onApplied });

    fireEvent.click(screen.getByText('Apply to File'));

    await waitFor(() => {
      expect(mockApplyAlignment).toHaveBeenCalledTimes(1);
    });
    expect(onApplied).toHaveBeenCalledWith(applyResult);
  });

  it('shows error and toast on API failure', async () => {
    mockApplyAlignment.mockRejectedValue(new Error('File has changed since preview'));

    renderModal();
    fireEvent.click(screen.getByText('Apply to File'));

    await waitFor(() => {
      expect(screen.getByText('Failed to apply normalization')).toBeTruthy();
    });
    expect(mockShowToast).toHaveBeenCalledWith('Failed to apply normalization', 'error');
  });

  it('shows Apply to File button disabled during loading', async () => {
    // Never resolve so loading stays true
    mockApplyAlignment.mockImplementation(() => new Promise(() => {}));

    renderModal();
    fireEvent.click(screen.getByText('Apply to File'));

    await waitFor(() => {
      expect(screen.getByText('Applying...')).toBeTruthy();
    });
    expect((screen.getByText('Applying...') as HTMLButtonElement).disabled).toBe(true);
  });

  /* ---- Close ---- */

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal(BASE_PREVIEW, { onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
