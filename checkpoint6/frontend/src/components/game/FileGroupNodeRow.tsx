/* ------------------------------------------------------------------ */
/*  FileGroupNodeRow — recursive tree node rendering for file groups    */
/*                                                                      */
/*  Renders a group header (label, file count, actions) and optionally  */
/*  its children recursively.  Supports depth-based indentation and     */
/*  can be used for flat, single-level, or deeply nested trees.         */
/*                                                                      */
/*  Supports both translation-job draft mode and custom action modes.   */
/*  Accepts a `style` prop on leaf file rows for future virtualization. */
/* ------------------------------------------------------------------ */

import React from 'react';
import type { FileGroupNode } from '../../domain/grouping/groupingTypes';
import { computeGroupProgress } from '../../domain/grouping/groupingProgress';
import { getRelativePath, normalizePath } from '../../utils/genericFileGrouping';
import { FileRow } from './FileRow';

/** Find a common parent directory from a list of absolute file paths. */
function getCommonParentDir(paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) {
    const idx = paths[0].lastIndexOf('/');
    return idx >= 0 ? paths[0].substring(0, idx) : null;
  }
  const sorted = [...paths].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && first[i] === last[i]) i++;
  const prefix = first.substring(0, i);
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash >= 0 ? prefix.substring(0, lastSlash) : null;
}

interface FileGroupNodeRowProps {
  node: FileGroupNode;
  /** Nesting depth (0 = top-level). Used for indentation. */
  depth: number;
  /** Set of expanded group IDs. */
  expandedGroups: Set<string>;
  /** Root directory for computing relative paths. */
  rootDir: string;
  /** Called when a group header is clicked to toggle expansion. */
  onToggleGroup: (id: string) => void;
  /** Called to add all files in a group to the job draft (optional). */
  onAddGroupToJob?: (node: FileGroupNode) => void;
  /** Called to translate a group's files (optional). */
  onTranslateGroup?: (node: FileGroupNode) => void;
  /** Check if a file path is already in the draft (optional). */
  isFileInDraft?: (path: string) => boolean;
  /** Whether to show a checkbox selector on file rows (default true). */
  selectable?: boolean;
  /** Set of selected file paths (optional; only used when selectable=true). */
  selectedFiles?: Set<string>;
  /** Called to toggle file selection (optional; only used when selectable=true). */
  onToggleFile?: (path: string) => void;
  /** Called to add/remove a file from the draft (optional). */
  onToggleDraftFile?: (path: string) => void;
  /** Called to open a file's folder in Finder. */
  onOpenFolder: (path: string) => void;
  /** Set of normalized draft paths for progress computation (optional). */
  draftPathSet?: Set<string>;
  /** Function to normalize paths for comparison. */
  normalizeFn?: (path: string) => string;
  /** Style for leaf file rows (for virtualization prep). */
  rowStyle?: React.CSSProperties;
  /**
   * Custom renderer for group-level actions.
   * If provided, replaces the default draft/job group action buttons.
   */
  renderGroupActions?: (node: FileGroupNode) => React.ReactNode;
  /**
   * Custom renderer for file-level actions.
   * If provided, passed to FileRow as customActions.
   */
  customFileActions?: (filePath: string) => React.ReactNode;
  /**
   * Custom CSS class per-file row.
   * If provided, passed to FileRow as className.
   */
  customFileRowClass?: (filePath: string) => string | undefined;
  /**
   * Set of file paths that should have data-reveal-path attribute set.
   * Used by PairingFileWorkspace reveal/highlight sync.
   */
  revealedFilePaths?: Set<string>;
  /**
   * Enables native HTML5 drag on file rows. The handler should set drag payload.
   * Passed through to every FileRow rendered by this component.
   */
  onFileDragStart?: (filePath: string, event: React.DragEvent) => void;
  /**
   * Display mode for file path text forwarded to FileRow.
   * 'full_path' (default) shows full relativePath; 'basename' shows file name + parent dir.
   */
  displayMode?: 'full_path' | 'basename';
  /**
   * If true, leaf nodes with a single file are rendered inline as a FileRow
   * instead of as an expandable group header wrapping the file.
   * Used by Folder/Filename/Language modes to avoid redundant singleton groups.
   * Smart mode typically keeps this as false.
   */
  flattenSingletons?: boolean;
}

export function FileGroupNodeRow({
  node,
  depth,
  expandedGroups,
  rootDir,
  onToggleGroup,
  onAddGroupToJob,
  onTranslateGroup,
  isFileInDraft = () => false,
  selectable = true,
  selectedFiles = new Set<string>(),
  onToggleFile = () => {},
  onToggleDraftFile,
  onOpenFolder,
  draftPathSet,
  normalizeFn = normalizePath,
  rowStyle,
  renderGroupActions,
  customFileActions,
  customFileRowClass,
  revealedFilePaths,
  onFileDragStart,
  displayMode = 'full_path',
  flattenSingletons = false,
}: FileGroupNodeRowProps) {
  const isExpanded = expandedGroups.has(node.id);
  const hasDraftProps = draftPathSet !== undefined;
  const effectiveDraftPathSet = draftPathSet ?? new Set<string>();
  const allGroupAdded = hasDraftProps && node.files.length > 0 && node.files.every(f => isFileInDraft(f));
  const progress = hasDraftProps
    ? computeGroupProgress(node.files, effectiveDraftPathSet, normalizeFn)
    : { partialAdded: false, allAdded: false, fractionLabel: '' };

  // Flatten singleton leaf nodes for non-smart modes:
  // a leaf node (children=undefined) with exactly 1 file renders directly
  // as a FileRow without an expandable group header wrapper.
  if (flattenSingletons && node.children === undefined && node.files.length === 1) {
    return (
      <div className="loc-group-item" style={{ marginLeft: depth > 0 ? `${depth * 0.5}rem` : undefined }}>
        <div className="loc-group-body">
          {node.files.map(fp => (
            <FileRow
              key={fp}
              filePath={fp}
              relativePath={getRelativePath(fp, rootDir)}
              displayMode={displayMode}
              isInDraft={isFileInDraft(fp)}
              selectable={selectable}
              isSelected={selectedFiles.has(fp)}
              onToggleSelect={() => onToggleFile(fp)}
              onToggleDraft={onToggleDraftFile ? () => onToggleDraftFile!(fp) : undefined}
              onOpenFolder={() => onOpenFolder(fp)}
              style={rowStyle}
              className={customFileRowClass?.(fp)}
              customActions={customFileActions ? customFileActions(fp) : undefined}
              revealed={revealedFilePaths?.has(fp)}
              onFileDragStart={onFileDragStart}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`loc-group-item${progress.partialAdded ? ' loc-group-has-added' : ''}`} style={{ marginLeft: depth > 0 ? `${depth * 0.5}rem` : undefined }}>
      {/* Group header */}
      {node.children !== undefined || node.files.length > 0 ? (
        <div className="loc-group-header" onClick={() => onToggleGroup(node.id)}>
          <span className={`loc-group-arrow${isExpanded ? ' open' : ''}`}>&#9654;</span>
          <span className="loc-group-label">{node.label}</span>
          {node.relativePath && (
            <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
              {node.relativePath}
            </span>
          )}
          <span className="badge badge-muted" style={{ marginLeft: 'auto', marginRight: '0.25rem' }}>
            {node.fileCount} file{node.fileCount !== 1 ? 's' : ''}
          </span>
          {/* Group progress badge (only in draft mode) */}
          {progress.partialAdded && (
            <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
              {progress.fractionLabel} added
            </span>
          )}
          {progress.allAdded && (
            <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>
              All added
            </span>
          )}
        </div>
      ) : null}

      {/* Group-level actions */}
      {node.files.length > 0 && (
        <div className="loc-group-actions">
          {renderGroupActions ? (
            renderGroupActions(node)
          ) : (
            <>
              {onAddGroupToJob && (
                <button
                  className={`btn btn-sm${allGroupAdded ? ' btn-added' : ''}`}
                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                  onClick={() => onAddGroupToJob(node)}
                  type="button"
                >
                  {allGroupAdded ? 'All added' : 'Add group to Translation Job'}
                </button>
              )}
              {onTranslateGroup && (
                <button
                  className="btn btn-sm"
                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                  onClick={() => onTranslateGroup(node)}
                  type="button"
                >
                  Translate group
                </button>
              )}
              <button
                className="btn btn-sm"
                style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                onClick={() => {
                  const dir = getCommonParentDir(node.files);
                  onOpenFolder(dir ?? node.files[0].substring(0, node.files[0].lastIndexOf('/')));
                }}
                type="button"
              >
                Open folder
              </button>
            </>
          )}
        </div>
      )}

      {/* Expanded children (recursive) */}
      {isExpanded && node.children && node.children.length > 0 && (
        <div className="loc-group-body">
          {node.children.map(child => (
            <FileGroupNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedGroups={expandedGroups}
              rootDir={rootDir}
              onToggleGroup={onToggleGroup}
              onAddGroupToJob={onAddGroupToJob}
              onTranslateGroup={onTranslateGroup}
              isFileInDraft={isFileInDraft}
              selectable={selectable}
              selectedFiles={selectedFiles}
              onToggleFile={onToggleFile}
              onToggleDraftFile={onToggleDraftFile}
              onOpenFolder={onOpenFolder}
              draftPathSet={draftPathSet}
              normalizeFn={normalizeFn}
              rowStyle={rowStyle}
              renderGroupActions={renderGroupActions}
              customFileActions={customFileActions}
              customFileRowClass={customFileRowClass}
              revealedFilePaths={revealedFilePaths}
              onFileDragStart={onFileDragStart}
              displayMode={displayMode}
              flattenSingletons={flattenSingletons}
            />
          ))}
        </div>
      )}

      {/* Expanded file list (leaf level) */}
      {isExpanded && (!node.children || node.children.length === 0) && node.files.length > 0 && (
        <div className="loc-group-body">
          {node.files.map(fp => (
            <FileRow
              key={fp}
              filePath={fp}
              relativePath={getRelativePath(fp, rootDir)}
              displayMode={displayMode}
              isInDraft={isFileInDraft(fp)}
              selectable={selectable}
              isSelected={selectedFiles.has(fp)}
              onToggleSelect={() => onToggleFile(fp)}
              onToggleDraft={onToggleDraftFile ? () => onToggleDraftFile!(fp) : undefined}
              onOpenFolder={() => onOpenFolder(fp)}
              style={rowStyle}
              className={customFileRowClass?.(fp)}
              customActions={customFileActions ? customFileActions(fp) : undefined}
              revealed={revealedFilePaths?.has(fp)}
              onFileDragStart={onFileDragStart}
            />
          ))}
        </div>
      )}
    </div>
  );
}
