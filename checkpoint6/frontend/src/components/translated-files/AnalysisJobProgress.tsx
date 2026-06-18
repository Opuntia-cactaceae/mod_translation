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

function _hasIssues(job: OutputAnalysisJob): boolean {
  return job.failed_count > 0 || job.error_count > 0;
}

function _badgeClassAndLabel(job: OutputAnalysisJob): { cls: string; label: string } {
  if (job.status === 'completed' && _hasIssues(job)) {
    return { cls: 'warning', label: 'Completed with issues' };
  }
  switch (job.status) {
    case 'queued':     return { cls: 'info', label: 'Queued' };
    case 'running':    return { cls: 'primary', label: 'Running' };
    case 'completed':  return { cls: 'success', label: 'Completed' };
    case 'failed':     return { cls: 'danger', label: 'Failed' };
    case 'cancelled':  return { cls: 'secondary', label: 'Cancelled' };
    default:           return { cls: 'secondary', label: job.status };
  }
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
  const badge = _badgeClassAndLabel(job);
  const issueCount = job.failed_count + job.error_count;

  return (
    <div className={`analysis-job-progress card ${badge.cls === 'danger' ? 'card-error' : ''}`}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Analysis Job</span>
        <span className={`badge badge-${badge.cls}`}>{badge.label}</span>
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

        {/* Files section */}
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.8em', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #888)' }}>
            Files
          </div>
          <div className="analysis-job-counts" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <span className="analysis-count">Total: {job.total_count}</span>
            <span className="analysis-count passed">Successful: {job.passed_count}</span>
            <span className="analysis-count failed">Failed: {job.failed_count}</span>
            <span className="analysis-count skipped">Skipped: {job.skipped_count}</span>
          </div>
        </div>

        {/* Analysis section */}
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.8em', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #888)' }}>
            Analysis
          </div>
          <div className="analysis-job-counts" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <span className="analysis-count error">Errors found: {job.error_count}</span>
            <span className="analysis-count warning">Warnings found: {job.warning_count}</span>
            <span className="analysis-count">Processed: {job.processed_count}</span>
          </div>
        </div>

        {/* Issues summary for completed-with-issues */}
        {job.status === 'completed' && issueCount > 0 && (
          <div className="alert alert-warning" style={{ marginTop: '0.5rem', marginBottom: '0.5rem', fontSize: '0.85em' }}>
            Completed with {issueCount} issue{issueCount !== 1 ? 's' : ''}
            {' '}({job.failed_count} failed file{job.failed_count !== 1 ? 's' : ''}
            {job.failed_count > 0 && job.error_count > 0 ? ', ' : ''}
            {job.error_count > 0 ? `${job.error_count} error${job.error_count !== 1 ? 's' : ''}` : ''})
          </div>
        )}

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
