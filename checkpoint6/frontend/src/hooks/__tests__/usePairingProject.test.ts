import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePairingProject } from '../usePairingProject';
import type { UsePairingProjectResult } from '../usePairingProject';

/* ------------------------------------------------------------------ */
/*  Mock api                                                            */
/* ------------------------------------------------------------------ */

const mockGetPairingProject = vi.hoisted(() => vi.fn());

vi.mock('../../App', () => ({
  api: {
    getPairingProject: mockGetPairingProject,
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

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  root_path: '/game/mod',
  source_language: 'en',
  target_language: 'fr',
  status: 'active',
  last_scanned_at: '2025-01-15T10:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-15T10:00:00Z',
  notes: 'My project',
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('usePairingProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null project when projectId is null', () => {
    const { result } = renderHook(() => usePairingProject(null));
    expect(result.current.project).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('loads project when projectId is provided', async () => {
    mockGetPairingProject.mockResolvedValue(MOCK_PROJECT);
    const { result } = renderHook(() => usePairingProject('proj-1'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.project).not.toBeNull();
    expect(result.current.project?.id).toBe('proj-1');
    expect(result.current.project?.name).toBe('Test Project');
    expect(result.current.project?.rootPath).toBe('/game/mod');
    expect(mockGetPairingProject).toHaveBeenCalledWith('proj-1');
  });

  it('sets error on API failure', async () => {
    mockGetPairingProject.mockRejectedValue(new Error('Project not found'));
    const { result } = renderHook(() => usePairingProject('proj-1'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain('Failed to load project');
    expect(result.current.project).toBeNull();
  });

  it('refresh re-fetches the project', async () => {
    mockGetPairingProject.mockResolvedValue(MOCK_PROJECT);
    const { result } = renderHook(() => usePairingProject('proj-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetPairingProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockGetPairingProject).toHaveBeenCalledTimes(2);
  });

  it('clears project when projectId becomes null', async () => {
    mockGetPairingProject.mockResolvedValue(MOCK_PROJECT);
    const { result, rerender } = renderHook<UsePairingProjectResult, { projectId: string | null }>(
      ({ projectId }) => usePairingProject(projectId),
      { initialProps: { projectId: 'proj-1' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.project).not.toBeNull();

    rerender({ projectId: null });
    expect(result.current.project).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
