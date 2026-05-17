import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';
import { api, ApiError, useToast } from '../App';
import type { EditorFileResponse, EditorRowSchema } from '../api/types';
import { PathPicker } from '../components';
import { ConfirmDialog } from '../components/common/ConfirmDialog';

export default function Editor() {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const [fileId, setFileId] = useState('');
  const [editorData, setEditorData] = useState<EditorFileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLoaded, setAutoLoaded] = useState(false);

  // Auto-load from query param ?filePath=
  useEffect(() => {
    if (autoLoaded) return;
    const filePath = searchParams.get('filePath');
    if (filePath) {
      setFileId(filePath);
      setAutoLoaded(true);
      loadFileByPath(filePath);
    }
  }, [searchParams, autoLoaded]);

  async function loadFileByPath(path: string) {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setEditorData(null);
    try {
      const data = await api.getEditorFile(path.trim());
      setEditorData(data);
      // Reset dirty state on fresh load
      setIsDirty(false);
      setEditingDirty(false);
      savedContentRef.current = buildSavedContentMap(data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load editor data');
    } finally {
      setLoading(false);
    }
  }
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [outputPath, setOutputPath] = useState('');

  // ── Dirty state ──────────────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    action: 'navigate' | 'switch-file';
    callback: () => void;
    message: string;
  } | null>(null);

  // Snapshot of row content at last load/save for comparison
  const savedContentRef = useRef<Map<string, string>>(new Map());

  // Track whether the current in-progress edit differs from saved content
  const [editingDirty, setEditingDirty] = useState(false);

  // ── Navigation guard (compatible with BrowserRouter) ─────────
  const { confirmNavigation } = useUnsavedChangesWarning({ dirty: isDirty });

  // ── Helpers ──────────────────────────────────────────────────
  function buildSavedContentMap(data: EditorFileResponse): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of data.rows) {
      map.set(row.row_id, row.translated_text ?? '');
    }
    return map;
  }

  async function handleLoad() {
    // If dirty, confirm before switching to a new file
    if (isDirty) {
      setConfirmAction({
        action: 'switch-file',
        callback: async () => {
          setConfirmAction(null);
          await loadFileByPath(fileId);
        },
        message: 'You have unsaved edits. Load a new file and discard changes?',
      });
    } else {
      await loadFileByPath(fileId);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !loading) {
      handleLoad();
    }
  }

  async function handleEditStart(row: EditorRowSchema) {
    setEditingRow(row.row_id);
    setEditValue(row.translated_text ?? '');
  }

  async function handleEditSave(rowId: string) {
    if (!editorData) return;
    setSavingEntry(true);
    try {
      const res = await api.updateEditorEntry(editorData.file_id, rowId, { translated: editValue });
      if (res.success && res.row) {
        setEditorData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map(r => r.row_id === rowId ? res.row! : r),
          };
        });
        toast.showToast('Entry updated');
        // Mark dirty if the new content differs from saved snapshot
        const saved = savedContentRef.current.get(rowId) ?? '';
        if (editValue !== saved) {
          setIsDirty(true);
        }
      }
      setEditingRow(null);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to save entry', 'error');
    } finally {
      setSavingEntry(false);
    }
  }

  function handleEditCancel() {
    setEditingRow(null);
    setEditValue('');
  }

  async function handleSaveFile() {
    if (!editorData) return;
    setSavingFile(true);
    setSaveResult(null);
    try {
      const res = await api.saveEditorFile(editorData.file_id, {
        output_path: outputPath.trim() || undefined,
        overwrite: !!outputPath.trim(),
        backup: !outputPath.trim(),
      });
      setSaveResult({ success: res.success, message: res.message || `Saved to ${res.output_path}` });
      if (res.success) {
        toast.showToast('File saved');
        // Reset dirty state — file is now saved
        setIsDirty(false);
        savedContentRef.current = buildSavedContentMap(editorData);
      }
    } catch (err) {
      if (err instanceof ApiError) setSaveResult({ success: false, message: err.message });
      else setSaveResult({ success: false, message: 'Save failed' });
    } finally {
      setSavingFile(false);
    }
  }

  async function handleValidate() {
    if (!editorData) return;
    try {
      const res = await api.validateEditorFile(editorData.file_id);
      toast.showToast('Validation complete');
      setEditorData(prev => prev ? { ...prev } : prev); // trigger re-render
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Validation failed', 'error');
    }
  }

  function handleConfirmAction() {
    if (confirmAction) {
      confirmAction.callback();
    }
  }

  function handleCancelAction() {
    setConfirmAction(null);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Editor / Trace</h1>
        <p>View and edit translated content</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {isDirty && (
        <div className="alert alert-warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>You have unsaved changes.</span>
          <button className="btn btn-sm btn-primary" onClick={handleSaveFile} disabled={savingFile}>
            {savingFile ? 'Saving...' : 'Save now'}
          </button>
        </div>
      )}

      {/* File selector */}
      <div className="card">
        <div className="card-title">Open translated file / editor source</div>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="editor-file-input">File ID or path</label>
            <div className="form-row" style={{ gap: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <input
                  id="editor-file-input"
                  className="form-control"
                  placeholder="Enter file_id or path to open in editor"
                  value={fileId}
                  onChange={e => setFileId(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <PathPicker
                value={fileId}
                onChange={setFileId}
                mode="file"
                extensions={['.yml', '.yaml']}
              />
            </div>
            <div className="form-helper-text">
              Use a file_id from a translation job, or paste a localisation file path.
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleLoad} disabled={loading} style={{ alignSelf: 'flex-end' }}>
            {loading ? 'Loading...' : 'Open'}
          </button>
        </div>
      </div>

      {/* Editor table */}
      {editorData && (
        <>
          <div className="card">
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                Editor: {editorData.file_id.slice(0, 16)}
                {editorData.stats && (
                  <span style={{ fontWeight: 'normal', fontSize: '0.75rem', marginLeft: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {editorData.stats.total_rows} rows &middot;
                    {editorData.stats.translated_rows} translated &middot;
                    {editorData.stats.edited_rows} edited &middot;
                    {editorData.stats.warnings_count} warnings &middot;
                    {editorData.stats.errors_count} errors
                  </span>
                )}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-sm" onClick={handleValidate}>Validate</button>
                <button className="btn btn-sm btn-primary" onClick={handleSaveFile} disabled={savingFile}>
                  {savingFile ? 'Saving...' : 'Save File'}
                </button>
              </div>
            </div>

            {/* Save output path */}
            <div style={{ marginBottom: '0.75rem' }}>
              <PathPicker
                value={outputPath}
                onChange={setOutputPath}
                mode="file"
                extensions={['.yml', '.yaml']}
                label="Save output path (optional)"
                placeholder="Custom output path for saving"
              />
              <div className="form-helper-text">
                Leave empty to save with default naming (backup will be created).
              </div>
            </div>

            {saveResult && (
              <div className={`alert ${saveResult.success ? 'alert-success' : 'alert-error'}`}>
                {saveResult.message}
              </div>
            )}

            {editorData.rows.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No editable rows</div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Key</th>
                      <th>Source</th>
                      <th>Translation</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editorData.rows.map(row => (
                      <tr key={row.row_id}>
                        <td className="mono">{row.line_no}</td>
                        <td className="mono" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.key}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.source_text}</td>
                        <td style={{ maxWidth: 200 }}>
                          {editingRow === row.row_id ? (
                            <div style={{ display: 'flex', gap: '0.25rem', flexDirection: 'column' }}>
                              <textarea
                                className="form-control"
                                rows={2}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                autoFocus
                              />
                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <button className="btn btn-sm btn-primary" onClick={() => handleEditSave(row.row_id)} disabled={savingEntry}>
                                  Save
                                </button>
                                <button className="btn btn-sm" onClick={handleEditCancel}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <span>{row.translated_text || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>—</span>}</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${row.status === 'translated' ? 'badge-success' : row.status === 'edited' ? 'badge-info' : 'badge-muted'}`}>
                            {row.status}
                          </span>
                          {row.warnings.length > 0 && <span className="badge badge-warning" style={{ marginLeft: '0.2rem' }}>W</span>}
                          {row.errors.length > 0 && <span className="badge badge-error" style={{ marginLeft: '0.2rem' }}>E</span>}
                        </td>
                        <td>
                          {row.editable && editingRow !== row.row_id && (
                            <button className="btn btn-sm" onClick={() => handleEditStart(row)}>Edit</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Trace for this file */}
        </>
      )}

      {/* Dirty guard confirmation dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        title="Unsaved Changes"
        message={confirmAction?.message ?? ''}
        confirmLabel="Discard"
        confirmClass="btn btn-danger"
        cancelLabel="Cancel"
        onConfirm={handleConfirmAction}
        onCancel={handleCancelAction}
      />
    </div>
  );
}
