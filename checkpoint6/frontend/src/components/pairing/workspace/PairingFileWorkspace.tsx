/* ------------------------------------------------------------------ */
/*  PairingFileWorkspace — explorer-style file tree for Pair Projects   */
/*                                                                      */
/*  Provides an explorer-style grouped file tree (similar to            */
/*  GenericFileSection) with scan controls, grouping mode selector,     */
/*  include/exclude filters, and pairing-oriented file actions.         */
/*                                                                      */
/*  Persistence (localStorage, project-scoped):                         */
/*    - grouping mode (smart, folder, filename, language_marker, flat)  */
/*    - expanded groups                                                 */
/*    - selected file paths                                             */
/*    - include filter text                                             */
/*    - exclude filter text                                             */
/*                                                                      */
/*  Uses genericFileGrouping.ts for client-side grouping (same as       */
/*  GenericFileSection).  Backend provides flat file list via the       */
/*  existing pairing-project groups endpoint; paths are extracted and   */
/*  re-grouped on the client.                                           */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, useToast } from '../../../App';
import { usePersistentState } from '../../../hooks/usePersistentState';
import { STORAGE_KEYS } from '../../../utils/storageKeys';
import { filterFileGroupNodes, filterFileGroupNodesByExtension } from '../../../utils/fileTreeFilter';
import type { WorkspaceFileGroup, WorkspaceFile } from '../../../domain/pairingTypes';
import type { PairingFileStateInfo } from '../../../domain/pairingFileState';
import type { SuggestFilterScope } from '../../../api/types';
import {
  type FileGroupNode,
  type GroupingMode,
  groupByDirectoryNode,
  groupByFilenameNode,
  groupByLanguageMarkerNode,
  groupFlatNode,
  isAbsolutePath,
  smartGroupNode,
} from '../../../utils/genericFileGrouping';
import { FileGroupNodeRow } from '../../game/FileGroupNodeRow';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GROUPING_MODES: { value: GroupingMode; label: string }[] = [
  { value: 'folder', label: 'Folder' },
  { value: 'filename', label: 'File name' },
  { value: 'language_marker', label: 'Language marker' },
  { value: 'flat', label: 'Flat' },
  { value: 'smart', label: 'Smart' },
];

const VALID_GROUPING_MODES = new Set<string>(['smart', 'flat', 'folder', 'filename', 'language_marker']);
const LARGE_SCAN_THRESHOLD = 1000;

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PairingFileWorkspaceProps {
  projectId: string;
  rootPath: string;
  lastScannedAt: string | null;
  /** Backend file groups (from usePairingGroups). */
  groups: WorkspaceFileGroup[];
  groupsLoading: boolean;
  onRefreshGroups: () => void;
  /** Scan controls (wired by parent). */
  onScan: () => Promise<void>;
  scanning: boolean;
  scanResult: { total_files: number; new_files: number; updated_files: number } | null;
  /** File path → WorkspaceFile lookup (built by parent from groups tree). */
  filesByPath: Map<string, WorkspaceFile>;
  /** Pairing actions (wired by parent). */
  onSetAsSource: (filePath: string) => void;
  onSetAsTranslated: (filePath: string) => void;
  /** Per-file pairing state map (from buildPairingFileStateMap). */
  pairingFileState: Map<string, PairingFileStateInfo>;
  /** Currently selected pair ID (for active-pair highlight). */
  selectedPairId: string | null;
  /** File paths belonging to the active pair (for hidden-files hint). */
  activePairPaths: string[];
  /** Reveal target — when set, the file tree expands/scrolls/pulses to this file. */
  revealTarget?: RevealTarget;
  /**
   * Enables native HTML5 drag on file rows.
   * The handler should set the drag payload via setDragFilePayload.
   */
  onFileDragStart?: (filePath: string, event: React.DragEvent) => void;
  /** Called whenever the active filter scope changes (for Suggest Pairs scope). */
  onFilterScopeUpdate?: (scope: SuggestFilterScope) => void;
  /** Optional resize handle element, rendered at bottom of the FILES card. */
  resizeHandle?: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  try {
    const d = new Date(raw);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return raw;
  }
}

/** Recursively collect all file relative paths from a group tree. */
function collectAllPaths(groups: WorkspaceFileGroup[]): string[] {
  const paths: string[] = [];
  function walk(list: WorkspaceFileGroup[]) {
    for (const g of list) {
      for (const f of g.files) {
        paths.push(f.relativePath);
      }
      walk(g.children);
    }
  }
  walk(groups);
  return paths;
}

/** Collect all file paths from a filtered FileGroupNode[] tree. */
function collectAllPathsFromNodes(nodes: FileGroupNode[]): string[] {
  const paths: string[] = [];
  function walk(list: FileGroupNode[]) {
    for (const n of list) {
      paths.push(...n.files);
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return paths;
}

/* ------------------------------------------------------------------ */
/*  Reveal helpers                                                     */
/* ------------------------------------------------------------------ */

/** Find ancestor group IDs (root-first) for a given file path in a FileGroupNode tree.
 *
 * Recurses into children FIRST so that the deepest matching leaf-group is the
 * primary match.  Directory nodes that contain the file via their aggregated
 * `files` array are only added if a child match was found deeper in the tree.
 * This ensures all ancestor groups (including the leaf group that actually
 * renders FileRow components) are included.
 */
export function findAncestorGroupIdsForFile(nodes: FileGroupNode[], targetPath: string): string[] {
  const ancestors: string[] = [];
  function walk(list: FileGroupNode[]): boolean {
    for (const node of list) {
      // Recurse into children first — prefer the deepest match
      if (node.children && walk(node.children)) {
        ancestors.push(node.id);
        return true;
      }
      // Only match if this node directly contains the file AND is a leaf
      // (no children to recurse into), or if the children didn't match.
      if (node.files.includes(targetPath)) {
        ancestors.push(node.id);
        return true;
      }
    }
    return false;
  }
  walk(nodes);
  return ancestors.reverse(); // root first
}

/** Check whether a target file path is visible in a filtered FileGroupNode[] tree. */
export function isFileVisibleInFilteredTree(nodes: FileGroupNode[], targetPath: string): boolean {
  for (const node of nodes) {
    if (node.files.includes(targetPath)) return true;
    if (node.children && isFileVisibleInFilteredTree(node.children, targetPath)) return true;
  }
  return false;
}

/** Reveal target descriptor — passed from ProjectWorkspace to PairingFileWorkspace. */
export interface RevealTarget {
  filePath: string;
  nonce: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PairingFileWorkspace({
  projectId,
  rootPath,
  lastScannedAt,
  groups,
  groupsLoading,
  onRefreshGroups,
  onScan,
  scanning,
  scanResult,
  filesByPath,
  onSetAsSource,
  onSetAsTranslated,
  pairingFileState,
  selectedPairId,
  activePairPaths,
  revealTarget,
  onFileDragStart,
  onFilterScopeUpdate,
  resizeHandle,
}: PairingFileWorkspaceProps) {
  const toast = useToast();

  /* ================================================================ */
  /*  Persisted state (localStorage, project-scoped)                   */
  /* ================================================================ */

  const [groupingMode, setGroupingMode] = usePersistentState<GroupingMode>(
    `${STORAGE_KEYS.pairingGroupingMode}.${projectId}`,
    'smart' as GroupingMode,
  );

  const [expandedGroupList, setExpandedGroupList] = usePersistentState<string[]>(
    `${STORAGE_KEYS.pairingExpandedGroups}.${projectId}`,
    [],
  );
  const expandedGroups = useMemo(() => new Set(expandedGroupList), [expandedGroupList]);

  /* ---- Include/Exclude filters (persisted, project-scoped) ---- */

  const [includeFilter, setIncludeFilter] = usePersistentState<string>(
    `${STORAGE_KEYS.pairingIncludeFilter}.${projectId}`,
    '',
  );

  const [excludeFilter, setExcludeFilter] = usePersistentState<string>(
    `${STORAGE_KEYS.pairingExcludeFilter}.${projectId}`,
    '',
  );

  /* ---- Extension filter (persisted, project-scoped) ---- */

  const [extensionFilter, setExtensionFilter] = usePersistentState<string[]>(
    `${STORAGE_KEYS.pairingExtensionFilter}.${projectId}`,
    [],
  );

  const hasActiveFilters = includeFilter.trim().length > 0
    || excludeFilter.trim().length > 0
    || extensionFilter.length > 0;
  const clearFilters = useCallback(() => {
    setIncludeFilter('');
    setExcludeFilter('');
    setExtensionFilter([]);
  }, [setIncludeFilter, setExcludeFilter, setExtensionFilter]);

  /* ================================================================ */
  /*  Derived — flat file paths + client-side grouping                 */
  /* ================================================================ */

  /** All scanned file paths (extracted from backend groups tree). */
  const scannedFiles = useMemo(() => collectAllPaths(groups), [groups]);

  /** Unique available extensions from scanned files (sorted, lowercased). */
  const availableExtensions = useMemo<string[]>(() => {
    const exts = new Set<string>();
    for (const path of scannedFiles) {
      const file = filesByPath.get(path);
      if (file) {
        const ext = file.extension.toLowerCase();
        if (ext) exts.add(ext);
      }
    }
    return Array.from(exts).sort();
  }, [scannedFiles, filesByPath]);

  /* ---- Extension badges collapse/expand (local state) ---- */

  const [extensionsExpanded, setExtensionsExpanded] = useState(false);

  /** How many extension badges fit in one row (rough estimate). */
  const EXTENSIONS_PER_ROW = 8;

  const { visibleExtensions, hiddenExtCount } = useMemo<{ visibleExtensions: string[]; hiddenExtCount: number }>(() => {
    if (extensionsExpanded || availableExtensions.length <= EXTENSIONS_PER_ROW) {
      return { visibleExtensions: availableExtensions, hiddenExtCount: 0 };
    }
    // Show first (PER_ROW - 1) + any selected extensions not in that batch
    const firstBatch = availableExtensions.slice(0, EXTENSIONS_PER_ROW - 1);
    const firstSet = new Set(firstBatch);
    const selectedExtras = extensionFilter.filter(e => !firstSet.has(e));
    const visible = [...firstBatch];
    for (const ext of selectedExtras) {
      if (!visible.includes(ext)) visible.push(ext);
    }
    return {
      visibleExtensions: visible,
      hiddenExtCount: availableExtensions.length - visible.length,
    };
  }, [availableExtensions, extensionFilter, extensionsExpanded]);

  /** Grouped FileGroupNode[] computed client-side via genericFileGrouping.ts. */
  const fileGroupNodes = useMemo<FileGroupNode[]>(() => {
    if (scannedFiles.length === 0) return [];
    const root = rootPath.trim().replace(/\/+$/, '');
    switch (groupingMode) {
      case 'flat':
        return groupFlatNode(scannedFiles, root);
      case 'folder':
        return groupByDirectoryNode(scannedFiles, root);
      case 'filename':
        return groupByFilenameNode(scannedFiles, root);
      case 'language_marker':
        return groupByLanguageMarkerNode(scannedFiles, root);
      case 'smart':
      default:
        return smartGroupNode(scannedFiles, root);
    }
  }, [scannedFiles, groupingMode, rootPath]);

  /** Get extension for a file path (for extension filter). */
  const getExtension = useCallback((filePath: string): string => {
    const file = filesByPath.get(filePath);
    return file ? file.extension : '';
  }, [filesByPath]);

  /** Filtered tree — include/exclude + extension filters applied. */
  const filteredGroupNodes = useMemo<FileGroupNode[]>(() => {
    let nodes = filterFileGroupNodes(fileGroupNodes, includeFilter, excludeFilter);
    if (extensionFilter.length > 0) {
      nodes = filterFileGroupNodesByExtension(
        nodes,
        new Set(extensionFilter.map(e => e.toLowerCase())),
        getExtension,
      );
    }
    return nodes;
  }, [fileGroupNodes, includeFilter, excludeFilter, extensionFilter, getExtension]);

  /** All visible file paths in the filtered tree (for select-all). */
  const visiblePaths = useMemo(() => collectAllPathsFromNodes(filteredGroupNodes), [filteredGroupNodes]);

  /** Notify parent of current filter scope whenever filters change (for Suggest Pairs). */
  useEffect(() => {
    onFilterScopeUpdate?.({
      include_filter: includeFilter || undefined,
      exclude_filter: excludeFilter || undefined,
      extensions: extensionFilter.length > 0 ? extensionFilter : undefined,
    });
  }, [includeFilter, excludeFilter, extensionFilter, onFilterScopeUpdate]);

  /** Check if any active pair files are hidden by current filters. */
  const hasHiddenActiveFiles = useMemo(() => {
    if (activePairPaths.length === 0) return false;
    return activePairPaths.some(p => !visiblePaths.includes(p));
  }, [activePairPaths, visiblePaths]);

  /* Validate stored grouping mode on mount — reset to default if invalid */
  useEffect(() => {
    if (!VALID_GROUPING_MODES.has(groupingMode)) {
      setGroupingMode('smart' as GroupingMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================================================================ */
  /*  Auto-expand lifecycle (matching GenericFileSection pattern)      */
  /*  MUST be declared BEFORE the reveal effect so auto-expand runs    */
  /*  first — React 18 batches set-state calls from effects, and the   */
  /*  reveal effect uses a functional updater that must build on the   */
  /*  auto-expanded list rather than being overridden by it.           */
  /* ================================================================ */

  const scanInitiatedRef = useRef(false);
  const prevGroupingRef = useRef(groupingMode);
  /** Tracks whether initial data has been loaded to handle first-mount expansion. */
  const initialDataLoadedRef = useRef(false);
  /** Captures whether the persisted expanded groups were empty at mount time. */
  const initialExpandedEmptyRef = useRef(expandedGroupList.length === 0);

  useEffect(() => {
    if (scannedFiles.length === 0) {
      setExpandedGroupList([]);
      return;
    }

    // --- Initial data load (first time files arrive) ---
    if (!initialDataLoadedRef.current) {
      initialDataLoadedRef.current = true;
      // Only auto-expand if no persisted state was restored.
      if (initialExpandedEmptyRef.current) {
        if (scannedFiles.length <= LARGE_SCAN_THRESHOLD) {
          setExpandedGroupList(fileGroupNodes.map(g => g.id));
        }
      }
      return;
    }

    // --- Subsequent updates: explicit scan or grouping mode change ---
    const groupingChanged = groupingMode !== prevGroupingRef.current;
    prevGroupingRef.current = groupingMode;

    if (scanInitiatedRef.current || groupingChanged) {
      scanInitiatedRef.current = false;
      if (scannedFiles.length > LARGE_SCAN_THRESHOLD) {
        setExpandedGroupList([]);
      } else {
        setExpandedGroupList(fileGroupNodes.map(g => g.id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedFiles, groupingMode, fileGroupNodes]);

  /* ================================================================ */
  /*  Reveal/highlight sync — Pair Slot Card click → file tree          */
  /*  MUST be declared AFTER auto-expand lifecycle so this effect's     */
  /*  functional setState updater builds on the auto-expanded groups.   */
  /* ================================================================ */

  /** Set of file paths that should carry data-reveal-path (scroll/pulse target). */
  const revealedFilePaths = useMemo(() => {
    if (!revealTarget) return new Set<string>();
    return new Set([revealTarget.filePath]);
  }, [revealTarget]);

  /** Tracks whether the most recent reveal was blocked by filters (for enhanced warning). */
  const [revealFilteredOut, setRevealFilteredOut] = useState<string | null>(null);

  /**
   * When revealTarget changes:
   *  1. If the file is visible in the filtered tree, expand ancestor groups,
   *     then after the next paint scroll it into view and apply a temporary pulse class.
   *  2. If the file exists but is hidden by filters, set revealFilteredOut for the UI hint.
   *  3. If the file does not exist in scanned files, no-op.
   */
  useEffect(() => {
    if (!revealTarget) {
      setRevealFilteredOut(null);
      return;
    }
    const { filePath } = revealTarget;

    // File does not exist in the scanned set — graceful no-op
    if (!scannedFiles.includes(filePath)) return;

    if (isFileVisibleInFilteredTree(filteredGroupNodes, filePath)) {
      setRevealFilteredOut(null);

      // Expand ancestor groups so the file row becomes visible in the DOM
      const ancestorIds = findAncestorGroupIdsForFile(fileGroupNodes, filePath);
      if (ancestorIds.length > 0) {
        setExpandedGroupList(prev => {
          const next = new Set(prev);
          for (const id of ancestorIds) next.add(id);
          return Array.from(next);
        });
      }

      // After state update, scroll the row into view and pulse
      const revealTimer = setTimeout(() => {
        try {
          const row = document.querySelector(`[data-reveal-path="${filePath}"]`);
          if (row instanceof HTMLElement) {
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            row.classList.add('pw-file-row--revealed');
            setTimeout(() => row.classList.remove('pw-file-row--revealed'), 2000);
          }
        } catch {
          // querySelector or classList may fail in test/jsdom environments — swallow
        }
      }, 0);
      return () => clearTimeout(revealTimer);
    }

    // File exists but is hidden by include/exclude filters
    setRevealFilteredOut(filePath);
  }, [revealTarget?.nonce, revealTarget?.filePath, scannedFiles, fileGroupNodes, filteredGroupNodes, setExpandedGroupList]);

  /* ================================================================ */
  /*  Event handlers                                                   */
  /* ================================================================ */

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroupList(prev => {
      if (prev.includes(groupId)) {
        return prev.filter(id => id !== groupId);
      }
      return [...prev, groupId];
    });
  }, [setExpandedGroupList]);

  const handleScanClick = useCallback(async () => {
    scanInitiatedRef.current = true;
    await onScan();
  }, [onScan]);

  /** Handle Set as source file action — delegates directly to parent which calls the API. */
  const handleSetAsSource = useCallback((filePath: string) => {
    onSetAsSource(filePath);
  }, [onSetAsSource]);

  /** Handle Set as translated file action — delegates directly to parent which calls the API. */
  const handleSetAsTranslated = useCallback((filePath: string) => {
    onSetAsTranslated(filePath);
  }, [onSetAsTranslated]);

  /** Handle Open folder in Finder.
   *
   *  Defensive: ensure we always pass an absolute filesystem path.
   *  filePath from WorkspaceFile.relativePath is relative to project root
   *  and must be resolved before reaching revealPath.
   *  Follows the same pattern as GenericFileSection.handleOpenFolder.
   */
  const handleOpenFolder = useCallback(async (filePath: string) => {
    const resolved = isAbsolutePath(filePath)
      ? filePath
      : rootPath.trim().replace(/\/+$/, '') + '/' + filePath;
    try {
      const { api: appApi, ApiError: AppApiError } = await import('../../../App');
      const res = await appApi.revealPath({ path: resolved });
      if (!res.success) toast.showToast(res.message, 'error');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to open folder';
      toast.showToast(message, 'error');
    }
  }, [toast, rootPath]);

  /** Custom file actions renderer for FileRow — includes pairing state badge + direct Set source/translated with visual state. */
  const renderFileActions = useCallback((filePath: string): React.ReactNode => {
    const file = filesByPath.get(filePath);
    if (!file) return null;

    // Pairing state badge
    const info = pairingFileState.get(filePath);
    const stateBadge = info ? (
      <span
        className={`pw-file-badge pw-file-badge--${info.state}${info.pairId === selectedPairId ? ' pw-file-badge--active' : ''}`}
        title={
          info.state === 'paired' ? 'Paired' :
          info.state === 'source_only' ? 'Source file (no translated)' :
          'Translated file (no source)'
        }
        aria-label={
          info.state === 'paired' ? 'Paired' :
          info.state === 'source_only' ? 'Source only' :
          'Translated only'
        }
      >
        {info.state === 'paired' ? 'P' : info.state === 'source_only' ? 'S' : 'T'}
      </span>
    ) : null;

    // Determine button visual state based on file pairing role
    const isSourceFile = info?.role === 'source';
    const isTranslatedFile = info?.role === 'translated';

    return (
      <>
        {stateBadge}
        <button
          className={`btn btn-sm${isSourceFile ? ' btn-added' : ''}`}
          style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', flexShrink: 0 }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            handleSetAsSource(filePath);
          }}
          type="button"
          title={isSourceFile ? 'Remove from source slot' : 'Set as source file'}
        >
          {isSourceFile ? 'Source' : 'Set source'}
        </button>
        <button
          className={`btn btn-sm${isTranslatedFile ? ' btn-added' : ''}`}
          style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', flexShrink: 0 }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            handleSetAsTranslated(filePath);
          }}
          type="button"
          title={isTranslatedFile ? 'Remove from translated slot' : 'Set as translated file'}
        >
          {isTranslatedFile ? 'Translated' : 'Set translated'}
        </button>
      </>
    );
  }, [filesByPath, handleSetAsSource, handleSetAsTranslated, pairingFileState, selectedPairId]);

  /** Custom CSS class per-file row for active pair highlighting. */
  const fileRowClass = useCallback((filePath: string): string | undefined => {
    const info = pairingFileState.get(filePath);
    if (info && info.pairId === selectedPairId) {
      return 'pw-file-row--active-pair';
    }
    return undefined;
  }, [pairingFileState, selectedPairId]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Block: Scan & Info */}
      <div className="card">
        <div className="card-title">Scan &amp; Files</div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleScanClick}
            disabled={scanning}
            type="button"
          >
            {scanning ? 'Scanning...' : 'Scan / Rescan'}
          </button>

          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            <strong>Last scanned:</strong> {formatDate(lastScannedAt)}
          </span>

          {scanResult && (
            <div className="alert alert-success" style={{ margin: 0, padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}>
              {scanResult.total_files} total, {scanResult.new_files} new, {scanResult.updated_files} updated
            </div>
          )}
        </div>
      </div>

      {/* Block: Grouping mode */}
      {scannedFiles.length > 0 && (
        <div className="card">
          <div className="card-title">Grouping Mode</div>
          <div className="form-group">
            <select
              className="form-control"
              value={groupingMode}
              onChange={e => setGroupingMode(e.target.value as GroupingMode)}
              style={{ width: 'auto', minWidth: '200px', fontSize: '0.8rem' }}
            >
              {GROUPING_MODES.map(mode => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Block: File tree */}
      <div className="card pw-files-card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span>
            Files{hasActiveFilters
              ? ` (${visiblePaths.length} of ${scannedFiles.length})`
              : ` (${scannedFiles.length})`}
          </span>
          {scannedFiles.length > 0 && <span />}
        </div>

        {/* Filter inputs */}
        {scannedFiles.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap', flexShrink: 0 }}>
            <input
              type="text"
              className="form-control"
              placeholder="Show only folders/files, e.g. events, localization"
              value={includeFilter}
              onChange={e => setIncludeFilter(e.target.value)}
              style={{ flex: 1, minWidth: '180px', fontSize: '0.8rem' }}
              aria-label="Include filter"
            />
            <input
              type="text"
              className="form-control"
              placeholder="Hide folders/files, e.g. cache, temp"
              value={excludeFilter}
              onChange={e => setExcludeFilter(e.target.value)}
              style={{ flex: 1, minWidth: '180px', fontSize: '0.8rem' }}
              aria-label="Exclude filter"
            />
            {hasActiveFilters && (
              <button
                className="btn btn-sm"
                onClick={clearFilters}
                type="button"
                style={{ flexShrink: 0 }}
                aria-label="Clear filters"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Extension filter badges — collapsible */}
        {scannedFiles.length > 0 && availableExtensions.length > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem', flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginRight: '0.15rem', flexShrink: 0 }}>
              Ext:
            </span>
            {(extensionsExpanded ? availableExtensions : visibleExtensions).map(ext => {
              const isSelected = extensionFilter.includes(ext);
              return (
                <span
                  key={ext}
                  className={`badge ${isSelected ? 'badge-info' : 'badge-muted'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setExtensionFilter(
                      isSelected
                        ? extensionFilter.filter(e => e !== ext)
                        : [...extensionFilter, ext],
                    );
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExtensionFilter(
                        isSelected
                          ? extensionFilter.filter(e => e !== ext)
                          : [...extensionFilter, ext],
                      );
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    textTransform: 'none',
                    fontSize: '0.65rem',
                    userSelect: 'none',
                  }}
                >
                  {ext}
                </span>
              );
            })}
            {/* Expand/collapse controls */}
            {!extensionsExpanded && hiddenExtCount > 0 && (
              <span
                className="badge badge-muted"
                role="button"
                tabIndex={0}
                onClick={() => setExtensionsExpanded(true)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExtensionsExpanded(true); } }}
                style={{ cursor: 'pointer', textTransform: 'none', fontSize: '0.65rem', userSelect: 'none' }}
              >
                +{hiddenExtCount}
              </span>
            )}
            {extensionsExpanded && (
              <span
                className="badge badge-muted"
                role="button"
                tabIndex={0}
                onClick={() => setExtensionsExpanded(false)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExtensionsExpanded(false); } }}
                style={{ cursor: 'pointer', textTransform: 'none', fontSize: '0.65rem', userSelect: 'none' }}
              >
                Show less
              </span>
            )}
          </div>
        )}

        {groupsLoading && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0.5rem 0' }}>
            Loading files...
          </div>
        )}

        {!groupsLoading && scannedFiles.length === 0 && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0.5rem 0' }}>
            No files found. Click Scan / Rescan to discover files.
          </div>
        )}

        {!groupsLoading && scannedFiles.length > 0 && filteredGroupNodes.length === 0 && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', padding: '0.5rem 0' }}>
            No files match the current filters.
          </div>
        )}

        {!groupsLoading && scannedFiles.length > 0 && filteredGroupNodes.length > 0 && (
          <div className="pw-tree-viewport pw-tree-scroll" style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
            <div className="loc-groups-container" style={{ minWidth: 'max-content' }}>
              {filteredGroupNodes.map(node => (
                <FileGroupNodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  selectable={false}
                  expandedGroups={expandedGroups}
                  rootDir={rootPath.trim().replace(/\/+$/, '')}
                  onToggleGroup={toggleGroup}
                  onOpenFolder={handleOpenFolder}
                  customFileActions={renderFileActions}
                  customFileRowClass={fileRowClass}
                  revealedFilePaths={revealedFilePaths}
                  onFileDragStart={onFileDragStart}
                  displayMode="basename"
                  flattenSingletons={groupingMode !== 'smart'}
                />
              ))}
            </div>
          </div>
        )}

        {/* Hidden active pair files hint */}
        {(hasHiddenActiveFiles || revealFilteredOut) && (
          <div
            className="alert alert-warning"
            style={{ marginTop: '0.5rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          >
            Some files from the active pair are hidden by filters.
            {revealFilteredOut && <span style={{ display: 'block' }}>Clear filters to reveal this file.</span>}
          </div>
        )}
        {resizeHandle}
      </div>

    </div>
  );
}
