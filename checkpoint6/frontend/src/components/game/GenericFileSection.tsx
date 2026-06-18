import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, useToast } from '../../App';
import { mapSettingsResponse } from '../../domain/settings';
import { PathPicker } from '..';
import type { GameModel, FileHandlerModel } from '../../domain';
import { useDraftJobSelectionApi } from '../../hooks/useDraftJobSelectionApi';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useTranslateDiscoveryFiles } from '../../hooks/useTranslateDiscoveryFiles';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import {
  type FileGroupNode,
  type GroupingMode,
  getRelativePath,
  groupByDirectoryNode,
  groupByFilenameNode,
  groupByLanguageMarkerNode,
  groupFlatNode,
  isAbsolutePath,
  normalizePath,
  smartGroupNode,
} from '../../utils/genericFileGrouping';
import { DuplicateJobConfirmDialog } from '../jobs/DuplicateJobConfirmDialog';
import { FileGroupNodeRow } from './FileGroupNodeRow';

/* ------------------------------------------------------------------ */
/*  Fallback (used when API is unreachable)                            */
/* ------------------------------------------------------------------ */
const FALLBACK_EXTENSIONS: Record<string, string[]> = {
  plain_text: ['.txt'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
};

/** Threshold above which groups are collapsed by default on scan. */
const LARGE_SCAN_THRESHOLD = 1000;

interface GenericFileSectionProps {
  game: GameModel;
  handlerOptions: FileHandlerModel[];
  // Lifted scan state (lives in GamePage to survive tab switches)
  scannedFiles: string[];
  setScannedFiles: React.Dispatch<React.SetStateAction<string[]>>;
  scanning: boolean;
  setScanning: React.Dispatch<React.SetStateAction<boolean>>;
  scanError: string | null;
  setScanError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function GenericFileSection({
  game,
  handlerOptions,
  scannedFiles,
  setScannedFiles,
  scanning,
  setScanning,
  scanError,
  setScanError,
}: GenericFileSectionProps) {
  const toast = useToast();
  const navigate = useNavigate();

  // --- Persistent: Paths ---
  const [rootDir, setRootDir] = usePersistentState(
    STORAGE_KEYS.discoveryRootDir + '.' + game.id,
    '',
  );
  const [outputDir, setOutputDir] = usePersistentState(
    STORAGE_KEYS.discoveryOutputDir + '.' + game.id,
    '',
  );

  // --- Handler ---
  const defaultHandler = handlerOptions.length > 0 ? handlerOptions[0].id : 'plain_text';
  const [handler, setHandler] = usePersistentState(
    STORAGE_KEYS.discoveryHandler + '.' + game.id,
    defaultHandler,
  );

  // --- Load defaults from game_settings.generic (only when no persisted value) ---
  useEffect(() => {
    api.getSettings()
      .then(res => {
        const model = mapSettingsResponse(res.settings);
        const generic = model.game_settings?.generic;
        if (generic?.root_dir && !rootDir) setRootDir(generic.root_dir);
        if (generic?.output_dir && !outputDir) setOutputDir(generic.output_dir);
        if (generic?.default_file_handler && handler === defaultHandler) setHandler(generic.default_file_handler);
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Recursive toggle ---
  const [recursiveScan, setRecursiveScan] = useState(true);

  // --- Expanded groups (persisted as string[], used as Set<string>) ---
  const [expandedGroupList, setExpandedGroupList] = usePersistentState<string[]>(
    STORAGE_KEYS.discoveryExpandedGroups + '.' + game.id,
    [],
  );
  const expandedGroups = useMemo(() => new Set(expandedGroupList), [expandedGroupList]);

  // --- Grouping mode ---
  const VALID_GROUPING_MODES = new Set(['smart', 'flat', 'folder', 'filename', 'language_marker']);
  const [groupingMode, setGroupingMode] = usePersistentState<GroupingMode>(
    STORAGE_KEYS.discoveryGroupingMode + '.' + game.id,
    'smart' as GroupingMode,
  );

  // Validate stored grouping mode on mount — reset to default if invalid
  useEffect(() => {
    if (!VALID_GROUPING_MODES.has(groupingMode)) {
      setGroupingMode('smart' as GroupingMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Unified translate flow ---
  const { translateAll, checkExistingJobs, duplicateInfo, setDuplicateInfo, clearDuplicateInfo } = useTranslateDiscoveryFiles();
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const pendingTranslateRef = useRef<string[]>([]);

  // Close duplicate dialog when files change (stale guard)
  useEffect(() => {
    if (showDuplicateConfirm) {
      setShowDuplicateConfirm(false);
      clearDuplicateInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedFiles, game.id]);

  // --- Draft job selection (shared with ModListSection via App root context) ---
  const draftApi = useDraftJobSelectionApi();
  const {
    draftFiles,
    addFile: draftAddFile,
    addFiles: draftAddFiles,
    removeFile: draftRemoveFile,
  } = draftApi;

  /** Precomputed set of normalised draft file paths for O(1) lookups. */
  const draftPathSet = useMemo(
    () => new Set(draftFiles.map(normalizePath)),
    [draftFiles],
  );

  /** Check if a file path is already in the draft (O(1) via Set). */
  function isFileInDraft(fp: string): boolean {
    return draftPathSet.has(normalizePath(fp));
  }

  /** Memoised grouped files — recomputed only when inputs change. */
  const groupedFiles = useMemo<FileGroupNode[]>(() => {
    const root = rootDir.trim().replace(/\/+$/, '');
    if (scannedFiles.length === 0) return [];
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
  }, [scannedFiles, groupingMode, rootDir]);

  // (translate flow now uses useTranslateDiscoveryFiles hook)

  /* ---- Resolve extensions for current handler ---- */
  function getExtensions(handlerId: string): string[] {
    const opt = handlerOptions.find(h => h.id === handlerId);
    return opt?.extensions ?? FALLBACK_EXTENSIONS[handlerId] ?? [];
  }

  /* ---- Scan files ---- */
  async function handleScan() {
    if (!rootDir.trim()) {
      toast.showToast('Root directory is required', 'error');
      return;
    }
    scanInitiatedRef.current = true;
    setScanning(true);
    setScanError(null);
    setScannedFiles([]);

    try {
      const extensions = getExtensions(handler);
      const allFiles = recursiveScan
        ? await collectFilesRecursive(rootDir.trim(), extensions)
        : await collectFilesFlat(rootDir.trim(), extensions);
      setScannedFiles(allFiles);
      // Expanded groups will be auto-computed by the effect below
      if (allFiles.length === 0) {
        toast.showToast('No matching files found', 'error');
      } else {
        toast.showToast(`Found ${allFiles.length} file(s)`);
      }
    } catch (err) {
      if (err instanceof ApiError) setScanError(err.message);
      else setScanError('Scan failed');
    } finally {
      setScanning(false);
    }
  }

  /** Recursively collect files matching extensions from a directory. */
  async function collectFilesRecursive(
    dirPath: string,
    extensions: string[],
  ): Promise<string[]> {
    const results: string[] = [];
    try {
      const res = await api.listDirectory({
        path: dirPath,
        mode: 'both',
        extensions,
        show_hidden: false,
      });
      const dirs: string[] = [];
      for (const item of res.items) {
        if (item.type === 'directory' && item.name !== '.' && item.name !== '..') {
          dirs.push(item.path);
        } else if (item.type === 'file') {
          const ext = '.' + item.name.split('.').pop()?.toLowerCase();
          if (extensions.some(e => e === ext || item.name.toLowerCase().endsWith(e))) {
            results.push(item.path);
          }
        }
      }
      for (const d of dirs) {
        const subFiles = await collectFilesRecursive(d, extensions);
        results.push(...subFiles);
      }
    } catch {
      // skip directories we can't read
    }
    return results;
  }

  /** Collect files from a single directory (non-recursive). */
  async function collectFilesFlat(
    dirPath: string,
    extensions: string[],
  ): Promise<string[]> {
    const results: string[] = [];
    try {
      const res = await api.listDirectory({
        path: dirPath,
        mode: 'both',
        extensions,
        show_hidden: false,
      });
      for (const item of res.items) {
        if (item.type === 'file') {
          const ext = '.' + item.name.split('.').pop()?.toLowerCase();
          if (extensions.some(e => e === ext || item.name.toLowerCase().endsWith(e))) {
            results.push(item.path);
          }
        }
      }
    } catch {
      // skip
    }
    return results;
  }

  /* ---- Auto-expand on fresh scan or grouping mode change ---- */
  /**
   * Tracks whether `handleScan` was explicitly invoked by the user.
   * Set to `true` at the start of handleScan (before any async work),
   * read and reset by the effect below.  This is more robust than
   * an `initialMountRef` because it survives StrictMode double-invoke
   * and does not fire on remount with persisted state.
   */
  const scanInitiatedRef = useRef(false);
  const prevGroupingRef = useRef(groupingMode);

  useEffect(() => {
    if (scannedFiles.length === 0) {
      setExpandedGroupList([]);
      return;
    }

    const groupingChanged = groupingMode !== prevGroupingRef.current;
    prevGroupingRef.current = groupingMode;

    // Auto-expand only on explicit fresh scan or grouping mode change.
    // On remount with restored files neither flag is set → persisted
    // expanded groups are preserved as-is.
    if (scanInitiatedRef.current || groupingChanged) {
      scanInitiatedRef.current = false;
      if (scannedFiles.length > LARGE_SCAN_THRESHOLD) {
        setExpandedGroupList([]);
      } else {
        setExpandedGroupList(groupedFiles.map(g => g.id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedFiles, groupingMode, groupedFiles]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroupList(prev => {
      if (prev.includes(groupId)) {
        return prev.filter(id => id !== groupId);
      }
      return [...prev, groupId];
    });
  }, [setExpandedGroupList]);

  /* ---- Add to job (uses shared DraftJobSelectionContext) ---- */
  function handleAddToJob(filePaths: string[]) {
    if (filePaths.length === 0) {
      toast.showToast('No files selected', 'error');
      return;
    }
    const newPaths = filePaths.filter(f => !isFileInDraft(f));
    if (newPaths.length === 0) {
      toast.showToast('All files already added to job draft', 'info');
      return;
    }
    draftAddFiles(newPaths, { modId: game.id, modName: game.label });
    toast.showToast(`${newPaths.length} file(s) added to job draft`, 'info');
  }

  function handleAddAllToJob() {
    handleAddToJob(scannedFiles);
  }

  /* ---- Draft toggle for FileGroupNodeRow ---- */

  /** Toggle a single file's draft status (add if absent, remove if present). */
  function handleToggleDraftFile(fp: string) {
    if (isFileInDraft(fp)) {
      draftRemoveFile(fp);
    } else {
      draftAddFile(fp, { modId: game.id, modName: game.label });
    }
  }

  /* ---- Unified translate flow ---- */

  /** Translate all scanned files through the unified hook. */
  async function handleTranslateAll() {
    const files = scannedFiles;
    if (files.length === 0) {
      toast.showToast('No files to translate', 'error');
      return;
    }
    pendingTranslateRef.current = files;
    clearDuplicateInfo();

    // Check for duplicates first, without navigating
    const duplicates = await checkExistingJobs(files);
    if (duplicates.length > 0) {
      setDuplicateInfo({ duplicateJobs: duplicates, hasDuplicates: true });
      setShowDuplicateConfirm(true);
      return;
    }

    // No duplicates — proceed with draft + navigate
    await translateAll(
      { files, gameId: game.id, gameLabel: game.label },
      true,
    );
  }

  /** Translate a group through the unified hook. */
  async function handleGroupTranslate(groupFiles: string[]) {
    pendingTranslateRef.current = groupFiles;
    clearDuplicateInfo();

    const duplicates = await checkExistingJobs(groupFiles);
    if (duplicates.length > 0) {
      setDuplicateInfo({ duplicateJobs: duplicates, hasDuplicates: true });
      setShowDuplicateConfirm(true);
      return;
    }

    await translateAll(
      { files: groupFiles, gameId: game.id, gameLabel: game.label },
      true,
    );
  }

  /** Navigate to an existing job when user chooses to open it. */
  function handleOpenExistingJob(jobId: string) {
    setShowDuplicateConfirm(false);
    clearDuplicateInfo();
    navigate('/jobs', { state: { selectedJobId: jobId } });
  }

  /** Proceed with creating a new job despite duplicates. */
  function handleContinueNewJob() {
    setShowDuplicateConfirm(false);
    clearDuplicateInfo();
    draftAddFiles(pendingTranslateRef.current, { modId: game.id, modName: game.label });
    navigate('/jobs');
  }

  /* ---- Open in Finder ---- */
  async function handleOpenFolder(filePath: string) {
    // Defensive: ensure we always pass an absolute filesystem path.
    // Grouping display paths (node.id / node.relativePath) are never
    // real filesystem paths and must never reach revealPath.
    const resolved = isAbsolutePath(filePath)
      ? filePath
      : rootDir.trim().replace(/\/+$/, '') + '/' + filePath;
    try {
      const res = await api.revealPath({ path: resolved });
      if (!res.success) toast.showToast(res.message, 'error');
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to open folder', 'error');
    }
  }

  /* ---- Build label for handler option ---- */
  function handlerLabel(opt: FileHandlerModel): string {
    const count = opt.extensions.length;
    return count > 0 ? `${opt.label} (${count})` : opt.label;
  }

  /* ---- Render ---- */
  return (
    <div>
      {/* Block 1: Paths */}
      <div className="card">
        <div className="card-title">Paths</div>
        <PathPicker
          value={rootDir}
          onChange={setRootDir}
          mode="directory"
          label="Root directory (where files are located)"
          placeholder="Pick the root directory"
        />
        <div style={{ height: '0.75rem' }} />
        <PathPicker
          value={outputDir}
          onChange={setOutputDir}
          mode="directory"
          label="Output directory (optional)"
          placeholder="Pick output directory or leave empty"
        />
      </div>

      {/* Block 2: File Handler */}
      <div className="card">
        <div className="card-title">File Handler</div>
        <div className="form-group">
          <label>File format</label>
          <select
            className="form-control"
            value={handler}
            onChange={e => {
              setHandler(e.target.value);
              setScannedFiles([]);
            }}
          >
            {handlerOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{handlerLabel(opt)}</option>
            ))}
          </select>
          {/* Extension badges for the selected handler */}
          {getExtensions(handler).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.35rem' }}>
              {getExtensions(handler).map(ext => (
                <span key={ext} className="badge badge-muted" style={{ textTransform: 'none', fontSize: '0.65rem' }}>{ext}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Block 3: Scan */}
      <div className="card">
        <div className="card-title">Find Files</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
          <input
            type="checkbox"
            className="form-checkbox"
            checked={recursiveScan}
            onChange={e => setRecursiveScan(e.target.checked)}
          />
          Search recursively in subdirectories
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Scan files'}
          </button>
        </div>
        {scanError && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{scanError}</div>}
      </div>

      {/* Block 3.5: Grouping mode (only shown when files exist) */}
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
              <option value="smart">Smart (filename families)</option>
              <option value="flat">Flat (no grouping)</option>
              <option value="folder">Folder</option>
              <option value="filename">File name</option>
              <option value="language_marker">Language marker</option>
            </select>
          </div>
        </div>
      )}

      {/* Block 4: Files list */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Files ({scannedFiles.length})</span>
          {scannedFiles.length > 0 && (
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button className="btn btn-sm" onClick={handleAddAllToJob} type="button">
                Add all
              </button>
              <button className="btn btn-sm btn-primary" onClick={handleTranslateAll} type="button">
                Translate all
              </button>
            </div>
          )}
        </div>

        {scannedFiles.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
            {scanning ? 'Scanning...' : 'No files scanned yet. Set a root directory and click Scan files.'}
          </div>
        ) : (
          <div className="loc-groups-container">
            {groupedFiles.map(node => (
              <FileGroupNodeRow
                key={node.id}
                node={node}
                depth={0}
                expandedGroups={expandedGroups}
                rootDir={rootDir.trim().replace(/\/+$/, '')}
                onToggleGroup={toggleGroup}
                onAddGroupToJob={(n) => handleAddToJob(n.files)}
                onTranslateGroup={(n) => handleGroupTranslate(n.files)}
                isFileInDraft={isFileInDraft}
                selectable={false}
                onToggleDraftFile={handleToggleDraftFile}
                onOpenFolder={handleOpenFolder}
                draftPathSet={draftPathSet}
                flattenSingletons={groupingMode !== 'smart'}
              />
            ))}
          </div>
        )}
      </div>

      {/* Duplicate job confirmation dialog */}
      {showDuplicateConfirm && duplicateInfo.hasDuplicates && (
        <DuplicateJobConfirmDialog
          existingJobs={duplicateInfo.duplicateJobs}
          onOpenExisting={handleOpenExistingJob}
          onContinueNew={handleContinueNewJob}
          onCancel={() => setShowDuplicateConfirm(false)}
        />
      )}

      {/* Floating bar: Go to job when draft files exist */}
      {draftFiles.length > 0 && (
        <div className="floating-job-bar">
          <span className="floating-job-bar-label">
            {draftFiles.length} file(s) selected
          </span>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/jobs')}
          >
            Go to job ({draftFiles.length})
          </button>
        </div>
      )}
    </div>
  );
}
