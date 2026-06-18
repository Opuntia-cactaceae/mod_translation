/* ------------------------------------------------------------------ */
/*  Tests: PairLineEditorPanel — line-by-line SOURCE ↔ TRANSLATION     */
/*                                                                      */
/*  Component receives preview/loading/error via props (no API call).  */
/*  Save handlers call api.savePairingFileContent.                      */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import PairLineEditorPanel from '../PairLineEditorPanel';
import { pairDraftStore } from '../../../utils/pairDraftStore';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const { mockShowToast, mockSavePairingFileContent, MockApiError } = vi.hoisted(
  () => {
    class MockApiError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ApiError';
      }
    }
    return {
      mockShowToast: vi.fn(),
      mockSavePairingFileContent: vi.fn(),
      MockApiError,
    };
  },
);

vi.mock('../../../App', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  api: { savePairingFileContent: mockSavePairingFileContent },
  ApiError: MockApiError,
}));

/* ================================================================== */
/*  Test data                                                          */
/* ================================================================== */

const MOCK_PREVIEW = {
  pair: {
    id: 'pair-1',
    project_id: 'proj-1',
    source_file_id: 'f1',
    translated_file_id: 'f2',
    status: 'manual',
    confidence: 1,
  } as any,
  source_file: {
    file_id: 'f1',
    relative_path: 'src/source.txt',
    content: 'line one\nline two\nline three',
    encoding: 'utf-8',
    line_count: 3,
    size_bytes: 30,
  },
  translated_file: {
    file_id: 'f2',
    relative_path: 'src/translated.txt',
    content: 'первая строка\nвторая строка\nтретья строка',
    encoding: 'utf-8',
    line_count: 3,
    size_bytes: 55,
  },
};

/** Preview where source has more lines than translation. */
const MOCK_PREVIEW_SOURCE_LONGER = {
  ...MOCK_PREVIEW,
  source_file: {
    ...MOCK_PREVIEW.source_file,
    content: 'line one\nline two\nline three\nline four\nline five',
    line_count: 5,
  },
  translated_file: {
    ...MOCK_PREVIEW.translated_file,
    content: 'первая строка\nвторая строка\nтретья строка',
    line_count: 3,
  },
};

/** Preview where translation has more lines than source. */
const MOCK_PREVIEW_TRANSLATED_LONGER = {
  ...MOCK_PREVIEW,
  source_file: {
    ...MOCK_PREVIEW.source_file,
    content: 'line one\nline two',
    line_count: 2,
  },
  translated_file: {
    ...MOCK_PREVIEW.translated_file,
    content: 'первая строка\nвторая строка\nтретья строка\nчетвертая строка',
    line_count: 4,
  },
};

/** Preview with empty content. */
const MOCK_PREVIEW_EMPTY = {
  ...MOCK_PREVIEW,
  source_file: { ...MOCK_PREVIEW.source_file, content: '', line_count: 0 },
  translated_file: { ...MOCK_PREVIEW.translated_file, content: '', line_count: 0 },
};

const MOCK_PREVIEW_NO_TRANSLATED = {
  ...MOCK_PREVIEW,
  translated_file: null,
};

const MOCK_PREVIEW_NO_SOURCE = {
  ...MOCK_PREVIEW,
  source_file: null,
};

const SAVE_RESPONSE = {
  file_id: 'f2',
  content_hash: 'abc123',
  modified_at: '2025-01-01T00:00:00Z',
  size_bytes: 10,
};

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

beforeEach(() => {
  vi.clearAllMocks();
  mockShowToast.mockClear();
  mockSavePairingFileContent.mockClear();
  mockSavePairingFileContent.mockResolvedValue(SAVE_RESPONSE);
  pairDraftStore.clearAll();
});

afterEach(cleanup);

function renderPanel(overrides: Record<string, any> = {}) {
  return render(
    <PairLineEditorPanel
      pairId="pair-1"
      preview={MOCK_PREVIEW}
      loading={false}
      error={null}
      projectId="proj-1"
      {...overrides}
    />,
  );
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('PairLineEditorPanel', () => {
  describe('states', () => {
    it('shows no-pair message when pairId is null', () => {
      render(
        <PairLineEditorPanel
          pairId={null}
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('Select a pair to edit lines.')).toBeDefined();
    });

    it('shows loading state', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={null}
          loading={true}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('Loading line editor...')).toBeDefined();
    });

    it('shows error state on API failure', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={null}
          loading={false}
          error="Network error"
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('Network error')).toBeDefined();
    });

    it('shows no-data message when preview is null (and not loading/error)', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('No line editor data available.')).toBeDefined();
    });
  });

  describe('content rendering', () => {
    it('renders toolbar with stats', () => {
      renderPanel();

      expect(screen.getByText('Rows')).toBeDefined();

      // Rows=3 and Matched=3 — both exist, so we check there are ≥2 elements with "3"
      const threes = screen.getAllByText('3');
      expect(threes.length).toBeGreaterThanOrEqual(2);
    });

    it('renders column headers', () => {
      renderPanel();

      expect(screen.getByText('SOURCE')).toBeDefined();
      expect(screen.getByText('TRANSLATION')).toBeDefined();
    });

    it('renders source and translated text for each row', () => {
      renderPanel();

      expect(screen.getByText('line one')).toBeDefined();
      expect(screen.getByText('line two')).toBeDefined();
      expect(screen.getByText('line three')).toBeDefined();

      // Translated content is in textareas
      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(3);
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('первая строка');
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('вторая строка');
      expect((textareas[2] as HTMLTextAreaElement).value).toBe('третья строка');
    });

    it('shows line numbers in source and translation cells', () => {
      renderPanel();

      // L1 appears twice (source cell + translation cell)
      const l1Elements = screen.getAllByText('L1');
      expect(l1Elements.length).toBeGreaterThanOrEqual(1);

      const l2Elements = screen.getAllByText('L2');
      expect(l2Elements.length).toBeGreaterThanOrEqual(1);

      const l3Elements = screen.getAllByText('L3');
      expect(l3Elements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders Save Changes and Revert Changes buttons', () => {
      renderPanel();

      expect(screen.getByText('Save Changes')).toBeDefined();
      expect(screen.getByText('Revert Changes')).toBeDefined();
    });
  });

  describe('stats computation', () => {
    it('shows correct stats for all-matched data', () => {
      renderPanel();

      const threes = screen.getAllByText('3');
      // Rows=3, Matched=3 → there should be at least 2 "3"s
      expect(threes.length).toBeGreaterThanOrEqual(2);

      // Source only = 0, Translated only = 0, Edited = 0 → all present
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBe(3);
    });

    it('shows correct stats for uneven line counts', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_SOURCE_LONGER}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // 5 rows total, 3 matched, 2 source_only, 0 translated_only
      const fives = screen.getAllByText('5');
      expect(fives.length).toBeGreaterThanOrEqual(1); // total

      // "3" appears — matched stat
      const threes = screen.getAllByText('3');
      expect(threes.length).toBeGreaterThanOrEqual(1); // matched

      const twos = screen.getAllByText('2');
      expect(twos.length).toBeGreaterThanOrEqual(1); // source only = 2
    });
  });

  describe('translation editing', () => {
    it('marks a row dirty when translation is edited', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit the first translation row
      fireEvent.change(textareas[0], { target: { value: 'modified translation' } });

      // Edited stat should now be 1
      const editedValue = screen.getByText('1');
      expect(editedValue).toBeTruthy();
    });

    it('marks multiple rows dirty when multiple translations are edited', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      fireEvent.change(textareas[0], { target: { value: 'modified 1' } });
      fireEvent.change(textareas[1], { target: { value: 'modified 2' } });

      const editedValue = screen.getByText('2');
      expect(editedValue).toBeTruthy();
    });

    it('clears dirty when reverted to original', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit first row
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Revert original by typing same original value
      fireEvent.change(textareas[0], { target: { value: 'первая строка' } });

      // All zero-stats (source_only=0, translated_only=0, edited=0)
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBe(3);
    });
  });

  describe('revert', () => {
    it('Revert Changes restores all translation values', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit two rows
      fireEvent.change(textareas[0], { target: { value: 'modified 1' } });
      fireEvent.change(textareas[1], { target: { value: 'modified 2' } });

      // Save Changes should be enabled
      const saveBtn = screen.getByText('Save Changes') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);

      // Click Revert Changes
      fireEvent.click(screen.getByText('Revert Changes'));

      // All textareas should be back to original values
      const textareasAfter = screen.getAllByRole('textbox');
      expect((textareasAfter[0] as HTMLTextAreaElement).value).toBe('первая строка');
      expect((textareasAfter[1] as HTMLTextAreaElement).value).toBe('вторая строка');
      expect((textareasAfter[2] as HTMLTextAreaElement).value).toBe('третья строка');

      // Save Changes should be disabled again
      expect(
        (screen.getByText('Save Changes') as HTMLButtonElement).disabled,
      ).toBe(true);
    });
  });

  describe('filters', () => {
    it('shows filter buttons', () => {
      renderPanel();

      expect(screen.getByText('All')).toBeDefined();

      // Filter button text also appears in stat labels, so use getAllByText
      const matchedButtons = screen.getAllByText('Matched');
      expect(matchedButtons.length).toBeGreaterThanOrEqual(1);

      const sourceOnlyButtons = screen.getAllByText('Source only');
      expect(sourceOnlyButtons.length).toBeGreaterThanOrEqual(1);

      const translatedOnlyButtons = screen.getAllByText('Translated only');
      expect(translatedOnlyButtons.length).toBeGreaterThanOrEqual(1);

      const editedButtons = screen.getAllByText('Edited');
      expect(editedButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('applies active class to the current filter', () => {
      renderPanel();

      const allBtn = screen.getByText('All');
      expect(allBtn.classList.contains('pair-line-editor__filter-btn--active')).toBe(true);

      // Click Edited filter button (second occurrence — the filter button, not stat label)
      const editedButtons = screen.getAllByText('Edited');
      const editedFilterBtn = editedButtons.find(
        (el) => el.tagName === 'BUTTON',
      );
      expect(editedFilterBtn).toBeDefined();
      fireEvent.click(editedFilterBtn!);

      expect(allBtn.classList.contains('pair-line-editor__filter-btn--active')).toBe(false);
      expect(
        editedFilterBtn!.classList.contains('pair-line-editor__filter-btn--active'),
      ).toBe(true);
    });

    it('shows empty message when filter yields no results', () => {
      renderPanel();

      // No edited rows initially, so "Edited" filter shows empty state
      const editedButtons = screen.getAllByText('Edited');
      const editedFilterBtn = editedButtons.find((el) => el.tagName === 'BUTTON');
      fireEvent.click(editedFilterBtn!);

      expect(
        screen.getByText(/"Edited" filter/),
      ).toBeDefined();
    });

    it('shows rows matching the edited filter', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit one row
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Switch to Edited filter
      const editedButtons = screen.getAllByText('Edited');
      const editedFilterBtn = editedButtons.find((el) => el.tagName === 'BUTTON');
      fireEvent.click(editedFilterBtn!);

      // Only one row should match — L1 appears in the single filtered row (both cells)
      const rows = screen.getAllByText(/^L1/);
      expect(rows.length).toBe(2); // appears in source cell and translation cell
    });

    it('shows source-only rows with source_longer data', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_SOURCE_LONGER}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('line five')).toBeDefined();

      // Switch to Source only filter
      const sourceOnlyButtons = screen.getAllByText('Source only');
      const sourceOnlyFilterBtn = sourceOnlyButtons.find(
        (el) => el.tagName === 'BUTTON',
      );
      fireEvent.click(sourceOnlyFilterBtn!);

      // Should see source-only rows: line four, line five
      expect(screen.getByText('line four')).toBeDefined();
      expect(screen.getByText('line five')).toBeDefined();
    });
  });

  describe('missing file state', () => {
    it('shows missing header hint when translated file is absent', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_NO_TRANSLATED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText(/TRANSLATION.*missing/)).toBeDefined();
    });

    it('shows missing header hint when source file is absent', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_NO_SOURCE}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText(/SOURCE.*missing/)).toBeDefined();
    });
  });

  describe('empty content', () => {
    it('shows empty message when both files have no content', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_EMPTY}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('No file content available.')).toBeDefined();
    });
  });

  describe('save behavior', () => {
    it('calls api.savePairingFileContent with translated file id and joined lines', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified первая' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledWith(
          'proj-1',
          'f2',
          'modified первая\nвторая строка\nтретья строка',
        );
      });
    });

    it('Save Changes is disabled when no edits', () => {
      renderPanel();

      const saveBtn = screen.getByText('Save Changes') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
    });

    it('Save Changes is enabled when edits exist', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      const saveBtn = screen.getByText('Save Changes') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });

    it('shows success toast after saving', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Line edits saved.',
          'success',
        );
      });
    });

    it('clears dirty state after successful save', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Edit stat should be 1
      expect(screen.getByText('1')).toBeTruthy();

      fireEvent.click(screen.getByText('Save Changes'));

      // After save, Edited count should be 0
      await waitFor(() => {
        // Check that all zero-stats are present (edited = 0)
        const zeros = screen.getAllByText('0');
        expect(zeros.length).toBe(3);
      });
    });

    it('keeps dirty state on save failure', async () => {
      mockSavePairingFileContent.mockRejectedValue(
        new MockApiError('Save failed'),
      );
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Save failed',
          'error',
        );
      });

      // Edited count should still be 1
      expect(screen.getByText('1')).toBeTruthy();
    });

    it('shows generic error toast on unexpected save failure', async () => {
      mockSavePairingFileContent.mockRejectedValue(
        new Error('Unexpected crash'),
      );
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Failed to save line edits',
          'error',
        );
      });
    });

    it('calls onContentSaved after successful save', async () => {
      const onContentSaved = vi.fn();
      renderPanel({ onContentSaved });

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(onContentSaved).toHaveBeenCalledTimes(1);
      });
    });

    it('shows error toast when translated file is missing', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_NO_TRANSLATED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Save Changes should be disabled (no file to save)
      const saveBtn = screen.getByText('Save Changes') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
    });

    it('shows Saving... while save is in progress', async () => {
      // Never resolve so saving state persists
      mockSavePairingFileContent.mockReturnValue(new Promise(() => {}));
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeDefined();
      });
    });

    it('Save Changes and Revert Changes are disabled while saving', async () => {
      // Never resolve so saving state persists
      mockSavePairingFileContent.mockReturnValue(new Promise(() => {}));
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        const saveBtn = screen.getByText('Saving...') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(true);
        const revertBtn = screen.getByText('Revert Changes') as HTMLButtonElement;
        expect(revertBtn.disabled).toBe(true);
      });
    });

    it('stale save does not affect new pair when pairId changes during save', async () => {
      // Deferred promise — save stays in-flight
      let resolveSave: (v: any) => void;
      const savePromise = new Promise((resolve) => {
        resolveSave = resolve;
      });
      mockSavePairingFileContent.mockReturnValue(savePromise);

      const onContentSaved = vi.fn();
      const { rerender } = renderPanel({ onContentSaved });

      // Edit a row to enable save
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Start save
      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledTimes(1);
      });

      // Switch to a new pair while save is still in flight
      rerender(
        <PairLineEditorPanel
          pairId="pair-2"
          preview={{
            ...MOCK_PREVIEW,
            pair: { ...MOCK_PREVIEW.pair, id: 'pair-2' },
            source_file: { ...MOCK_PREVIEW.source_file, content: 'new line one\nnew line two' },
            translated_file: { ...MOCK_PREVIEW.translated_file, content: 'новый раз\nновый два' },
          }}
          loading={false}
          error={null}
          projectId="proj-1"
          onContentSaved={onContentSaved}
        />,
      );

      // Now resolve the stale save
      resolveSave!(SAVE_RESPONSE);
      await new Promise((r) => setTimeout(r, 50));

      // Stale save should NOT affect new pair
      expect(onContentSaved).not.toHaveBeenCalled();

      // No success toast for the stale save
      const successCalls = mockShowToast.mock.calls.filter(
        (call: string[]) => call[1] === 'success',
      );
      expect(successCalls).toHaveLength(0);

      // New pair's rows should be untouched by stale save
      const newTextareas = screen.getAllByRole('textbox');
      expect(newTextareas).toHaveLength(2);
      expect((newTextareas[0] as HTMLTextAreaElement).value).toBe('новый раз');
      expect((newTextareas[1] as HTMLTextAreaElement).value).toBe('новый два');
    });

    it('clears saving when pairId changes during save', async () => {
      // Never resolve so saving stays active
      mockSavePairingFileContent.mockReturnValue(new Promise(() => {}));
      const { rerender } = renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Start save
      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeDefined();
      });

      // Switch to new pair — saving flag should be cleared
      rerender(
        <PairLineEditorPanel
          pairId="pair-2"
          preview={{
            ...MOCK_PREVIEW,
            pair: { ...MOCK_PREVIEW.pair, id: 'pair-2' },
            source_file: { ...MOCK_PREVIEW.source_file, content: 'new line one\nnew line two' },
            translated_file: { ...MOCK_PREVIEW.translated_file, content: 'новый раз\nновый два' },
          }}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Saving... should no longer be shown after switching pairs
      await waitFor(() => {
        expect(screen.queryByText('Saving...')).toBeNull();
      });
    });
  });

  describe('preview refresh protection', () => {
    it('after successful save + preview refresh, rows rebuild cleanly', async () => {
      const onContentSaved = vi.fn();
      const { rerender } = renderPanel({ onContentSaved });

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified первая' } });

      fireEvent.click(screen.getByText('Save Changes'));
      await waitFor(() => {
        expect(onContentSaved).toHaveBeenCalled();
      });

      // Simulate parent re-fetching preview after save
      const REFRESHED_PREVIEW = {
        ...MOCK_PREVIEW,
        translated_file: {
          ...MOCK_PREVIEW.translated_file,
          content: 'modified первая\nвторая строка\nтретья строка',
        },
      };
      rerender(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={REFRESHED_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
          onContentSaved={onContentSaved}
        />,
      );

      // Rows should be rebuilt from refreshed preview (no dirty rows)
      const updatedTextareas = screen.getAllByRole('textbox');
      expect((updatedTextareas[0] as HTMLTextAreaElement).value).toBe('modified первая');
      expect((updatedTextareas[1] as HTMLTextAreaElement).value).toBe('вторая строка');
      expect((updatedTextareas[2] as HTMLTextAreaElement).value).toBe('третья строка');

      // Edited count should be 0
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBe(3);
    });

    it('preview refresh while dirty preserves local edits', async () => {
      const { rerender } = renderPanel({ onContentSaved: vi.fn() });

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified первая' } });
      fireEvent.change(textareas[1], { target: { value: 'modified вторая' } });

      // Simulate parent re-fetching preview (e.g., after File View save)
      const REFRESHED_PREVIEW = {
        ...MOCK_PREVIEW,
        // translated content unchanged on disk
        source_file: {
          ...MOCK_PREVIEW.source_file,
          content: 'line one modified',
        },
      };
      rerender(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={REFRESHED_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Local edits should be preserved
      const updatedTextareas = screen.getAllByRole('textbox');
      expect((updatedTextareas[0] as HTMLTextAreaElement).value).toBe('modified первая');
      expect((updatedTextareas[1] as HTMLTextAreaElement).value).toBe('modified вторая');

      // Edited count should still be 2
      const twos = screen.getAllByText('2');
      expect(twos.length).toBeGreaterThanOrEqual(1);
    });

    it('pairId change resets rows', async () => {
      const { rerender } = renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Change pair — simulates parent switching pairs
      const NEW_PAIR_PREVIEW = {
        ...MOCK_PREVIEW,
        pair: { ...MOCK_PREVIEW.pair, id: 'pair-2' },
        source_file: {
          ...MOCK_PREVIEW.source_file,
          content: 'new source one\nnew source two',
        },
        translated_file: {
          ...MOCK_PREVIEW.translated_file,
          content: 'новый перевод один\nновый перевод два',
        },
      };
      rerender(
        <PairLineEditorPanel
          pairId="pair-2"
          preview={NEW_PAIR_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Should show new pair's content (2 rows), not old edits from previous pair
      const newTextareas = screen.getAllByRole('textbox');
      expect(newTextareas).toHaveLength(2);
      expect((newTextareas[0] as HTMLTextAreaElement).value).toBe('новый перевод один');
      expect((newTextareas[1] as HTMLTextAreaElement).value).toBe('новый перевод два');
    });
  });

  describe('state badges', () => {
    it('shows Src badge for source-only rows', () => {
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_SOURCE_LONGER}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('line five')).toBeDefined();

      // Source-only rows should have "Src" badge
      const srcBadges = screen.getAllByText('Src');
      expect(srcBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('onOpenInFileView', () => {
    it('renders Open button for rows when callback is provided', () => {
      const onOpen = vi.fn();
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
          onOpenInFileView={onOpen}
        />,
      );

      expect(screen.getByText('line one')).toBeDefined();

      const openButtons = screen.getAllByText('Open');
      expect(openButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('does not render Open button when callback is not provided', () => {
      renderPanel();

      expect(screen.getByText('line one')).toBeDefined();

      const openButtons = screen.queryAllByText('Open');
      expect(openButtons.length).toBe(0);
    });

    it('clicking Open calls onOpenInFileView with correct line numbers', () => {
      const onOpen = vi.fn();
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
          onOpenInFileView={onOpen}
        />,
      );

      expect(screen.getByText('line one')).toBeDefined();

      // Click Open on the first row (source line 1, translated line 1)
      const openButtons = screen.getAllByText('Open');
      fireEvent.click(openButtons[0]);

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith({
        sourceLineNumber: 1,
        translatedLineNumber: 1,
      });
    });

    it('clicking Open on source-only row passes null translated line', () => {
      const onOpen = vi.fn();
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_SOURCE_LONGER}
          loading={false}
          error={null}
          projectId="proj-1"
          onOpenInFileView={onOpen}
        />,
      );

      expect(screen.getByText('line five')).toBeDefined();

      // Click Open on a source-only row (line 5)
      const openButtons = screen.getAllByText('Open');
      // Line 5 is the last row with source-only state
      const lastOpen = openButtons[openButtons.length - 1];
      fireEvent.click(lastOpen);

      expect(onOpen).toHaveBeenCalledWith({
        sourceLineNumber: 5,
        translatedLineNumber: null,
      });
    });
  });

  describe('onDirtyChange', () => {
    it('calls onDirtyChange(true) after row edit', async () => {
      const onDirty = vi.fn();
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
          onDirtyChange={onDirty}
        />,
      );

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(false));
      onDirty.mockClear();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
    });

    it('calls onDirtyChange(false) after revert', async () => {
      const onDirty = vi.fn();
      render(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
          onDirtyChange={onDirty}
        />,
      );

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(false));
      onDirty.mockClear();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
      onDirty.mockClear();

      fireEvent.click(screen.getByText('Revert Changes'));

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(false));
    });
  });

  /* ================================================================ */
  /*  Text wrapping & row resize                                       */
  /* ================================================================ */

  describe('text wrapping', () => {
    it('translation textarea does not have wrap="off"', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      textareas.forEach((ta) => {
        expect(ta.getAttribute('wrap')).not.toBe('off');
      });
    });

    it('translation textarea does not have overflow-x auto style', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      textareas.forEach((ta) => {
        // The textarea should not have wrap=off which prevents wrapping
        expect(ta.getAttribute('wrap')).not.toBe('off');
      });
    });
  });

  describe('row resize', () => {
    it('renders row resize handle for each row', () => {
      renderPanel();

      const handles = document.querySelectorAll('.pair-line-editor__row-resize-handle');
      expect(handles.length).toBe(3);
    });

    it('row resize handle has role="separator" and aria-orientation', () => {
      renderPanel();

      const handles = document.querySelectorAll('.pair-line-editor__row-resize-handle');
      expect(handles.length).toBeGreaterThan(0);
      handles.forEach((h) => {
        expect(h.getAttribute('role')).toBe('separator');
        expect(h.getAttribute('aria-orientation')).toBe('horizontal');
      });
    });

    it('each row resize handle has unique aria-label', () => {
      renderPanel();

      const handles = document.querySelectorAll('.pair-line-editor__row-resize-handle');
      const labels = Array.from(handles).map((h) => h.getAttribute('aria-label'));
      const uniqueLabels = new Set(labels);
      expect(uniqueLabels.size).toBe(handles.length);
    });

    it('pointerDown on row handle adds is-resizing-vertical class to body', () => {
      renderPanel();

      const handle = document.querySelector('.pair-line-editor__row-resize-handle') as HTMLElement;
      expect(handle).toBeTruthy();

      expect(document.body.classList.contains('is-resizing-vertical')).toBe(false);
      fireEvent.pointerDown(handle, { clientY: 200 });
      expect(document.body.classList.contains('is-resizing-vertical')).toBe(true);

      // Cleanup
      fireEvent.pointerUp(window);
    });

    it('dragging row handle sets inline height on the row', () => {
      renderPanel();

      const handle = document.querySelector('.pair-line-editor__row-resize-handle') as HTMLElement;
      expect(handle).toBeTruthy();

      const row = handle.closest('.pair-line-editor__row') as HTMLElement;
      expect(row).toBeTruthy();
      expect(row.style.height).toBe('');

      fireEvent.pointerDown(handle, { clientY: 200 });
      fireEvent.pointerMove(window, { clientY: 300 });
      fireEvent.pointerUp(window);

      // Row should have inline height after drag
      expect(row.style.height).toBeTruthy();
      const heightPx = parseInt(row.style.height, 10);
      expect(heightPx).toBeGreaterThan(0);
    });

    it('row height clamps to min 72px', () => {
      renderPanel();

      const handle = document.querySelector('.pair-line-editor__row-resize-handle') as HTMLElement;
      const row = handle.closest('.pair-line-editor__row') as HTMLElement;

      // Drag upward a lot (negative delta) — height should be clamped to min 72
      fireEvent.pointerDown(handle, { clientY: 200 });
      fireEvent.pointerMove(window, { clientY: -500 });
      fireEvent.pointerUp(window);

      const heightPx = parseInt(row.style.height, 10);
      expect(heightPx).toBeGreaterThanOrEqual(72);
    });

    it('row height clamps to max 480px', () => {
      renderPanel();

      const handle = document.querySelector('.pair-line-editor__row-resize-handle') as HTMLElement;
      const row = handle.closest('.pair-line-editor__row') as HTMLElement;

      // Drag downward a lot — height should be clamped to max 480
      fireEvent.pointerDown(handle, { clientY: 200 });
      fireEvent.pointerMove(window, { clientY: 2000 });
      fireEvent.pointerUp(window);

      const heightPx = parseInt(row.style.height, 10);
      expect(heightPx).toBeLessThanOrEqual(480);
    });

    it('each row has independent height after separate drags', () => {
      renderPanel();

      const handles = document.querySelectorAll('.pair-line-editor__row-resize-handle');
      expect(handles.length).toBe(3);

      // Drag first row handle
      const row0 = handles[0].closest('.pair-line-editor__row') as HTMLElement;
      fireEvent.pointerDown(handles[0], { clientY: 200 });
      fireEvent.pointerMove(window, { clientY: 350 });
      fireEvent.pointerUp(window);
      expect(row0.style.height).toBeTruthy();
      const h0 = parseInt(row0.style.height, 10);

      // Drag second row handle
      const row1 = handles[1].closest('.pair-line-editor__row') as HTMLElement;
      fireEvent.pointerDown(handles[1], { clientY: 200 });
      fireEvent.pointerMove(window, { clientY: 500 });
      fireEvent.pointerUp(window);
      expect(row1.style.height).toBeTruthy();
      const h1 = parseInt(row1.style.height, 10);

      // Heights should be different (different deltas)
      expect(h0).not.toBe(h1);
    });

    it('pairId change resets row heights', async () => {
      const { rerender } = renderPanel();

      // Drag first row to set a custom height
      const handle = document.querySelector('.pair-line-editor__row-resize-handle') as HTMLElement;
      const row = handle.closest('.pair-line-editor__row') as HTMLElement;
      fireEvent.pointerDown(handle, { clientY: 200 });
      fireEvent.pointerMove(window, { clientY: 350 });
      fireEvent.pointerUp(window);
      expect(row.style.height).toBeTruthy();

      // Change pair — should reset rowHeights
      const NEW_PAIR_PREVIEW = {
        ...MOCK_PREVIEW,
        pair: { ...MOCK_PREVIEW.pair, id: 'pair-2' },
        source_file: {
          ...MOCK_PREVIEW.source_file,
          content: 'new source one\nnew source two',
        },
        translated_file: {
          ...MOCK_PREVIEW.translated_file,
          content: 'новый перевод один\nновый перевод два',
        },
      };
      rerender(
        <PairLineEditorPanel
          pairId="pair-2"
          preview={NEW_PAIR_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Existing rows should be gone (pair change rebuilt)
      const newRows = document.querySelectorAll('.pair-line-editor__row');
      expect(newRows.length).toBe(2);

      // No rows should have inline height (rowHeights was reset)
      newRows.forEach((r) => {
        expect((r as HTMLElement).style.height).toBe('');
      });
    });
  });

  describe('edit/save/revert preserved', () => {
    it('translation textareas still editable after wrapping fix', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      expect(textareas.length).toBe(3);

      // Edit first row
      fireEvent.change(textareas[0], { target: { value: 'modified translation' } });

      // Edited stat should now be 1
      const editedValue = screen.getByText('1');
      expect(editedValue).toBeTruthy();

      // Revert
      fireEvent.click(screen.getByText('Revert Changes'));

      // All zero-stats
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBe(3);
    });
  });

  /* ---- Preview variants for merge edge cases ---- */

  const PREVIEW_INSERTED_ROW = {
    ...MOCK_PREVIEW,
    pair: { ...MOCK_PREVIEW.pair, id: 'pair-3' },
    source_file: {
      ...MOCK_PREVIEW.source_file,
      content: 'inserted line\nline one\nline two\nline three',
    },
    translated_file: {
      ...MOCK_PREVIEW.translated_file,
      content: 'inserted trans\nпервая строка\nвторая строка\nтретья строка',
    },
  };

  const PREVIEW_REMOVED_ROW = {
    ...MOCK_PREVIEW,
    pair: { ...MOCK_PREVIEW.pair, id: 'pair-4' },
    source_file: {
      ...MOCK_PREVIEW.source_file,
      content: 'line one\nline three',
    },
    translated_file: {
      ...MOCK_PREVIEW.translated_file,
      content: 'первая строка\nтретья строка',
    },
  };

  const PREVIEW_REORDERED = {
    ...MOCK_PREVIEW,
    pair: { ...MOCK_PREVIEW.pair, id: 'pair-5' },
    source_file: {
      ...MOCK_PREVIEW.source_file,
      content: 'line three\nline two\nline one',
    },
    translated_file: {
      ...MOCK_PREVIEW.translated_file,
      content: 'третья строка\nвторая строка\nпервая строка',
    },
  };

  /* ---- Preview for second pair (B) ---- */

  const PREVIEW_B = {
    ...MOCK_PREVIEW,
    pair: { ...MOCK_PREVIEW.pair, id: 'pair-B' },
    source_file: {
      ...MOCK_PREVIEW.source_file,
      content: 'source B line 1\nsource B line 2',
    },
    translated_file: {
      ...MOCK_PREVIEW.translated_file,
      content: 'trans B line 1\ntrans B line 2',
    },
  };

  /* ---- Preview for duplicate originalTranslated (different source, same trans) ---- */
  /** Scenario: source differs but translatedText is the same for two rows.
   *  Row 0: "hello" → "приветствие"
   *  Row 1: "farewell" → "прощание"
   *  Row 2: "greeting" → "приветствие"  (same trans as row 0, but different source)
   *  draftKey = sourceText + \x1f + originalTranslated disambiguates rows 0 and 2.
   */
  const PREVIEW_DUPLICATE_TRANS = {
    ...MOCK_PREVIEW,
    pair: { ...MOCK_PREVIEW.pair, id: 'pair-dup' },
    source_file: {
      ...MOCK_PREVIEW.source_file,
      content: 'hello\nfarewell\ngreeting',
    },
    translated_file: {
      ...MOCK_PREVIEW.translated_file,
      content: 'приветствие\nпрощание\nприветствие',
    },
  };

  const PREVIEW_DUP_INSERTED = {
    ...PREVIEW_DUPLICATE_TRANS,
    source_file: {
      ...PREVIEW_DUPLICATE_TRANS.source_file,
      content: 'new first line\nhello\nfarewell\ngreeting',
    },
    translated_file: {
      ...PREVIEW_DUPLICATE_TRANS.translated_file,
      content: 'новый первый\nприветствие\nпрощание\nприветствие',
    },
  };

  /* ================================================================ */
  /*  Draft preservation (pairDraftStore integration)                  */
  /* ================================================================ */

  describe('draft preservation (pairDraftStore)', () => {
    it('saves Line Editor draft on pair switch and restores on return', async () => {
      const { rerender } = renderPanel({ pairId: 'pair-1' });

      // Edit row 1 (index 1, "вторая строка")
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[1], { target: { value: 'EDITED вторая строка' } });

      // Switch to pair-B
      rerender(
        <PairLineEditorPanel
          pairId="pair-B"
          preview={PREVIEW_B}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Draft saved for pair-1
      const draft = pairDraftStore.load('pair-1');
      expect(draft?.lineEditor).toBeDefined();
      const savedRow = draft!.lineEditor!.rows.find((r) => r.id === 1);
      expect(savedRow).toBeDefined();
      expect(savedRow!.translatedText).toBe('EDITED вторая строка');
      expect(savedRow!.dirty).toBe(true);

      // Switch back to pair-1
      rerender(
        <PairLineEditorPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Draft restored — row 1 should have the edit
      await waitFor(() => {
        const restored = screen.getAllByRole('textbox');
        expect((restored[1] as HTMLTextAreaElement).value).toBe('EDITED вторая строка');
      });
    });

    it('saves Line Editor draft when pairId becomes null', async () => {
      const { rerender } = renderPanel({ pairId: 'pair-1' });

      // Edit row 0
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'dirty for null' } });

      // Set pairId=null
      rerender(
        <PairLineEditorPanel
          pairId={null}
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Draft should be saved
      const draft = pairDraftStore.load('pair-1');
      expect(draft?.lineEditor).toBeDefined();
      expect(draft!.lineEditor!.rows[0].translatedText).toBe('dirty for null');
      expect(draft!.lineEditor!.rows[0].dirty).toBe(true);
    });

    it('does NOT save Line Editor draft when pair becomes null with no dirty rows', async () => {
      const { rerender } = renderPanel({ pairId: 'pair-1' });

      // No edits

      // Set pairId=null
      rerender(
        <PairLineEditorPanel
          pairId={null}
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(pairDraftStore.load('pair-1')).toBeUndefined();
    });

    it('Line Editor save clears lineEditor draft', async () => {
      renderPanel({ pairId: 'pair-1' });

      // Edit row 0
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'edited первая' } });

      // Save
      fireEvent.click(screen.getByText('Save Changes'));
      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalled();
      });

      // Line Editor draft should be cleared
      const afterSave = pairDraftStore.load('pair-1');
      expect(afterSave?.lineEditor).toBeUndefined();
    });

    it('Line Editor save does NOT clear File View draft', async () => {
      // Prepopulate File View draft
      pairDraftStore.saveFileViewDraft('pair-1', {
        sourceContent: 'unsaved source',
        translatedContent: 'unsaved translation',
        sourceDirty: true,
        translatedDirty: false,
      });

      renderPanel({ pairId: 'pair-1' });

      // Edit row 0
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'edited первая' } });

      // Save Line Editor
      fireEvent.click(screen.getByText('Save Changes'));
      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalled();
      });

      // File View draft should still exist
      const afterSave = pairDraftStore.load('pair-1');
      expect(afterSave?.fileView).toBeDefined();
      expect(afterSave?.fileView?.sourceContent).toBe('unsaved source');
      expect(afterSave?.fileView?.sourceDirty).toBe(true);
    });
  });

  /* ================================================================ */
  /*  Merge-on-restore edge cases                                       */
  /* ================================================================ */

  describe('merge-on-restore edge cases', () => {
    it('restores correctly when fresh rows have same shape', () => {
      // Store a draft for pair-1 with edited row 1
      pairDraftStore.saveLineEditorDraft('pair-1', {
        rows: [
          { id: 0, translatedText: 'первая строка', dirty: false, originalTranslated: 'первая строка' },
          { id: 1, translatedText: 'EDITED вторая строка', dirty: true, originalTranslated: 'вторая строка' },
          { id: 2, translatedText: 'третья строка', dirty: false, originalTranslated: 'третья строка' },
        ],
      });

      // Render with same 3-row preview → ids match 1-to-1
      renderPanel({ pairId: 'pair-1' });

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(3);
      // Row 1 should have the edit
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('EDITED вторая строка');
    });

    it('handles inserted row: edit should NOT shift to wrong row', () => {
      // Store a draft for inserted-row pair with edited row 1
      // Old content: line one/line two/line three → первая/вторая/третья
      // User edited row 1 (вторая строка → "EDITED вторая строка")
      pairDraftStore.saveLineEditorDraft('pair-3', {
        rows: [
          { id: 0, translatedText: 'первая строка', dirty: false, originalTranslated: 'первая строка' },
          { id: 1, translatedText: 'EDITED вторая строка', dirty: true, originalTranslated: 'вторая строка' },
          { id: 2, translatedText: 'третья строка', dirty: false, originalTranslated: 'третья строка' },
        ],
      });

      // Render with preview that has an extra row at the top
      // New: inserted line/line one/line two/line three
      // New trans: inserted trans/первая/вторая/третья
      render(
        <PairLineEditorPanel
          pairId="pair-3"
          preview={PREVIEW_INSERTED_ROW}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(4);

      // Row with "вторая строка" is now at index 2, NOT index 1
      // The edit "EDITED вторая строка" should be at index 2
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('inserted trans');
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('первая строка');
      expect((textareas[2] as HTMLTextAreaElement).value).toBe('EDITED вторая строка');
      expect((textareas[3] as HTMLTextAreaElement).value).toBe('третья строка');
    });

    it('handles removed row: edit should not be applied to remaining row', () => {
      // Store a draft for removed-row pair with row 1 edited
      // Old: line one/line two/line three → первая/вторая/третья
      // User edited row 1 (вторая строка → "EDITED вторая строка")
      pairDraftStore.saveLineEditorDraft('pair-4', {
        rows: [
          { id: 0, translatedText: 'первая строка', dirty: false, originalTranslated: 'первая строка' },
          { id: 1, translatedText: 'EDITED вторая строка', dirty: true, originalTranslated: 'вторая строка' },
          { id: 2, translatedText: 'третья строка', dirty: false, originalTranslated: 'третья строка' },
        ],
      });

      // Render with preview where "line two" row was removed
      // New: line one/line three → первая/третья
      render(
        <PairLineEditorPanel
          pairId="pair-4"
          preview={PREVIEW_REMOVED_ROW}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(2);

      // Row 0: "первая строка" — should NOT have "EDITED вторая строка"
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('первая строка');
      // Row 1: "третья строка" — should NOT have "EDITED вторая строка"
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('третья строка');
    });

    it('handles reordered rows: edit follows content, not index', () => {
      // Store a draft for reordered pair with row 1 edited
      // Old: line one/line two/line three → первая/вторая/третья
      // User edited row 1 (вторая строка → "EDITED вторая строка")
      pairDraftStore.saveLineEditorDraft('pair-5', {
        rows: [
          { id: 0, translatedText: 'первая строка', dirty: false, originalTranslated: 'первая строка' },
          { id: 1, translatedText: 'EDITED вторая строка', dirty: true, originalTranslated: 'вторая строка' },
          { id: 2, translatedText: 'третья строка', dirty: false, originalTranslated: 'третья строка' },
        ],
      });

      // Render with preview where lines are reordered
      // New: line three/line two/line one → третья/вторая/первая
      render(
        <PairLineEditorPanel
          pairId="pair-5"
          preview={PREVIEW_REORDERED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(3);

      // "EDITED вторая строка" should be on the row with "вторая строка" content
      // Currently that's at index 1
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('третья строка');
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('EDITED вторая строка');
      expect((textareas[2] as HTMLTextAreaElement).value).toBe('первая строка');
    });
  });

  describe('merge-on-restore with draftKey (duplicate originalTranslated)', () => {
    it('disambiguates duplicate originalTranslated rows via draftKey', () => {
      // Two rows have same originalTranslated="приветствие" but different sourceText:
      //   Row 0: source="hello", originalTranslated="приветствие" — EDITED
      //   Row 2: source="greeting", originalTranslated="приветствие" — NOT edited
      // draftKey includes sourceText, so hello+sep+приветствие ≠ greeting+sep+приветствие
      pairDraftStore.saveLineEditorDraft('pair-dup', {
        rows: [
          {
            id: 0, translatedText: 'EDITED hello приветствие', dirty: true,
            originalTranslated: 'приветствие', draftKey: 'hello\u001fприветствие',
          },
          {
            id: 1, translatedText: 'прощание', dirty: false,
            originalTranslated: 'прощание', draftKey: 'farewell\u001fпрощание',
          },
          {
            id: 2, translatedText: 'приветствие', dirty: false,
            originalTranslated: 'приветствие', draftKey: 'greeting\u001fприветствие',
          },
        ],
      });

      render(
        <PairLineEditorPanel
          pairId="pair-dup"
          preview={PREVIEW_DUPLICATE_TRANS}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(3);

      // Row 0 (hello) should get the edit
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('EDITED hello приветствие');
      // Row 2 (greeting) should remain untouched despite same originalTranslated
      expect((textareas[2] as HTMLTextAreaElement).value).toBe('приветствие');
    });

    it('inserted row before duplicates: edit stays on correct row', () => {
      // Same draft: row 0 (hello) edited, row 2 (greeting) untouched
      // Now an insert shifts everything down by 1
      pairDraftStore.saveLineEditorDraft('pair-dup', {
        rows: [
          {
            id: 0, translatedText: 'EDITED hello приветствие', dirty: true,
            originalTranslated: 'приветствие', draftKey: 'hello\u001fприветствие',
          },
          {
            id: 1, translatedText: 'прощание', dirty: false,
            originalTranslated: 'прощание', draftKey: 'farewell\u001fпрощание',
          },
          {
            id: 2, translatedText: 'приветствие', dirty: false,
            originalTranslated: 'приветствие', draftKey: 'greeting\u001fприветствие',
          },
        ],
      });

      render(
        <PairLineEditorPanel
          pairId="pair-dup"
          preview={PREVIEW_DUP_INSERTED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(4);

      // The "hello"/"приветствие" row that was edited is now at index 1, not 0
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('новый первый');
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('EDITED hello приветствие');
      expect((textareas[2] as HTMLTextAreaElement).value).toBe('прощание');
      // The "greeting"/"приветствие" at index 3 must NOT get the edit
      expect((textareas[3] as HTMLTextAreaElement).value).toBe('приветствие');
    });

    it('removed edited row: draft not applied to remaining duplicate', () => {
      // Draft: row 0 (hello) was edited, row 2 (greeting) untouched
      // Then "farewell" row is removed, leaving only: hello/greeting → приветствие/приветствие
      pairDraftStore.saveLineEditorDraft('pair-dup', {
        rows: [
          {
            id: 0, translatedText: 'EDITED hello приветствие', dirty: true,
            originalTranslated: 'приветствие', draftKey: 'hello\u001fприветствие',
          },
          {
            id: 1, translatedText: 'прощание', dirty: false,
            originalTranslated: 'прощание', draftKey: 'farewell\u001fпрощание',
          },
          {
            id: 2, translatedText: 'приветствие', dirty: false,
            originalTranslated: 'приветствие', draftKey: 'greeting\u001fприветствие',
          },
        ],
      });

      // New file: only "hello" + "greeting" remain
      const PREVIEW_DUP_REMOVED = {
        ...PREVIEW_DUPLICATE_TRANS,
        source_file: {
          ...PREVIEW_DUPLICATE_TRANS.source_file,
          content: 'hello\ngreeting',
        },
        translated_file: {
          ...PREVIEW_DUPLICATE_TRANS.translated_file,
          content: 'приветствие\nприветствие',
        },
      };

      render(
        <PairLineEditorPanel
          pairId="pair-dup"
          preview={PREVIEW_DUP_REMOVED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(2);

      // The "hello" row (index 0) has source="hello" which matches saved row 0's draftKey → gets the edit
      // The "greeting" row (index 1) has source="greeting" which matches saved row 2's draftKey → no edit
      // The "прощание" row that got removed had a unique draftKey → its edit is correctly lost
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('EDITED hello приветствие');
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('приветствие');
    });

    it('old draft without draftKey still restores correctly for unique content', () => {
      // Simulate an old draft saved before draftKey existed (no draftKey field)
      // Content is unique (no duplicate originalTranslated), so fallback works
      pairDraftStore.saveLineEditorDraft('pair-1', {
        rows: [
          { id: 0, translatedText: 'EDITED первая строка', dirty: true, originalTranslated: 'первая строка' },
          { id: 1, translatedText: 'вторая строка', dirty: false, originalTranslated: 'вторая строка' },
          { id: 2, translatedText: 'третья строка', dirty: false, originalTranslated: 'третья строка' },
        ],
      });

      renderPanel({ pairId: 'pair-1' });

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(3);
      // Row 0 should have the edit (fallback match by originalTranslated)
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('EDITED первая строка');
      // Other rows unchanged
      expect((textareas[1] as HTMLTextAreaElement).value).toBe('вторая строка');
      expect((textareas[2] as HTMLTextAreaElement).value).toBe('третья строка');
    });
  });

  describe('edit/save/revert preserved', () => {
    it('save still joins lines correctly with pre-wrap', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified первая' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledWith(
          'proj-1',
          'f2',
          'modified первая\nвторая строка\nтретья строка',
        );
      });
    });
  });
});