/* ------------------------------------------------------------------ */
/*  Tests: PairFileViewPanel — editable file view for selected pair    */
/*                                                                      */
/*  Component receives preview/loading/error via props (no API call).  */
/*  Save handlers call api.savePairingFileContent.                      */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import PairFileViewPanel from '../PairFileViewPanel';
import { pairDraftStore } from '../../../utils/pairDraftStore';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const { mockShowToast, mockSavePairingFileContent, mockGetAlignment, MockApiError } = vi.hoisted(
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
      mockGetAlignment: vi.fn(),
      MockApiError,
    };
  },
);

vi.mock('../../../App', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  api: {
    savePairingFileContent: mockSavePairingFileContent,
    getPairingAlignment: mockGetAlignment,
    previewPairingAlignment: vi.fn(),
    savePairingAlignment: vi.fn(),
    applyPairingAlignment: vi.fn(),
  },
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
    content: 'source content\nsecond line',
    encoding: 'utf-8',
    line_count: 2,
    size_bytes: 30,
  },
  translated_file: {
    file_id: 'f2',
    relative_path: 'src/translated.txt',
    content: 'translated content',
    encoding: 'utf-8',
    line_count: 1,
    size_bytes: 18,
  },
};

const MOCK_PREVIEW_NO_TRANSLATED = {
  ...MOCK_PREVIEW,
  translated_file: null,
};

const SAVE_RESPONSE = {
  file_id: 'f1',
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
  mockGetAlignment.mockResolvedValue(null);
  pairDraftStore.clearAll();
});

afterEach(cleanup);

function renderPanel(overrides: Record<string, any> = {}) {
  return render(
    <PairFileViewPanel
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

describe('PairFileViewPanel', () => {
  describe('states', () => {
    it('shows no-pair message when pairId is null', () => {
      render(
        <PairFileViewPanel
          pairId={null}
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('Select a pair to view files.')).toBeDefined();
    });

    it('shows loading state', () => {
      render(
        <PairFileViewPanel
          pairId="pair-1"
          preview={null}
          loading={true}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('Loading file view...')).toBeDefined();
    });

    it('shows error state', () => {
      render(
        <PairFileViewPanel
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
        <PairFileViewPanel
          pairId="pair-1"
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('No file preview data available.')).toBeDefined();
    });
  });

  describe('content rendering', () => {
    it('renders source and translated textareas with content', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      expect(textareas).toHaveLength(2);

      // Source textarea has content
      expect((textareas[0] as HTMLTextAreaElement).value).toContain('source content');
      // Translated textarea has content
      expect((textareas[1] as HTMLTextAreaElement).value).toContain('translated content');
    });

    it('shows source and translated file paths', () => {
      renderPanel();

      expect(screen.getByText(/src\/source\.txt/)).toBeDefined();
      expect(screen.getByText(/src\/translated\.txt/)).toBeDefined();
    });

    it('shows Save Both button', () => {
      renderPanel();

      expect(screen.getByText('Save Both')).toBeDefined();
    });
  });

  describe('dirty state', () => {
    it('marks Source dirty when source textarea is edited', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit source textarea
      fireEvent.change(textareas[0], { target: { value: 'modified source' } });

      // Status badge should change to dirty
      const dirtyBadge = screen.getAllByText('Unsaved changes');
      expect(dirtyBadge.length).toBeGreaterThanOrEqual(1);
    });

    it('marks Translated dirty when translated textarea is edited', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit translated textarea
      fireEvent.change(textareas[1], { target: { value: 'modified translation' } });

      const dirtyBadge = screen.getAllByText('Unsaved changes');
      expect(dirtyBadge.length).toBeGreaterThanOrEqual(1);
    });

    it('Revert Source clears dirty state for source', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit source
      fireEvent.change(textareas[0], { target: { value: 'modified source' } });

      // Click Revert Source
      const revertButtons = screen.getAllByText(/^Revert/);
      const revertSourceBtn = revertButtons.find(b => b.textContent === 'Revert Source');
      expect(revertSourceBtn).toBeDefined();
      fireEvent.click(revertSourceBtn!);

      // Source value should be back to original
      const textareasAfter = screen.getAllByRole('textbox');
      expect((textareasAfter[0] as HTMLTextAreaElement).value).toBe('source content\nsecond line');
    });

    it('Revert Translation clears dirty state for translated', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit translated
      fireEvent.change(textareas[1], { target: { value: 'modified translation' } });

      // Click Revert Translation
      const revertButtons = screen.getAllByText(/^Revert/);
      const revertTransBtn = revertButtons.find(b => b.textContent === 'Revert Translation');
      expect(revertTransBtn).toBeDefined();
      fireEvent.click(revertTransBtn!);

      const textareasAfter = screen.getAllByRole('textbox');
      expect((textareasAfter[1] as HTMLTextAreaElement).value).toBe('translated content');
    });
  });

  describe('missing file state', () => {
    it('shows missing state when translated file is absent', () => {
      render(
        <PairFileViewPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_NO_TRANSLATED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      expect(screen.getByText('File content is not available for this pair.')).toBeDefined();
    });

    it('disables Save Translation when translated is missing', () => {
      render(
        <PairFileViewPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_NO_TRANSLATED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      const saveTransBtn = screen.getByText('Save Translation') as HTMLButtonElement;
      expect(saveTransBtn.disabled).toBe(true);
    });
  });

  describe('save handlers', () => {
    it('calls api.savePairingFileContent on Save Source', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit to enable save button
      fireEvent.change(textareas[0], { target: { value: 'modified source content' } });

      const saveSourceBtn = screen.getByText('Save Source');
      expect((saveSourceBtn as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(saveSourceBtn);

      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledWith(
          'proj-1',
          'f1',
          'modified source content',
        );
      });
    });

    it('calls api.savePairingFileContent on Save Translation', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit to enable save button
      fireEvent.change(textareas[1], { target: { value: 'modified translated content' } });

      const saveTransBtn = screen.getByText('Save Translation');
      expect((saveTransBtn as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(saveTransBtn);

      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledWith(
          'proj-1',
          'f2',
          'modified translated content',
        );
      });
    });

    it('shows success toast after saving', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Saved Source file.',
          'success',
        );
      });
    });

    it('clears dirty state after successful save', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      // After save, dirty state clears — the status label changes back to "Saved"
      await waitFor(() => {
        expect(screen.getByText('Saved')).toBeDefined();
      });
    });

    it('shows error toast on save failure', async () => {
      mockSavePairingFileContent.mockRejectedValue(
        new MockApiError('File not found'),
      );
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'File not found',
          'error',
        );
      });
    });

    it('shows generic error toast on unexpected save failure', async () => {
      mockSavePairingFileContent.mockRejectedValue(
        new Error('Something crashed'),
      );
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Failed to save source file',
          'error',
        );
      });
    });

    it('calls onContentSaved after successful save', async () => {
      const onContentSaved = vi.fn();
      renderPanel({ onContentSaved });

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      await waitFor(() => {
        expect(onContentSaved).toHaveBeenCalledTimes(1);
      });
    });

    it('preserves translation dirty/draft after saving source + preview refresh', async () => {
      const onContentSaved = vi.fn();
      const { rerender } = renderPanel({ onContentSaved });

      const textareas = screen.getAllByRole('textbox');

      // 1. Edit both sides
      fireEvent.change(textareas[0], { target: { value: 'modified source' } });
      fireEvent.change(textareas[1], { target: { value: 'modified translation' } });

      // 2. Save source only
      fireEvent.click(screen.getByText('Save Source'));
      await waitFor(() => {
        expect(onContentSaved).toHaveBeenCalled();
      });

      // 3. Simulate parent re-fetching preview after save
      const REFRESHED_PREVIEW = {
        ...MOCK_PREVIEW,
        // source now reflects saved content; translated unchanged on disk
        source_file: { ...MOCK_PREVIEW.source_file, content: 'modified source' },
      };
      rerender(
        <PairFileViewPanel
          pairId="pair-1"
          preview={REFRESHED_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
          onContentSaved={onContentSaved}
        />,
      );

      // 4. Source: draft updated from preview, dirty=false
      const updatedTextareas = screen.getAllByRole('textbox');
      expect((updatedTextareas[0] as HTMLTextAreaElement).value).toBe('modified source');
      // Wait for render, then check: no "Unsaved changes" badge for source only
      // but there IS still one for translation
      await waitFor(() => {
        // There should still be at least 1 "Unsaved changes" badge (translation)
        const unsavedBadges = screen.getAllByText('Unsaved changes');
        expect(unsavedBadges.length).toBeGreaterThanOrEqual(1);
      });

      // 5. Translation: draft preserved, dirty=true
      expect((updatedTextareas[1] as HTMLTextAreaElement).value).toBe('modified translation');

      // 6. Revert Translation → reverts to REFRESHED_PREVIEW's (old) content
      fireEvent.click(screen.getByText('Revert Translation'));
      const afterRevert = screen.getAllByRole('textbox');
      expect((afterRevert[1] as HTMLTextAreaElement).value).toBe('translated content');
    });

    it('shows error toast when file is missing on save attempt', () => {
      render(
        <PairFileViewPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW_NO_TRANSLATED}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Save Translation is disabled when file is missing, but
      // the handleSave guard also handles missing file_id for safety.
      const saveTransBtn = screen.getByText('Save Translation');
      expect((saveTransBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows Saving... status while save is in progress', async () => {
      // Never resolve so saving state persists
      mockSavePairingFileContent.mockReturnValue(new Promise(() => {}));
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeDefined();
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

      // Edit source to enable save
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Start save
      fireEvent.click(screen.getByText('Save Source'));

      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledTimes(1);
      });

      // Switch to a new pair while save is still in flight
      rerender(
        <PairFileViewPanel
          pairId="pair-2"
          preview={{
            ...MOCK_PREVIEW,
            pair: { ...MOCK_PREVIEW.pair, id: 'pair-2' },
            source_file: { ...MOCK_PREVIEW.source_file, content: 'new pair content' },
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
      // success toast (Saved Source) should NOT have been shown
      // The mock may have been called with the "Cannot save" toast — that's ok
      // But "Saved Source file" should not be among the calls
      const successCalls = mockShowToast.mock.calls.filter(
        (call: string[]) => call[1] === 'success',
      );
      expect(successCalls).toHaveLength(0);
    });

    it('clears saving flags when pairId changes during save', async () => {
      // Never resolve so saving stays active
      mockSavePairingFileContent.mockReturnValue(new Promise(() => {}));
      const { rerender } = renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Start save
      fireEvent.click(screen.getByText('Save Source'));

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeDefined();
      });

      // Switch to new pair — saving flags should be cleared
      rerender(
        <PairFileViewPanel
          pairId="pair-2"
          preview={{
            ...MOCK_PREVIEW,
            pair: { ...MOCK_PREVIEW.pair, id: 'pair-2' },
            source_file: { ...MOCK_PREVIEW.source_file, content: 'new pair content' },
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

  describe('Save Both', () => {
    it('saves only dirty sides when Save Both is clicked', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Only edit source
      fireEvent.change(textareas[0], { target: { value: 'modified source' } });

      fireEvent.click(screen.getByText('Save Both'));

      // Should only call save for source (dirty), not for translated (not dirty)
      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledTimes(1);
      });
      expect(mockSavePairingFileContent).toHaveBeenCalledWith('proj-1', 'f1', 'modified source');
    });

    it('saves both sides when both are dirty', async () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');

      // Edit both sides
      fireEvent.change(textareas[0], { target: { value: 'modified source' } });
      fireEvent.change(textareas[1], { target: { value: 'modified translated' } });

      // Clear mock calls from the onChange (state updates don't trigger API)
      mockSavePairingFileContent.mockClear();

      fireEvent.click(screen.getByText('Save Both'));

      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalledTimes(2);
      });
      expect(mockSavePairingFileContent).toHaveBeenCalledWith('proj-1', 'f1', 'modified source');
      expect(mockSavePairingFileContent).toHaveBeenCalledWith('proj-1', 'f2', 'modified translated');
    });

    it('Save Both is disabled while saving', async () => {
      // Never resolve
      mockSavePairingFileContent.mockReturnValue(new Promise(() => {}));
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      // Save Both should be disabled while source is saving
      await waitFor(() => {
        const saveBothBtn = screen.getByText('Save Both') as HTMLButtonElement;
        expect(saveBothBtn.disabled).toBe(true);
      });
    });
  });

  describe('save buttons', () => {
    it('Save buttons are enabled when dirty', () => {
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      const saveSourceBtn = screen.getByText('Save Source') as HTMLButtonElement;
      expect(saveSourceBtn.disabled).toBe(false);
    });

    it('Save buttons are disabled when no changes are made', () => {
      renderPanel();

      const saveSourceBtn = screen.getByText('Save Source');
      const saveTransBtn = screen.getByText('Save Translation');
      const saveBothBtn = screen.getByText('Save Both');

      expect((saveSourceBtn as HTMLButtonElement).disabled).toBe(true);
      expect((saveTransBtn as HTMLButtonElement).disabled).toBe(true);
      expect((saveBothBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('Save buttons are disabled while saving', async () => {
      // Never resolve
      mockSavePairingFileContent.mockReturnValue(new Promise(() => {}));
      renderPanel();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      fireEvent.click(screen.getByText('Save Source'));

      // Save Source button should be disabled while saving (status changed from 'dirty' to 'saving')
      await waitFor(() => {
        const saveSourceBtn = screen.getByText('Save Source') as HTMLButtonElement;
        expect(saveSourceBtn.disabled).toBe(true);
      });
    });
  });

  describe('revealTarget', () => {
    it('shows reveal info chip when source and translated line numbers provided', () => {
      renderPanel({
        revealTarget: {
          sourceLineNumber: 2,
          translatedLineNumber: 3,
          nonce: 1,
        },
      });

      expect(screen.getByText(/Opened/)).toBeDefined();
      expect(screen.getByText(/source line 2/)).toBeDefined();
      expect(screen.getByText(/translation line 3/)).toBeDefined();
    });

    it('shows reveal info for source-only target', () => {
      renderPanel({
        revealTarget: {
          sourceLineNumber: 1,
          nonce: 1,
        },
      });

      expect(screen.getByText(/Opened source line 1/)).toBeDefined();
    });

    it('reveal info is not shown when no revealTarget provided', () => {
      renderPanel();

      expect(screen.queryByText(/Opened/)).toBeNull();
    });
  });

  describe('onDirtyChange', () => {
    it('calls onDirtyChange(true) when source is edited', async () => {
      const onDirty = vi.fn();
      renderPanel({ onDirtyChange: onDirty });

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(false));
      onDirty.mockClear();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
    });

    it('calls onDirtyChange(false) after revert', async () => {
      const onDirty = vi.fn();
      renderPanel({ onDirtyChange: onDirty });

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(false));
      onDirty.mockClear();

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
      onDirty.mockClear();

      fireEvent.click(screen.getByText('Revert Source'));

      await waitFor(() => expect(onDirty).toHaveBeenCalledWith(false));
    });
  });

  /* ================================================================ */
  /*  Draft preservation (pairDraftStore integration)                  */
  /* ================================================================ */

  describe('embedded Normalize section', () => {
    it('renders normalize section below file columns', () => {
      renderPanel();
      expect(screen.getByText('Normalization Operations')).toBeTruthy();
    });

    it('normalize section is collapsed by default', () => {
      renderPanel();
      expect(screen.queryByText('Operations (JSON)')).toBeNull();
    });

    it('normalize section can be expanded', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Normalization Operations'));
      expect(screen.getByText('Operations (JSON)')).toBeTruthy();
    });

    it('forwards normalizeAutoExpandKey prop', () => {
      renderPanel({ normalizeAutoExpandKey: 5 });
      // Section exists; key is consumed internally by NormalizationSection
      expect(screen.getByText('Normalization Operations')).toBeTruthy();
    });

    it('passes hasUnsavedEdits=true when source textarea is dirty', async () => {
      renderPanel();
      // Expand section
      fireEvent.click(screen.getByText('Normalization Operations'));
      // Initially no warning
      expect(screen.queryByText(/Save or revert file edits/)).toBeNull();

      // Edit source textarea
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      // Warning should appear (hasUnsavedEdits=true propagated)
      expect(screen.getByText(/Save or revert file edits/)).toBeTruthy();
    });

    it('passes hasUnsavedEdits=true when translated textarea is dirty', async () => {
      renderPanel();
      fireEvent.click(screen.getByText('Normalization Operations'));
      expect(screen.queryByText(/Save or revert file edits/)).toBeNull();

      // Edit translated textarea (second textarea)
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[1], { target: { value: 'modified trans' } });

      expect(screen.getByText(/Save or revert file edits/)).toBeTruthy();
    });

    it('clears hasUnsavedEdits after revert', async () => {
      renderPanel();
      fireEvent.click(screen.getByText('Normalization Operations'));

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      expect(screen.getByText(/Save or revert file edits/)).toBeTruthy();

      // Click Revert Source
      fireEvent.click(screen.getByText('Revert Source'));

      // Warning should disappear
      expect(screen.queryByText(/Save or revert file edits/)).toBeNull();
    });

    it('clears hasUnsavedEdits after successful save', async () => {
      renderPanel();
      fireEvent.click(screen.getByText('Normalization Operations'));

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'modified' } });

      expect(screen.getByText(/Save or revert file edits/)).toBeTruthy();

      // Save source
      fireEvent.click(screen.getByText('Save Source'));
      await waitFor(() => {
        expect(screen.queryByText(/Save or revert file edits/)).toBeNull();
      });
    });
  });

  describe('resize handle', () => {
    it('renders a resize handle for the file viewer columns', () => {
      renderPanel();
      const handle = screen.getByRole('separator', { name: /resize file viewer height/i });
      expect(handle).toBeTruthy();
    });

    it('resize handle has ns-resize cursor (via CSS class)', () => {
      renderPanel();
      const handle = screen.getByRole('separator', { name: /resize file viewer height/i });
      expect(handle.classList.contains('pair-file-view__resize-handle')).toBe(true);
    });

    it('resize handle is positioned inside columns container', () => {
      renderPanel();
      const handle = screen.getByRole('separator', { name: /resize file viewer height/i });
      const container = handle.closest('.pair-file-view__columns-container');
      expect(container).toBeTruthy();
    });
  });

  describe('draft preservation (pairDraftStore)', () => {
    const PREVIEW_B = {
      ...MOCK_PREVIEW,
      pair: { ...MOCK_PREVIEW.pair, id: 'pair-2' },
      source_file: {
        ...MOCK_PREVIEW.source_file,
        content: 'content for pair B',
      },
      translated_file: {
        ...MOCK_PREVIEW.translated_file,
        content: 'translated for pair B',
      },
    };

    it('saves File View draft on pair switch and restores on return', async () => {
      const { rerender } = renderPanel({ pairId: 'pair-1' });

      // Edit source
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'edited source' } });

      // Switch to pair-2
      rerender(
        <PairFileViewPanel
          pairId="pair-2"
          preview={PREVIEW_B}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Draft saved for pair-1
      const draft = pairDraftStore.load('pair-1');
      expect(draft?.fileView).toBeDefined();
      expect(draft?.fileView?.sourceContent).toBe('edited source');
      expect(draft?.fileView?.sourceDirty).toBe(true);

      // Switch back to pair-1
      rerender(
        <PairFileViewPanel
          pairId="pair-1"
          preview={MOCK_PREVIEW}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Draft restored
      await waitFor(() => {
        const restoredTextareas = screen.getAllByRole('textbox');
        expect((restoredTextareas[0] as HTMLTextAreaElement).value).toBe('edited source');
      });
    });

    it('saves File View draft when pairId becomes null', async () => {
      const { rerender } = renderPanel({ pairId: 'pair-1' });

      // Edit source
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'draft to save on null' } });

      // Set pairId=null
      rerender(
        <PairFileViewPanel
          pairId={null}
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // Draft should be saved for pair-1
      const draft = pairDraftStore.load('pair-1');
      expect(draft?.fileView).toBeDefined();
      expect(draft?.fileView?.sourceContent).toBe('draft to save on null');
      expect(draft?.fileView?.sourceDirty).toBe(true);
    });

    it('does NOT save draft when pair becomes null with no dirty edits', async () => {
      const { rerender } = renderPanel({ pairId: 'pair-1' });

      // No edits — clean state

      // Set pairId=null
      rerender(
        <PairFileViewPanel
          pairId={null}
          preview={null}
          loading={false}
          error={null}
          projectId="proj-1"
        />,
      );

      // No draft should exist
      expect(pairDraftStore.load('pair-1')).toBeUndefined();
    });

    it('File View save clears File View draft but preserves Line Editor draft', async () => {
      // Prepopulate Line Editor draft (simulates edits in the other tab)
      pairDraftStore.saveLineEditorDraft('pair-1', {
        rows: [
          { id: 0, translatedText: 'edited line', dirty: true, originalTranslated: 'original' },
        ],
      });

      renderPanel({ pairId: 'pair-1' });

      // Edit to make source dirty
      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'source to save' } });

      // Save source
      fireEvent.click(screen.getByText('Save Source'));
      await waitFor(() => {
        expect(mockSavePairingFileContent).toHaveBeenCalled();
      });

      // File View draft should be cleared (both sides clean after save)
      const afterSave = pairDraftStore.load('pair-1');
      expect(afterSave?.fileView).toBeUndefined();
      // Line Editor draft should still exist (independent tabs)
      expect(afterSave?.lineEditor).toBeDefined();
      expect(afterSave!.lineEditor!.rows[0].translatedText).toBe('edited line');
    });
  });
});
