import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, useToast } from '../../App';
import { mapSettingsResponse } from '../../domain/settings';
import { PathPicker } from '..';
import type { GameModel, FileHandlerModel } from '../../domain';
import { savePendingTranslation } from '../../utils/pendingTranslation';

/* ------------------------------------------------------------------ */
/*  Fallback (used when API is unreachable)                            */
/* ------------------------------------------------------------------ */
const FALLBACK_EXTENSIONS: Record<string, string[]> = {
  plain_text: ['.txt'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
};

interface GenericFileSectionProps {
  game: GameModel;
  handlerOptions: FileHandlerModel[];
}

export function GenericFileSection({ game, handlerOptions }: GenericFileSectionProps) {
  const toast = useToast();
  const navigate = useNavigate();

  // --- Paths ---
  const [rootDir, setRootDir] = useState('');
  const [outputDir, setOutputDir] = useState('');

  // --- Handler ---
  const defaultHandler = handlerOptions.length > 0 ? handlerOptions[0].id : 'plain_text';
  const [handler, setHandler] = useState(defaultHandler);

  // --- Load defaults from game_settings.generic ---
  useEffect(() => {
    api.getSettings()
      .then(res => {
        const model = mapSettingsResponse(res.settings);
        const generic = model.game_settings?.generic;
        if (generic?.root_dir && !rootDir) setRootDir(generic.root_dir);
        if (generic?.output_dir && !outputDir) setOutputDir(generic.output_dir);
        if (generic?.default_file_handler) setHandler(generic.default_file_handler);
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- File scan ---
  const [scannedFiles, setScannedFiles] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // --- Recursive toggle ---
  const [recursiveScan, setRecursiveScan] = useState(true);

  // --- Expanded groups ---
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // --- Selected files (for bulk actions) ---
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // --- Translate modal ---
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [translateSrcLang, setTranslateSrcLang] = useState('english');
  const [translateDstLang, setTranslateDstLang] = useState('russian');
  const [translating, setTranslating] = useState(false);

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
    setScanning(true);
    setScanError(null);
    setScannedFiles([]);
    setSelectedFiles(new Set());

    try {
      const extensions = getExtensions(handler);
      const allFiles = recursiveScan
        ? await collectFilesRecursive(rootDir.trim(), extensions)
        : await collectFilesFlat(rootDir.trim(), extensions);
      setScannedFiles(allFiles);
      // Expand all groups by default
      const root = rootDir.trim().replace(/\/+$/, '');
      const groupDirs = new Set<string>();
      for (const fp of allFiles) {
        const rel = fp.startsWith(root + '/') ? fp.slice(root.length + 1) : fp;
        const parts = rel.split('/');
        if (parts.length > 1) groupDirs.add(parts.slice(0, -1).join('/'));
      }
      setExpandedGroups(groupDirs);
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

  /* ---- Relative path helpers ---- */

  /** Strip root directory prefix from an absolute file path. */
  function getRelativePath(filePath: string): string {
    const root = rootDir.trim().replace(/\/+$/, '');
    if (filePath.startsWith(root + '/')) {
      return filePath.slice(root.length + 1);
    }
    return filePath;
  }

  /** Group scanned files by their relative directory. */
  function groupFilesByDir(files: string[]): { dir: string; files: string[] }[] {
    const groups = new Map<string, string[]>();
    for (const fp of files) {
      const rel = getRelativePath(fp);
      const parts = rel.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(fp);
    }
    // Sort: root group first, then alphabetical
    const entries = Array.from(groups.entries());
    entries.sort(([a], [b]) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b);
    });
    return entries.map(([dir, fileList]) => ({ dir, files: fileList }));
  }

  function toggleGroup(groupDir: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupDir)) {
        next.delete(groupDir);
      } else {
        next.add(groupDir);
      }
      return next;
    });
  }

  /* ---- File selection ---- */
  function toggleFile(filePath: string) {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }

  function handleSelectAll() {
    if (selectedFiles.size === scannedFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(scannedFiles));
    }
  }

  /* ---- Add to job (store in localStorage, navigate to /jobs) ---- */
  function handleAddToJob(filePaths: string[]) {
    if (filePaths.length === 0) {
      toast.showToast('No files selected', 'error');
      return;
    }
    savePendingTranslation({
      files: filePaths,
      gameConfig: { game: game.id, file_handler: handler },
    });
    navigate('/jobs');
  }

  function handleAddAllToJob() {
    handleAddToJob(scannedFiles);
  }

  /* ---- Translate all ---- */
  function handleOpenTranslateModal() {
    const files = selectedFiles.size > 0
      ? Array.from(selectedFiles)
      : scannedFiles;
    if (files.length === 0) {
      toast.showToast('No files to translate', 'error');
      return;
    }
    setSelectedFiles(new Set(files));
    setShowTranslateModal(true);
  }

  async function handleConfirmTranslate() {
    const files = Array.from(selectedFiles);
    if (files.length === 0) return;

    setTranslating(true);
    try {
      const config: Record<string, unknown> = {
        src_lang: translateSrcLang,
        dst_lang: translateDstLang,
        game: game.id,
        file_handler: handler,
        output: {
          output_dir: outputDir,
          preserve_relative_path: true,
          filename_suffix: '_translated',
          overwrite: false,
          backup: true,
        },
      };

      const newJob = await api.createJob({
        file_paths: files,
        name: `${game.label} Translation`,
        config,
      });

      await api.startJob(newJob.id);
      toast.showToast(`Job created and started: ${newJob.id.slice(0, 8)}`);
      setShowTranslateModal(false);
      navigate('/jobs', { state: { selectedJobId: newJob.id } });
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to create job', 'error');
    } finally {
      setTranslating(false);
    }
  }

  /* ---- Open in Finder ---- */
  async function handleOpenFolder(filePath: string) {
    try {
      const res = await api.revealPath({ path: filePath });
      if (!res.success) toast.showToast(res.message, 'error');
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to open folder', 'error');
    }
  }

  /* ---- Build label for handler option ---- */
  function handlerLabel(opt: FileHandlerModel): string {
    const extStr = opt.extensions.join(', ');
    return `${opt.label} (${extStr})`;
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
              setSelectedFiles(new Set());
            }}
          >
            {handlerOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{handlerLabel(opt)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Block 3: Scan */}
      <div className="card">
        <div className="card-title">Find Files</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
          <input
            type="checkbox"
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

      {/* Block 4: Files list */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Files ({scannedFiles.length})</span>
          {scannedFiles.length > 0 && (
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button className="btn btn-sm" onClick={handleSelectAll} type="button">
                {selectedFiles.size === scannedFiles.length ? 'Deselect all' : 'Select all'}
              </button>
              <button className="btn btn-sm" onClick={handleAddAllToJob} type="button">
                Add all
              </button>
              <button className="btn btn-sm btn-primary" onClick={handleOpenTranslateModal} type="button">
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
          <div>
            {groupFilesByDir(scannedFiles).map(group => {
              const isExpanded = expandedGroups.has(group.dir);
              const groupLabel = group.dir || '(root)';
              return (
                <div key={group.dir} className="loc-group-item" style={{ marginBottom: '0.35rem' }}>
                  <div
                    className="loc-group-header"
                    onClick={() => toggleGroup(group.dir)}
                  >
                    <span className={`loc-group-arrow${isExpanded ? ' open' : ''}`}>&#9654;</span>
                    <span className="loc-group-label">{groupLabel}</span>
                    <span className="badge badge-muted" style={{ marginLeft: 'auto' }}>
                      {group.files.length} file{group.files.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="loc-group-body" style={{ padding: '0.3rem 0.5rem 0.4rem' }}>
                      {group.files.map(fp => (
                        <div
                          key={fp}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.3rem 0',
                            borderBottom: '1px solid var(--color-border)',
                            fontSize: '0.8rem',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(fp)}
                            onChange={() => toggleFile(fp)}
                          />
                          <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getRelativePath(fp)}
                          </span>
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', flexShrink: 0 }}
                            onClick={() => handleAddToJob([fp])}
                            type="button"
                          >
                            Add to job
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', flexShrink: 0 }}
                            onClick={() => handleOpenFolder(fp)}
                            type="button"
                          >
                            Open folder
                          </button>
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

      {/* Translate Modal */}
      {showTranslateModal && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowTranslateModal(false); }}>
          <div className="modal-content" style={{ maxWidth: 480 }} onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Translate {selectedFiles.size} file(s)</span>
              <button className="btn btn-sm" onClick={() => setShowTranslateModal(false)} type="button">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Source Language</label>
                <input
                  className="form-control"
                  value={translateSrcLang}
                  onChange={e => setTranslateSrcLang(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Target Language</label>
                <input
                  className="form-control"
                  value={translateDstLang}
                  onChange={e => setTranslateDstLang(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>File handler</label>
                <select className="form-control" value={handler} onChange={e => setHandler(e.target.value)}>
                  {handlerOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{handlerLabel(opt)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Game mode: <strong>{game.id}</strong>, Handler: <strong>{handler}</strong>
              </div>
              <div style={{
                marginTop: '0.5rem',
                padding: '0.5rem',
                background: 'var(--color-surface-2)',
                borderRadius: 'var(--radius)',
                fontSize: '0.7rem',
                color: 'var(--color-text-muted)',
              }}>
                <div><strong>Output settings</strong></div>
                <div>Output directory: {outputDir || '(same as source)'}</div>
                <div>Preserve relative paths: yes</div>
                <div>Filename suffix: _translated</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleConfirmTranslate} disabled={translating}>
                {translating ? 'Creating...' : 'Create & Start Job'}
              </button>
              <button className="btn" onClick={() => setShowTranslateModal(false)} type="button">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
