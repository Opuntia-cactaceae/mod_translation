/* ------------------------------------------------------------------ */
/*  Integration tests: BottomEditorPanel draft/row preservation        */
/*                                                                      */
/*  Uses REAL PairFileViewPanel and PairLineEditorPanel to verify      */
/*  that internal React state (drafts, edited rows) is preserved        */
/*  when switching tabs (since panels stay mounted, just hidden).       */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import BottomEditorPanel from '../BottomEditorPanel';

/* ================================================================== */
/*  Mock api + useToast (real components need both)                    */
/* ================================================================== */

const { mockShowToast, mockGetPreview } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockGetPreview: vi.fn(),
}));

vi.mock('../../../App', () => {
  class MockApiError extends Error {
    name = 'ApiError';
    constructor(message: string) {
      super(message);
    }
  }

  return {
    api: {
      getPairingPairPreview: mockGetPreview,
      getPairingAlignment: vi.fn().mockResolvedValue(null),
      previewPairingAlignment: vi.fn(),
      savePairingAlignment: vi.fn(),
      applyPairingAlignment: vi.fn(),
    },
    ApiError: MockApiError,
    useToast: () => ({ showToast: mockShowToast }),
  };
});

/* ================================================================== */
/*  Test data — multi-line content for textarea interaction            */
/* ================================================================== */

const MOCK_PREVIEW = {
  pair: { id: 'pair-1', project_id: 'proj-1', status: 'manual', confidence: 1 } as any,
  source_file: {
    file_id: 'f1',
    relative_path: 'src/hello.txt',
    content: 'Hello\nWorld\nFoo',
    encoding: 'utf-8',
    line_count: 3,
    size_bytes: 15,
  },
  translated_file: {
    file_id: 'f2',
    relative_path: 'src/hello_ru.txt',
    content: 'Привет\nМир\nБаз',
    encoding: 'utf-8',
    line_count: 3,
    size_bytes: 20,
  },
};

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

beforeEach(() => {
  vi.clearAllMocks();
  mockShowToast.mockClear();
  mockGetPreview.mockReset();
  mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
});

afterEach(cleanup);

/** Render with a specific pairId. */
function renderWithPair(pairId = 'pair-1') {
  const onClose = vi.fn();
  const view = render(
    <BottomEditorPanel projectId="proj-1" pairId={pairId} onClose={onClose} />,
  );
  return { view, onClose };
}

/** Wait for preview to be loaded (File View textareas appear). */
async function waitForPreview() {
  await screen.findAllByRole('textbox');
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('BottomEditorPanel draft preservation (integration)', () => {
  describe('File View draft survives tab switch', () => {
    it('preserves source draft after File View → Line Editor → File View', async () => {
      renderWithPair();
      await waitForPreview();

      // Edit the source textarea (first textbox)
      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(2);
      fireEvent.change(textareas[0], { target: { value: 'EDITED SOURCE' } });

      // Verify the edit took effect
      expect((textareas[0] as HTMLTextAreaElement).value).toBe('EDITED SOURCE');

      // Switch to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));
      expect(
        screen.getByText('Line Editor').classList.contains('pw-bottom-editor__tab--active'),
      ).toBe(true);

      // Switch back to File View
      fireEvent.click(screen.getByText('File View'));

      // The source textarea should still have the edited value
      const textareasAfter = screen.getAllByRole('textbox');
      expect((textareasAfter[0] as HTMLTextAreaElement).value).toBe('EDITED SOURCE');
    });

    it('preserves translated draft after File View → Line Editor → File View', async () => {
      renderWithPair();
      await waitForPreview();

      // Edit the translated textarea (second textbox)
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[1], { target: { value: 'EDITED TRANSLATION' } });

      // Switch to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));

      // Switch back to File View
      fireEvent.click(screen.getByText('File View'));

      // The translated textarea should still have the edited value
      const textareasAfter = screen.getAllByRole('textbox');
      expect((textareasAfter[1] as HTMLTextAreaElement).value).toBe('EDITED TRANSLATION');
    });

    it('shows Unsaved changes badge after re-visiting File View', async () => {
      renderWithPair();
      await waitForPreview();

      // Edit source textarea
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Switch away and back
      fireEvent.click(screen.getByText('Line Editor'));
      fireEvent.click(screen.getByText('File View'));

      // Both PairFileViewPanel's internal badge and BottomEditorPanel's toolbar badge are visible
      expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Line Editor edited row survives tab switch', () => {
    it('preserves edited row after Line Editor → File View → Line Editor', async () => {
      renderWithPair();
      await waitForPreview();

      // Switch to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));

      // Edit the first row
      const rowTextareas = screen.getAllByRole('textbox');
      expect(rowTextareas.length).toBeGreaterThanOrEqual(1);
      fireEvent.change(rowTextareas[0], { target: { value: 'ИЗМЕНЁННЫЙ ТЕКСТ' } });

      // Switch to File View
      fireEvent.click(screen.getByText('File View'));

      // Switch back to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));

      // The first row should still have the edited value
      const rowTextareasAfter = screen.getAllByRole('textbox');
      expect((rowTextareasAfter[0] as HTMLTextAreaElement).value).toBe('ИЗМЕНЁННЫЙ ТЕКСТ');
    });

    it('shows increased Edited stat after re-visiting Line Editor', async () => {
      renderWithPair();
      await waitForPreview();

      // Switch to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));

      // Edit two rows
      const rowTextareas = screen.getAllByRole('textbox');
      fireEvent.change(rowTextareas[0], { target: { value: 'modified 1' } });
      fireEvent.change(rowTextareas[1], { target: { value: 'modified 2' } });

      // Switch away and back
      fireEvent.click(screen.getByText('File View'));
      fireEvent.click(screen.getByText('Line Editor'));

      // Edited count should be 2
      const editedValue = screen.getByText('2');
      expect(editedValue).toBeTruthy();
    });
  });

  describe('pairId change resets state', () => {
    it('resets File View drafts when pairId changes', async () => {
      const { view, onClose } = renderWithPair('pair-old');
      await waitForPreview();

      // Edit source textarea
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'will be reset' } });

      // Change pairId with new preview data
      mockGetPreview.mockResolvedValue({
        ...MOCK_PREVIEW,
        pair: { ...MOCK_PREVIEW.pair, id: 'pair-new' },
        source_file: {
          ...MOCK_PREVIEW.source_file,
          content: 'New\nContent',
        },
      });

      view.rerender(
        <BottomEditorPanel projectId="proj-1" pairId="pair-new" onClose={onClose} />,
      );

      await waitForPreview();

      // Textarea should show NEW content, not the edited old content
      const textareasAfter = screen.getAllByRole('textbox');
      expect((textareasAfter[0] as HTMLTextAreaElement).value).toBe('New\nContent');
    });

    it('resets Line Editor rows when pairId changes', async () => {
      const { view, onClose } = renderWithPair('pair-old');
      await waitForPreview();

      // Switch to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));

      const rowTextareas = screen.getAllByRole('textbox');
      fireEvent.change(rowTextareas[0], { target: { value: 'edited old pair' } });

      // Change pairId with new preview data
      mockGetPreview.mockResolvedValue({
        ...MOCK_PREVIEW,
        pair: { ...MOCK_PREVIEW.pair, id: 'pair-new-2' },
        source_file: {
          ...MOCK_PREVIEW.source_file,
          content: 'Fresh\nStart\nHere',
        },
        translated_file: {
          ...MOCK_PREVIEW.translated_file,
          content: 'Свежий\nСтарт\nЗдесь',
        },
      });

      view.rerender(
        <BottomEditorPanel projectId="proj-1" pairId="pair-new-2" onClose={onClose} />,
      );

      // Tab resets to File View after pairId change; switch back to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));

      // Wait for Line Editor rows to show new translated content
      await waitFor(() => {
        const rows = screen.getAllByRole('textbox');
        return rows.length >= 3 && (rows[0] as HTMLTextAreaElement).value === 'Свежий';
      });

      // The first row should now be the new translated content, not the old edit
      const rowsAfter = screen.getAllByRole('textbox');
      expect((rowsAfter[0] as HTMLTextAreaElement).value).toBe('Свежий');
    });
  });

  describe('no extra API calls on tab switch', () => {
    it('does not call getPairingPairPreview again when switching tabs', async () => {
      renderWithPair();

      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });

      // Switch tabs multiple times
      fireEvent.click(screen.getByText('Line Editor'));
      fireEvent.click(screen.getByText('File View'));
      fireEvent.click(screen.getByText('Line Editor'));

      // Still only 1 API call
      expect(mockGetPreview).toHaveBeenCalledTimes(1);
    });
  });
});
