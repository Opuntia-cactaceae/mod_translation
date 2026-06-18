import { useState, useCallback } from 'react';
import { api, ApiError } from '../../App';
import type { JobModel } from '../../domain';

interface UseJobActionsOptions {
  reloadJobs: () => Promise<void>;
  selectJob: (jobId: string) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export function useJobActions(options: UseJobActionsOptions) {
  const { reloadJobs, showToast } = options;

  const [startingJobId, setStartingJobId] = useState<string | null>(null);
  const [pausingJobId, setPausingJobId] = useState<string | null>(null);
  const [resumingJobId, setResumingJobId] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);

  const startJob = useCallback(async (job: JobModel) => {
    setStartingJobId(job.id);
    try {
      const res = await api.startJob(job.id);
      if (res.success) {
        showToast('Job started');
        await reloadJobs();
      } else {
        showToast(res.message || 'Failed to start', 'error');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to start job', 'error');
      }
    } finally {
      setStartingJobId(null);
    }
  }, [reloadJobs, showToast]);

  const pauseJob = useCallback(async (job: JobModel) => {
    setPausingJobId(job.id);
    try {
      const res = await api.pauseJob(job.id);
      if (res.success) {
        showToast('Job paused');
        await reloadJobs();
      } else {
        showToast(res.message || 'Failed to pause', 'error');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to pause job', 'error');
      }
    } finally {
      setPausingJobId(null);
    }
  }, [reloadJobs, showToast]);

  const resumeJob = useCallback(async (job: JobModel) => {
    setResumingJobId(job.id);
    try {
      const res = await api.resumeJob(job.id);
      if (res.success) {
        showToast('Job resumed');
        await reloadJobs();
      } else {
        showToast(res.message || 'Failed to resume', 'error');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to resume job', 'error');
      }
    } finally {
      setResumingJobId(null);
    }
  }, [reloadJobs, showToast]);

  const cancelJob = useCallback(async (job: JobModel) => {
    setCancellingJobId(job.id);
    try {
      const res = await api.cancelJob(job.id);
      if (res.success) {
        showToast('Job cancelled');
        await reloadJobs();
      } else {
        showToast(res.message || 'Failed to cancel', 'error');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to cancel job', 'error');
      }
    } finally {
      setCancellingJobId(null);
    }
  }, [reloadJobs, showToast]);

  return {
    startingJobId,
    pausingJobId,
    resumingJobId,
    cancellingJobId,
    startJob,
    pauseJob,
    resumeJob,
    cancelJob,
  };
}
