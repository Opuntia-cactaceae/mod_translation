import { useState, useCallback } from 'react';
import { api } from '../../App';
import { canPauseJob, canResumeJob, canCancelJob } from '../../domain';
import { runWithLimit } from '../../utils/async';
import type { JobModel } from '../../domain';

interface UseBulkJobActionsOptions {
  jobs: JobModel[];
  reloadJobs: () => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export function useBulkJobActions(options: UseBulkJobActionsOptions) {
  const { jobs, reloadJobs, showToast } = options;
  const [bulkActionRunning, setBulkActionRunning] = useState(false);

  const pauseAll = useCallback(async () => {
    const targets = jobs.filter(canPauseJob);
    if (targets.length === 0) {
      showToast('No jobs to pause');
      return;
    }
    setBulkActionRunning(true);
    try {
      const tasks = targets.map(job => async () => {
        try {
          const res = await api.pauseJob(job.id);
          return res.success;
        } catch {
          return false;
        }
      });
      const results = await runWithLimit(tasks, 5);
      const count = results.filter(Boolean).length;
      const errors = results.length - count;
      if (errors > 0) {
        showToast(`Paused ${count} jobs, ${errors} failed`, 'error');
      } else {
        showToast(`Paused ${count} jobs`);
      }
    } finally {
      setBulkActionRunning(false);
      await reloadJobs();
    }
  }, [jobs, reloadJobs, showToast]);

  const resumeAll = useCallback(async () => {
    const targets = jobs.filter(canResumeJob);
    if (targets.length === 0) {
      showToast('No jobs to resume');
      return;
    }
    setBulkActionRunning(true);
    try {
      const tasks = targets.map(job => async () => {
        try {
          const res = await api.resumeJob(job.id);
          return res.success;
        } catch {
          return false;
        }
      });
      const results = await runWithLimit(tasks, 5);
      const count = results.filter(Boolean).length;
      const errors = results.length - count;
      if (errors > 0) {
        showToast(`Resumed ${count} jobs, ${errors} failed`, 'error');
      } else {
        showToast(`Resumed ${count} jobs`);
      }
    } finally {
      setBulkActionRunning(false);
      await reloadJobs();
    }
  }, [jobs, reloadJobs, showToast]);

  const cancelAll = useCallback(async () => {
    const targets = jobs.filter(canCancelJob);
    if (targets.length === 0) {
      showToast('No jobs to cancel');
      return;
    }
    setBulkActionRunning(true);
    try {
      const tasks = targets.map(job => async () => {
        try {
          const res = await api.cancelJob(job.id);
          return res.success;
        } catch {
          return false;
        }
      });
      const results = await runWithLimit(tasks, 5);
      const count = results.filter(Boolean).length;
      const errors = results.length - count;
      if (errors > 0) {
        showToast(`Cancelled ${count} jobs, ${errors} failed`, 'error');
      } else {
        showToast(`Cancelled ${count} jobs`);
      }
    } finally {
      setBulkActionRunning(false);
      await reloadJobs();
    }
  }, [jobs, reloadJobs, showToast]);

  return {
    bulkActionRunning,
    pauseAll,
    resumeAll,
    cancelAll,
  };
}
