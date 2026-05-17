import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';
import { api, ApiError, useToast } from '../App';
import AutoResizeTextarea from '../components/common/AutoResizeTextarea';
import type { OutputFileEditorPayload, OutputEditorEntry, OutputEditorMetadata, OutputAnalysisResult, OutputAnalysisDiagnostic, FileContentsResponse } from '../api/types';

type SeverityFilter = 'all' | 'error' | 'warning' | 'info';

/* ── Helper: check if a row should be shown as non-editable ── */
function isNonEditable(entry: OutputEditorEntry): boolean {
  return !entry.translatable || entry.entry_type === 'raw_unknown';
}

/* ── Lightweight code viewer for file contents ──
     Single scroll container: each row has line-number + text in one line. */
function CodeViewerPanel({ title, content, path, exists, missingLabel }: {
  title: string;
  content: string;
  path: string;
  exists: boolean;
  missingLabel: string;
}) {
  const lines = useMemo(() => content.split('\n'), [content]);

  return (
    <div className="file-viewer-panel">
      <div className="file-viewer-header">
        <span className="file-viewer-title">{title}</span>
        <span className="file-viewer-path" title={path}>{path}</span>
      </div>
      {!exists ? (
        <div className="file-viewer-missing">{missingLabel}</div>
      ) : (
        <div className="code-scroll custom-scrollbar">
          {lines.map((line, i) => (
            <div key={i} className="code-row">
              <span className="code-line-no">{i + 1}</span>
              <span className="code-line-text">{line || '\u00A0'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OutputFileEditor() {
  const { outputFileId } = useParams<{ outputFileId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [payload, setPayload] = useState<OutputFileEditorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [translatedContent, setTranslatedContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  const [modified, setModified] = useState(false);

  // Analysis state
  const [analysisResult, setAnalysisResult] = useState<OutputAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Diagnostics UX state
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [showAffectedRows, setShowAffectedRows] = useState(false);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);

  // ── Collapsible sections state ──
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [fileViewerCollapsed, setFileViewerCollapsed] = useState(true);

  // ── File viewer state ──
  const [fileContents, setFileContents] = useState<FileContentsResponse | null>(null);
  const [fileContentsLoading, setFileContentsLoading] = useState(false);
  const [fileContentsError, setFileContentsError] = useState<string | null>(null);

  // ── Derived data ──────────────────────────────────────────────

  /** Map source_line -> severity for inline row highlighting. */
  const lineDiagnosticMap = useMemo(() => {
    const map = new Map<number, string>();
    if (!analysisResult) return map;
    for (const d of analysisResult.diagnostics) {
      if (d.line != null && !map.has(d.line)) {
        map.set(d.line, d.severity);
      }
    }
    return map;
  }, [analysisResult]);

  /** Counts of diagnostics per severity. */
  const severityCounts = useMemo(() => {
    const counts = { error: 0, warning: 0, info: 0 };
    if (!analysisResult) return counts;
    for (const d of analysisResult.diagnostics) {
      if (d.severity in counts) counts[d.severity as keyof typeof counts]++;
    }
    return counts;
  }, [analysisResult]);

  /** Filtered diagnostics list. */
  const filteredDiagnostics = useMemo(() => {
    if (!analysisResult) return [];
    if (severityFilter === 'all') return analysisResult.diagnostics;
    return analysisResult.diagnostics.filter(d => d.severity === severityFilter);
  }, [analysisResult, severityFilter]);

  /** Filtered entries in structured mode. */
  const filteredEntries = useMemo(() => {
    if (!payload || !payload.structured) return payload?.entries || [];
    if (!showAffectedRows || !analysisResult) return payload.entries;
    // Build set of affected source line numbers
    const affectedLines = new Set<number>();
    for (const d of analysisResult.diagnostics) {
      if (d.line != null) affectedLines.add(d.line);
    }
    return payload.entries.filter(e => affectedLines.has(e.source_line));
  }, [payload, showAffectedRows, analysisResult]);

  // ── Load payload ──────────────────────────────────────────────
  useEffect(() => {
    if (!outputFileId) return;
    loadPayload(outputFileId);
  }, [outputFileId]);

  async function loadPayload(id: string) {
    setLoading(true);
    setError(null);
    setPayload(null);
    setAnalysisResult(null);
    setHighlightedLine(null);
    setFileContents(null);
    setFileContentsError(null);
    try {
      const data = await api.getOutputEditorPayload(id);
      setPayload(data);
      setTranslatedContent(data.translated_content);
      setSavedContent(data.translated_content);
      setModified(false);
      // Also check if we have a latest analysis
      loadLatestAnalysis(id);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load editor payload');
    } finally {
      setLoading(false);
    }
  }

  async function loadLatestAnalysis(id: string) {
    try {
      const result = await api.getOutputFileLatestAnalysis(id);
      if (result) {
        setAnalysisResult(result);
      }
    } catch {
      // Non-critical
    }
  }

  // ── File Contents (read-only disk view) ─────────────────────
  async function handleToggleFileViewer() {
    const newCollapsed = !fileViewerCollapsed;
    setFileViewerCollapsed(newCollapsed);

    // Load contents on first expand
    if (!newCollapsed && !fileContents && outputFileId) {
      setFileContentsLoading(true);
      setFileContentsError(null);
      try {
        const data = await api.getFileContents(outputFileId);
        setFileContents(data);
      } catch (err) {
        if (err instanceof ApiError) {
          setFileContentsError(err.message);
        } else {
          setFileContentsError('Failed to load file contents');
        }
      } finally {
        setFileContentsLoading(false);
      }
    }
  }

  // ── Analyze ───────────────────────────────────────────────────
  async function handleAnalyze() {
    if (!outputFileId) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    try {
      const result = await api.analyzeOutputFile(outputFileId, { checks: ['compilability', 'placeholders'], save: true });
      setAnalysisResult(result);
      toast.showToast(`Analysis: ${result.status} (E:${result.errors_count} W:${result.warnings_count})`, result.status === 'passed' ? 'success' : 'error');
    } catch (err) {
      if (err instanceof ApiError) {
        setAnalysisError(err.message);
        toast.showToast(`Analysis failed: ${err.message}`, 'error');
      } else {
        setAnalysisError('Analysis failed');
        toast.showToast('Analysis failed', 'error');
      }
    } finally {
      setAnalysisLoading(false);
    }
  }

  // ── Navigate to line/entry from diagnostic ────────────────────
  function scrollToLine(line: number | null) {
    if (line == null) return;
    // Try to find a row with matching line number in structured view
    const rows = document.querySelectorAll('[data-entry-line]');
    for (const row of rows) {
      if (Number(row.getAttribute('data-entry-line')) === line) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight the row briefly
        setHighlightedLine(line);
        setTimeout(() => setHighlightedLine(null), 1500);
        // Focus the translated input in this row
        const input = row.querySelector('input, textarea') as HTMLElement | null;
        if (input) input.focus();
        return;
      }
    }
    // Fallback: scroll textarea to approximate position
    const textareas = document.querySelectorAll('textarea');
    if (textareas.length > 0) {
      const lines = translatedContent.split('\n');
      let charPos = 0;
      for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
        charPos += lines[i].length + 1;
      }
      textareas[textareas.length - 1]?.focus();
    }
  }

  // Track modified state
  useEffect(() => {
    setModified(translatedContent !== savedContent);
  }, [translatedContent, savedContent]);

  // ── Navigation guard (compatible with BrowserRouter) ─────────
  const { confirmNavigation } = useUnsavedChangesWarning({ dirty: modified });

  // ── Save ──────────────────────────────────────────────────────
  async function handleSave() {
    if (!payload || !outputFileId) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await api.saveOutputTranslatedContent(outputFileId, {
        translated_content: translatedContent,
        expected_updated_at: payload.metadata.updated_at || undefined,
      });
      setSaveResult({ success: true, message: 'Saved successfully' });
      toast.showToast('Translated content saved');
      setSavedContent(translatedContent);
      setModified(false);
      // Update stored updated_at
      setPayload(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          metadata: { ...prev.metadata, updated_at: res.updated_at, translated_size_bytes: res.translated_size_bytes },
        };
      });
      // Clear analysis since content changed
      setAnalysisResult(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveResult({ success: false, message: err.message });
        toast.showToast(err.message, 'error');
      } else {
        setSaveResult({ success: false, message: 'Save failed' });
        toast.showToast('Save failed', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Reload ────────────────────────────────────────────────────
  function handleReload() {
    if (modified) {
      const ok = window.confirm('Discard changes and reload?');
      if (!ok) return;
    }
    if (outputFileId) loadPayload(outputFileId);
  }

  // ── Helpers ───────────────────────────────────────────────────

  function getRowSeverity(entry: OutputEditorEntry): string | null {
    return lineDiagnosticMap.get(entry.source_line) || null;
  }

  function getRowStyle(entry: OutputEditorEntry): React.CSSProperties {
    const severity = getRowSeverity(entry);
    const isHighlighted = highlightedLine === entry.source_line;
    const base: React.CSSProperties = {};
    if (isHighlighted) {
      base.transition = 'background-color 0.3s ease';
      base.backgroundColor = 'var(--color-highlight-bg)';
    } else if (severity === 'error') {
      base.backgroundColor = 'var(--color-error-bg)';
    } else if (severity === 'warning') {
      base.backgroundColor = 'var(--color-warning-bg)';
    }
    return base;
  }

  function getSeverityMarker(severity: string | null): string {
    if (severity === 'error') return '\u2716'; // ✖
    if (severity === 'warning') return '\u26A0'; // ⚠
    if (severity === 'info') return '\u2139'; // ℹ
    return '';
  }

  function getSeverityFilterBtnClass(level: SeverityFilter): string {
    return `diag-filter-btn${severityFilter === level ? ' active' : ''}`;
  }

  // ── Render ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Output File Editor</h1>
        </div>
        <div className="loading"><span className="spinner" /> Loading editor...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="page-header">
          <h1>Output File Editor</h1>
        </div>
        <div className="alert alert-error">{error}</div>
        <button className="btn" onClick={() => navigate('/translated-files')}>Back to Translated Files</button>
      </div>
    );
  }

  if (!payload) {
    return (
      <div>
        <div className="page-header">
          <h1>Output File Editor</h1>
        </div>
        <div className="alert alert-error">No editor data available.</div>
        <button className="btn" onClick={() => navigate('/translated-files')}>Back to Translated Files</button>
      </div>
    );
  }

  const meta = payload.metadata;
  const missingSource = !payload.source_file.exists;
  const missingTranslated = !payload.translated_file.exists;

  // -- Stale analysis warning --
  const isOutdated = payload.metadata.latest_analysis_state === 'outdated';
  const showStaleWarning = (payload.metadata.analysis_stale || isOutdated) && analysisResult;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Output File Editor</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {meta.file_name} &middot; ID: {payload.output_file_id.slice(0, 16)}
            {payload.structured ? ' \u00b7 Structured' : ' \u00b7 Raw text'}
            {modified && <span style={{ color: 'var(--color-warning)', marginLeft: '0.5rem' }}>(modified)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={() => confirmNavigation(() => navigate('/translated-files'))}>Back</button>
          <button className="btn btn-sm" onClick={handleReload} disabled={loading}>Reload</button>
          <button className="btn btn-sm" onClick={handleAnalyze} disabled={analysisLoading}>
            {analysisLoading ? 'Analyzing...' : 'Analyze'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || !modified}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {missingSource && (
        <div className="alert alert-warning">Source file does not exist: {payload.source_file.relative_path || payload.source_file.path}</div>
      )}
      {missingTranslated && (
        <div className="alert alert-warning">Translated file does not exist: {payload.translated_file.relative_path || payload.translated_file.path}</div>
      )}

      {saveResult && (
        <div className={`alert ${saveResult.success ? 'alert-success' : 'alert-error'}`}>{saveResult.message}</div>
      )}

      {analysisError && (
        <div className="alert alert-error">{analysisError}</div>
      )}

      {showStaleWarning && (
        <div className="alert alert-warning" style={{ fontSize: '0.8rem' }}>
          File changed after last analysis — re-analyze to get up-to-date results.
        </div>
      )}

      {/* Analysis diagnostics panel — sticky */}
      {analysisResult && analysisResult.diagnostics.length > 0 && (
        <div className="card" style={{
          marginBottom: '1rem',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          maxHeight: '40vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}>
          {/* Header with status badge */}
          <div className="card-title" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0, padding: '0.6rem 0.75rem 0.4rem',
          }}>
            <span>
              Diagnostics ({analysisResult.diagnostics.length})
              <span className={`badge ${
                analysisResult.status === 'passed' ? 'badge-success' :
                analysisResult.status === 'warning' ? 'badge-warning' :
                analysisResult.status === 'failed' ? 'badge-error' : 'badge-muted'
              }`} style={{ marginLeft: '0.5rem' }}>
                {analysisResult.status}
              </span>
            </span>
            <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
              C:{analysisResult.compilability_score ?? '--'} P:{analysisResult.placeholders_score ?? '--'}
            </span>
          </div>

          {/* Severity filter bar */}
          <div style={{
            display: 'flex', gap: '0.3rem', padding: '0.3rem 0.75rem',
            borderBottom: '1px solid var(--color-border)', flexShrink: 0,
          }}>
            <button className={getSeverityFilterBtnClass('all')} onClick={() => setSeverityFilter('all')}>
              All ({analysisResult.diagnostics.length})
            </button>
            <button className={getSeverityFilterBtnClass('error')} onClick={() => setSeverityFilter('error')}>
              Errors ({severityCounts.error})
            </button>
            <button className={getSeverityFilterBtnClass('warning')} onClick={() => setSeverityFilter('warning')}>
              Warnings ({severityCounts.warning})
            </button>
            <button className={getSeverityFilterBtnClass('info')} onClick={() => setSeverityFilter('info')}>
              Info ({severityCounts.info})
            </button>
            {payload.structured && (
              <label className="diag-toggle-label">
                <input type="checkbox" checked={showAffectedRows} onChange={e => setShowAffectedRows(e.target.checked)} />
                Affected only
              </label>
            )}
          </div>

          {/* Diagnostic items */}
          <div className="custom-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: '0.25rem 0' }}>
            {filteredDiagnostics.length === 0 && (
              <div style={{ padding: '0.75rem 0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.75rem', textAlign: 'center' }}>
                No {severityFilter === 'all' ? '' : severityFilter} diagnostics.
              </div>
            )}
            {(['error', 'warning', 'info'] as const).map(group => {
              const groupItems = filteredDiagnostics.filter(d => d.severity === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <div className="diag-group-header">{group} ({groupItems.length})</div>
                  {groupItems.map((d, i) => (
                    <div
                      key={`${group}-${i}`}
                      className={`diagnostic-row diag-${d.severity}`}
                      onClick={() => scrollToLine(d.line)}
                    >
                      <div className="diagnostic-row-header">
                        <span className={`diagnostic-severity-badge diag-${d.severity}`}>
                          {d.severity === 'error' ? 'ERROR' : d.severity === 'warning' ? 'WARNING' : 'INFO'}
                        </span>
                        <span className="diagnostic-code">{d.code}</span>
                      </div>
                      <div className="diagnostic-message">{d.message}</div>
                      <div className="diagnostic-meta">
                        {d.key && <span className="diagnostic-meta-chip">key: {d.key}</span>}
                        {d.line != null && <span className="diagnostic-meta-chip">line: {d.line}</span>}
                        {d.source && <span className="diagnostic-meta-chip">{d.source}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          COLLAPSIBLE: Side-by-Side Editor
          ═══════════════════════════════════════════════════════════ */}
      <div className="collapsible-section">
        <button
          className="collapsible-header"
          onClick={() => setEditorCollapsed(!editorCollapsed)}
          aria-expanded={!editorCollapsed}
        >
          <span className={`collapsible-arrow${editorCollapsed ? '' : ' open'}`}>{'\u25B6'}</span>
          <span style={{ flex: 1 }}>
            {missingTranslated ? 'Translated (new file)' : 'Side-by-Side Editor'}
            {payload.structured && showAffectedRows && analysisResult && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                ({filteredEntries.length} / {payload.entries.length} rows)
              </span>
            )}
          </span>
        </button>

        {!editorCollapsed && (
          <div className="collapsible-body" style={{ padding: 0 }}>
            {payload.structured && payload.entries.length > 0 ? (
              /* ── Structured mode: entries table ── */
              <div className="table-wrapper">
                <table className="side-by-side-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: 20 }}></th>
                      <th style={{ width: 40 }}>#</th>
                      <th style={{ width: 180, maxWidth: 220 }}>Key</th>
                      <th style={{ minWidth: 200 }}>Source</th>
                      <th style={{ minWidth: 300 }}>Translation</th>
                      <th style={{ width: 110 }}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry, idx) => {
                      const severity = getRowSeverity(entry);
                      const marker = getSeverityMarker(severity);
                      const rowStyle = getRowStyle(entry);
                      const nonEditable = isNonEditable(entry);
                      return (
                        <tr
                          key={entry.key || idx}
                          data-entry-line={entry.source_line}
                          style={rowStyle}
                          className={nonEditable ? 'row-non-editable' : ''}
                        >
                          <td style={{ fontSize: '0.7rem', textAlign: 'center', color: severity === 'error' ? 'var(--color-error, #e74c3c)' : severity === 'warning' ? 'var(--color-warning, #f39c12)' : 'transparent' }}>
                            {marker || '\u2014'}
                          </td>
                          <td className="mono" style={{ fontSize: '0.7rem' }}>{idx + 1}</td>
                          <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem' }} title={entry.key || 'No key'}>
                            {entry.key || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{'\u2014'}</span>}
                          </td>
                          <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 200 }}>
                            {entry.source_text || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{'\u2014'}</span>}
                          </td>
                          <td style={{ minWidth: 300 }}>
                            {nonEditable ? (
                              <div className="editor-readonly-placeholder">
                                {entry.entry_type === 'raw_unknown' ? 'Raw line' : 'Not translatable'}
                              </div>
                            ) : (
                              <AutoResizeTextarea
                                className="form-control"
                                style={{
                                  width: '100%',
                                  fontSize: '0.8rem',
                                  minHeight: '1.8rem',
                                  resize: 'vertical',
                                  overflow: 'hidden',
                                  lineHeight: '1.3',
                                }}
                                value={entry.translated_text ?? ''}
                                onChange={e => {
                                  const newEntries = payload.entries.map((e2, i2) =>
                                    i2 === idx ? { ...e2, translated_text: e.target.value } : e2,
                                  );
                                  setPayload({ ...payload, entries: newEntries });
                                  const newContent = newEntries
                                    .map(e3 => e3.translated_text ?? '')
                                    .join('\n');
                                  setTranslatedContent(newContent);
                                }}
                                rows={1}
                              />
                            )}
                          </td>
                          <td style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                            <span
                              className={`badge ${nonEditable ? 'badge-muted' : 'badge-success'}`}
                              title={entry.entry_type}
                            >
                              {entry.entry_type === 'translation_entry' ? 'ENTRY' :
                               entry.entry_type === 'raw_unknown' ? 'RAW' :
                               entry.entry_type === 'language_header' ? 'HEADER' :
                               entry.entry_type === 'comment' ? 'COMMENT' :
                               entry.entry_type === 'empty' ? 'EMPTY' :
                               entry.entry_type}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* ── Raw text mode: side-by-side textareas ── */
              <div style={{ padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', minHeight: 400 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>
                      Source (read-only)
                      {missingSource && <span style={{ marginLeft: '0.5rem', color: 'var(--color-warning)' }}>(missing)</span>}
                    </div>
                    <textarea
                      className="form-control"
                      style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem', resize: 'none' }}
                      value={payload.source_content}
                      readOnly
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>
                      Translated {modified && <span style={{ color: 'var(--color-warning)' }}>(modified)</span>}
                    </div>
                    <textarea
                      className="form-control"
                      style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem', resize: 'none' }}
                      value={translatedContent}
                      onChange={e => setTranslatedContent(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          COLLAPSIBLE: File Viewer / Code View
          ═══════════════════════════════════════════════════════════ */}
      <div className="collapsible-section">
        <button
          className="collapsible-header"
          onClick={handleToggleFileViewer}
          aria-expanded={!fileViewerCollapsed}
        >
          <span className={`collapsible-arrow${fileViewerCollapsed ? '' : ' open'}`}>{'\u25B6'}</span>
          <span style={{ flex: 1 }}>Disk File View</span>
        </button>

        {!fileViewerCollapsed && (
          <div className="collapsible-body">
            {fileContentsLoading && (
              <div className="loading"><span className="spinner" /> Loading file contents...</div>
            )}
            {fileContentsError && (
              <div className="alert alert-error">{fileContentsError}</div>
            )}
            {fileContents && (
              <div className="file-viewer-container">
                <CodeViewerPanel
                  title="Source file"
                  content={fileContents.source_content}
                  path={fileContents.source_path}
                  exists={fileContents.source_exists}
                  missingLabel="Source file does not exist on disk."
                />
                <CodeViewerPanel
                  title="Translated file"
                  content={fileContents.translated_content}
                  path={fileContents.translated_path}
                  exists={fileContents.translated_exists}
                  missingLabel="Translated file does not exist on disk."
                />
              </div>
            )}
            {!fileContentsLoading && !fileContentsError && !fileContents && (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>
                No file contents loaded.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metadata summary */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-title">File Info</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', fontSize: '0.8rem' }}>
          <div><strong>File:</strong> {meta.file_name}</div>
          <div><strong>Type:</strong> {meta.file_ext || '\u2014'}</div>
          <div><strong>Status:</strong> {meta.status}</div>
          <div><strong>Source Size:</strong> {meta.source_size_bytes} B</div>
          <div><strong>Translated Size:</strong> {meta.translated_size_bytes} B</div>
          <div><strong>Updated:</strong> {meta.updated_at ? new Date(meta.updated_at).toLocaleString() : '\u2014'}</div>
          {analysisResult && (
            <>
              <div><strong>Analysis:</strong> {analysisResult.status}</div>
              <div><strong>Compilability:</strong> {analysisResult.compilability_score ?? '\u2014'}</div>
              <div><strong>Placeholders:</strong> {analysisResult.placeholders_score ?? '\u2014'}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
