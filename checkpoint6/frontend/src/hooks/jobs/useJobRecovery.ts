import { useState, useCallback } from 'react';
import { api, ApiError } from '../../App';
import type { JobModel } from '../../domain';

interface UseJobRecoveryOptions {
  reloadJobs: () => Promise<void>;
  selectJob: (jobId: string) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export function useJobRecovery(options: UseJobRecoveryOptions) {
  const { reloadJobs, selectJob, showToast } = options;

  const [restartingJobId, setRestartingJobId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const restartJob = useCallback(async (job: JobModel) => {
    if (!job.filePaths || job.filePaths.length === 0) {
      showToast('Cannot restart: no file paths', 'error');
      return;
    }
    if (!job.config) {
      showToast('Cannot restart: no config', 'error');
      return;
    }

    setRestartingJobId(job.id);
    try {
      const res = await api.restartJob(job.id);
      if (!res.success) {
        showToast(res.message || 'Failed to restart', 'error');
        return;
      }
      const newJob = res.job!;
      showToast(`Restart job created: "${newJob.name}" with ${newJob.total_units} units`);
      // Select new job before reload so trace panel starts immediately (no stale state)
      selectJob(newJob.id);
      await reloadJobs();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to restart job', 'error');
      }
    } finally {
      setRestartingJobId(null);
    }
  }, [reloadJobs, selectJob, showToast]);

  const retryFailedJob = useCallback(async (job: JobModel) => {
    if (!job.failedUnits || job.failedUnits <= 0) {
      showToast('No failed units to retry', 'warning');
      return;
    }

    setRetryingJobId(job.id);
    try {
      const res = await api.retryFailed(job.id);
      if (!res.success) {
        showToast(res.message || 'Failed to retry', 'error');
        return;
      }
      const newJob = res.job!;
      showToast(`Retry job created: "${newJob.name}" with ${newJob.total_units} failed units`);
      // Select new job before reload so trace panel starts immediately (no stale state)
      selectJob(newJob.id);
      await reloadJobs();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to retry', 'error');
      }
    } finally {
      setRetryingJobId(null);
    }
  }, [reloadJobs, selectJob, showToast]);

  return {
    restartingJobId,
    retryingJobId,
    restartJob,
    retryFailedJob,
  };
}
