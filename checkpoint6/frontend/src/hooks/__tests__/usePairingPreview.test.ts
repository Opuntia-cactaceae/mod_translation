import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePairingPreview } from '../usePairingPreview';
import type { UsePairingPreviewResult } from '../usePairingPreview';

/* ------------------------------------------------------------------ */
/*  Mock api                                                            */
/* ------------------------------------------------------------------ */

const mockGetPairingPairPreview = vi.hoisted(() => vi.fn());

vi.mock('../../App', () => ({
  api: {
    getPairingPairPreview: mockGetPairingPairPreview,
  },
  ApiError: class extends Error {
    code = '';
    details: Record<string, unknown> = {};
    recoverable = false;
    constructor(err: { message: string; code: string; details: Record<string, unknown>; recoverable: boolean }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details;
      this.recoverable = err.recoverable;
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const MOCK_PREVIEW = {
  pair: {
    id: 'pair-1',
    project_id: 'proj-1',
    source_file_id: 'file-1',
    translated_file_id: 'file-2',
    status: 'accepted',
    confidence: 0.95,
    reason: null,
    created_by: 'auto',
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  source_file: {
    file_id: 'file-1',
    relative_path: 'en/file.yml',
    content: 'l_english:\n key: "value"\n',
    encoding: 'utf-8',
    line_count: 3,
    size_bytes: 100,
  },
  translated_file: {
    file_id: 'file-2',
    relative_path: 'fr/file.yml',
    content: 'l_french:\n key: "valeur"\n',
    encoding: 'utf-8',
    line_count: 3,
    size_bytes: 100,
  },
};

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

async function flushMicrotasks() {
  await act(async () => {});
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('usePairingPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null preview when pairId is null', () => {
    const { result } = renderHook(() =>
      usePairingPreview('proj-1', null),
    );
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('loads preview when pairId is provided', async () => {
    mockGetPairingPairPreview.mockResolvedValue(MOCK_PREVIEW);
    const { result } = renderHook(() =>
      usePairingPreview('proj-1', 'pair-1'),
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.preview).not.toBeNull();
    expect(result.current.preview?.pair.id).toBe('pair-1');
    expect(result.current.preview?.sourceFile?.fileId).toBe('file-1');
    expect(result.current.preview?.translatedFile?.fileId).toBe('file-2');
    expect(mockGetPairingPairPreview).toHaveBeenCalledWith('proj-1', 'pair-1');
  });

  it('sets error on API failure', async () => {
    mockGetPairingPairPreview.mockRejectedValue(
      new Error('Preview unavailable'),
    );
    const { result } = renderHook(() =>
      usePairingPreview('proj-1', 'pair-1'),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain('Failed to load preview');
    expect(result.current.preview).toBeNull();
  });

  it('clears preview when pairId becomes null', async () => {
    mockGetPairingPairPreview.mockResolvedValue(MOCK_PREVIEW);
    const { result, rerender } = renderHook<UsePairingPreviewResult, { pairId: string | null }>(
      ({ pairId }) => usePairingPreview('proj-1', pairId),
      { initialProps: { pairId: 'pair-1' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.preview).not.toBeNull();

    rerender({ pairId: null });
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('discards stale preview when pairId changes rapidly', async () => {
    // Deferred promise for first (stale) preview request
    let resolveFirst: (v: unknown) => void = () => {};
    mockGetPairingPairPreview.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    mockGetPairingPairPreview.mockResolvedValue(MOCK_PREVIEW);

    const { result, rerender } = renderHook(
      ({ pairId }: { pairId: string | null }) =>
        usePairingPreview('proj-1', pairId),
      { initialProps: { pairId: 'pair-1' } },
    );

    // Switch to a different pair before first resolves
    rerender({ pairId: 'pair-2' });
    await flushMicrotasks();

    // Now resolve the stale first request
    await act(async () => {
      resolveFirst(MOCK_PREVIEW);
    });
    await flushMicrotasks();

    // Should have requested both pairs
    expect(mockGetPairingPairPreview).toHaveBeenCalledTimes(2);
    expect(mockGetPairingPairPreview.mock.calls[0][1]).toBe('pair-1');
    expect(mockGetPairingPairPreview.mock.calls[1][1]).toBe('pair-2');
  });

  it('clearPreview resets all state', async () => {
    mockGetPairingPairPreview.mockResolvedValue(MOCK_PREVIEW);
    const { result } = renderHook(() =>
      usePairingPreview('proj-1', 'pair-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.clearPreview();
    });

    expect(result.current.preview).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
