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
import { groupByDateBucket, getJobSortTimestamp, getDateBucketKey } from '../../utils/dateGrouping';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobsTableProps {
  jobs: JobModel[];
  filteredJobs: JobModel[];
  expandedJobs: Record<string, boolean>;
  /**
   * Unified expanded group state (groupKey -> boolean). Absent = expanded.
   * @deprecated Use `expandedGroups` instead.
   */
  expandedDateGroups?: Record<string, boolean>;
  /**
   * @deprecated Use `onToggleGroup` instead.
   */
  onToggleDateGroup?: (bucketKey: string) => void;
  /** Unified expanded group state (groupKey -> boolean). Absent = expanded. */
  expandedGroups?: Record<string, boolean>;
  /** Called when a group header is clicked to toggle collapse. */
  onToggleGroup?: (groupKey: string) => void;
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
  /** Called with output file id to open the new session-based editor. */
  onOpenEditor?: (outputFileId: string) => void;
  onViewTranslatedFiles?: (jobId: string) => void;
  options?: TranslationOptionsResponse | null;
  savingConfig?: boolean;
  /** Grouping mode for the jobs list. */
  groupBy?: 'none' | 'status' | 'date';
  /** Sort order for the jobs list. */
  sortOrder?: 'newest' | 'oldest';
}

/* ------------------------------------------------------------------ */
/*  Status display helpers                                             */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  pausing: 'Pausing',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function getStatusCategory(status: string): string {
  if (status === 'running' || status === 'pausing') return 'Active';
  if (status === 'pending') return 'Pending';
  if (status === 'paused') return 'Paused';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Other';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobsTable({
  jobs,
  filteredJobs,
  expandedJobs,
  expandedDateGroups,
  onToggleDateGroup,
  expandedGroups,
  onToggleGroup,
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
  groupBy = 'none',
  sortOrder = 'newest',
}: JobsTableProps) {
  // Backward compat: use new props, fall back to old deprecated props
  const effectiveExpanded = expandedGroups ?? expandedDateGroups ?? {};
  const effectiveToggle = onToggleGroup ?? onToggleDateGroup;
  // Null safety for expanded state (invalid localStorage values)
  const safeExpanded = effectiveExpanded ?? {};
  // Filters summary text
  const showSummary = filteredJobs.length < jobs.length;

  // Empty state
  if (jobs.length === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No jobs yet</div>
    );
  }

  // Apply grouping and sorting
  const displayJobs = applyGroupingAndSort(filteredJobs, groupBy, sortOrder);

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
            {displayJobs.map((section, si) => (
              <Fragment key={section.key}>
                {/* Section header for grouped modes — all groups with groupKey are collapsible */}
                {section.label && (
                  <tr
                    className={`group-header-row${section.groupKey ? ' group-header-row-collapsible' : ''}`}
                    onClick={section.groupKey && effectiveToggle ? () => effectiveToggle(section.groupKey!) : undefined}
                    role={section.groupKey ? 'button' : undefined}
                    tabIndex={section.groupKey ? 0 : undefined}
                    onKeyDown={section.groupKey && effectiveToggle ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); effectiveToggle(section.groupKey!); } } : undefined}
                    aria-expanded={section.groupKey ? (safeExpanded[section.groupKey] !== false) : undefined}
                  >
                    <td colSpan={8}>
                      <div className="group-header">
                        {section.groupKey && (
                          <span className={`group-header-arrow${safeExpanded[section.groupKey] !== false ? ' open' : ''}`}>
                            &#9654;
                          </span>
                        )}
                        {section.label}
                        <span className="tree-node-count">{section.count} job{section.count !== 1 ? 's' : ''}</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Job rows — skip when collapsed */}
                {(!section.groupKey || safeExpanded[section.groupKey] !== false) && section.jobs.map(job => {
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
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Grouping + Sorting logic                                           */
/* ------------------------------------------------------------------ */

interface DisplaySection {
  key: string;
  label: string | null;
  count: number;
  jobs: JobModel[];
  /** Stable group key for ALL collapsible group types (e.g. "date:today", "status:Active"). Absent for "none" mode. */
  groupKey?: string;
}

function applyGroupingAndSort(
  jobs: JobModel[],
  groupBy: 'none' | 'status' | 'date',
  sortOrder: 'newest' | 'oldest',
): DisplaySection[] {
  if (groupBy === 'none') {
    // Flat list, sorted
    const sorted = [...jobs].sort((a, b) => compareJobs(a, b, sortOrder));
    return [{ key: '_all', label: null, count: sorted.length, jobs: sorted }];
  }

  if (groupBy === 'status') {
    return groupByStatus(jobs, sortOrder);
  }

  // groupBy === 'date'
  return groupByDate(jobs, sortOrder);
}

function compareJobs(a: JobModel, b: JobModel, sortOrder: 'newest' | 'oldest'): number {
  const da = getJobSortTimestamp(a);
  const db = getJobSortTimestamp(b);
  if (!da && !db) return 0;
  if (!da) return 1;  // no date goes last
  if (!db) return -1;
  return sortOrder === 'newest' ? db.getTime() - da.getTime() : da.getTime() - db.getTime();
}

function groupByStatus(jobs: JobModel[], sortOrder: 'newest' | 'oldest'): DisplaySection[] {
  const groups = new Map<string, JobModel[]>();
  const order = ['Active', 'Pending', 'Paused', 'Completed', 'Failed', 'Cancelled', 'Other'];

  for (const job of jobs) {
    const cat = getStatusCategory(job.status);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(job);
  }

  const result: DisplaySection[] = [];
  for (const cat of order) {
    if (groups.has(cat)) {
      const groupJobs = groups.get(cat)!;
      groupJobs.sort((a, b) => compareJobs(a, b, sortOrder));
      result.push({ key: `status-${cat}`, label: cat, count: groupJobs.length, jobs: groupJobs, groupKey: `status:${cat}` });
    }
  }
  return result;
}

function groupByDate(jobs: JobModel[], sortOrder: 'newest' | 'oldest'): DisplaySection[] {
  const now = new Date();
  const grouped = groupByDateBucket(jobs, (job) => getJobSortTimestamp(job), now);

  const sections: DisplaySection[] = grouped.map(g => ({
    key: `date-${g.bucket}`,
    label: g.bucket,
    count: g.items.length,
    jobs: g.items,
    groupKey: `date:${g.bucketKey}`,
  }));

  // For "oldest first", reverse the bucket order but keep within-bucket order ascending
  if (sortOrder === 'oldest') {
    // Within each bucket, sort ascending
    for (const section of sections) {
      section.jobs.sort((a, b) => {
        const da = getJobSortTimestamp(a);
        const db = getJobSortTimestamp(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.getTime() - db.getTime();
      });
    }
    // Reverse bucket order (Unknown first, then oldest months, ..., Today last)
    sections.reverse();
  }

  return sections;
}
