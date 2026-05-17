import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { JobModel } from '../../../domain';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockApi = vi.hoisted(() => ({
  startJob: vi.fn(),
  pauseJob: vi.fn(),
  resumeJob: vi.fn(),
  cancelJob: vi.fn(),
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

import { useJobActions } from '../useJobActions';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const mockJob: JobModel = {
  id: 'job-1',
  name: 'Test Job',
  status: 'pending',
  filePaths: ['/path/to/file.txt'],
  config: { model: 'gpt-4' },
  totalUnits: 10,
  completedUnits: 0,
  failedUnits: 0,
  cachedUnits: 0,
  progress: 0,
  currentBatchIndex: 0,
  totalBatches: 1,
  diagnostics: [],
  outputFiles: [],
};

function setup() {
  const reloadJobs = vi.fn().mockResolvedValue(undefined);
  const selectJob = vi.fn();
  const showToast = vi.fn();
  const { result } = renderHook(() => useJobActions({ reloadJobs, selectJob, showToast }));
  return { result, reloadJobs, selectJob, showToast };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useJobActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /*  Initial state                                                      */
  /* ------------------------------------------------------------------ */

  describe('initial state', () => {
    it('all loading IDs start null', () => {
      const { result } = setup();
      expect(result.current.startingJobId).toBeNull();
      expect(result.current.pausingJobId).toBeNull();
      expect(result.current.resumingJobId).toBeNull();
      expect(result.current.cancellingJobId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  startJob                                                           */
  /* ------------------------------------------------------------------ */

  describe('startJob', () => {
    it('calls API, shows success toast, reloads jobs on success', async () => {
      mockApi.startJob.mockResolvedValue({ success: true, message: 'ok' });
      const { result, reloadJobs, showToast } = setup();

      await act(async () => {
        await result.current.startJob(mockJob);
      });

      expect(mockApi.startJob).toHaveBeenCalledTimes(1);
      expect(mockApi.startJob).toHaveBeenCalledWith('job-1');
      expect(showToast).toHaveBeenCalledWith('Job started');
      expect(reloadJobs).toHaveBeenCalledTimes(1);
    });

    it('shows error toast when API returns success=false', async () => {
      mockApi.startJob.mockResolvedValue({ success: false, message: 'Cannot start' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.startJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Cannot start', 'error');
    });

    it('shows fallback error toast when API returns success=false with no message', async () => {
      mockApi.startJob.mockResolvedValue({ success: false, message: '' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.startJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to start', 'error');
    });

    it('shows ApiError message toast on ApiError rejection', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.startJob.mockRejectedValue(
        new ApiError({ message: 'Server error', code: 'ERR', details: {}, recoverable: false }),
      );
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.startJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Server error', 'error');
    });

    it('shows generic error toast on unknown error', async () => {
      mockApi.startJob.mockRejectedValue(new Error('Network failure'));
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.startJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to start job', 'error');
    });

    it('sets startingJobId during operation and clears after', async () => {
      let deferredResolve!: (v: { success: boolean; message: string }) => void;
      mockApi.startJob.mockImplementation(
        () => new Promise(resolve => { deferredResolve = resolve; }),
      );

      const { result } = setup();
      const promise = result.current.startJob(mockJob);

      await waitFor(() => {
        expect(result.current.startingJobId).toBe(mockJob.id);
      });

      await act(async () => {
        deferredResolve({ success: true, message: 'ok' });
      });
      await promise;

      expect(result.current.startingJobId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  pauseJob                                                           */
  /* ------------------------------------------------------------------ */

  describe('pauseJob', () => {
    it('calls API, shows success toast, reloads jobs on success', async () => {
      mockApi.pauseJob.mockResolvedValue({ success: true, message: 'ok' });
      const { result, reloadJobs, showToast } = setup();

      await act(async () => {
        await result.current.pauseJob(mockJob);
      });

      expect(mockApi.pauseJob).toHaveBeenCalledTimes(1);
      expect(mockApi.pauseJob).toHaveBeenCalledWith('job-1');
      expect(showToast).toHaveBeenCalledWith('Job paused');
      expect(reloadJobs).toHaveBeenCalledTimes(1);
    });

    it('shows error toast when API returns success=false', async () => {
      mockApi.pauseJob.mockResolvedValue({ success: false, message: 'Cannot pause' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.pauseJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Cannot pause', 'error');
    });

    it('shows fallback error toast when API returns success=false with no message', async () => {
      mockApi.pauseJob.mockResolvedValue({ success: false, message: '' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.pauseJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to pause', 'error');
    });

    it('shows ApiError message toast on ApiError rejection', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.pauseJob.mockRejectedValue(
        new ApiError({ message: 'Pause denied', code: 'ERR', details: {}, recoverable: false }),
      );
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.pauseJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Pause denied', 'error');
    });

    it('shows generic error toast on unknown error', async () => {
      mockApi.pauseJob.mockRejectedValue(new Error('Unexpected'));
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.pauseJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to pause job', 'error');
    });

    it('sets pausingJobId during operation and clears after', async () => {
      let deferredResolve!: (v: { success: boolean; message: string }) => void;
      mockApi.pauseJob.mockImplementation(
        () => new Promise(resolve => { deferredResolve = resolve; }),
      );

      const { result } = setup();
      const promise = result.current.pauseJob(mockJob);

      await waitFor(() => {
        expect(result.current.pausingJobId).toBe(mockJob.id);
      });

      await act(async () => {
        deferredResolve({ success: true, message: 'ok' });
      });
      await promise;

      expect(result.current.pausingJobId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  resumeJob                                                          */
  /* ------------------------------------------------------------------ */

  describe('resumeJob', () => {
    it('calls API, shows success toast, reloads jobs on success', async () => {
      mockApi.resumeJob.mockResolvedValue({ success: true, message: 'ok' });
      const { result, reloadJobs, showToast } = setup();

      await act(async () => {
        await result.current.resumeJob(mockJob);
      });

      expect(mockApi.resumeJob).toHaveBeenCalledTimes(1);
      expect(mockApi.resumeJob).toHaveBeenCalledWith('job-1');
      expect(showToast).toHaveBeenCalledWith('Job resumed');
      expect(reloadJobs).toHaveBeenCalledTimes(1);
    });

    it('shows error toast when API returns success=false', async () => {
      mockApi.resumeJob.mockResolvedValue({ success: false, message: 'Cannot resume' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.resumeJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Cannot resume', 'error');
    });

    it('shows fallback error toast when API returns success=false with no message', async () => {
      mockApi.resumeJob.mockResolvedValue({ success: false, message: '' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.resumeJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to resume', 'error');
    });

    it('shows ApiError message toast on ApiError rejection', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.resumeJob.mockRejectedValue(
        new ApiError({ message: 'Resume denied', code: 'ERR', details: {}, recoverable: false }),
      );
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.resumeJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Resume denied', 'error');
    });

    it('shows generic error toast on unknown error', async () => {
      mockApi.resumeJob.mockRejectedValue(new Error('Unexpected'));
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.resumeJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to resume job', 'error');
    });

    it('sets resumingJobId during operation and clears after', async () => {
      let deferredResolve!: (v: { success: boolean; message: string }) => void;
      mockApi.resumeJob.mockImplementation(
        () => new Promise(resolve => { deferredResolve = resolve; }),
      );

      const { result } = setup();
      const promise = result.current.resumeJob(mockJob);

      await waitFor(() => {
        expect(result.current.resumingJobId).toBe(mockJob.id);
      });

      await act(async () => {
        deferredResolve({ success: true, message: 'ok' });
      });
      await promise;

      expect(result.current.resumingJobId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  cancelJob                                                          */
  /* ------------------------------------------------------------------ */

  describe('cancelJob', () => {
    it('calls API, shows success toast, reloads jobs on success', async () => {
      mockApi.cancelJob.mockResolvedValue({ success: true, message: 'ok' });
      const { result, reloadJobs, showToast } = setup();

      await act(async () => {
        await result.current.cancelJob(mockJob);
      });

      expect(mockApi.cancelJob).toHaveBeenCalledTimes(1);
      expect(mockApi.cancelJob).toHaveBeenCalledWith('job-1');
      expect(showToast).toHaveBeenCalledWith('Job cancelled');
      expect(reloadJobs).toHaveBeenCalledTimes(1);
    });

    it('shows error toast when API returns success=false', async () => {
      mockApi.cancelJob.mockResolvedValue({ success: false, message: 'Cannot cancel' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.cancelJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Cannot cancel', 'error');
    });

    it('shows fallback error toast when API returns success=false with no message', async () => {
      mockApi.cancelJob.mockResolvedValue({ success: false, message: '' });
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.cancelJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to cancel', 'error');
    });

    it('shows ApiError message toast on ApiError rejection', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.cancelJob.mockRejectedValue(
        new ApiError({ message: 'Cancel denied', code: 'ERR', details: {}, recoverable: false }),
      );
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.cancelJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Cancel denied', 'error');
    });

    it('shows generic error toast on unknown error', async () => {
      mockApi.cancelJob.mockRejectedValue(new Error('Unexpected'));
      const { result, showToast } = setup();

      await act(async () => {
        await result.current.cancelJob(mockJob);
      });

      expect(showToast).toHaveBeenCalledWith('Failed to cancel job', 'error');
    });

    it('sets cancellingJobId during operation and clears after', async () => {
      let deferredResolve!: (v: { success: boolean; message: string }) => void;
      mockApi.cancelJob.mockImplementation(
        () => new Promise(resolve => { deferredResolve = resolve; }),
      );

      const { result } = setup();
      const promise = result.current.cancelJob(mockJob);

      await waitFor(() => {
        expect(result.current.cancellingJobId).toBe(mockJob.id);
      });

      await act(async () => {
        deferredResolve({ success: true, message: 'ok' });
      });
      await promise;

      expect(result.current.cancellingJobId).toBeNull();
    });
  });
});
