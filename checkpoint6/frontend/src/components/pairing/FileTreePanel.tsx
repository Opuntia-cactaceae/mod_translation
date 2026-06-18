import { useState, useEffect } from 'react';
import type { FileGroupResponse, PairingProjectFile } from '../../api/types';

const COLLAPSE_THRESHOLD = 50;

// ─── Helper functions ────────────────────────────────────────────────────────

function getRoleBadgeClass(role: string): string {
  switch (role) {
    case 'source':
      return 'badge badge-success';
    case 'translated':
      return 'badge badge-info';
    case 'unpaired':
      return 'badge badge-warning';
    default:
      return 'badge';
  }
}

function getRoleLabel(role: string): string {
  switch (role) {
    case 'source':
      return 'Source';
    case 'translated':
      return 'Translated';
    case 'unpaired':
      return 'Unpaired';
    default:
      return role;
  }
}

/** Exhaustive walk of the group tree collecting all group keys that exceed the collapse threshold. */
function collectLargeGroupKeys(groups: FileGroupResponse[]): string[] {
  const keys: string[] = [];
  function walk(list: FileGroupResponse[]) {
    for (const g of list) {
      if (g.files_count > COLLAPSE_THRESHOLD) {
        keys.push(g.group_key);
      }
      walk(g.children);
    }
  }
  walk(groups);
  return keys;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface FileTreePanelProps {
  groups: FileGroupResponse[];
  loading: boolean;
  groupingMode: string;
  onGroupingModeChange: (mode: string) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  fileFilter: string;
  onFileFilterChange: (filter: string) => void;
  selectedSourceFile: PairingProjectFile | null;
  selectedTranslatedFile: PairingProjectFile | null;
  onSelectSourceFile: (file: PairingProjectFile | null) => void;
  onSelectTranslatedFile: (file: PairingProjectFile | null) => void;
  onCreatePair: () => void;
  filesScanned: boolean;
}

// ─── Group tree component ────────────────────────────────────────────────────

interface FileGroupTreeProps {
  group: FileGroupResponse;
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string, fileCount: number) => void;
  selectedSourceFile: PairingProjectFile | null;
  selectedTranslatedFile: PairingProjectFile | null;
  onSelectSourceFile: (file: PairingProjectFile | null) => void;
  onSelectTranslatedFile: (file: PairingProjectFile | null) => void;
  searchQuery: string;
  fileFilter: string;
}

function FileGroupTree({
  group,
  collapsedGroups,
  onToggleGroup,
  selectedSourceFile,
  selectedTranslatedFile,
  onSelectSourceFile,
  onSelectTranslatedFile,
  searchQuery,
  fileFilter,
}: FileGroupTreeProps): JSX.Element {
  const hasChildren = group.children && group.children.length > 0;
  const isCollapsed = collapsedGroups.has(group.group_key);

  const isSourceSelected =
    selectedSourceFile !== null && group.files.some((f) => f.id === selectedSourceFile.id);
  const isTranslatedSelected =
    selectedTranslatedFile !== null && group.files.some((f) => f.id === selectedTranslatedFile.id);

  // Filter files by search query and role filter
  const filteredFiles = group.files.filter((f) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesFileName = f.file_name.toLowerCase().includes(q);
      const matchesRelativePath = f.relative_path.toLowerCase().includes(q);
      if (!matchesFileName && !matchesRelativePath) {
        return false;
      }
    }
    if (fileFilter === 'all') return true;
    if (fileFilter === 'source-like') return f.detected_role === 'source';
    if (fileFilter === 'translated-like') return f.detected_role === 'translated';
    if (fileFilter === 'unpaired') return f.detected_role === 'unpaired';
    if (fileFilter === 'ignored') return f.is_ignored;
    return true;
  });

  const hiddenCount = group.files_count - filteredFiles.length;

  return (
    <div className="tree-group">
      {/* ── Group Header ─────────────────────────────────────────────── */}
      <div className="tree-group-header">
        {(group.files_count > 0 || hasChildren) && (
          <button
            className="tree-collapse-toggle"
            onClick={() => onToggleGroup(group.group_key, group.files_count)}
            title={isCollapsed ? 'Expand group' : 'Collapse group'}
            aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              marginRight: 4,
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            {isCollapsed ? '\u25B6' : '\u25BC'}
          </button>
        )}

        <span className="tree-group-name">{group.display_name}</span>
        <span className="tree-group-stats">
          ({group.files_count} files, {group.source_like_count} source-like,{' '}
          {group.translated_like_count} translated-like)
        </span>

        {isCollapsed && filteredFiles.length > 0 && (
          <span
            className="tree-hidden-badge"
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontStyle: 'italic',
            }}
          >
            {hiddenCount > 0
              ? `${filteredFiles.length} shown, ${hiddenCount} hidden by filter`
              : `${filteredFiles.length} file${filteredFiles.length !== 1 ? 's' : ''} hidden`}
          </span>
        )}
      </div>

      {/* ── File List ────────────────────────────────────────────────── */}
      {!isCollapsed &&
        filteredFiles.map((file) => {
          const isSelectedSource =
            selectedSourceFile !== null && selectedSourceFile.id === file.id;
          const isSelectedTranslated =
            selectedTranslatedFile !== null && selectedTranslatedFile.id === file.id;
          const isSelected = isSelectedSource || isSelectedTranslated;

          return (
            <div
              key={file.id}
              className={`tree-file-row${isSelected ? ' file-selected' : ''}`}
              onClick={() => {
                if (isSelectedSource) {
                  onSelectSourceFile(null);
                } else if (isSelectedTranslated) {
                  onSelectTranslatedFile(null);
                } else {
                  onSelectSourceFile(file);
                }
              }}
            >
              <div className="tree-file-info">
                <span
                  className="tree-file-name"
                  title={file.file_name}
                  style={{
                    maxWidth: 180,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'inline-block',
                  }}
                >
                  {file.file_name}
                </span>
                <span
                  className="tree-file-path"
                  title={file.relative_path}
                  style={{
                    maxWidth: 240,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'inline-block',
                    verticalAlign: 'bottom',
                  }}
                >
                  ({file.relative_path})
                </span>
              </div>
              <div className="tree-file-meta">
                {file.detected_language && (
                  <span className="badge">{file.detected_language}</span>
                )}
                <span className={getRoleBadgeClass(file.detected_role)}>
                  {getRoleLabel(file.detected_role)}
                </span>
                {file.is_ignored && <span className="badge badge-warning">Ignored</span>}
              </div>
              <div className="tree-file-actions">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSourceFile(file);
                  }}
                  disabled={isSelectedSource}
                >
                  Set as source
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTranslatedFile(file);
                  }}
                  disabled={isSelectedTranslated}
                >
                  Set as translated
                </button>
              </div>
            </div>
          );
        })}

      {/* ── Children groups ──────────────────────────────────────────── */}
      {hasChildren &&
        group.children.map((child) => (
          <FileGroupTree
            key={child.group_key}
            group={child}
            collapsedGroups={collapsedGroups}
            onToggleGroup={onToggleGroup}
            selectedSourceFile={selectedSourceFile}
            selectedTranslatedFile={selectedTranslatedFile}
            onSelectSourceFile={onSelectSourceFile}
            onSelectTranslatedFile={onSelectTranslatedFile}
            searchQuery={searchQuery}
            fileFilter={fileFilter}
          />
        ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function FileTreePanel({
  groups,
  loading,
  groupingMode,
  onGroupingModeChange,
  searchQuery,
  onSearchQueryChange,
  fileFilter,
  onFileFilterChange,
  selectedSourceFile,
  selectedTranslatedFile,
  onSelectSourceFile,
  onSelectTranslatedFile,
  onCreatePair,
  filesScanned,
}: FileTreePanelProps) {
  // Collapsed group keys. Default: groups > COLLAPSE_THRESHOLD files are collapsed.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  // Auto-collapse large groups whenever the group tree changes.
  useEffect(() => {
    const largeKeys = collectLargeGroupKeys(groups);
    setCollapsedGroups((prev) => {
      const merged = new Set(prev);
      for (const k of largeKeys) {
        merged.add(k);
      }
      return merged;
    });
  }, [groups]);

  function toggleGroup(key: string, _fileCount: number) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // ── Body renderer ──────────────────────────────────────────────────
  const renderBody = () => {
    if (loading) {
      return <div className="panel-body-loading">Loading files...</div>;
    }

    if (!filesScanned) {
      return <div className="panel-body-empty">Project not scanned yet</div>;
    }

    if (!groups || groups.length === 0) {
      return <div className="panel-body-empty">No files found</div>;
    }

    return (
      <div
        className="file-tree-scroll-container"
        style={{
          maxHeight: 'calc(100vh - 250px)',
          overflowY: 'auto',
          minWidth: 0,
        }}
      >
        {groups.map((group) => (
          <FileGroupTree
            key={group.group_key}
            group={group}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            selectedSourceFile={selectedSourceFile}
            selectedTranslatedFile={selectedTranslatedFile}
            onSelectSourceFile={onSelectSourceFile}
            onSelectTranslatedFile={onSelectTranslatedFile}
            searchQuery={searchQuery}
            fileFilter={fileFilter}
          />
        ))}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="panel" style={{ minWidth: 0, overflow: 'hidden' }}>
      <div className="panel-header">
        <h3>File Tree</h3>
      </div>

      <div className="panel-body" style={{ minWidth: 0 }}>
        <div className="file-tree-controls">
          <input
            type="text"
            className="form-control"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />

          <select
            className="form-control"
            value={groupingMode}
            onChange={(e) => onGroupingModeChange(e.target.value)}
          >
            <option value="by_directory">By Directory</option>
            <option value="by_filename">By Filename</option>
            <option value="by_language_marker">By Language Marker</option>
            <option value="flat">Flat</option>
          </select>

          <select
            className="form-control"
            value={fileFilter}
            onChange={(e) => onFileFilterChange(e.target.value)}
          >
            <option value="all">All Files</option>
            <option value="source-like">Source-like</option>
            <option value="translated-like">Translated-like</option>
            <option value="unpaired">Unpaired</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>

        {renderBody()}

        {selectedSourceFile && selectedTranslatedFile && (
          <div className="create-pair-bar">
            <button className="btn btn-sm btn-primary" onClick={onCreatePair}>
              Create Pair
            </button>
          </div>
        )}
      </div>

      <div className="selected-bar">
        <div className="selected-bar-item">
          <strong>Source:</strong>{' '}
          {selectedSourceFile ? selectedSourceFile.file_name : '(none)'}
        </div>
        <div className="selected-bar-item">
          <strong>Translated:</strong>{' '}
          {selectedTranslatedFile ? selectedTranslatedFile.file_name : '(none)'}
        </div>
      </div>
    </div>
  );
}
