import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePairingPairs } from '../usePairingPairs';

/* ------------------------------------------------------------------ */
/*  Mock api                                                            */
/* ------------------------------------------------------------------ */

const mockListPairingPairs = vi.hoisted(() => vi.fn());
const mockCreatePairingPair = vi.hoisted(() => vi.fn());
const mockUpdatePairingPair = vi.hoisted(() => vi.fn());
const mockDeletePairingPair = vi.hoisted(() => vi.fn());
const mockSuggestPairingPairs = vi.hoisted(() => vi.fn());

vi.mock('../../App', () => ({
  api: {
    listPairingPairs: mockListPairingPairs,
    createPairingPair: mockCreatePairingPair,
    updatePairingPair: mockUpdatePairingPair,
    deletePairingPair: mockDeletePairingPair,
    suggestPairingPairs: mockSuggestPairingPairs,
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

const MOCK_PAIRS = [
  {
    id: 'pair-1',
    project_id: 'proj-1',
    source_file_id: 'file-1',
    translated_file_id: 'file-2',
    status: 'accepted',
    confidence: 0.95,
    reason: 'Language suffix match',
    created_by: 'auto',
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'pair-2',
    project_id: 'proj-1',
    source_file_id: 'file-3',
    translated_file_id: 'file-4',
    status: 'suggested',
    confidence: 0.6,
    reason: 'Weak match',
    created_by: 'auto',
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

async function flushMicrotasks() {
  await act(async () => {});
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('usePairingPairs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with empty pairs when projectId is null', () => {
    const { result } = renderHook(() => usePairingPairs(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.pairs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('loads pairs when projectId is provided', async () => {
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);
    const { result } = renderHook(() => usePairingPairs('proj-1'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pairs).toHaveLength(2);
    expect(result.current.pairs[0].id).toBe('pair-1');
    expect(result.current.pairs[0].status).toBe('accepted');
    expect(result.current.pairs[0].createdBy).toBe('auto'); // camelCase
    expect(mockListPairingPairs).toHaveBeenCalledWith('proj-1');
  });

  it('sets error on API failure', async () => {
    mockListPairingPairs.mockRejectedValue(new Error('Failed to load pairs'));
    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain('Failed to load pairs');
  });

  it('createPair calls api.createPairingPair and refreshes', async () => {
    mockCreatePairingPair.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListPairingPairs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.createPair('file-src', 'file-tgt');
    });

    expect(mockCreatePairingPair).toHaveBeenCalledWith('proj-1', {
      source_file_id: 'file-src',
      translated_file_id: 'file-tgt',
      notes: null,
    });
    // After create, listPairingPairs is called again (refresh)
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('updatePairStatus calls api.updatePairingPair and refreshes', async () => {
    mockUpdatePairingPair.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListPairingPairs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.updatePairStatus('pair-1', 'rejected');
    });

    expect(mockUpdatePairingPair).toHaveBeenCalledWith('proj-1', 'pair-1', {
      status: 'rejected',
    });
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('deletePair calls api.deletePairingPair and refreshes', async () => {
    mockDeletePairingPair.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deletePair('pair-1');
    });

    expect(mockDeletePairingPair).toHaveBeenCalledWith('proj-1', 'pair-1');
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('updatePairFiles calls api.updatePairingPair with { source_file_id } and refreshes', async () => {
    mockUpdatePairingPair.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListPairingPairs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.updatePairFiles('pair-1', { source_file_id: 'new-src-id' });
    });

    expect(mockUpdatePairingPair).toHaveBeenCalledWith('proj-1', 'pair-1', {
      source_file_id: 'new-src-id',
    });
    // After update, listPairingPairs is called again (refresh)
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('updatePairFiles calls api.updatePairingPair with { translated_file_id } and refreshes', async () => {
    mockUpdatePairingPair.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updatePairFiles('pair-1', { translated_file_id: 'new-tgt-id' });
    });

    expect(mockUpdatePairingPair).toHaveBeenCalledWith('proj-1', 'pair-1', {
      translated_file_id: 'new-tgt-id',
    });
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('updatePairFiles with explicit null source_file_id clears source slot', async () => {
    mockUpdatePairingPair.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updatePairFiles('pair-1', { source_file_id: null });
    });

    expect(mockUpdatePairingPair).toHaveBeenCalledWith('proj-1', 'pair-1', {
      source_file_id: null,
    });
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('updatePairFiles with explicit null translated_file_id clears translated slot', async () => {
    mockUpdatePairingPair.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updatePairFiles('pair-1', { translated_file_id: null });
    });

    expect(mockUpdatePairingPair).toHaveBeenCalledWith('proj-1', 'pair-1', {
      translated_file_id: null,
    });
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('suggestPairs calls api.suggestPairingPairs and refreshes', async () => {
    mockSuggestPairingPairs.mockResolvedValue({});
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.suggestPairs();
    });

    expect(mockSuggestPairingPairs).toHaveBeenCalledWith('proj-1', undefined);
    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });

  it('discards stale response when projectId changes rapidly', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    mockListPairingPairs.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) =>
        usePairingPairs(projectId),
      { initialProps: { projectId: 'proj-1' } },
    );

    // Switch project before first resolves
    rerender({ projectId: 'proj-2' });
    await flushMicrotasks();

    // Now resolve the stale first request
    await act(async () => {
      resolveFirst(MOCK_PAIRS);
    });
    await flushMicrotasks();

    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
    expect(mockListPairingPairs.mock.calls[0][0]).toBe('proj-1');
    expect(mockListPairingPairs.mock.calls[1][0]).toBe('proj-2');
  });

  it('refresh reloads pairs', async () => {
    mockListPairingPairs.mockResolvedValue(MOCK_PAIRS);
    const { result } = renderHook(() => usePairingPairs('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListPairingPairs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockListPairingPairs).toHaveBeenCalledTimes(2);
  });
});
