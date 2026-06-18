/* ------------------------------------------------------------------ */
/*  SelectedJobFilesPanel — files for a selected job                   */
/*  Shows a Tree/Table toggle + either OutputFilesTree or table        */
/* ------------------------------------------------------------------ */
import type { OutputFile, OutputFileTreeResponse, OutputFilesSummaryResponse, OutputFileListItem } from '../../api/types';
import OutputFilesTree from './OutputFilesTree';
import OutputFilesTable from './OutputFilesTable';
import OutputFilesSummaryCards from './OutputFilesSummaryCards';

interface FilterState {
  job_id?: string;
  mod_id?: string;
  group_key?: string;
}

type GroupMode = 'folder' | 'job' | 'date-job';

interface Props {
  selectedJobId: string | null;
  tree: OutputFileTreeResponse | null;
  treeLoading?: boolean;
  files: OutputFile[];
  filesLoading?: boolean;
  fileTotal: number;
  filter: FilterState;
  onFilterChange: (f: FilterState) => void;
  groupMode: GroupMode;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onSelectFile: (file: OutputFile) => void;
  selectedFileId?: string;
  summary: OutputFilesSummaryResponse | null;
  summaryLoading?: boolean;
  viewMode: 'tree' | 'table';
  onViewModeChange: (mode: 'tree' | 'table') => void;
}

export default function SelectedJobFilesPanel({
  selectedJobId,
  tree,
  treeLoading,
  files,
  filesLoading,
  fileTotal,
  filter,
  onFilterChange,
  groupMode,
  expandedGroups,
  onToggleGroup,
  onSelectFile,
  selectedFileId,
  summary,
  summaryLoading,
  viewMode,
  onViewModeChange,
}: Props) {
  if (!selectedJobId) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        Select a job to view files
      </div>
    );
  }

  return (
    <div>
      {/* Summary cards row */}
      {summary && (
        <OutputFilesSummaryCards summary={summary} loading={summaryLoading} />
      )}

      {/* Toolbar: view mode toggle */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
          Files for job: <span className="mono">{selectedJobId.length > 16 ? selectedJobId.slice(0, 16) + '...' : selectedJobId}</span>
          {tree && tree.jobs[selectedJobId] && (
            <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>
              ({countJobFiles(tree.jobs[selectedJobId])} files)
            </span>
          )}
        </div>
        <div className="view-mode-toggle">
          <button
            className={`btn btn-sm${viewMode === 'tree' ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => onViewModeChange('tree')}
          >
            Tree
          </button>
          <button
            className={`btn btn-sm${viewMode === 'table' ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => onViewModeChange('table')}
          >
            Table
          </button>
        </div>
      </div>

      {/* Files display: Tree or Table */}
      {viewMode === 'tree' ? (
        <div className="output-files-tree-panel" style={{ maxHeight: 'none' }}>
          <div className="card-title" style={{ padding: '0.5rem 0.75rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Files Tree</span>
            <select
              className="form-control"
              style={{ width: 'auto', minWidth: 100, marginLeft: 'auto', fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
              value={groupMode}
              onChange={e => onFilterChange({ job_id: selectedJobId })}
              disabled
            >
              <option value="folder">Folder</option>
              <option value="job">Job</option>
              <option value="date-job">Date → Job</option>
            </select>
          </div>
          <OutputFilesTree
            tree={tree}
            loading={treeLoading}
            filter={filter}
            onFilterChange={onFilterChange}
            groupMode={groupMode}
            expandedGroups={expandedGroups}
            onToggleGroup={onToggleGroup}
            files={files}
            onSelectFile={onSelectFile}
          />
        </div>
      ) : (
        <div className="output-files-table-panel">
          <OutputFilesTable
            files={files}
            loading={filesLoading}
            total={fileTotal}
            onSelectFile={onSelectFile}
            selectedFileId={selectedFileId}
          />
        </div>
      )}
    </div>
  );
}

function countJobFiles(jobNode: { mods?: Record<string, { groups?: Record<string, { files: unknown[] }> }> }): number {
  let total = 0;
  for (const mod of Object.values(jobNode.mods ?? {})) {
    for (const group of Object.values(mod.groups ?? {})) {
      total += group.files.length;
    }
  }
  return total;
}
