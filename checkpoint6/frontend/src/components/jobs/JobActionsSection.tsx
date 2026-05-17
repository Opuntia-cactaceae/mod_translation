import {
  canStartJob, canPauseJob, canResumeJob,
  canCancelJob, canRestartJob, canRetryFailed,
  type JobModel,
} from '../../domain';
import type { JobActionsApi } from '../../hooks/jobs/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobActionsSectionProps {
  job: JobModel;
  jobActions: JobActionsApi;
  onRequestConfirm: (action: 'pause' | 'cancel' | 'restart' | 'retry', job?: JobModel) => void;
  onRefresh: () => void;
  onOpenTrace: (jobId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobActionsSection({
  job,
  jobActions,
  onRequestConfirm,
  onRefresh,
  onOpenTrace,
}: JobActionsSectionProps) {
  const showJobActions = canRestartJob(job);

  return (
    <div className="job-detail-section">
      <div className="job-detail-section-title">Actions</div>
      <div className="job-detail-actions">
        {canStartJob(job) && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => jobActions.startJob(job)}>Start</button>
            <button className="btn btn-sm btn-danger" onClick={() => onRequestConfirm('cancel', job)}>Cancel</button>
          </>
        )}
        {canPauseJob(job) && (
          <>
            <button className="btn btn-sm" onClick={() => onRequestConfirm('pause', job)}>Pause</button>
            <button className="btn btn-sm btn-danger" onClick={() => onRequestConfirm('cancel', job)}>Cancel</button>
          </>
        )}
        {canResumeJob(job) && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => jobActions.resumeJob(job)}>Resume</button>
            <button className="btn btn-sm btn-danger" onClick={() => onRequestConfirm('cancel', job)}>Cancel</button>
          </>
        )}
        <button className="btn btn-sm" onClick={onRefresh}>Refresh</button>
        <button className="btn btn-sm" onClick={() => onOpenTrace(job.id)}>Open trace</button>
        {canRestartJob(job) && (
          <button className="btn btn-sm" onClick={() => onRequestConfirm('restart', job)}>Restart job</button>
        )}
        {canRetryFailed(job) && (
          <button className="btn btn-sm btn-warning" onClick={() => onRequestConfirm('retry', job)} title="Retry only the failed units from this job (not a full rerun)">
            Retry failed units
          </button>
        )}
      </div>
      {showJobActions && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          Restart job creates a full rerun.<br />
          Retry failed units reuses successful/cached units from the original job.
        </div>
      )}
    </div>
  );
}
