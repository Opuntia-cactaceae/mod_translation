/* ------------------------------------------------------------------ */
/*  Tests: useTranslateDiscoveryFiles hook                              */
/*                                                                      */
/*  Focus: race conditions, double-click guard, unmount guard,          */
/*  duplicate detection semantics, draft interaction.                    */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React from 'react';
import { useTranslateDiscoveryFiles } from '../useTranslateDiscoveryFiles';
import { DraftJobSelectionProvider } from '../../contexts/DraftJobSelectionContext';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockNavigate = vi.fn();
const mockShowToast = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../App', () => ({
  api: {
    listJobs: vi.fn(),
    getDraftJobSelection: vi.fn(),
    addDraftFiles: vi.fn(),
    removeDraftFiles: vi.fn(),
    clearDraftJobSelection: vi.fn(),
  },
  useToast: () => ({
    showToast: mockShowToast,
  }),
  ApiError: class extends Error {
    constructor(msg: string) { super(msg); this.name = 'ApiError'; }
  },
}));

import { api } from '../../App';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const OPTIONS = {
  files: ['/game/file1.yml', '/game/file2.yml'],
  gameId: 'game-1',
  gameLabel: 'Test Game',
};

const EXISTING_JOB = {
  id: 'job-1',
  name: 'Test Job',
  status: 'completed' as const,
  file_paths: ['/game/file1.yml', '/game/file2.yml'],
  filePaths: ['/game/file1.yml', '/game/file2.yml'],
  total_units: 10,
  totalUnits: 10,
  completed_units: 10,
  completedUnits: 10,
  failed_units: 0,
  failedUnits: 0,
  cached_units: 0,
  cachedUnits: 0,
  progress: 1,
  created_at: '2024-06-01T12:00:00Z',
  current_batch_index: 0,
  total_batches: 1,
  diagnostics: [],
  output_files: [],
  outputFiles: [],
};

/* ================================================================== */
/*  Wrapper                                                            */
/* ================================================================== */

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(DraftJobSelectionProvider, null, children);
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function setupDraft(initialFiles: string[] = []) {
  vi.mocked(api.getDraftJobSelection).mockResolvedValue({
    files: initialFiles,
    file_metadata: {},
    grouped: [],
    diagnostics: [],
    count: initialFiles.length,
  });
  vi.mocked(api.addDraftFiles).mockImplementation(
    (data: { file_paths: string[] }) =>
      Promise.resolve({
        files: data.file_paths,
        file_metadata: {},
        grouped: [],
        diagnostics: [],
        count: data.file_paths.length,
      }),
  );
  vi.mocked(api.removeDraftFiles).mockResolvedValue({
    files: [],
    file_metadata: {},
    grouped: [],
    diagnostics: [],
    count: 0,
  });
  vi.mocked(api.clearDraftJobSelection).mockResolvedValue({
    files: [],
    file_metadata: {},
    grouped: [],
    diagnostics: [],
    count: 0,
  });
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useTranslateDiscoveryFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDraft();
    vi.mocked(api.listJobs).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  /* ---- Basic flow ---- */

  it('translateAll adds files to draft and navigates to /jobs', async () => {
    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    await act(async () => {
      const res = await result.current.translateAll(OPTIONS, true);
      expect(res.addedFiles).toEqual(['/game/file1.yml', '/game/file2.yml']);
      expect(res.skippedFiles).toEqual([]);
      expect(res.navigated).toBe(true);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/jobs');
  });

  it('translateAll detects duplicates when skipDuplicateCheck is false', async () => {
    vi.mocked(api.listJobs).mockResolvedValue([EXISTING_JOB]);

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    await act(async () => {
      const res = await result.current.translateAll(OPTIONS, false);
      expect(res.isDuplicate).toBe(true);
      expect(res.existingJobId).toBe('job-1');
    });

    expect(result.current.duplicateInfo.hasDuplicates).toBe(true);
    expect(result.current.duplicateInfo.duplicateJobs).toHaveLength(1);
  });

  it('returns empty result for empty files list', async () => {
    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    await act(async () => {
      const res = await result.current.translateAll(
        { files: [], gameId: 'g', gameLabel: 'G' },
        false,
      );
      expect(res.navigated).toBe(false);
      expect(res.addedFiles).toEqual([]);
    });

    expect(mockShowToast).toHaveBeenCalledWith('No files to translate', 'error');
  });

  it('checkExistingJobs returns matching jobs', async () => {
    vi.mocked(api.listJobs).mockResolvedValue([EXISTING_JOB]);

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    let matches: any[];
    await act(async () => {
      matches = await result.current.checkExistingJobs(['/game/file1.yml', '/game/file2.yml']);
    });

    expect(matches!).toHaveLength(1);
    expect(matches![0].id).toBe('job-1');
  });

  it('checkExistingJobs returns empty for non-matching files', async () => {
    vi.mocked(api.listJobs).mockResolvedValue([EXISTING_JOB]);

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    let matches: any[];
    await act(async () => {
      matches = await result.current.checkExistingJobs(['/other/file3.yml']);
    });

    expect(matches!).toHaveLength(0);
  });

  it('clearDuplicateInfo resets duplicate state', async () => {
    vi.mocked(api.listJobs).mockResolvedValue([EXISTING_JOB]);

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    await act(async () => {
      await result.current.translateAll(OPTIONS, false);
    });

    expect(result.current.duplicateInfo.hasDuplicates).toBe(true);

    act(() => {
      result.current.clearDuplicateInfo();
    });

    expect(result.current.duplicateInfo.hasDuplicates).toBe(false);
    expect(result.current.duplicateInfo.duplicateJobs).toEqual([]);
  });

  /* ---- Race conditions ---- */

  it('second translateAll call invalidates first (double-click guard)', async () => {
    // Simulate a slow listJobs response
    let resolveFirst: (v: any) => void;
    const firstPromise = new Promise<any>(resolve => { resolveFirst = resolve; });
    vi.mocked(api.listJobs).mockReturnValueOnce(firstPromise);
    vi.mocked(api.listJobs).mockReturnValueOnce(Promise.resolve([]));

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    // Start first translateAll (will hang)
    let firstResult: any;
    let secondResult: any;
    act(() => {
      result.current.translateAll(OPTIONS, false).then(r => { firstResult = r; });
    });

    // Start second translateAll immediately (fast)
    await act(async () => {
      secondResult = await result.current.translateAll(OPTIONS, false);
    });

    // Resolve first translateAll
    await act(async () => {
      resolveFirst!([]);
      // Wait for the next tick so the stale-guarded code path runs
      await new Promise(r => setTimeout(r, 10));
    });

    // First result should be stale-guarded (no navigation)
    expect(firstResult).toBeDefined();
    expect(firstResult.navigated).toBe(false);
    expect(firstResult.addedFiles).toEqual([]);

    // Second result should have navigated
    expect(secondResult.navigated).toBe(true);
  });

  it('unmount during translateAll does not call setState', async () => {
    // Make listJobs slow so we can unmount mid-flight
    let resolveJobs: (v: any) => void;
    const jobsPromise = new Promise<any>(resolve => { resolveJobs = resolve; });
    vi.mocked(api.listJobs).mockReturnValueOnce(jobsPromise);

    const { result, unmount } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    // Start translate and unmount before it resolves
    act(() => {
      result.current.translateAll(OPTIONS, false);
    });

    // Unmount while request is pending
    unmount();

    // Resolve the jobs request
    await act(async () => {
      resolveJobs!([]);
      await new Promise(r => setTimeout(r, 10));
    });

    // Should not have navigated (unmounted)
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  /* ---- Duplicate detection semantics ---- */

  it('fileSetsMatch detects order-independent match', async () => {
    vi.mocked(api.listJobs).mockResolvedValue([EXISTING_JOB]);

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    // Query with reversed file order
    let matches: any[];
    await act(async () => {
      matches = await result.current.checkExistingJobs(['/game/file2.yml', '/game/file1.yml']);
    });

    expect(matches!).toHaveLength(1);
  });

  it('fileSetsMatch rejects subset', async () => {
    vi.mocked(api.listJobs).mockResolvedValue([EXISTING_JOB]);

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    let matches: any[];
    await act(async () => {
      matches = await result.current.checkExistingJobs(['/game/file1.yml']);
    });

    expect(matches!).toHaveLength(0);
  });

  it('fileSetsMatch rejects superset', async () => {
    vi.mocked(api.listJobs).mockResolvedValue([EXISTING_JOB]);

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    let matches: any[];
    await act(async () => {
      matches = await result.current.checkExistingJobs([
        '/game/file1.yml',
        '/game/file2.yml',
        '/game/file3.yml',
      ]);
    });

    expect(matches!).toHaveLength(0);
  });

  it('handles api.listJobs failure gracefully', async () => {
    vi.mocked(api.listJobs).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useTranslateDiscoveryFiles(), { wrapper });

    let matches: any[];
    await act(async () => {
      matches = await result.current.checkExistingJobs(['/game/file1.yml']);
    });

    expect(matches!).toEqual([]);
  });
});
