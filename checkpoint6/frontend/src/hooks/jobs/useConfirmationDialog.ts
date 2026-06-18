import { useState, useCallback, useRef } from 'react';
import type { JobModel } from '../../domain';
import type { JobActionsApi, JobRecoveryApi } from './types';
import type { useBulkJobActions } from './useBulkJobActions';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ConfirmActionType =
  | 'pause'
  | 'cancel'
  | 'restart'
  | 'retry'
  | 'bulk_pause'
  | 'bulk_cancel';

export interface ConfirmAction {
  action: ConfirmActionType;
  jobId?: string;
  count?: number;
}

interface UseConfirmationDialogDeps {
  jobs: JobModel[];
  jobActions: JobActionsApi;
  bulkActions: ReturnType<typeof useBulkJobActions>;
  recovery: JobRecoveryApi;
}

/* ------------------------------------------------------------------ */
/*  Action dispatch registry (decouples dispatch logic from state)     */
/* ------------------------------------------------------------------ */

function buildDispatchMap(deps: UseConfirmationDialogDeps) {
  return {
    bulk_cancel: () => deps.bulkActions.cancelAll(),
    bulk_pause: () => deps.bulkActions.pauseAll(),
    restart: (job: JobModel) => deps.recovery.restartJob(job),
    retry: (job: JobModel) => deps.recovery.retryFailedJob(job),
    pause: (job: JobModel) => deps.jobActions.pauseJob(job),
    cancel: (job: JobModel) => deps.jobActions.cancelJob(job),
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useConfirmationDialog(deps: UseConfirmationDialogDeps) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const requestConfirm = useCallback((
    action: ConfirmActionType,
    opts?: { jobId?: string; count?: number },
  ) => {
    setConfirmAction({ action, ...opts });
  }, []);

  const handleConfirm = useCallback(() => {
    const a = confirmAction;
    if (!a) return;
    const currentDeps = depsRef.current;
    const dispatchMap = buildDispatchMap(currentDeps);

    const { action, jobId } = a;
    const handler = dispatchMap[action];

    if (action === 'bulk_cancel' || action === 'bulk_pause') {
      (handler as () => void)();
    } else {
      const job = jobId ? currentDeps.jobs.find(j => j.id === jobId) : undefined;
      if (job && handler) (handler as (job: JobModel) => void)(job);
    }

    setConfirmAction(null);
  }, [confirmAction]);

  const clearConfirm = useCallback(() => {
    setConfirmAction(null);
  }, []);

  return {
    confirmAction,
    requestConfirm,
    handleConfirm,
    clearConfirm,
  };
}
