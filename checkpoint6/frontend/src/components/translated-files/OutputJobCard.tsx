/* ------------------------------------------------------------------ */
/*  OutputJobCard — compact job summary card for Translated Files      */
/* ------------------------------------------------------------------ */

import { formatDate } from './OutputJobList';

interface StatusCounts {
  ready: number;
  missing_source: number;
  stale: number;
  [key: string]: number;
}

interface Props {
  jobId: string;
  jobName?: string;
  fileCount: number;
  modCount: number;
  groupCount: number;
  statusCounts: StatusCounts;
  isSelected: boolean;
  onSelect: (jobId: string) => void;
  onRefresh?: () => void;
  onReindex?: () => void;
  reindexLoading?: boolean;
  onAnalyzeStale?: () => void;
  createdAt?: string;
}

/**
 * Build a human-readable label for a job card header.
 * Uses the job name if available, falls back to "Job: <short id>".
 */
export function buildJobLabel(jobId: string, jobName?: string): string {
  if (jobName && jobName.trim().length > 0) {
    return jobName;
  }
  const shortId = jobId.length > 12 ? jobId.slice(0, 12) + '...' : jobId;
  return `Job: ${shortId}`;
}

export default function OutputJobCard({
  jobId,
  jobName,
  fileCount,
  modCount,
  groupCount,
  statusCounts,
  isSelected,
  onSelect,
  onRefresh,
  onReindex,
  reindexLoading,
  onAnalyzeStale,
  createdAt,
}: Props) {
  const label = buildJobLabel(jobId, jobName);
  const dateLabel = createdAt ? formatDate(createdAt) : null;

  return (
    <div
      className={`job-card${isSelected ? ' selected' : ''}`}
      onClick={() => onSelect(jobId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(jobId);
        }
      }}
    >
      <div className="job-card-header">
        <span className="job-card-name">{label}</span>
        {dateLabel && <span className="job-card-date">{dateLabel}</span>}
      </div>

      <div className="job-card-stats">
        <div className="job-card-stat">
          <span className="job-card-stat-value">{fileCount}</span>
          <span className="job-card-stat-label">Files</span>
        </div>
        <div className="job-card-stat">
          <span className="job-card-stat-value">{modCount}</span>
          <span className="job-card-stat-label">Mods</span>
        </div>
        <div className="job-card-stat">
          <span className="job-card-stat-value">{groupCount}</span>
          <span className="job-card-stat-label">Groups</span>
        </div>
      </div>

      <div className="job-card-statuses">
        {statusCounts.ready > 0 && (
          <span className="badge badge-success badge-sm">{statusCounts.ready} ready</span>
        )}
        {statusCounts.missing_source > 0 && (
          <span className="badge badge-error badge-sm">{statusCounts.missing_source} missing</span>
        )}
        {statusCounts.stale > 0 && (
          <span className="badge badge-warning badge-sm">{statusCounts.stale} stale</span>
        )}
        {Object.entries(statusCounts)
          .filter(([k]) => k !== 'ready' && k !== 'missing_source' && k !== 'stale')
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <span key={k} className="badge badge-muted badge-sm">{v} {k}</span>
          ))}
      </div>

      <div className="job-card-actions">
        {onRefresh && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            title="Refresh"
          >
            Refresh
          </button>
        )}
        {onReindex && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={(e) => { e.stopPropagation(); onReindex(); }}
            disabled={reindexLoading}
            title="Reindex output files"
          >
            {reindexLoading ? '...' : 'Reindex'}
          </button>
        )}
        {onAnalyzeStale && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={(e) => { e.stopPropagation(); onAnalyzeStale(); }}
            title="Analyze stale files"
          >
            Analyze stale
          </button>
        )}
      </div>
    </div>
  );
}
