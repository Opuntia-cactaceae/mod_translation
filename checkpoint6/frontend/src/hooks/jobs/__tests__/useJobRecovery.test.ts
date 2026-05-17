import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { JobModel } from '../../../domain';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockApi = vi.hoisted(() => ({
  createJob: vi.fn(),
  startJob: vi.fn(),
  retryFailed: vi.fn(),
}));

vi.mock('../../../App', () => ({
  api: mockApi,
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

import { useJobRecovery } from '../useJobRecovery';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

function createJob(overrides: Partial<JobModel> = {}): JobModel {
  return {
    id: 'job-1',
    name: 'Test Job',
    status: 'failed',
    filePaths: ['/path/to/file1.txt', '/path/to/file2.txt'],
    config: { model: 'gpt-4' },
    totalUnits: 10,
    completedUnits: 5,
    failedUnits: 3,
    cachedUnits: 0,
    progress: 50,
    currentBatchIndex: 1,
    totalBatches: 2,
    diagnostics: [],
    outputFiles: [],
    ...overrides,
  };
}

function setup() {
  const reloadJobs = vi.fn().mockResolvedValue(undefined);
  const selectJob = vi.fn();
  const showToast = vi.fn();
  const { result } = renderHook(() => useJobRecovery({ reloadJobs, selectJob, showToast }));
  return { result, reloadJobs, selectJob, showToast };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useJobRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /*  Initial state                                                      */
  /* ------------------------------------------------------------------ */

  describe('initial state', () => {
    it('all loading IDs start null', () => {
      const { result } = setup();
      expect(result.current.restartingJobId).toBeNull();
      expect(result.current.retryingJobId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  restartJob                                                         */
  /* ------------------------------------------------------------------ */

  describe('restartJob', () => {
    it('creates new job, starts it, shows success toast, selects, reloads', async () => {
      mockApi.createJob.mockResolvedValue({ id: 'new-job-1', name: 'Test Job (restart)' });
      mockApi.startJob.mockResolvedValue({ success: true, message: 'ok' });

      const { result, reloadJobs, selectJob, showToast } = setup();
      const job = createJob();

      await act(async () => {
        await result.current.restartJob(job);
      });

      expect(mockApi.createJob).toHaveBeenCalledWith({
        file_paths: job.filePaths,
        name: 'Test Job (restart)',
        config: { model: 'gpt-4' },
      });
      expect(mockApi.startJob).toHaveBeenCalledWith('new-job-1');
      expect(showToast).toHaveBeenCalledWith('New job created and started: "Test Job (restart)"');
      expect(selectJob).toHaveBeenCalledWith('new-job-1');
      expect(reloadJobs).toHaveBeenCalledTimes(1);
    });

    it('uses default name when job has no name', async () => {
      mockApi.createJob.mockResolvedValue({ id: 'new-job-2', name: ' (restart)' });
      mockApi.startJob.mockResolvedValue({ success: true, message: 'ok' });

      const { result, showToast } = setup();
      const job = createJob({ name: '' });

      await act(async () => {
        await result.current.restartJob(job);
      });

      expect(mockApi.createJob).toHaveBeenCalledWith({
        file_paths: job.filePaths,
        name: undefined,
        config: { model: 'gpt-4' },
      });
      expect(showToast).toHaveBeenCalledWith('New job created and started: " (restart)"');
    });

    it('shows error toast when job has no filePaths', async () => {
      const { result, showToast } = setup();
      const job = createJob({ filePaths: [] });

      await act(async () => {
        await result.current.restartJob(job);
      });

      expect(showToast).toHaveBeenCalledWith('Cannot restart: no file paths', 'error');
      expect(mockApi.createJob).not.toHaveBeenCalled();
    });

    it('shows error toast when job has no config', async () => {
      const { result, showToast } = setup();
      const job = createJob({ config: null });

      await act(async () => {
        await result.current.restartJob(job);
      });

      expect(showToast).toHaveBeenCalledWith('Cannot restart: no config', 'error');
      expect(mockApi.createJob).not.toHaveBeenCalled();
    });

    it('shows ApiError message toast on ApiError rejection', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.createJob.mockRejectedValue(
        new ApiError({ message: 'Creation failed', code: 'ERR', details: {}, recoverable: false }),
      );

      const { result, showToast } = setup();

      await act(async () => {
        await result.current.restartJob(createJob());
      });

      expect(showToast).toHaveBeenCalledWith('Creation failed', 'error');
    });

    it('shows generic error toast on unknown error', async () => {
      mockApi.createJob.mockRejectedValue(new Error('Network failure'));

      const { result, showToast } = setup();

      await act(async () => {
        await result.current.restartJob(createJob());
      });

      expect(showToast).toHaveBeenCalledWith('Failed to restart job', 'error');
    });

    it('sets restartingJobId during operation and clears after', async () => {
      let deferredResolve!: (v: { id: string; name: string }) => void;
      mockApi.createJob.mockImplementation(
        () => new Promise(resolve => { deferredResolve = resolve; }),
      );
      mockApi.startJob.mockResolvedValue({ success: true, message: 'ok' });

      const { result } = setup();
      const promise = result.current.restartJob(createJob());

      await waitFor(() => {
        expect(result.current.restartingJobId).toBe('job-1');
      });

      await act(async () => {
        deferredResolve({ id: 'new-job-1', name: 'Test Job (restart)' });
      });
      await promise;

      expect(result.current.restartingJobId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  retryFailedJob                                                     */
  /* ------------------------------------------------------------------ */

  describe('retryFailedJob', () => {
    it('calls retryFailed endpoint, shows success toast, selects, reloads', async () => {
      mockApi.retryFailed.mockResolvedValue({
        success: true,
        job: { id: 'retry-job-1', name: 'Test Job (retry failed)', total_units: 3 },
        message: 'Retry job created with 3 failed units',
      });

      const { result, reloadJobs, selectJob, showToast } = setup();
      const job = createJob({ failedUnits: 3 });

      await act(async () => {
        await result.current.retryFailedJob(job);
      });

      expect(mockApi.retryFailed).toHaveBeenCalledWith('job-1');
      expect(mockApi.createJob).not.toHaveBeenCalled();
      expect(mockApi.startJob).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'Retry job created: "Test Job (retry failed)" with 3 failed units',
      );
      expect(selectJob).toHaveBeenCalledWith('retry-job-1');
      expect(reloadJobs).toHaveBeenCalledTimes(1);
    });

    it('shows warning toast when no failed units', async () => {
      const { result, showToast } = setup();
      const job = createJob({ failedUnits: 0 });

      await act(async () => {
        await result.current.retryFailedJob(job);
      });

      expect(showToast).toHaveBeenCalledWith('No failed units to retry', 'warning');
      expect(mockApi.retryFailed).not.toHaveBeenCalled();
    });

    it('shows warning toast when failedUnits is negative', async () => {
      const { result, showToast } = setup();
      const job = createJob({ failedUnits: -1 });

      await act(async () => {
        await result.current.retryFailedJob(job);
      });

      expect(showToast).toHaveBeenCalledWith('No failed units to retry', 'warning');
      expect(mockApi.retryFailed).not.toHaveBeenCalled();
    });

    it('shows error toast when API returns success=false', async () => {
      mockApi.retryFailed.mockResolvedValue({ success: false, message: 'Cannot retry' });

      const { result, showToast } = setup();

      await act(async () => {
        await result.current.retryFailedJob(createJob({ failedUnits: 3 }));
      });

      expect(showToast).toHaveBeenCalledWith('Cannot retry', 'error');
    });

    it('shows fallback error toast when API returns success=false with no message', async () => {
      mockApi.retryFailed.mockResolvedValue({ success: false, message: '' });

      const { result, showToast } = setup();

      await act(async () => {
        await result.current.retryFailedJob(createJob({ failedUnits: 3 }));
      });

      expect(showToast).toHaveBeenCalledWith('Failed to retry', 'error');
    });

    it('shows ApiError message toast on ApiError rejection', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.retryFailed.mockRejectedValue(
        new ApiError({ message: 'Retry failed', code: 'ERR', details: {}, recoverable: false }),
      );

      const { result, showToast } = setup();

      await act(async () => {
        await result.current.retryFailedJob(createJob({ failedUnits: 3 }));
      });

      expect(showToast).toHaveBeenCalledWith('Retry failed', 'error');
    });

    it('shows generic error toast on unknown error', async () => {
      mockApi.retryFailed.mockRejectedValue(new Error('Network failure'));

      const { result, showToast } = setup();

      await act(async () => {
        await result.current.retryFailedJob(createJob({ failedUnits: 3 }));
      });

      expect(showToast).toHaveBeenCalledWith('Failed to retry', 'error');
    });

    it('sets retryingJobId during operation and clears after', async () => {
      let deferredResolve!: (v: { success: boolean; job: { id: string; name: string; total_units: number }; message: string }) => void;
      mockApi.retryFailed.mockImplementation(
        () => new Promise(resolve => { deferredResolve = resolve; }),
      );

      const { result } = setup();
      const promise = result.current.retryFailedJob(createJob({ failedUnits: 3 }));

      await waitFor(() => {
        expect(result.current.retryingJobId).toBe('job-1');
      });

      await act(async () => {
        deferredResolve({ success: true, job: { id: 'retry-job-1', name: 'Retry', total_units: 3 }, message: 'ok' });
      });
      await promise;

      expect(result.current.retryingJobId).toBeNull();
    });
  });
});
