/* ------------------------------------------------------------------ */
/*  Tests: PairList — cache, stale guard, loading for exact line stats */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import PairList, { __resetLineMatchCache } from '../workspace/PairList';
import { api } from '../../../App';
import type { WorkspacePair } from '../../../domain/pairingTypes';

/* ------------------------------------------------------------------ */
/*  Mock data                                                           */
/* ------------------------------------------------------------------ */

function makePair(overrides: Partial<Record<string, any>> = {}): WorkspacePair {
  return {
    id: overrides.id ?? 'pair-1',
    projectId: 'proj-1',
    sourceFileId: 'file-1',
    translatedFileId: 'file-2',
    sourceFile: null,
    translatedFile: null,
    status: overrides.status ?? 'manual',
    confidence: 1.0,
    reason: null,
    createdBy: 'user',
    notes: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  } as WorkspacePair;
}

const LINE_MATCH_RESPONSE = {
  threshold_percent: 0,
  matches: [
    {
      pair_id: 'pair-1',
      source_file: 'src.yml',
      translated_file: 'tgt.yml',
      exact_line_match_percent: 42.5,
      exact_line_match_count: 5,
      exact_line_match_total_count: 10,
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../../../App', () => ({
  api: {
    exactLineMatchPreview: vi.fn(),
    previewFilenamePairs: vi.fn().mockResolvedValue({ count: 0, pair_ids: [], examples: [] }),
    findIdenticalPairs: vi.fn().mockResolvedValue({ count: 0, pair_ids: [], examples: [], errors: 0, error_details: [] }),
    bulkDeletePairs: vi.fn().mockResolvedValue({ deleted_count: 0 }),
    exactLineMatchDelete: vi.fn().mockResolvedValue({ deleted_count: 0 }),
    updatePairingPair: vi.fn().mockResolvedValue({}),
    deletePairingPair: vi.fn().mockResolvedValue({}),
    suggestPairingPairs: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ApiError'; }
  },
  useToast: () => ({ showToast: vi.fn() }),
}));

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

function renderPairList(projectId: string, overrides: Record<string, any> = {}) {
  const pairs: WorkspacePair[] = overrides.pairs ?? [makePair()];
  const onPairsChange = overrides.onPairsChange ?? vi.fn();
  const onSelectPair = overrides.onSelectPair ?? vi.fn();
  const onOpenFileView = overrides.onOpenFileView ?? vi.fn();
  return render(
    <PairList
      projectId={projectId}
      pairs={pairs}
      loading={false}
      error={null}
      selectedPairId={null}
      onPairsChange={onPairsChange}
      onSelectPair={onSelectPair}
      onOpenFileView={onOpenFileView}
    />,
  );
}

describe('PairList — exact line stats caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetLineMatchCache();
  });

  afterEach(() => {
    cleanup();
  });

  /* ================================================================ */
  /*  Basic fetch                                                      */
  /* ================================================================ */

  it('calls exactLineMatchPreview on mount with projectId', async () => {
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_RESPONSE);
    renderPairList('proj-1');

    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
      expect(api.exactLineMatchPreview).toHaveBeenCalledWith('proj-1', { threshold_percent: 0 });
    });
  });

  it('shows loading state while stats are being fetched', async () => {
    // Keep the promise pending
    vi.mocked(api.exactLineMatchPreview).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    renderPairList('proj-1');

    // The card should show "Same lines: …" (loading) because lineMatchLoading is true
    // and lineMatchStats is null (no data yet)
    // But the component uses PairsPanel which renders PairSlotCard...
    // The "…" badge should appear
    await waitFor(() => {
      expect(screen.getByText('Same lines: …')).toBeTruthy();
    });
  });

  /* ================================================================ */
  /*  Cache test — same projectId after unmount/remount                */
  /* ================================================================ */

  it('does not call API again when re-opening the same projectId', async () => {
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_RESPONSE);

    // First mount
    const { unmount } = renderPairList('proj-1');
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
    });

    // Wait for stats to appear
    await screen.findByText('Same lines: 43%');

    // Unmount
    unmount();

    // Clear mock call count to verify no new calls on re-mount
    vi.mocked(api.exactLineMatchPreview).mockClear();

    // Re-mount with same projectId
    renderPairList('proj-1');

    // Should NOT call API again (cache hit)
    await waitFor(() => {
      expect(screen.getByText('Same lines: 43%')).toBeTruthy();
    });
    expect(api.exactLineMatchPreview).not.toHaveBeenCalled();
  });

  it('calls API again for a different projectId', async () => {
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_RESPONSE);

    // Open first project
    const { unmount } = renderPairList('proj-1');
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledWith('proj-1', { threshold_percent: 0 });
    });
    await screen.findByText('Same lines: 43%');
    unmount();

    vi.mocked(api.exactLineMatchPreview).mockClear();
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue({
      ...LINE_MATCH_RESPONSE,
      matches: [{
        ...LINE_MATCH_RESPONSE.matches[0],
        exact_line_match_percent: 99.9,
      }],
    });

    // Open different project
    renderPairList('proj-2');
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledWith('proj-2', { threshold_percent: 0 });
    });
    await waitFor(() => {
      expect(screen.getByText('Same lines: 100%')).toBeTruthy();
    });
  });

  /* ================================================================ */
  /*  Stale guard — old response doesn't overwrite new project stats   */
  /* ================================================================ */

  it('stale response from old project does not overwrite new project stats', async () => {
    // Create deferred promises
    let resolveOld: (value: any) => void = () => {};
    const oldPromise: Promise<any> = new Promise((resolve) => { resolveOld = resolve; });

    vi.mocked(api.exactLineMatchPreview).mockImplementation(
      () => oldPromise,
    );

    // Mount first project
    const { unmount } = renderPairList('proj-old');
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledWith('proj-old', { threshold_percent: 0 });
    });

    // Unmount (this simulates user switching projects quickly)
    unmount();

    // Now mount new project with a fast resolution
    vi.mocked(api.exactLineMatchPreview).mockImplementation(
      () => Promise.resolve({
        threshold_percent: 0,
        matches: [{
          pair_id: 'pair-1',
          source_file: 'src.yml',
          translated_file: 'tgt.yml',
          exact_line_match_percent: 88.0,
          exact_line_match_count: 8,
          exact_line_match_total_count: 10,
        }],
      }),
    );

    renderPairList('proj-new');

    // Wait for new project's response to set stats
    await waitFor(() => {
      expect(screen.getByText('Same lines: 88%')).toBeTruthy();
    });

    // Now resolve the OLD request — it should be ignored
    act(() => {
      resolveOld({
        threshold_percent: 0,
        matches: [{
          pair_id: 'pair-1',
          source_file: 'src.yml',
          translated_file: 'tgt.yml',
          exact_line_match_percent: 10.0,
          exact_line_match_count: 1,
          exact_line_match_total_count: 10,
        }],
      });
    });

    // Wait a tick for React to process
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // The stats should still be 88%, not overwritten by stale 10%
    expect(screen.getByText('Same lines: 88%')).toBeTruthy();
  });

  /* ================================================================ */
  /*  Error handling                                                   */
  /* ================================================================ */

  it('handles API error gracefully — shows muted dash badge', async () => {
    vi.mocked(api.exactLineMatchPreview).mockRejectedValue(new Error('Network error'));

    renderPairList('proj-1');

    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalled();
    });

    // After error, loading goes to false and stats become {} → dash badge
    await waitFor(() => {
      expect(screen.getByText('Same lines: —')).toBeTruthy();
    });
  });

  /* ================================================================ */
  /*  Cache invalidation — onPairsChange clears & triggers refetch     */
  /* ================================================================ */

  it('invalidates cache and refetches when onPairsChange is called (via Refresh button)', async () => {
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_RESPONSE);
    renderPairList('proj-1');

    // Wait for initial fetch and display
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('Same lines: 43%');

    // Clear mock to detect new calls
    vi.mocked(api.exactLineMatchPreview).mockClear();

    // Click Refresh — this calls onPairsChange → handlePairsChange → invalidates cache
    fireEvent.click(screen.getByText('Refresh'));

    // Cache was deleted, lineMatchVersion incremented → useEffect re-fetches
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
    });
    expect(api.exactLineMatchPreview).toHaveBeenCalledWith('proj-1', { threshold_percent: 0 });
  });

  it('forwards to the original onPairsChange callback', async () => {
    const onPairsChange = vi.fn();
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_RESPONSE);
    renderPairList('proj-1', { onPairsChange });

    // Wait for initial stats
    await screen.findByText('Same lines: 43%');

    // Click Refresh
    fireEvent.click(screen.getByText('Refresh'));

    // The wrapper must call the original callback
    await waitFor(() => {
      expect(onPairsChange).toHaveBeenCalledTimes(1);
    });
  });

  it('refetches with new data, then caches the updated result for subsequent remount', async () => {
    // First mount — populate cache with 43%
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_RESPONSE);
    const { unmount } = renderPairList('proj-1');
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('Same lines: 43%');
    unmount();

    // Re-mount — cache hit, no API call
    vi.mocked(api.exactLineMatchPreview).mockClear();
    const { unmount: unmount2 } = renderPairList('proj-1');
    await screen.findByText('Same lines: 43%');
    expect(api.exactLineMatchPreview).not.toHaveBeenCalled(); // cache hit

    // Set up new response for the upcoming refetch
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue({
      ...LINE_MATCH_RESPONSE,
      matches: [{
        ...LINE_MATCH_RESPONSE.matches[0],
        exact_line_match_percent: 77.7,
      }],
    });

    // Click Refresh — invalidates cache, triggers refetch
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => {
      expect(screen.getByText('Same lines: 78%')).toBeTruthy();
    });
    expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
    unmount2();

    // Mount yet again — should hit the NEW cache (78%)
    vi.mocked(api.exactLineMatchPreview).mockClear();
    renderPairList('proj-1');
    await waitFor(() => {
      expect(screen.getByText('Same lines: 78%')).toBeTruthy();
    });
    expect(api.exactLineMatchPreview).not.toHaveBeenCalled();
  });

  /* ================================================================ */
  /*  lineMatchRefreshKey — external re-fetch trigger                  */
  /* ================================================================ */

  it('re-fetches stats when lineMatchRefreshKey is incremented', async () => {
    vi.mocked(api.exactLineMatchPreview).mockResolvedValue(LINE_MATCH_RESPONSE);

    // Default export wraps in vi.mocked — we need to render with custom props
    // Using render directly with lineMatchRefreshKey
    const { rerender } = render(
      <PairList
        projectId="proj-1"
        pairs={[makePair()]}
        loading={false}
        error={null}
        onPairsChange={vi.fn()}
        onSelectPair={vi.fn()}
        onOpenFileView={vi.fn()}
        lineMatchRefreshKey={0}
        selectedPairId={null}
      />,
    );

    // Wait for initial fetch
    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.exactLineMatchPreview).mockClear();

    // Increment lineMatchRefreshKey
    rerender(
      <PairList
        projectId="proj-1"
        pairs={[makePair()]}
        loading={false}
        error={null}
        onPairsChange={vi.fn()}
        onSelectPair={vi.fn()}
        onOpenFileView={vi.fn()}
        lineMatchRefreshKey={1}
        selectedPairId={null}
      />,
    );

    await waitFor(() => {
      expect(api.exactLineMatchPreview).toHaveBeenCalledTimes(1);
    });
    expect(api.exactLineMatchPreview).toHaveBeenCalledWith('proj-1', { threshold_percent: 0 });
  });

});
