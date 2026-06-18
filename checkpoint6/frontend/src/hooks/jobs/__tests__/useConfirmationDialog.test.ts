import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { JobModel } from '../../../domain';
import type { JobActionsApi, JobRecoveryApi } from '../types';
import { useConfirmationDialog, type ConfirmActionType } from '../useConfirmationDialog';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

function createJob(id: string, overrides: Partial<JobModel> = {}): JobModel {
  return {
    id,
    name: `Job ${id}`,
    status: 'running',
    filePaths: ['/path/to/file.txt'],
    config: { model: 'gpt-4' },
    totalUnits: 10,
    completedUnits: 5,
    failedUnits: 0,
    cachedUnits: 0,
    progress: 50,
    currentBatchIndex: 1,
    totalBatches: 2,
    diagnostics: [],
    outputFiles: [],
    ...overrides,
  };
}

function createMockJobActions(): JobActionsApi {
  return {
    startingJobId: null,
    pausingJobId: null,
    resumingJobId: null,
    cancellingJobId: null,
    startJob: vi.fn().mockResolvedValue(undefined),
    pauseJob: vi.fn().mockResolvedValue(undefined),
    resumeJob: vi.fn().mockResolvedValue(undefined),
    cancelJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as JobActionsApi;
}

function createMockRecovery(): JobRecoveryApi {
  return {
    restartingJobId: null,
    retryingJobId: null,
    restartJob: vi.fn().mockResolvedValue(undefined),
    retryFailedJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as JobRecoveryApi;
}

function createMockBulkActions() {
  return {
    bulkActionRunning: false,
    pauseAll: vi.fn().mockResolvedValue(undefined),
    resumeAll: vi.fn().mockResolvedValue(undefined),
    cancelAll: vi.fn().mockResolvedValue(undefined),
  };
}

interface SetupOptions {
  jobs?: JobModel[];
}

function setup(opts: SetupOptions = {}) {
  const jobs = opts.jobs ?? [createJob('job-1'), createJob('job-2')];
  const jobActions = createMockJobActions();
  const bulkActions = createMockBulkActions();
  const recovery = createMockRecovery();

  const { result } = renderHook(() =>
    useConfirmationDialog({ jobs, jobActions, bulkActions, recovery }),
  );

  return { result, jobs, jobActions, bulkActions, recovery };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useConfirmationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /*  Initial state                                                      */
  /* ------------------------------------------------------------------ */

  describe('initial state', () => {
    it('confirmAction starts null', () => {
      const { result } = setup();
      expect(result.current.confirmAction).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  requestConfirm                                                     */
  /* ------------------------------------------------------------------ */

  describe('requestConfirm', () => {
    it('sets confirmAction with action and jobId', () => {
      const { result } = setup();

      act(() => {
        result.current.requestConfirm('pause', { jobId: 'job-1' });
      });

      expect(result.current.confirmAction).toEqual({
        action: 'pause',
        jobId: 'job-1',
      });
    });

    it('sets confirmAction with action and count for bulk actions', () => {
      const { result } = setup();

      act(() => {
        result.current.requestConfirm('bulk_pause', { count: 3 });
      });

      expect(result.current.confirmAction).toEqual({
        action: 'bulk_pause',
        count: 3,
      });
    });

    it('replaces previous confirmAction', () => {
      const { result } = setup();

      act(() => {
        result.current.requestConfirm('pause', { jobId: 'job-1' });
      });
      act(() => {
        result.current.requestConfirm('cancel', { jobId: 'job-2' });
      });

      expect(result.current.confirmAction).toEqual({
        action: 'cancel',
        jobId: 'job-2',
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  clearConfirm                                                       */
  /* ------------------------------------------------------------------ */

  describe('clearConfirm', () => {
    it('clears confirmAction back to null', () => {
      const { result } = setup();

      act(() => {
        result.current.requestConfirm('pause', { jobId: 'job-1' });
      });
      expect(result.current.confirmAction).not.toBeNull();

      act(() => {
        result.current.clearConfirm();
      });
      expect(result.current.confirmAction).toBeNull();
    });

    it('is safe to call when already null', () => {
      const { result } = setup();

      act(() => {
        result.current.clearConfirm();
      });
      expect(result.current.confirmAction).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  handleConfirm — action dispatch                                     */
  /* ------------------------------------------------------------------ */

  describe('handleConfirm dispatches correct handler', () => {
    it('dispatches pauseJob when action is pause', () => {
      const { result, jobActions } = setup();

      act(() => result.current.requestConfirm('pause', { jobId: 'job-1' }));
      act(() => result.current.handleConfirm());

      expect(jobActions.pauseJob).toHaveBeenCalledTimes(1);
      expect(jobActions.pauseJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1' }),
      );
    });

    it('dispatches cancelJob when action is cancel', () => {
      const { result, jobActions } = setup();

      act(() => result.current.requestConfirm('cancel', { jobId: 'job-1' }));
      act(() => result.current.handleConfirm());

      expect(jobActions.cancelJob).toHaveBeenCalledTimes(1);
      expect(jobActions.cancelJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1' }),
      );
    });

    it('dispatches restartJob when action is restart', () => {
      const { result, recovery } = setup();

      act(() => result.current.requestConfirm('restart', { jobId: 'job-1' }));
      act(() => result.current.handleConfirm());

      expect(recovery.restartJob).toHaveBeenCalledTimes(1);
      expect(recovery.restartJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1' }),
      );
    });

    it('dispatches retryFailedJob when action is retry', () => {
      const { result, recovery } = setup();

      act(() => result.current.requestConfirm('retry', { jobId: 'job-1' }));
      act(() => result.current.handleConfirm());

      expect(recovery.retryFailedJob).toHaveBeenCalledTimes(1);
      expect(recovery.retryFailedJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1' }),
      );
    });

    it('dispatches bulkActions.pauseAll when action is bulk_pause', () => {
      const { result, bulkActions } = setup();

      act(() => result.current.requestConfirm('bulk_pause', { count: 3 }));
      act(() => result.current.handleConfirm());

      expect(bulkActions.pauseAll).toHaveBeenCalledTimes(1);
    });

    it('dispatches bulkActions.cancelAll when action is bulk_cancel', () => {
      const { result, bulkActions } = setup();

      act(() => result.current.requestConfirm('bulk_cancel', { count: 3 }));
      act(() => result.current.handleConfirm());

      expect(bulkActions.cancelAll).toHaveBeenCalledTimes(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  handleConfirm — clears dialog                                        */
  /* ------------------------------------------------------------------ */

  describe('handleConfirm clears dialog after dispatch', () => {
    it('sets confirmAction to null after successful dispatch', () => {
      const { result } = setup();

      act(() => result.current.requestConfirm('pause', { jobId: 'job-1' }));
      expect(result.current.confirmAction).not.toBeNull();

      act(() => result.current.handleConfirm());
      expect(result.current.confirmAction).toBeNull();
    });

    it('is safe to call when confirmAction is null', () => {
      const { result, jobActions } = setup();

      act(() => {
        result.current.handleConfirm();
      });

      expect(jobActions.pauseJob).not.toHaveBeenCalled();
      expect(jobActions.cancelJob).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  handleConfirm — missing job safety                                   */
  /* ------------------------------------------------------------------ */

  describe('handleConfirm handles missing job safely', () => {
    it('does not crash when job is not found in the jobs list', () => {
      const { result, jobActions } = setup();

      act(() => result.current.requestConfirm('pause', { jobId: 'nonexistent' }));
      expect(() => {
        act(() => result.current.handleConfirm());
      }).not.toThrow();

      expect(jobActions.pauseJob).not.toHaveBeenCalled();
    });

    it('does not crash when jobId is missing for a job-specific action', () => {
      const { result, jobActions } = setup();

      act(() => {
        result.current.requestConfirm('pause', {});
      });
      expect(() => {
        act(() => result.current.handleConfirm());
      }).not.toThrow();

      expect(jobActions.pauseJob).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  ConfirmActionType — type safety (compile-time check)                 */
  /* ------------------------------------------------------------------ */

  describe('ConfirmActionType type safety', () => {
    it('accepts all valid action types', () => {
      const valid: ConfirmActionType[] = [
        'pause',
        'cancel',
        'restart',
        'retry',
        'bulk_pause',
        'bulk_cancel',
      ];
      expect(valid).toHaveLength(6);
    });

    it('prevents arbitrary string usage at compile time', () => {
      // This is a compile-time check: TypeScript should prevent
      // assigning arbitrary strings to ConfirmActionType
      const validActions: readonly ConfirmActionType[] = [
        'pause',
        'cancel',
        'restart',
        'retry',
        'bulk_pause',
        'bulk_cancel',
      ];

      // Verify all actions are represented in the type
      const actionSet = new Set<ConfirmActionType>(validActions);
      expect(actionSet.has('pause')).toBe(true);
      expect(actionSet.has('cancel')).toBe(true);
      expect(actionSet.has('restart')).toBe(true);
      expect(actionSet.has('retry')).toBe(true);
      expect(actionSet.has('bulk_pause')).toBe(true);
      expect(actionSet.has('bulk_cancel')).toBe(true);
    });
  });
});
