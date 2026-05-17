import { Fragment } from 'react';
import JobExpandedDetails from './JobExpandedDetails';
import {
  canStartJob, canPauseJob, canResumeJob,
  canCancelJob, canRestartJob, canRetryFailed,
  type JobModel,
} from '../../domain';
import { getJobStatusDisplay, getJobCompletionLabel, getProcessedUnits, type JobConfigFormModel } from '../../domain';
import type { TranslationOptionsResponse } from '../../api/types';
import type { JobActionsApi, JobRecoveryApi } from '../../hooks/jobs/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobsTableProps {
  jobs: JobModel[];
  filteredJobs: JobModel[];
  expandedJobs: Record<string, boolean>;
  editingJobId?: string | null;
  onToggleExpanded: (jobId: string) => void;
  onOpenTrace: (jobId: string) => void;
  onEditConfig: (job: JobModel) => void;
  onEditConfigFieldChange: (field: keyof JobConfigFormModel, value: string) => void;
  onCancelEdit: () => void;
  onSaveConfig: () => void;
  editConfigForm: Partial<JobConfigFormModel>;
  jobActions: JobActionsApi;
  recovery: JobRecoveryApi;
  onRequestConfirm: (action: 'pause' | 'cancel' | 'restart' | 'retry', job?: JobModel) => void;
  onRefresh: () => void;
  onRevealPath?: (path: string) => void;
  onOpenEditor?: (path: string) => void;
  onViewTranslatedFiles?: (jobId: string) => void;
  options?: TranslationOptionsResponse | null;
  savingConfig?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobsTable({
  jobs,
  filteredJobs,
  expandedJobs,
  editingJobId,
  onToggleExpanded,
  onOpenTrace,
  onEditConfig,
  onEditConfigFieldChange,
  onCancelEdit,
  onSaveConfig,
  editConfigForm,
  jobActions,
  recovery,
  onRequestConfirm,
  onRefresh,
  onRevealPath,
  onOpenEditor,
  onViewTranslatedFiles,
  options,
  savingConfig,
}: JobsTableProps) {
  // Filters summary text
  const showSummary = filteredJobs.length < jobs.length;

  // Empty state
  if (jobs.length === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No jobs yet</div>
    );
  }

  return (
    <>
      {showSummary && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
          Showing {filteredJobs.length} of {jobs.length} jobs
        </div>
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Units</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map(job => {
              const isEditing = editingJobId === job.id;
              const statusPres = getJobStatusDisplay(job.status, job.failedUnits);
              const completionLabel = getJobCompletionLabel(job.status, job.failedUnits);
              return (
                <Fragment key={job.id}>
                  <tr>
                    <td>
                      <button
                        className={`expand-toggle${expandedJobs[job.id] ? ' open' : ''}`}
                        onClick={() => onToggleExpanded(job.id)}
                        title={expandedJobs[job.id] ? 'Collapse' : 'Expand'}
                      >
                        &#9654;
                      </button>
                    </td>
                    <td className="mono">{job.id.slice(0, 8)}</td>
                    <td>{job.name || '\u2014'}</td>
                    <td><span className={`badge ${statusPres.badgeClass}`}>{statusPres.label}</span></td>
                    <td style={{ minWidth: 120 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div className="progress-bar" style={{ flex: 1, margin: 0 }}>
                          <div className="progress-fill" style={{ width: `${job.progress}%` }} />
                        </div>
                        <span className="mono">{job.progress.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="mono">
                      {getProcessedUnits(job)}/{job.totalUnits}
                      {job.completedUnits > 0 && <span style={{ color: 'var(--color-success)', fontSize: '0.7rem' }}> &middot; {job.completedUnits} translated</span>}
                      {job.cachedUnits > 0 && <span style={{ color: 'var(--color-info)', fontSize: '0.7rem' }}> &middot; {job.cachedUnits} cached</span>}
                      {job.failedUnits > 0 && <span style={{ color: 'var(--color-error)', fontSize: '0.7rem' }}> &middot; {job.failedUnits} failed</span>}
                      {job.totalUnits === 0 && job.filePaths.length > 0 && (
                        <span className="badge badge-warning" title="No translation units found. Check file format or language header." style={{ marginLeft: '0.3rem', fontSize: '0.6rem', cursor: 'help' }}>No units</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.75rem' }}>{job.createdAt ? new Date(job.createdAt).toLocaleString() : '\u2014'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {canStartJob(job) && (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); jobActions.startJob(job); }}>Start</button>
                            <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); onRequestConfirm('cancel', job); }}>Cancel</button>
                          </>
                        )}
                        {canPauseJob(job) && (
                          <>
                            <button className="btn btn-sm" onClick={e => { e.stopPropagation(); onRequestConfirm('pause', job); }}>Pause</button>
                            <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); onRequestConfirm('cancel', job); }}>Cancel</button>
                          </>
                        )}
                        {canResumeJob(job) && (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); jobActions.resumeJob(job); }}>Resume</button>
                            <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); onRequestConfirm('cancel', job); }}>Cancel</button>
                          </>
                        )}
                        {job.status === 'completed' && completionLabel.label && (
                          <span className={completionLabel.className}>{completionLabel.label}</span>
                        )}
                        {job.status === 'completed' && onViewTranslatedFiles && (
                          <button
                            className="btn btn-sm"
                            onClick={e => { e.stopPropagation(); onViewTranslatedFiles(job.id); }}
                            title="View translated files for this job"
                          >
                            View files
                          </button>
                        )}
                        {job.status === 'failed' && <span className="badge badge-error">{job.errorMessage?.slice(0, 30) || 'Failed'}</span>}
                        {canRestartJob(job) && (
                          <button className="btn btn-sm" onClick={e => { e.stopPropagation(); onRequestConfirm('restart', job); }} title="Restart job">Restart</button>
                        )}
                        {canRetryFailed(job) && (
                          <button className="btn btn-sm btn-warning" onClick={e => { e.stopPropagation(); onRequestConfirm('retry', job); }} title="Retry only the failed units from this job (not a full rerun)">
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedJobs[job.id] && (
                    <tr className="job-detail-row">
                      <td colSpan={8}>
                        <JobExpandedDetails
                          job={job}
                          editing={isEditing}
                          editConfigForm={editConfigForm}
                          onEditConfig={onEditConfig}
                          onEditConfigFieldChange={onEditConfigFieldChange}
                          onCancelEdit={onCancelEdit}
                          onSaveConfig={onSaveConfig}
                          recovery={recovery}
                          jobActions={jobActions}
                          onRequestConfirm={onRequestConfirm}
                          onOpenTrace={onOpenTrace}
                          onRefresh={onRefresh}
                          options={options}
                          savingConfig={savingConfig}
                          onRevealPath={onRevealPath}
                          onOpenEditor={onOpenEditor}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
