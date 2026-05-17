/* ------------------------------------------------------------------ */
/*  Centralized job status UI presentation mapping                     */
/*  Render components MUST NOT contain switch/case on job status.      */
/* ------------------------------------------------------------------ */

export interface JobStatusPresentation {
  badgeClass: string;
  label: string;
}

export const JOB_STATUS_PRESENTATION: Record<string, JobStatusPresentation> = {
  pending:   { badgeClass: 'badge-muted',  label: 'Pending' },
  running:   { badgeClass: 'badge-info',   label: 'Running' },
  pausing:   { badgeClass: 'badge-warning',label: 'Pausing' },
  paused:    { badgeClass: 'badge-warning',label: 'Paused' },
  completed: { badgeClass: 'badge-success',label: 'Completed' },
  failed:    { badgeClass: 'badge-error',  label: 'Failed' },
  cancelled: { badgeClass: 'badge-error',  label: 'Cancelled' },
};

/** Status display overrides for job status values that need extra context
 *  (e.g. completed with failed units). Key is "<status>:<context>". */
const JOB_STATUS_OVERRIDES: Record<string, JobStatusPresentation> = {
  'completed:with_errors': { badgeClass: 'badge-warning', label: 'Completed with errors' },
};

export function getJobStatusPresentation(status: string): JobStatusPresentation {
  return JOB_STATUS_PRESENTATION[status] ?? { badgeClass: 'badge-muted', label: status };
}

/**
 * Like getJobStatusPresentation but also considers failed_units.
 * Returns a richer label when a completed job has failures.
 */
export function getJobStatusDisplay(status: string, failedUnits: number): JobStatusPresentation {
  const key = status === 'completed' && failedUnits > 0 ? 'completed:with_errors' : status;
  return JOB_STATUS_OVERRIDES[key] ?? getJobStatusPresentation(status);
}

/**
 * Returns a short completion label and CSS class for terminal jobs,
 * distinguishing clean completion from completion with errors.
 */
export function getJobCompletionLabel(status: string, failedUnits: number): { label: string; className: string } {
  if (status === 'completed' && failedUnits > 0) {
    return { label: 'Done with errors', className: 'badge badge-warning' };
  }
  if (status === 'completed') {
    return { label: 'Done', className: 'badge badge-success' };
  }
  if (status === 'failed') {
    return { label: 'Failed', className: 'badge badge-error' };
  }
  return { label: '', className: '' };
}
