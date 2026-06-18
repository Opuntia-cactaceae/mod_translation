/* ------------------------------------------------------------------ */
/*  OutputJobList — date-grouped collapsible sections with grid cards  */
/* ------------------------------------------------------------------ */
import type { OutputFileTreeResponse, JobTimestampInfo } from '../../api/types';
import { groupByDateBucket } from '../../utils/dateGrouping';
import OutputJobCard from './OutputJobCard';

interface StatusCounts {
  ready: number;
  missing_source: number;
  stale: number;
  [key: string]: number;
}

interface JobEntry {
  jobId: string;
  jobName?: string;
  fileCount: number;
  modCount: number;
  groupCount: number;
  statusCounts: StatusCounts;
  createdAt?: string;
}

interface Props {
  tree: OutputFileTreeResponse | null;
  loading?: boolean;
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  onRefresh?: (jobId: string) => void;
  onReindex?: (jobId: string) => void;
  reindexLoading?: boolean;
  onAnalyzeStale?: (jobId: string) => void;
  /** Persisted expanded/collapsed state keyed by bucketKey */
  expandedGroups?: Record<string, boolean>;
  /** Called when a group header is clicked to toggle collapse */
  onToggleGroup?: (bucketKey: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Derive per-job stats from tree data                                */
/* ------------------------------------------------------------------ */
function deriveJobEntries(tree: OutputFileTreeResponse): JobEntry[] {
  const entries: JobEntry[] = [];
  for (const [jobId, jobNode] of Object.entries(tree.jobs)) {
    let fileCount = 0;
    let groupCount = 0;
    const modCount = Object.keys(jobNode.mods ?? {}).length;
    const statusCounts: StatusCounts = { ready: 0, missing_source: 0, stale: 0 };

    for (const modNode of Object.values(jobNode.mods ?? {})) {
      groupCount += Object.keys(modNode.groups ?? {}).length;
      for (const groupNode of Object.values(modNode.groups ?? {})) {
        fileCount += groupNode.files.length;
        for (const f of groupNode.files) {
          if (statusCounts[f.status] !== undefined) {
            statusCounts[f.status]++;
          } else {
            statusCounts[f.status] = 1;
          }
        }
      }
    }

    const jobName = jobNode.name || undefined;
    const ts = tree.job_timestamps?.[jobId];
    const createdAt = ts?.created_at || undefined;

    entries.push({ jobId, jobName, fileCount, modCount, groupCount, statusCounts, createdAt });
  }

  // Sort by file count descending, then by jobId (preserved within date groups)
  entries.sort((a, b) => b.fileCount - a.fileCount || a.jobId.localeCompare(b.jobId));
  return entries;
}

/* ------------------------------------------------------------------ */
/*  Best timestamp for an output job (matches getJobSortTimestamp)     */
/* ------------------------------------------------------------------ */
export function getOutputJobTimestamp(
  _entry: JobEntry,
  timestamps: Record<string, JobTimestampInfo>,
): Date | null {
  const info = timestamps[_entry.jobId];
  if (!info) return null;
  const raw = info.completed_at || info.updated_at || info.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format an ISO date string to a compact human-readable form.
 * Example: "2026-05-29 18:42"
 */
export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}`;
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/*  Determine whether a group is expanded                              */
/* ------------------------------------------------------------------ */
function isGroupExpanded(
  bucketKey: string,
  index: number,
  expandedGroups?: Record<string, boolean>,
): boolean {
  if (expandedGroups && bucketKey in expandedGroups) {
    return expandedGroups[bucketKey];
  }
  // Default: first group expanded, others collapsed
  return index === 0;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function OutputJobList({
  tree,
  loading,
  selectedJobId,
  onSelectJob,
  onRefresh,
  onReindex,
  reindexLoading,
  onAnalyzeStale,
  expandedGroups,
  onToggleGroup,
}: Props) {
  if (loading) {
    return (
      <div className="loading" style={{ padding: '1rem', justifyContent: 'flex-start' }}>
        <span className="spinner" /> Loading jobs...
      </div>
    );
  }

  if (!tree || Object.keys(tree.jobs).length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        No translated output jobs
      </div>
    );
  }

  const jobEntries = deriveJobEntries(tree);

  // Group by date bucket using the same utility as Translation Jobs
  const groups = groupByDateBucket(
    jobEntries,
    (entry) => getOutputJobTimestamp(entry, tree.job_timestamps),
  );

  return (
    <div className="output-job-list">
      {groups.map((group, index) => {
        const expanded = isGroupExpanded(group.bucketKey, index, expandedGroups);
        const hasSelected = group.items.some((e) => e.jobId === selectedJobId);

        return (
          <div key={group.bucketKey} className="output-job-group">
            {/* Collapsible group header */}
            <div
              className={`output-job-group-header${hasSelected ? ' has-selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => onToggleGroup?.(group.bucketKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleGroup?.(group.bucketKey);
                }
              }}
            >
              <span className={`group-header-arrow${expanded ? ' open' : ''}`}>
                ▶
              </span>
              <span className="output-job-group-title">{group.bucket}</span>
              <span className="tree-node-count">{group.items.length}</span>
              {hasSelected && !expanded && (
                <span className="badge badge-sm badge-primary" style={{ marginLeft: 'auto' }}>
                  Selected
                </span>
              )}
            </div>

            {/* Expanded content: cards in a responsive grid */}
            {expanded && (
              <div className="job-list-grid">
                {group.items.map((entry) => (
                  <OutputJobCard
                    key={entry.jobId}
                    jobId={entry.jobId}
                    jobName={entry.jobName}
                    fileCount={entry.fileCount}
                    modCount={entry.modCount}
                    groupCount={entry.groupCount}
                    statusCounts={entry.statusCounts}
                    isSelected={selectedJobId === entry.jobId}
                    onSelect={onSelectJob}
                    onRefresh={onRefresh ? () => onRefresh(entry.jobId) : undefined}
                    onReindex={onReindex ? () => onReindex(entry.jobId) : undefined}
                    reindexLoading={reindexLoading}
                    onAnalyzeStale={onAnalyzeStale ? () => onAnalyzeStale(entry.jobId) : undefined}
                    createdAt={entry.createdAt}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
