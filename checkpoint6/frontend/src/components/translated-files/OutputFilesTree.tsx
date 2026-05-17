/* ------------------------------------------------------------------ */
/*  OutputFilesTree — hierarchy with job-scoped source grouping        */
/* ------------------------------------------------------------------ */
import type { OutputFileTreeResponse, OutputFileListItem } from '../../api/types';

interface FilterState {
  job_id?: string;
  mod_id?: string;
  group_key?: string;
}

interface Props {
  tree: OutputFileTreeResponse | null;
  loading?: boolean;
  filter: FilterState;
  onFilterChange: (f: FilterState) => void;
}

/* ------------------------------------------------------------------ */
/*  Tree node click helpers                                            */
/* ------------------------------------------------------------------ */

function selectJob(jobId: string): FilterState {
  return { job_id: jobId };
}

function selectMod(jobId: string, modId: string): FilterState {
  return { job_id: jobId, mod_id: modId };
}

function selectGroup(jobId: string, modId: string, groupKey: string): FilterState {
  return { job_id: jobId, mod_id: modId, group_key: groupKey };
}

/* ------------------------------------------------------------------ */
/*  Status badge helper                                                */
/* ------------------------------------------------------------------ */

function statusLabel(status: string): string {
  switch (status) {
    case 'ready': return 'READY';
    case 'missing_source': return 'MISSING SOURCE';
    case 'stale': return 'STALE';
    default: return status.toUpperCase();
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'ready': return 'badge badge-success';
    case 'missing_source': return 'badge badge-error';
    default: return 'badge badge-warning';
  }
}

/* ------------------------------------------------------------------ */
/*  Job-scoped grouping: group translated files under their source     */
/* ------------------------------------------------------------------ */

interface SourceGroup {
  sourceFileName: string;
  sourceFilePath: string;
  files: OutputFileListItem[];
}

function groupBySource(files: OutputFileListItem[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const f of files) {
    const key = f.source_file_name || f.file_name;
    if (!groups.has(key)) {
      groups.set(key, {
        sourceFileName: f.source_file_name || f.file_name,
        sourceFilePath: f.source_file_path || f.relative_source_path || '',
        files: [],
      });
    }
    groups.get(key)!.files.push(f);
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.sourceFileName.localeCompare(b.sourceFileName)
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OutputFilesTree({ tree, loading, filter, onFilterChange }: Props) {
  if (loading) {
    return (
      <div className="loading" style={{ padding: '1rem', justifyContent: 'flex-start' }}>
        <span className="spinner" /> Loading tree...
      </div>
    );
  }

  if (!tree || Object.keys(tree.jobs).length === 0) {
    return (
      <div style={{ padding: '1rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
        No indexed output files
      </div>
    );
  }

  const entries = Object.entries(tree.jobs);
  const isJobScoped = !!filter.job_id;

  return (
    <div className="tree-panel">
      {entries.map(([jobId, jobNode]) => (
        <div key={jobId} className="tree-section">
          {/* Job node — only show in global mode, or as a header in job-scoped */}
          {!isJobScoped && (
            <div
              className={`tree-node tree-node-job${filter.job_id === jobId ? ' tree-node-selected' : ''}`}
              onClick={() => onFilterChange(selectJob(jobId))}
            >
              Job: {jobId.slice(0, 8)}
            </div>
          )}

          {/* Job-scoped header */}
          {isJobScoped && (
            <div className="tree-node tree-node-job tree-node-selected">
              Job: {jobId.slice(0, 8)}
              <span className="tree-node-count">
                {Object.values(jobNode.mods).reduce(
                  (sum, m) => sum + Object.values(m.groups).reduce(
                    (gs, g) => gs + g.files.length, 0
                  ), 0
                )}
              </span>
            </div>
          )}

          {/* Mod nodes */}
          <div className="tree-children">
            {Object.entries(jobNode.mods).map(([modId, modNode]) => (
              <div key={modId}>
                <div
                  className={`tree-node tree-node-mod${filter.mod_id === modId && filter.job_id === jobId ? ' tree-node-selected' : ''}`}
                  onClick={() => onFilterChange(isJobScoped ? { job_id: jobId } : selectMod(jobId, modId))}
                >
                  {modNode.mod_name || 'Unknown mod'}
                </div>

                {/* Children: groups (global) or source files (job-scoped) */}
                <div className="tree-children">
                  {isJobScoped
                    ? <JobScopedModContent
                        modNode={modNode}
                        jobId={jobId}
                        filter={filter}
                        onFilterChange={onFilterChange}
                      />
                    : <GlobalModContent
                        modNode={modNode}
                        jobId={jobId}
                        filter={filter}
                        onFilterChange={onFilterChange}
                      />
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Global mode: Mod → Group → Files (flat list)                       */
/* ------------------------------------------------------------------ */

function GlobalModContent({
  modNode, jobId, filter, onFilterChange,
}: {
  modNode: { groups: Record<string, { group_key: string; group_label: string; files: OutputFileListItem[] }> };
  jobId: string;
  filter: FilterState;
  onFilterChange: (f: FilterState) => void;
}) {
  return (
    <>
      {Object.entries(modNode.groups).map(([groupKey, groupNode]) => (
        <div key={groupKey}>
          <div
            className={`tree-node tree-node-group${filter.group_key === groupKey && filter.mod_id ? ' tree-node-selected' : ''}`}
            onClick={() => onFilterChange(selectGroup(jobId, modNode.mod_id || '', groupKey))}
          >
            {groupNode.group_label || groupKey}
            <span className="tree-node-count">{groupNode.files.length}</span>
          </div>
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Job-scoped mode: Mod → Source file → Translated files              */
/* ------------------------------------------------------------------ */

function JobScopedModContent({
  modNode, jobId, filter, onFilterChange,
}: {
  modNode: { mod_id?: string; groups: Record<string, { files: OutputFileListItem[] }> };
  jobId: string;
  filter: FilterState;
  onFilterChange: (f: FilterState) => void;
}) {
  // Collect all files across all groups and group by source file
  const allFiles: OutputFileListItem[] = [];
  for (const groupNode of Object.values(modNode.groups)) {
    allFiles.push(...groupNode.files);
  }

  const sourceGroups = groupBySource(allFiles);

  return (
    <>
      {sourceGroups.map((sg) => (
        <div key={sg.sourceFileName}>
          {/* Source file header */}
          <div className="tree-node tree-node-source">
            <span className="source-label">Source</span>
            {sg.sourceFileName}
          </div>

          {/* Translated files under this source */}
          <div className="tree-children">
            {sg.files.map((f) => (
              <div
                key={f.id}
                className={`tree-node tree-node-file${
                  f.id === filter.group_key ? ' tree-node-selected' : ''
                }`}
                onClick={() => onFilterChange({
                  job_id: jobId,
                })}
              >
                <span className="translated-label">Translated</span>
                {f.file_name}
                <span className={statusClass(f.status)} style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>
                  {statusLabel(f.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
