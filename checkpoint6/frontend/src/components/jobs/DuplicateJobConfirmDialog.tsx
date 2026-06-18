/* ------------------------------------------------------------------ */
/*  DuplicateJobConfirmDialog — shown when existing job(s) share the   */
/*  same file set as the requested translate action.                    */
/* ------------------------------------------------------------------ */

import type { JobModel } from '../../domain/jobs';

interface DuplicateJobConfirmDialogProps {
  existingJobs: JobModel[];
  onOpenExisting: (jobId: string) => void;
  onContinueNew: () => void;
  onCancel: () => void;
}

export function DuplicateJobConfirmDialog({
  existingJobs,
  onOpenExisting,
  onContinueNew,
  onCancel,
}: DuplicateJobConfirmDialogProps) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="modal-content"
        style={{ maxWidth: 520 }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Duplicate job detected</span>
          <button className="modal-close" onClick={onCancel} type="button" aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
            The selected files match {existingJobs.length} existing job(s):
          </p>
          <ul style={{ fontSize: '0.8rem', margin: '0 0 0.75rem', paddingLeft: '1.25rem' }}>
            {existingJobs.slice(0, 5).map(job => (
              <li key={job.id} style={{ marginBottom: '0.25rem' }}>
                <strong>{job.name}</strong>
                {' '}
                <span className="badge" style={{ fontSize: '0.65rem' }}>
                  {job.status}
                </span>
                {' '}
                <span style={{ color: 'var(--color-text-muted)' }}>
                  ({job.filePaths.length} files)
                </span>
              </li>
            ))}
            {existingJobs.length > 5 && (
              <li style={{ color: 'var(--color-text-muted)' }}>
                ...and {existingJobs.length - 5} more
              </li>
            )}
          </ul>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Do you want to open the existing job or create a new one anyway?
          </p>
        </div>
        <div className="modal-footer">
          {existingJobs.length === 1 ? (
            <button
              className="btn btn-primary"
              onClick={() => onOpenExisting(existingJobs[0].id)}
              type="button"
            >
              Open existing job
            </button>
          ) : (
            <select
              className="form-control"
              style={{ width: 'auto', display: 'inline-block', marginRight: '0.5rem' }}
              onChange={e => onOpenExisting(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>Select a job...</option>
              {existingJobs.map(job => (
                <option key={job.id} value={job.id}>{job.name}</option>
              ))}
            </select>
          )}
          <button className="btn" onClick={onContinueNew} type="button">
            Create new anyway
          </button>
          <button className="btn" onClick={onCancel} type="button">Cancel</button>
        </div>
      </div>
    </div>
  );
}
