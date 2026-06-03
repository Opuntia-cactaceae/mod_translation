/* ------------------------------------------------------------------ */
/*  OutputFilesTree — hierarchy with date grouping                     */
/* ------------------------------------------------------------------ */
import React, { useMemo } from 'react';
import type { OutputFile, OutputFileTreeResponse, OutputFileListItem, JobTimestampInfo } from '../../api/types';
import { groupByDateBucket } from '../../utils/dateGrouping';
import FreshnessBadge from '../common/FreshnessBadge';
import ResultBadge from '../common/ResultBadge';

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
  /** Grouping mode for the tree. Defaults to 'job' for backward compat. */
  groupMode?: 'folder' | 'job' | 'date-job';
  /**
   * Per-date-group expanded state (bucketKey -> boolean). Absent = expanded.
   * @deprecated Use `expandedGroups` instead.
   */
  expandedDateGroups?: Record<string, boolean>;
  /**
   * @deprecated Use `onToggleGroup` instead.
   */
  onToggleDateGroup?: (bucketKey: string) => void;
  /** Unified expanded group state (groupKey -> boolean). Absent = expanded. */
  expandedGroups?: Record<string, boolean>;
  /** Called when a collapsible group header is clicked to toggle. */
  onToggleGroup?: (groupKey: string) => void;
  /** Full file list for the selected job (used to show analysis status). */
  files?: OutputFile[];
  /** Called when a file row is clicked to open the details modal. */
  onSelectFile?: (file: OutputFile) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function countJobFiles(jobNode: { mods?: Record<string, { groups?: Record<string, { files: unknown[] }> }> }): number {
  let total = 0;
  for (const mod of Object.values(jobNode.mods ?? {})) {
    for (const group of Object.values(mod.groups ?? {})) {
      total += group.files.length;
    }
  }
  return total;
}

function getJobTimestamp(jobId: string, jobTimestamps: Record<string, JobTimestampInfo>): Date | null {
  const ts = jobTimestamps[jobId];
  if (!ts) return null;
  const raw = ts.completed_at || ts.updated_at || ts.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
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
/*  Generic collapsible header render helper                           */
/* ------------------------------------------------------------------ */

/** Props for rendering a collapsible tree node header. */
interface CollapsibleHeaderProps {
  groupKey: string;
  label: React.ReactNode;
  count?: number;
  countLabel?: string;
  isSelected?: boolean;
  className?: string;
  expanded: Record<string, boolean>;
  onToggle: ((key: string) => void) | undefined;
}

/** Render a collapsible tree node header with arrow, label, count. */
function CollapsibleHeader({
  groupKey,
  label,
  count,
  countLabel,
  isSelected,
  className = '',
  expanded,
  onToggle,
}: CollapsibleHeaderProps) {
  const isExpanded = expanded[groupKey] !== false;
  return (
    <div
      className={`tree-node tree-node-collapsible ${className}${isSelected ? ' tree-node-selected' : ''}`}
      onClick={onToggle ? () => onToggle(groupKey) : undefined}
      role="button"
      tabIndex={0}
      onKeyDown={onToggle ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(groupKey);
        }
      } : undefined}
      aria-expanded={isExpanded}
    >
      <span className={`group-header-arrow${isExpanded ? ' open' : ''}`}>&#9654;</span>
      {label}
      {count !== undefined && (
        <span className="tree-node-count">
          {count}{countLabel ? ` ${countLabel}` : ''}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OutputFilesTree({
  tree, loading, filter, onFilterChange, groupMode = 'job',
  expandedDateGroups, onToggleDateGroup,
  expandedGroups, onToggleGroup,
  files, onSelectFile,
}: Props) {
  // Backward compat: use new props, fall back to old deprecated props
  const effectiveExpanded = expandedGroups ?? expandedDateGroups ?? {};
  const effectiveToggle = onToggleGroup ?? onToggleDateGroup;

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
  const isDateJobMode = groupMode === 'date-job' && !isJobScoped;

  return (
    <div className="tree-panel">
      {isDateJobMode
        ? <DateJobTreeContent
            entries={entries}
            jobTimestamps={tree.job_timestamps || {}}
            filter={filter}
            onFilterChange={onFilterChange}
            expanded={effectiveExpanded}
            onToggle={effectiveToggle}
          />
        : entries.map(([jobId, jobNode]) => {
            const isJobMode = groupMode === 'job' && !isJobScoped;
            const isFolderMode = groupMode === 'folder' && !isJobScoped;
            const jobKey = `job:${jobId}`;
            const isJobExpanded = effectiveExpanded[jobKey] !== false;

            return (
              <div key={jobId} className="tree-section">
                {/* Job node */}
                {!isJobScoped && isJobMode && (
                  <CollapsibleHeader
                    groupKey={jobKey}
                    label={<>Job: {jobId.slice(0, 8)}</>}
                    count={countJobFiles(jobNode)}
                    isSelected={filter.job_id === jobId}
                    className="tree-node-job"
                    expanded={effectiveExpanded}
                    onToggle={effectiveToggle}
                  />
                )}
                {!isJobScoped && !isJobMode && (
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
                      {countJobFiles(jobNode)}
                    </span>
                  </div>
                )}

                {/* Mod nodes — conditionally rendered when job is expanded */}
                {(!isJobMode || isJobExpanded) && (
                  <div className="tree-children">
                    {Object.entries(jobNode.mods ?? {}).map(([modId, modNode]) => {
                      const modKey = `mod:${modId}`;
                      const isModCollapsible = isFolderMode || isJobScoped;
                      const isModExpanded = isModCollapsible
                        ? (effectiveExpanded[modKey] !== false)
                        : true;

                      return (
                        <div key={modId}>
                          {isModCollapsible ? (
                            <CollapsibleHeader
                              groupKey={modKey}
                              label={modNode.mod_name || 'Unknown mod'}
                              className="tree-node-mod"
                              isSelected={filter.mod_id === modId && filter.job_id === jobId}
                              expanded={effectiveExpanded}
                              onToggle={effectiveToggle}
                            />
                          ) : (
                            <div
                              className={`tree-node tree-node-mod${filter.mod_id === modId && filter.job_id === jobId ? ' tree-node-selected' : ''}`}
                              onClick={() => onFilterChange(isJobScoped ? { job_id: jobId } : selectMod(jobId, modId))}
                            >
                              {modNode.mod_name || 'Unknown mod'}
                            </div>
                          )}

                          {/* Children: hidden when mod is collapsed */}
                          {(!isModCollapsible || isModExpanded) && (
                            <div className="tree-children">
                              {isJobScoped
                                ? <JobScopedModContent
                                    modNode={modNode}
                                    jobId={jobId}
                                    filter={filter}
                                    onFilterChange={onFilterChange}
                                    files={files}
                                    onSelectFile={onSelectFile}
                                  />
                                : <GlobalModContent
                                    modNode={modNode}
                                    jobId={jobId}
                                    filter={filter}
                                    onFilterChange={onFilterChange}
                                  />
                              }
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
      }
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible header for tree nodes (used by DateJobTreeContent)     */
/* ------------------------------------------------------------------ */

function DateCollapsibleHeader({
  groupKey, label, count, countLabel, expanded, onToggle,
}: {
  groupKey: string;
  label: string;
  count: string;
  countLabel?: string;
  expanded: Record<string, boolean>;
  onToggle: ((key: string) => void) | undefined;
}) {
  const isExpanded = expanded[groupKey] !== false;
  return (
    <div
      className="tree-date-header tree-date-header-collapsible"
      onClick={onToggle ? () => onToggle(groupKey) : undefined}
      role="button"
      tabIndex={0}
      onKeyDown={onToggle ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(groupKey);
        }
      } : undefined}
      aria-expanded={isExpanded}
    >
      <span className={`group-header-arrow${isExpanded ? ' open' : ''}`}>&#9654;</span>
      {label}
      <span className="tree-node-count">
        {count}{countLabel ? ` ${countLabel}` : ''}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Date → Job grouping mode                                           */
/* ------------------------------------------------------------------ */

function DateJobTreeContent({
  entries,
  jobTimestamps,
  filter,
  onFilterChange,
  expanded,
  onToggle,
}: {
  entries: [string, OutputFileTreeResponse['jobs'][string]][];
  jobTimestamps: Record<string, JobTimestampInfo>;
  filter: FilterState;
  onFilterChange: (f: FilterState) => void;
  expanded: Record<string, boolean>;
  onToggle: ((key: string) => void) | undefined;
}) {
  // Build items list for date grouping
  const items = entries.map(([jobId, jobNode]) => ({
    jobId,
    jobNode,
    date: getJobTimestamp(jobId, jobTimestamps),
  }));

  const now = new Date();
  const grouped = groupByDateBucket(items, (item) => item.date, now);

  return (
    <>
      {grouped.map(({ bucket, bucketKey, items: bucketItems }) => {
        const totalJobs = bucketItems.length;
        const totalFiles = bucketItems.reduce((sum, item) => sum + countJobFiles(item.jobNode), 0);
        const dateGroupKey = `date:${bucketKey}`;
        const isDateExpanded = expanded[dateGroupKey] !== false;

        return (
          <div key={bucket} className="tree-section">
            <DateCollapsibleHeader
              groupKey={dateGroupKey}
              label={bucket}
              count={`${totalJobs} job${totalJobs !== 1 ? 's' : ''}, ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`}
              expanded={expanded}
              onToggle={onToggle}
            />
            {isDateExpanded && (
            <div className="tree-children">
              {bucketItems.map(({ jobId, jobNode }) => {
                const jobKey = `job:${jobId}`;
                const isJobExpanded = expanded[jobKey] !== false;

                return (
                  <div key={jobId} className="tree-section">
                    <CollapsibleHeader
                      groupKey={jobKey}
                      label={<>Job: {jobId.slice(0, 8)}</>}
                      count={countJobFiles(jobNode)}
                      isSelected={filter.job_id === jobId}
                      className="tree-node-job"
                      expanded={expanded}
                      onToggle={onToggle}
                    />
                    {isJobExpanded && (
                      <div className="tree-children">
                        {Object.entries(jobNode.mods ?? {}).map(([modId, modNode]) => (
                          <div key={modId}>
                            <div
                              className={`tree-node tree-node-mod${filter.mod_id === modId && filter.job_id === jobId ? ' tree-node-selected' : ''}`}
                              onClick={() => onFilterChange(selectMod(jobId, modId))}
                            >
                              {modNode.mod_name || 'Unknown mod'}
                            </div>
                            <div className="tree-children">
                              <GlobalModContent
                                modNode={modNode}
                                jobId={jobId}
                                filter={filter}
                                onFilterChange={onFilterChange}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Global mode: Mod → Group → Files (flat list)                       */
/* ------------------------------------------------------------------ */

function GlobalModContent({
  modNode, jobId, filter, onFilterChange,
}: {
  modNode: { mod_id?: string; groups: Record<string, { group_key: string; group_label: string; files: OutputFileListItem[] }> };
  jobId: string;
  filter: FilterState;
  onFilterChange: (f: FilterState) => void;
}) {
  return (
    <>
      {Object.entries(modNode.groups ?? {}).map(([groupKey, groupNode]) => (
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
/*  Shared badge helpers (delegates to common components)               */
/* ------------------------------------------------------------------ */

function analysisBadgeLabel(analysis: { status: string; errors_count?: number; warnings_count?: number } | null | undefined, stale: boolean | undefined): React.ReactNode {
  if (!analysis) {
    return null;
  }
  return (
    <ResultBadge
      status={analysis.status}
      errorsCount={analysis.errors_count}
      warningsCount={analysis.warnings_count}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Analysis state badge helper (delegates to FreshnessBadge)           */
/* ------------------------------------------------------------------ */

function analysisStateBadge(state: string | undefined): React.ReactNode {
  return <FreshnessBadge state={state} />;
}

/* ------------------------------------------------------------------ */
/*  Job-scoped mode: Mod → Source file → Translated files              */
/* ------------------------------------------------------------------ */

function JobScopedModContent({
  modNode, jobId, filter, onFilterChange,
  files, onSelectFile,
}: {
  modNode: { mod_id?: string; groups: Record<string, { files: OutputFileListItem[] }> };
  jobId: string;
  filter: FilterState;
  onFilterChange: (f: FilterState) => void;
  files?: OutputFile[];
  onSelectFile?: (file: OutputFile) => void;
}) {
  // Build a lookup map from the full file list (if available) for analysis data
  const fileMap = useMemo(() => {
    if (!files) return null;
    const map = new Map<string, OutputFile>();
    for (const f of files) {
      map.set(f.id, f);
    }
    return map;
  }, [files]);

  function handleFileClick(f: OutputFileListItem) {
    if (!onSelectFile || !fileMap) return;
    const fullFile = fileMap.get(f.id);
    if (fullFile) {
      onSelectFile(fullFile);
    }
  }

  // Collect all files across all groups and group by source file
  const allFiles: OutputFileListItem[] = [];
  for (const groupNode of Object.values(modNode.groups ?? {})) {
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
            {sg.files.map((f) => {
              const fullFile = fileMap?.get(f.id);
              return (
                <div
                  key={f.id}
                  className={`tree-node tree-node-file${
                    f.id === filter.group_key ? ' tree-node-selected' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFileClick(f);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleFileClick(f);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  title="View file details"
                >
                  <span className="translated-label">Translated</span>
                  {f.file_name}
                  <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', marginLeft: '0.5rem' }}>
                    <span className={statusClass(f.status)} style={{ fontSize: '0.65rem' }}>
                      {statusLabel(f.status)}
                    </span>
                    {fullFile && (
                      <span style={{ fontSize: '0.65rem' }}>
                        <ResultBadge
                          status={fullFile.latest_analysis?.status}
                          errorsCount={fullFile.latest_analysis?.errors_count}
                          warningsCount={fullFile.latest_analysis?.warnings_count}
                          freshnessState={fullFile.latest_analysis_state || undefined}
                        />
                      </span>
                    )}
                    {!fullFile && (
                      <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>Not analyzed</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
