/* ------------------------------------------------------------------ */
/*  Tests: BulkCleanup — filename, identical, and threshold cleanup     */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import BulkCleanup from '../BulkCleanup';
import { api } from '../../../App';
import { pairDraftStore } from '../../../utils/pairDraftStore';

/* ------------------------------------------------------------------ */
/*  Mock data                                                           */
/* ------------------------------------------------------------------ */

const FILENAME_PREVIEW = {
  count: 2,
  pair_ids: ['pair-1', 'pair-2'],
  examples: [
    { pair_id: 'pair-1', source_file: 'src1.yml', translated_file: 'tgt1.yml', status: 'manual', confidence: 1 },
    { pair_id: 'pair-2', source_file: 'src2.yml', translated_file: 'tgt2.yml', status: 'manual', confidence: 1 },
  ],
};

const FILENAME_PREVIEW_EMPTY = {
  count: 0,
  pair_ids: [],
  examples: [],
};

const IDENTICAL_RESULT = {
  count: 1,
  pair_ids: ['pair-3'],
  errors: 0,
  error_details: [],
  examples: [
    { pair_id: 'pair-3', source_file: 'common.yml', translated_file: 'common_ru.yml', status: 'manual', confidence: 1 },
  ],
};

const LINE_MATCH_PREVIEW = {
  threshold_percent: 80,
  matches: [
    {
      pair_id: 'pair-4',
      source_file: 'events_1.yml',
      translated_file: 'events_1_ru.yml',
      exact_line_match_percent: 95,
      exact_line_match_count: 19,
      exact_line_match_total_count: 20,
    },
    {
      pair_id: 'pair-5',
      source_file: 'events_2.yml',
      translated_file: 'events_2_ru.yml',
      exact_line_match_percent: 50,
      exact_line_match_count: 5,
      exact_line_match_total_count: 10,
    },
  ],
};

const LINE_MATCH_PREVIEW_EMPTY = {
  threshold_percent: 100,
  matches: [],
};

const DELETE_RESPONSE = { deleted_count: 2 };

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../../../App', () => ({
  api: {
    previewFilenamePairs: vi.fn(),
    findIdenticalPairs: vi.fn(),
    bulkDeletePairs: vi.fn(),
    exactLineMatchPreview: vi.fn(),
    exactLineMatchDelete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ApiError'; }
  },
}));

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

function renderCleanup(overrides: Record<string, any> = {}) {
  const { dirty, ...handlerOverrides } = overrides;
  const handlers = {
    onDeleted: vi.fn(),
    ...handlerOverrides,
  };
  return render(
    <BulkCleanup projectId="proj-1" onDeleted={handlers.onDeleted} dirty={dirty} />,
  );
}

describe('BulkCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pairDraftStore.clearAll();
  });

  afterEach(() => {
    cleanup();
    pairDraftStore.clearAll();
  });

  /* ================================================================ */
  /*  Section 1: Filename cleanup                                       */
  /* ================================================================ */

  describe('filename cleanup', () => {
    it('renders filename section with input and preview button', () => {
      renderCleanup();

      // Expand the section
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      expect(screen.getByPlaceholderText('Enter word/substring...')).toBeTruthy();
      // First "Preview" button is in the filename section
      expect(screen.getAllByText('Preview')[0]).toBeTruthy();
    });

    it('calls previewFilenamePairs when Preview is clicked', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      renderCleanup();

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });

      // Click the first "Preview" button (filename section)
      fireEvent.click(screen.getAllByText('Preview')[0]);
      await waitFor(() => {
        expect(api.previewFilenamePairs).toHaveBeenCalledWith('proj-1', { substring: 'events' });
      });
    });

    it('displays preview results and delete button', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      renderCleanup();

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);

      await screen.findByText(/Found 2 pair/);
      expect(screen.getByText('Delete found pairs')).toBeTruthy();
    });

    it('shows empty message when no pairs match', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW_EMPTY);
      renderCleanup();

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'zzz' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);

      await screen.findByText(/No pairs match/);
    });

    it('calls bulkDeletePairs with pair_ids from filename preview', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      const onDeleted = vi.fn();
      renderCleanup({ onDeleted });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);
      await screen.findByText('Delete found pairs');

      fireEvent.click(screen.getByText('Delete found pairs'));
      await waitFor(() => {
        expect(api.bulkDeletePairs).toHaveBeenCalledWith('proj-1', { pair_ids: ['pair-1', 'pair-2'] });
        expect(onDeleted).toHaveBeenCalledWith(2);
      });
    });

    it('disables preview button when input is empty', () => {
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const previewBtns = screen.getAllByText('Preview');
      const filenamePreviewBtn = previewBtns[0].closest('button')!;
      expect(filenamePreviewBtn.hasAttribute('disabled')).toBe(true);
    });
  });

  /* ================================================================ */
  /*  Section 2: Identical pairs cleanup                                */
  /* ================================================================ */

  describe('identical pairs cleanup', () => {
    it('renders identical pairs section with mode selector and find button', () => {
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      expect(screen.getByText('Delete identical pairs')).toBeTruthy();
      expect(screen.getByText('Find identical')).toBeTruthy();
    });

    it('calls findIdenticalPairs when Find identical is clicked', async () => {
      vi.mocked(api.findIdenticalPairs).mockResolvedValue(IDENTICAL_RESULT);
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      fireEvent.click(screen.getByText('Find identical'));

      await waitFor(() => {
        expect(api.findIdenticalPairs).toHaveBeenCalledWith('proj-1', { mode: 'chars' });
      });
    });

    it('calls bulkDeletePairs with pair_ids from identical result', async () => {
      vi.mocked(api.findIdenticalPairs).mockResolvedValue(IDENTICAL_RESULT);
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      const onDeleted = vi.fn();
      renderCleanup({ onDeleted });
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      fireEvent.click(screen.getByText('Find identical'));
      await screen.findByText('Delete found pairs');

      fireEvent.click(screen.getByText('Delete found pairs'));
      await waitFor(() => {
        expect(api.bulkDeletePairs).toHaveBeenCalledWith('proj-1', { pair_ids: ['pair-3'] });
        expect(onDeleted).toHaveBeenCalledWith(2);
      });
    });

    it('switches mode to lines and calls with mode: "lines"', async () => {
      vi.mocked(api.findIdenticalPairs).mockResolvedValue(IDENTICAL_RESULT);
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const select = screen.getByDisplayValue('By characters (exact)');
      fireEvent.change(select, { target: { value: 'lines' } });

      fireEvent.click(screen.getByText('Find identical'));
      await waitFor(() => {
        expect(api.findIdenticalPairs).toHaveBeenCalledWith('proj-1', { mode: 'lines' });
      });
    });
  });

  /* ================================================================ */
  /*  Section 3: Exact line match threshold cleanup                     */
  /* ================================================================ */

  describe('exact line match threshold cleanup', () => {
    it('renders threshold section with input defaulting to 100', () => {
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      expect(screen.getByText('Exact line match threshold')).toBeTruthy();
      const input = screen.getByLabelText('Exact line match threshold (%)');
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).value).toBe('100');
    });

    it('calls exactLineMatchPreview when Preview is clicked', async () => {
      vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_PREVIEW);
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      // Change threshold to 80
      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '80' } });

      fireEvent.click(screen.getAllByText('Preview')[1]); // second "Preview" button in expanded bulk cleanup
      await waitFor(() => {
        expect(api.exactLineMatchPreview).toHaveBeenCalledWith('proj-1', { threshold_percent: 80 });
      });
    });

    it('displays matched pairs with percent badges', async () => {
      vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_PREVIEW);
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '80' } });

      fireEvent.click(screen.getAllByText('Preview')[1]);

      await screen.findByText(/Found 2 pair/);
      expect(screen.getByText('95%')).toBeTruthy();
      expect(screen.getByText('50%')).toBeTruthy();
    });

    it('shows empty message when no pairs match threshold', async () => {
      vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_PREVIEW_EMPTY);
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '100' } });

      fireEvent.click(screen.getAllByText('Preview')[1]);

      await screen.findByText(/No pairs match the threshold/);
    });

    it('calls exactLineMatchDelete when Delete found pairs is clicked', async () => {
      vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_PREVIEW);
      vi.mocked(api.exactLineMatchDelete).mockResolvedValue(DELETE_RESPONSE);
      const onDeleted = vi.fn();
      renderCleanup({ onDeleted });
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '80' } });

      fireEvent.click(screen.getAllByText('Preview')[1]);
      await screen.findByText('Delete found pairs');

      // There are two "Delete found pairs" buttons visible (section 2 may or may not
      // have one). Pick the one in the exact line match section — it's the last one.
      const deleteButtons = screen.getAllByText('Delete found pairs');
      const thresholdDeleteBtn = deleteButtons[deleteButtons.length - 1];
      fireEvent.click(thresholdDeleteBtn);

      await waitFor(() => {
        expect(api.exactLineMatchDelete).toHaveBeenCalledWith('proj-1', { threshold_percent: 80 });
        expect(onDeleted).toHaveBeenCalledWith(2);
      });
    });

    it('clears preview after exact line match delete', async () => {
      vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_PREVIEW);
      vi.mocked(api.exactLineMatchDelete).mockResolvedValue(DELETE_RESPONSE);
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '80' } });

      fireEvent.click(screen.getAllByText('Preview')[1]);
      await screen.findByText(/Found 2 pair/);

      const deleteButtons = screen.getAllByText('Delete found pairs');
      const thresholdDeleteBtn = deleteButtons[deleteButtons.length - 1];
      fireEvent.click(thresholdDeleteBtn);

      await waitFor(() => {
        // Preview should be cleared
        expect(screen.queryByText(/Found 2 pair/)).toBeNull();
      });
    });

    it('clamps threshold between 0 and 100', () => {
      renderCleanup();
      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '150' } });
      expect((input as HTMLInputElement).value).toBe('100');

      fireEvent.change(input, { target: { value: '-10' } });
      expect((input as HTMLInputElement).value).toBe('0');
    });
  });

  /* ================================================================ */
  /*  Dirty guard — unsaved changes protection                          */
  /* ================================================================ */

  describe('dirty guard', () => {
    it('does NOT show ConfirmDialog when dirty=false (filename delete works)', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      const onDeleted = vi.fn();
      renderCleanup({ onDeleted });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);
      await screen.findByText('Delete found pairs');

      // No dialog shown
      expect(screen.queryByText('Discard changes')).toBeNull();

      // Delete proceeds immediately
      fireEvent.click(screen.getByText('Delete found pairs'));
      await waitFor(() => {
        expect(api.bulkDeletePairs).toHaveBeenCalledWith('proj-1', { pair_ids: ['pair-1', 'pair-2'] });
        expect(onDeleted).toHaveBeenCalledWith(2);
      });
    });

    it('blocks filename delete when dirty=true, shows ConfirmDialog', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      renderCleanup({ dirty: true });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);
      await screen.findByText('Delete found pairs');

      // Click delete → blocked by ConfirmDialog
      fireEvent.click(screen.getByText('Delete found pairs'));
      expect(screen.getByText('Discard changes')).toBeTruthy();
      expect(api.bulkDeletePairs).not.toHaveBeenCalled();
    });

    it('blocks identical delete when dirty=true, shows ConfirmDialog', async () => {
      vi.mocked(api.findIdenticalPairs).mockResolvedValue(IDENTICAL_RESULT);
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      renderCleanup({ dirty: true });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));
      fireEvent.click(screen.getByText('Find identical'));
      await screen.findByText('Delete found pairs');

      fireEvent.click(screen.getByText('Delete found pairs'));
      expect(screen.getByText('Discard changes')).toBeTruthy();
      expect(api.bulkDeletePairs).not.toHaveBeenCalled();
    });

    it('blocks exact-line delete when dirty=true, shows ConfirmDialog', async () => {
      vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_PREVIEW);
      vi.mocked(api.exactLineMatchDelete).mockResolvedValue(DELETE_RESPONSE);
      renderCleanup({ dirty: true });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '80' } });
      fireEvent.click(screen.getAllByText('Preview')[1]);
      await screen.findByText(/Found 2 pair/);

      const deleteButtons = screen.getAllByText('Delete found pairs');
      fireEvent.click(deleteButtons[deleteButtons.length - 1]);
      expect(screen.getByText('Discard changes')).toBeTruthy();
      expect(api.exactLineMatchDelete).not.toHaveBeenCalled();
    });

    it('ConfirmDialog confirm → deletion proceeds', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      const onDeleted = vi.fn();
      renderCleanup({ dirty: true, onDeleted });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);
      await screen.findByText('Delete found pairs');

      // Click delete → ConfirmDialog appears
      fireEvent.click(screen.getByText('Delete found pairs'));
      expect(screen.getByText('Discard changes')).toBeTruthy();

      // Confirm → deletion proceeds
      fireEvent.click(screen.getByText('Discard changes'));
      await waitFor(() => {
        expect(api.bulkDeletePairs).toHaveBeenCalledWith('proj-1', { pair_ids: ['pair-1', 'pair-2'] });
        expect(onDeleted).toHaveBeenCalledWith(2);
      });

      // Dialog closes
      expect(screen.queryByText('Discard changes')).toBeNull();
    });

    it('ConfirmDialog cancel → no deletion', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      renderCleanup({ dirty: true });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));

      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);
      await screen.findByText('Delete found pairs');

      // Click delete → ConfirmDialog appears
      fireEvent.click(screen.getByText('Delete found pairs'));
      expect(screen.getByText('Discard changes')).toBeTruthy();

      // Click Cancel (last button with that label = ConfirmDialog's Cancel)
      const cancels = screen.getAllByText('Cancel');
      fireEvent.click(cancels[cancels.length - 1]);

      // Dialog closes
      expect(screen.queryByText('Discard changes')).toBeNull();

      // API was NOT called
      expect(api.bulkDeletePairs).not.toHaveBeenCalled();

      // Preview is still shown (not cleared)
      expect(screen.getByText('Delete found pairs')).toBeTruthy();
    });
  });

  /* ================================================================ */
  /*  Draft store cleanup after bulk delete                             */
  /* ================================================================ */

  describe('draft store cleanup', () => {
    beforeEach(() => {
      vi.mocked(api.bulkDeletePairs).mockResolvedValue(DELETE_RESPONSE);
      vi.mocked(api.exactLineMatchDelete).mockResolvedValue(DELETE_RESPONSE);
    });

    it('clears draft for deleted pair after filename cleanup', async () => {
      vi.mocked(api.previewFilenamePairs).mockResolvedValue(FILENAME_PREVIEW);
      pairDraftStore.saveFileViewDraft('pair-1', {
        sourceContent: 's', translatedContent: 't', sourceDirty: true, translatedDirty: false,
      });
      pairDraftStore.saveFileViewDraft('pair-2', {
        sourceContent: 'a', translatedContent: 'b', sourceDirty: true, translatedDirty: false,
      });
      pairDraftStore.saveFileViewDraft('pair-99', {
        sourceContent: 'keep', translatedContent: 'keep', sourceDirty: false, translatedDirty: false,
      });

      const onDeleted = vi.fn();
      renderCleanup({ onDeleted });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));
      const input = screen.getByPlaceholderText('Enter word/substring...');
      fireEvent.change(input, { target: { value: 'events' } });
      fireEvent.click(screen.getAllByText('Preview')[0]);
      await screen.findByText('Delete found pairs');
      fireEvent.click(screen.getByText('Delete found pairs'));
      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(2));

      // Deleted pairs cleared
      expect(pairDraftStore.has('pair-1')).toBe(false);
      expect(pairDraftStore.has('pair-2')).toBe(false);
      // Non-deleted pair preserved
      expect(pairDraftStore.has('pair-99')).toBe(true);
    });

    it('clears draft for deleted pair after identical cleanup', async () => {
      vi.mocked(api.findIdenticalPairs).mockResolvedValue(IDENTICAL_RESULT);
      pairDraftStore.saveFileViewDraft('pair-3', {
        sourceContent: 's', translatedContent: 't', sourceDirty: true, translatedDirty: false,
      });
      pairDraftStore.saveFileViewDraft('pair-99', {
        sourceContent: 'keep', translatedContent: 'keep', sourceDirty: false, translatedDirty: false,
      });

      const onDeleted = vi.fn();
      renderCleanup({ onDeleted });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));
      fireEvent.click(screen.getByText('Find identical'));
      await screen.findByText('Delete found pairs');
      fireEvent.click(screen.getByText('Delete found pairs'));
      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(2));

      expect(pairDraftStore.has('pair-3')).toBe(false);
      expect(pairDraftStore.has('pair-99')).toBe(true);
    });

    it('clears ALL drafts after exact-line cleanup (fallback)', async () => {
      vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_PREVIEW);
      pairDraftStore.saveFileViewDraft('pair-4', {
        sourceContent: 's', translatedContent: 't', sourceDirty: true, translatedDirty: false,
      });
      pairDraftStore.saveFileViewDraft('pair-5', {
        sourceContent: 'a', translatedContent: 'b', sourceDirty: true, translatedDirty: false,
      });
      pairDraftStore.saveFileViewDraft('pair-99', {
        sourceContent: 'keep', translatedContent: 'keep', sourceDirty: false, translatedDirty: false,
      });

      const onDeleted = vi.fn();
      renderCleanup({ onDeleted });

      fireEvent.click(screen.getByText(/Bulk Cleanup/));
      const input = screen.getByLabelText('Exact line match threshold (%)');
      fireEvent.change(input, { target: { value: '80' } });
      fireEvent.click(screen.getAllByText('Preview')[1]);
      await screen.findByText(/Found 2 pair/);

      const deleteButtons = screen.getAllByText('Delete found pairs');
      fireEvent.click(deleteButtons[deleteButtons.length - 1]);
      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(2));

      // All drafts cleared (fallback behavior — no deleted_ids returned)
      expect(pairDraftStore.has('pair-4')).toBe(false);
      expect(pairDraftStore.has('pair-5')).toBe(false);
      expect(pairDraftStore.has('pair-99')).toBe(false);
    });
  });
});
