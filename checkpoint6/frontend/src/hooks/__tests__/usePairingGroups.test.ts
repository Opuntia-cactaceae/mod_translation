import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePairingGroups } from '../usePairingGroups';
import type { UsePairingGroupsResult } from '../usePairingGroups';

/* ------------------------------------------------------------------ */
/*  Mock api                                                            */
/* ------------------------------------------------------------------ */

const mockGetPairingGroups = vi.hoisted(() => vi.fn());

vi.mock('../../App', () => ({
  api: {
    getPairingGroups: mockGetPairingGroups,
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

const MOCK_GROUPS = [
  {
    group_key: 'group1',
    display_name: 'Group 1',
    relative_dir: '/',
    files_count: 2,
    source_like_count: 1,
    translated_like_count: 1,
    children: [],
    files: [
      {
        id: 'file-1',
        project_id: 'proj-1',
        relative_path: 'en/file.yml',
        file_name: 'file.yml',
        extension: '.yml',
        parent_dir: 'en',
        size_bytes: 100,
        content_hash: null,
        modified_at: null,
        detected_language: 'en',
        detected_role: 'source',
        group_key: null,
        is_ignored: false,
        created_at: '',
        updated_at: '',
      },
    ],
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

describe('usePairingGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with empty groups and loading=false when projectId is null', () => {
    const { result } = renderHook(() =>
      usePairingGroups(null, 'by_directory'),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.groups).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('loads groups when projectId is provided', async () => {
    mockGetPairingGroups.mockResolvedValue(MOCK_GROUPS);
    const { result } = renderHook(() =>
      usePairingGroups('proj-1', 'by_directory'),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.groups).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].groupKey).toBe('group1');
    expect(mockGetPairingGroups).toHaveBeenCalledWith('proj-1', 'by_directory');
  });

  it('sets error on API failure', async () => {
    mockGetPairingGroups.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() =>
      usePairingGroups('proj-1', 'by_directory'),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain('Failed to load file groups');
    expect(result.current.groups).toEqual([]);
  });

  it('reloads when groupingMode changes', async () => {
    mockGetPairingGroups.mockResolvedValue(MOCK_GROUPS);
    const { result, rerender } = renderHook(
      ({ projectId, groupingMode }: { projectId: string | null; groupingMode: string }) =>
        usePairingGroups(projectId, groupingMode),
      { initialProps: { projectId: 'proj-1', groupingMode: 'by_directory' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetPairingGroups).toHaveBeenCalledTimes(1);

    // Change grouping mode
    rerender({ projectId: 'proj-1', groupingMode: 'by_filename' });
    await waitFor(() => expect(mockGetPairingGroups).toHaveBeenCalledTimes(2));
    expect(mockGetPairingGroups).toHaveBeenLastCalledWith(
      'proj-1',
      'by_filename',
    );
  });

  it('clears groups when projectId becomes null', async () => {
    mockGetPairingGroups.mockResolvedValue(MOCK_GROUPS);
    const { result, rerender } = renderHook<UsePairingGroupsResult, { projectId: string | null }>(
      ({ projectId }) => usePairingGroups(projectId, 'by_directory'),
      { initialProps: { projectId: 'proj-1' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toHaveLength(1);

    rerender({ projectId: null });
    expect(result.current.groups).toEqual([]);
  });

  it('discards stale response when projectId changes rapidly', async () => {
    // Deferred promise for the first (stale) request
    let resolveFirst: (v: unknown) => void = () => {};
    mockGetPairingGroups.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    // Second request resolves immediately
    mockGetPairingGroups.mockResolvedValue(MOCK_GROUPS);

    const { result, rerender } = renderHook(
      ({ projectId, groupingMode }: { projectId: string | null; groupingMode: string }) =>
        usePairingGroups(projectId, groupingMode),
      { initialProps: { projectId: 'proj-1', groupingMode: 'by_directory' } },
    );

    // Switch project before first resolves
    rerender({ projectId: 'proj-2', groupingMode: 'by_directory' });
    await flushMicrotasks();

    // Now resolve the stale first request
    await act(async () => {
      resolveFirst(MOCK_GROUPS);
    });
    await flushMicrotasks();

    // The hook should have the SECOND project's data (or loading if still in flight)
    // and the first (stale) response was discarded
    expect(mockGetPairingGroups).toHaveBeenCalledTimes(2);
    expect(mockGetPairingGroups.mock.calls[0][0]).toBe('proj-1');
    expect(mockGetPairingGroups.mock.calls[1][0]).toBe('proj-2');
  });
});
