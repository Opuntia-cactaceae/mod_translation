import { useEffect, useRef, useState } from 'react';
import { api } from '../../App';
import type { OutputAnalysisJob } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
interface Props {
  job: OutputAnalysisJob;
  onComplete: (job: OutputAnalysisJob) => void;
  onCancel: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function AnalysisJobProgress({ job: initialJob, onComplete, onCancel }: Props) {
  const [job, setJob] = useState<OutputAnalysisJob>(initialJob);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Poll while the job is active
  useEffect(() => {
    mountedRef.current = true;

    if (job.status === 'queued' || job.status === 'running') {
      pollingRef.current = setInterval(async () => {
        try {
          const updated = await api.getOutputAnalysisJob(job.id);
          if (!mountedRef.current) return;
          setJob(updated);

          if (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            onComplete(updated);
          }
        } catch {
          // Ignore polling errors, will retry on next interval
        }
      }, 1500);
    }

    return () => {
      mountedRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [job.id, job.status, onComplete]);

  function handleCancel() {
    api.cancelOutputAnalysisJob(job.id).then(() => {
      setJob(prev => ({ ...prev, cancel_requested: true }));
      onCancel();
    }).catch(() => {
      // Ignore cancel errors
    });
  }

  const progress = job.total_count > 0 ? (job.processed_count / job.total_count) * 100 : 0;
  const isActive = job.status === 'queued' || job.status === 'running';

  return (
    <div className={`analysis-job-progress card ${job.status === 'failed' ? 'card-error' : ''}`}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Analysis Job</span>
        <span className={`badge badge-${_badgeClass(job.status)}`}>{job.status}</span>
      </div>

      <div style={{ padding: '0.75rem' }}>
        {/* Progress bar */}
        {isActive && (
          <div className="progress-bar-container" style={{ marginBottom: '0.75rem' }}>
            <div className="progress-bar" style={{ width: `${Math.min(progress, 100)}%` }} />
            <span className="progress-text">
              {job.processed_count} / {job.total_count} files
            </span>
          </div>
        )}

        {/* Counts */}
        <div className="analysis-job-counts" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {job.passed_count > 0 && <span className="analysis-count passed">Passed: {job.passed_count}</span>}
          {job.warning_count > 0 && <span className="analysis-count warning">Warnings: {job.warning_count}</span>}
          {job.failed_count > 0 && <span className="analysis-count failed">Failed: {job.failed_count}</span>}
          {job.error_count > 0 && <span className="analysis-count error">Errors: {job.error_count}</span>}
          {job.skipped_count > 0 && <span className="analysis-count skipped">Skipped: {job.skipped_count}</span>}
        </div>

        {/* Error message */}
        {job.error_message && (
          <div className="alert alert-error" style={{ marginTop: '0.5rem', fontSize: '0.85em' }}>
            {job.error_message}
          </div>
        )}

        {/* Cancel / Close button */}
        <div style={{ marginTop: '0.5rem' }}>
          {isActive && !job.cancel_requested && (
            <button className="btn btn-sm btn-outline-danger" onClick={handleCancel}>
              Cancel
            </button>
          )}
          {job.cancel_requested && job.status !== 'cancelled' && (
            <span style={{ fontSize: '0.85em', color: '#888' }}>Cancelling...</span>
          )}
        </div>
      </div>
    </div>
  );
}

function _badgeClass(status: string): string {
  switch (status) {
    case 'queued': return 'info';
    case 'running': return 'primary';
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'cancelled': return 'secondary';
    default: return 'secondary';
  }
}
