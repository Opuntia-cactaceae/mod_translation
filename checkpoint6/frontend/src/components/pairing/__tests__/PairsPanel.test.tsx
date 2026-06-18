/* ------------------------------------------------------------------ */
/*  Tests: PairsPanel — sort, filters, bulk actions                    */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { PairsPanel } from '../PairsPanel';
import type { PairingProjectPair } from '../../../api/types';

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

function makeFile(
  id: string,
  file_name: string,
  overrides: Partial<Record<string, any>> = {},
) {
  return {
    id,
    project_id: 'proj-1',
    relative_path: overrides.relative_path ?? `localisation/${file_name}`,
    file_name,
    extension: '.yml',
    parent_dir: overrides.parent_dir ?? 'localisation',
    size_bytes: 1024,
    content_hash: 'abc',
    modified_at: '2025-01-01T00:00:00Z',
    detected_language: overrides.detected_language ?? 'en',
    detected_role: overrides.detected_role ?? 'source',
    group_key: 'en',
    is_ignored: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

function makePair(overrides: Partial<Record<string, any>> = {}): PairingProjectPair {
  return {
    id: overrides.id ?? 'pair-1',
    project_id: 'proj-1',
    source_file_id: 'sf-1',
    translated_file_id: 'tf-1',
    source_file: overrides.source_file !== undefined ? overrides.source_file : makeFile('sf-1', 'english.yml', { detected_role: 'source', detected_language: 'en' }),
    translated_file: overrides.translated_file !== undefined ? overrides.translated_file : makeFile('tf-1', 'russian.yml', { detected_role: 'translated', detected_language: 'ru' }),
    status: overrides.status ?? 'manual',
    confidence: overrides.confidence ?? 0.85,
    reason: overrides.reason ?? null,
    created_by: 'user',
    notes: overrides.notes ?? null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

/** Several pairs for filter/sort/bulk tests. */
function makeTestPairs(): PairingProjectPair[] {
  return [
    makePair({ id: 'pair-1', status: 'suggested', confidence: 0.9, reason: 'filename match' }),
    makePair({
      id: 'pair-2', status: 'accepted', confidence: 0.5,
      source_file: makeFile('sf-2', 'french.yml', { detected_role: 'source', detected_language: 'fr' }),
      translated_file: makeFile('tf-2', 'german.yml', { detected_role: 'translated', detected_language: 'de' }),
      reason: 'content similarity',
    }),
    makePair({
      id: 'pair-3', status: 'suggested', confidence: 0.3,
      source_file: makeFile('sf-3', 'spanish.yml', { detected_role: 'source', detected_language: 'es' }),
      reason: 'path match',
    }),
    makePair({ id: 'pair-4', status: 'manual', confidence: 0.7 }),
    makePair({ id: 'pair-5', status: 'rejected', confidence: 0.1, reason: 'low score' }),
    makePair({
      id: 'pair-6', status: 'ignored', confidence: 0.6,
      source_file: makeFile('sf-6', 'korean.yml', { detected_role: 'source', detected_language: 'ko' }),
      translated_file: makeFile('tf-6', 'japanese.yml', { detected_role: 'translated', detected_language: 'ja' }),
    }),
  ];
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

function renderPanel(overrides: Record<string, any> = {}) {
  const props = {
    projectId: 'proj-1',
    pairs: overrides.pairs ?? makeTestPairs(),
    loading: overrides.loading ?? false,
    pairsError: overrides.pairsError ?? null,
    onPairsChange: overrides.onPairsChange ?? vi.fn(),
    selectedPairId: overrides.selectedPairId ?? null,
    onSelectPair: overrides.onSelectPair ?? vi.fn(),
    onOpenFileView: overrides.onOpenFileView ?? vi.fn(),
    onOpenNormalize: overrides.onOpenNormalize ?? vi.fn(),
    onRevealFile: overrides.onRevealFile,
    onUpdatePairSlot: overrides.onUpdatePairSlot,
    onClearAll: overrides.onClearAll,
    onDeletePair: overrides.onDeletePair,
    lineMatchStats: overrides.lineMatchStats ?? null,
    lineMatchLoading: overrides.lineMatchLoading ?? false,
    ...overrides,
  };
  return render(<PairsPanel {...props} />);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(cleanup);
afterEach(cleanup);

describe('PairsPanel', () => {
  describe('empty state', () => {
    it('shows "No pairs yet" when no pairs are provided', () => {
      renderPanel({ pairs: [] });
      expect(screen.getByText('No pairs yet — drop a file here to create a pair')).toBeTruthy();
    });

    it('shows "No pairs matching filters" when filters are active with no results', () => {
      renderPanel({ pairs: [] });
      // Open filters and set a filter
      const filtersBtn = screen.getByText('Filters');
      fireEvent.click(filtersBtn);

      // Two inputs have placeholder "0": min confidence and min same lines
      const minConfInput = screen.getAllByPlaceholderText('0')[0];
      fireEvent.change(minConfInput, { target: { value: '90' } });

      expect(screen.getByText('No pairs matching filters')).toBeTruthy();
    });

    it('does not show bulk action bar when no pairs visible', () => {
      renderPanel({ pairs: [] });
      expect(screen.queryByText(/visible pairs/)).toBeNull();
    });
  });

  describe('loading state', () => {
    it('shows loading text when loading is true', () => {
      renderPanel({ loading: true, pairs: [] });
      expect(screen.getByText('Loading pairs...')).toBeTruthy();
    });
  });

  describe('error state', () => {
    it('shows error message when pairsError is set', () => {
      renderPanel({ pairsError: 'Something went wrong', pairs: [] });
      expect(screen.getByText('Something went wrong')).toBeTruthy();
    });
  });

  describe('status filter', () => {
    it('renders status filter dropdown', () => {
      renderPanel();
      const select = screen.getByLabelText('Filter by status');
      expect(select).toBeTruthy();
    });

    it('shows all status options', () => {
      renderPanel();
      const select = screen.getByLabelText('Filter by status');
      expect(within(select).getByText('All')).toBeTruthy();
      expect(within(select).getByText('Suggested')).toBeTruthy();
      expect(within(select).getByText('Accepted')).toBeTruthy();
      expect(within(select).getByText('Manual')).toBeTruthy();
      expect(within(select).getByText('Rejected')).toBeTruthy();
      expect(within(select).getByText('Ignored')).toBeTruthy();
    });

    it('filters pairs by selected status', () => {
      renderPanel();
      const select = screen.getByLabelText('Filter by status');

      // Default: all 6 pairs visible (english.yml appears in pairs 1,4,5)
      expect(screen.getAllByText('english.yml').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('french.yml')).toBeTruthy();
      expect(screen.getByText('spanish.yml')).toBeTruthy();

      // Filter to "Suggested" only
      fireEvent.change(select, { target: { value: 'suggested' } });

      // Only suggested pairs should be visible — pair-1 and pair-3
      expect(screen.getByText('spanish.yml')).toBeTruthy();
      expect(screen.queryByText('french.yml')).toBeNull();     // accepted
      expect(screen.queryByText('korean.yml')).toBeNull();     // ignored
      // english.yml appears only once (pair-1 is suggested, pair-4 manual, pair-5 rejected)
      expect(screen.getAllByText('english.yml').length).toBe(1);
    });
  });

  describe('sort controls', () => {
    it('toggles sort panel on Sort button click', () => {
      renderPanel();
      // Sort panel should not be open initially
      expect(screen.queryByText('Sort by:')).toBeNull();

      const sortBtn = screen.getByText('Sort');
      fireEvent.click(sortBtn);

      // Sort panel now visible
      expect(screen.getByText('Sort by:')).toBeTruthy();
      expect(screen.getByLabelText('Sort by')).toBeTruthy();
      expect(screen.getByLabelText('Sort direction')).toBeTruthy();
    });

    it('closes sort panel on second click', () => {
      renderPanel();
      const sortBtn = screen.getByText('Sort');
      fireEvent.click(sortBtn);
      expect(screen.getByText('Sort by:')).toBeTruthy();

      fireEvent.click(sortBtn);
      expect(screen.queryByText('Sort by:')).toBeNull();
    });

    it('closes filters when sort is opened and vice versa', () => {
      renderPanel();
      const sortBtn = screen.getByText('Sort');
      const filtersBtn = screen.getByText('Filters');

      // Open sort first
      fireEvent.click(sortBtn);
      expect(screen.getByText('Sort by:')).toBeTruthy();

      // Open filters — sort should close
      fireEvent.click(filtersBtn);
      expect(screen.queryByText('Sort by:')).toBeNull();
      expect(screen.getByText('Min confidence %')).toBeTruthy();

      // Open sort again — filters should close
      fireEvent.click(sortBtn);
      expect(screen.getByText('Sort by:')).toBeTruthy();
      expect(screen.queryByText('Min confidence %')).toBeNull();
    });

    it('has all 8 sort options', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Sort'));
      const select = screen.getByLabelText('Sort by');
      expect(within(select).getByText('Pair confidence')).toBeTruthy();
      expect(within(select).getByText('Same lines')).toBeTruthy();
      expect(within(select).getByText('Status')).toBeTruthy();
      expect(within(select).getByText('Source filename')).toBeTruthy();
      expect(within(select).getByText('Translated filename')).toBeTruthy();
      expect(within(select).getByText('Source language')).toBeTruthy();
      expect(within(select).getByText('Target language')).toBeTruthy();
      expect(within(select).getByText('Reason')).toBeTruthy();
    });

    it('changes sort direction', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Sort'));
      const dirSelect = screen.getByLabelText('Sort direction');
      expect(within(dirSelect).getByText('Descending')).toBeTruthy();
      fireEvent.change(dirSelect, { target: { value: 'asc' } });
      expect(within(dirSelect).getByText('Ascending')).toBeTruthy();
    });

    it('defaults to confidence descending', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Sort'));
      const bySelect = screen.getByLabelText('Sort by') as HTMLSelectElement;
      const dirSelect = screen.getByLabelText('Sort direction') as HTMLSelectElement;
      expect(bySelect.value).toBe('confidence');
      expect(dirSelect.value).toBe('desc');
    });
  });

  describe('filters panel', () => {
    it('opens filters panel on Filters button click', () => {
      renderPanel();
      const filtersBtn = screen.getByText('Filters');
      fireEvent.click(filtersBtn);

      expect(screen.getByText('Min confidence %')).toBeTruthy();
      expect(screen.getByText('Max confidence %')).toBeTruthy();
      expect(screen.getByText('Min same lines %')).toBeTruthy();
      expect(screen.getByText('Max same lines %')).toBeTruthy();
      expect(screen.getByText('Reason contains')).toBeTruthy();
      expect(screen.getByText('Filename contains')).toBeTruthy();
      expect(screen.getByText('Reset filters')).toBeTruthy();
    });

    it('shows source/target language selects when pairs have languages', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));

      expect(screen.getByText('Source language')).toBeTruthy();
      expect(screen.getByText('Target language')).toBeTruthy();
    });

    it('filters by min confidence', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));

      // Set min confidence to 80%
      const minInput = screen.getAllByPlaceholderText('0')[0];
      fireEvent.change(minInput, { target: { value: '80' } });

      // pair-1 (90%) and pair-4 (70%) — only 90% >= 80%
      expect(screen.getByText('english.yml')).toBeTruthy();
      expect(screen.queryByText('french.yml')).toBeNull();  // 50%
      expect(screen.queryByText('spanish.yml')).toBeNull(); // 30%
    });

    it('filters by max confidence', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));

      const maxInput = screen.getAllByPlaceholderText('100')[0];
      fireEvent.change(maxInput, { target: { value: '40' } });

      // Only pairs with confidence <= 40%: pair-3 (30%), pair-5 (10%)
      // pair-3 uses spanish.yml, pair-5 uses default english.yml (10%)
      expect(screen.getByText('spanish.yml')).toBeTruthy();
      expect(screen.getAllByText('english.yml').length).toBe(1); // pair-5 only
      expect(screen.queryByText('french.yml')).toBeNull();  // 50%
      expect(screen.queryByText('korean.yml')).toBeNull();  // 60%
    });

    it('filters by reason contains', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));

      const reasonInput = screen.getByPlaceholderText('Search reasons...');
      fireEvent.change(reasonInput, { target: { value: 'filename' } });

      // pair-1 has reason 'filename match'
      expect(screen.getByText('english.yml')).toBeTruthy();
      // pair-2 has reason 'content similarity'
      expect(screen.queryByText('french.yml')).toBeNull();
    });

    it('filters by filename contains', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));

      const filenameInput = screen.getByPlaceholderText('Search filenames...');
      fireEvent.change(filenameInput, { target: { value: 'korean' } });

      expect(screen.getByText('korean.yml')).toBeTruthy();
      expect(screen.getByText('japanese.yml')).toBeTruthy();
      expect(screen.queryByText('english.yml')).toBeNull();
    });

    it('shows active filter count badge on Filters button', () => {
      renderPanel();
      const filtersBtn = screen.getByText('Filters');
      expect(screen.queryByText(/Filters \(\d\)/)).toBeNull();

      fireEvent.click(filtersBtn);
      const minInput = screen.getAllByPlaceholderText('0')[0];
      fireEvent.change(minInput, { target: { value: '50' } });

      // Should show "Filters (1)"
      expect(screen.getByText('Filters (1)')).toBeTruthy();
    });

    it('resets all filters on Reset button click', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));

      // Apply some filters
      fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '50' } });
      fireEvent.change(screen.getByPlaceholderText('Search reasons...'), { target: { value: 'test' } });

      // Verify badge shows (2)
      expect(screen.getByText('Filters (2)')).toBeTruthy();

      // Reset
      fireEvent.click(screen.getByText('Reset filters'));

      // Badge should be gone
      expect(screen.queryByText('Filters (2)')).toBeNull();
      expect(screen.getByText('Filters')).toBeTruthy();
    });

    it('filters by source language', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));

      const sourceLangLabel = screen.getByText('Source language');
      const select = sourceLangLabel.parentElement!.querySelector('select')!;
      fireEvent.change(select, { target: { value: 'fr' } });

      // Only french.yml source
      expect(screen.getByText('french.yml')).toBeTruthy();
      expect(screen.queryByText('english.yml')).toBeNull();
    });
  });

  describe('sorting behavior', () => {
    it('sorts by confidence descending by default', () => {
      renderPanel();
      // The first pair should be the one with highest confidence
      const cards = document.querySelectorAll('.pair-slot-card');
      expect(cards.length).toBeGreaterThanOrEqual(1);
      // pair-1 has confidence 0.9, pair-2 has 0.5, pair-3 has 0.3, ...
      // Highest first: pair-1 (0.9), pair-4 (0.7), pair-6 (0.6), pair-2 (0.5), pair-3 (0.3), pair-5 (0.1)
      const firstCard = cards[0];
      expect(firstCard.textContent).toContain('english.yml');
    });

    it('sorts by confidence ascending', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Sort'));
      fireEvent.change(screen.getByLabelText('Sort direction'), { target: { value: 'asc' } });

      const cards = document.querySelectorAll('.pair-slot-card');
      // Lowest first: pair-5 (0.1)
      const firstText = cards[0].textContent || '';
      // pair-5 has the lowest confidence, should appear first
      expect(firstText).toContain('english.yml'); // pair-5 uses default english/russian files
    });

    it('sorts by status alphabetically', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Sort'));
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'status' } });

      const cards = document.querySelectorAll('.pair-slot-card');
      const statuses = Array.from(cards).map((card) => {
        const badge = card.querySelector('.badge');
        return badge?.textContent?.trim() || '';
      });
      // Default sort is descending: Suggested > Rejected > Manual > Ignored > Accepted
      const filteredStatuses = statuses.filter(Boolean);
      const sortedDesc = [...filteredStatuses].sort().reverse();
      expect(filteredStatuses).toEqual(sortedDesc);
    });

    it('sorts by source filename', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Sort'));
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'sourceFile' } });

      const cards = document.querySelectorAll('.pair-slot-card');
      // Source filenames should be alphabetical (desc by default)
      const names = Array.from(cards).map((card) => {
        // First .pair-slot__file-name in the card is the source
        const nameEls = card.querySelectorAll('.pair-slot__file-name');
        return nameEls[0]?.textContent?.trim() || '';
      });
      const nonEmpty = names.filter(Boolean);
      // Check descending alphabetical
      for (let i = 0; i < nonEmpty.length - 1; i++) {
        expect(nonEmpty[i].localeCompare(nonEmpty[i + 1])).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('combined filter + sort', () => {
    it('applies status filter before sorting', () => {
      renderPanel();
      // Filter to suggested only
      fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'suggested' } });

      fireEvent.click(screen.getByText('Sort'));
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'confidence' } });

      // Only suggested pairs visible, sorted by confidence descending
      // pair-1 (90%), pair-3 (30%)
      const cards = document.querySelectorAll('.pair-slot-card');
      expect(cards.length).toBe(2);
      expect(cards[0].textContent).toContain('english.yml'); // 90%
      expect(cards[1].textContent).toContain('spanish.yml'); // 30%
    });
  });

  describe('bulk action bar', () => {
    it('shows visible pair count', () => {
      renderPanel();
      expect(screen.getByText('6 visible pairs')).toBeTruthy();
    });

    it('shows Accept visible, Reject visible, Delete visible buttons', () => {
      renderPanel();
      expect(screen.getByText('Accept visible')).toBeTruthy();
      expect(screen.getByText('Reject visible')).toBeTruthy();
      expect(screen.getByText('Delete visible')).toBeTruthy();
    });

    it('updates visible count when filtered', () => {
      renderPanel();
      fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'suggested' } });
      expect(screen.getByText('2 visible pairs')).toBeTruthy();
    });

    it('does not show bulk bar when no pairs match', () => {
      renderPanel({ pairs: [] });
      expect(screen.queryByText(/visible pairs/)).toBeNull();
    });
  });

  describe('bulk confirmation modal', () => {
    it('opens bulk accept confirmation with correct title and message', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Accept visible'));

      // Modal should be visible
      expect(screen.getByText('Accept visible?')).toBeTruthy();
      expect(screen.getByText('Accept all')).toBeTruthy();
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('shows eligible and skipped counts in accept modal', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Accept visible'));

      // 6 pairs total: 2 suggested + 1 manual = 3 eligible, 3 skipped
      // The "3 visible pairs" count (eligible) should be shown
      // "3 skipped — already accepted/rejected" should be shown
      const modalBody = document.querySelector('.modal-body');
      const bodyText = modalBody?.textContent || '';
      expect(bodyText).toContain('3'); // eligible
      expect(bodyText).toContain('skipped');
      expect(bodyText).toContain('only suggested/manual pairs will be updated');
    });

    it('shows preview pairs in bulk modal', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Accept visible'));

      // First 5 pairs should be shown in preview
      expect(screen.getByText('First 5 affected:')).toBeTruthy();
    });

    it('closes bulk modal on cancel', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Accept visible'));
      expect(screen.getByText('Accept visible?')).toBeTruthy();

      const cancelBtn = screen.getByText('Cancel');
      fireEvent.click(cancelBtn);

      expect(screen.queryByText('Accept visible?')).toBeNull();
    });

    it('bulk delete modal shows eligible ids without skipped count', () => {
      // Delete all pairs (skippedCount = 0 for delete)
      renderPanel();
      fireEvent.click(screen.getByText('Delete visible'));

      expect(screen.getByText('Delete visible?')).toBeTruthy();
      expect(screen.getByText('Delete all')).toBeTruthy();
    });

    it('opens bulk reject confirmation', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Reject visible'));

      expect(screen.getByText('Reject visible?')).toBeTruthy();
      expect(screen.getByText('Reject all')).toBeTruthy();
    });

    it('shows filter summary in bulk modal when filters active', () => {
      renderPanel();
      fireEvent.click(screen.getByText('Filters'));
      const minInput = screen.getAllByPlaceholderText('0')[0];
      fireEvent.change(minInput, { target: { value: '50' } });

      fireEvent.click(screen.getByText('Accept visible'));

      const modalBody = document.querySelector('.modal-body');
      expect(modalBody?.textContent).toContain('Active filters:');
      expect(modalBody?.textContent).toContain('Min confidence: 50%');
    });
  });

  describe('action buttons', () => {
    it('renders Suggest Pairs button', () => {
      renderPanel();
      expect(screen.getByText('Suggest Pairs')).toBeTruthy();
    });

    it('renders Refresh button', () => {
      renderPanel();
      expect(screen.getByText('Refresh')).toBeTruthy();
    });

    it('calls onPairsChange when Refresh is clicked', () => {
      const onPairsChange = vi.fn();
      renderPanel({ onPairsChange });
      fireEvent.click(screen.getByText('Refresh'));
      expect(onPairsChange).toHaveBeenCalledTimes(1);
    });

    it('shows Clear All button when pairs exist and onClearAll is provided', () => {
      const onClearAll = vi.fn();
      renderPanel({ onClearAll });
      expect(screen.getByText('Clear All')).toBeTruthy();
    });

    it('does not show Clear All when pairs are empty', () => {
      const onClearAll = vi.fn();
      renderPanel({ onClearAll, pairs: [] });
      expect(screen.queryByText('Clear All')).toBeNull();
    });
  });

  describe('clear all confirmation', () => {
    it('opens clear all confirmation when Clear All is clicked', () => {
      const onClearAll = vi.fn();
      renderPanel({ onClearAll });
      fireEvent.click(screen.getByText('Clear All'));

      expect(screen.getByText('Clear all pairs?')).toBeTruthy();
      expect(screen.getByText('Delete all pairs')).toBeTruthy();
    });
  });

  describe('delete confirmation', () => {
    it('opens delete confirmation when card Delete is clicked', () => {
      renderPanel();
      const deleteBtns = screen.getAllByText('Delete');
      // First Delete button is on a pair card
      fireEvent.click(deleteBtns[0]);

      expect(screen.getByText('Delete pair')).toBeTruthy();
    });
  });

  describe('card rendering', () => {
    it('renders PairSlotCard for each visible pair', () => {
      renderPanel();
      const cards = document.querySelectorAll('.pair-slot-card');
      expect(cards.length).toBe(6); // 6 test pairs
    });

    it('applies selected state to the selected pair', () => {
      renderPanel({ selectedPairId: 'pair-1' });
      const selectedCard = document.querySelector('.pair-slot-card--selected');
      expect(selectedCard).toBeTruthy();
      expect(selectedCard?.textContent).toContain('english.yml');
    });
  });
});
