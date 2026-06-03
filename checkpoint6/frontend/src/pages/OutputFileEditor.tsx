import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';
import { api, ApiError, useToast } from '../App';
import AutoResizeTextarea from '../components/common/AutoResizeTextarea';
import FreshnessBadge from '../components/common/FreshnessBadge';
import ResultBadge from '../components/common/ResultBadge';
import type {
  EditorSessionState,
  EditorSessionEntry,
  OutputAnalysisResult,
  FileContentsResponse,
} from '../api/types';

type SeverityFilter = 'all' | 'error' | 'warning' | 'info';

/* ── Helper: check if a row should be shown as non-editable ── */
function isNonEditable(entry: EditorSessionEntry): boolean {
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
  const location = useLocation();
  const toast = useToast();

  // Extract jobId from navigation state (set by OutputFileActions when opening editor)
  const editorNavState = location.state as { jobId?: string } | null;
  const jobId = editorNavState?.jobId;

  // ── Session state (single source of truth) ──
  const [session, setSession] = useState<EditorSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Save / sync state ──
  const [savingEntryKeys, setSavingEntryKeys] = useState<Set<string>>(new Set());
  const [savingToDisk, setSavingToDisk] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  // ── Raw text draft (only used in raw text mode) ──
  const [rawTextDraft, setRawTextDraft] = useState<string>('');
  const [rawTextDirty, setRawTextDirty] = useState(false);

  // ── Analysis state ──
  const [analysisResult, setAnalysisResult] = useState<OutputAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // ── Diagnostics UX state ──
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

  // ── Blur debounce refs ──
  const entryBlurTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Track the last backend-synced translated_text for each entry key.
  // This is distinct from the session state, which includes optimistic local
  // updates.  Used to skip spurious blur events (e.g. layout-reflow focus
  // changes) that would otherwise trigger a costly backend rebuild cycle.
  const syncedTranslations = useRef<Record<string, string | null>>({});

  // ── Editor scroll container ref (for jump-to-line scrolling) ──
  const editorScrollRef = useRef<HTMLDivElement>(null);

  // ── Derive back-navigation target from incoming state ──
  function goBackToTranslatedFiles() {
    navigate('/translated-files', jobId ? { state: { restoreJobId: jobId } } : undefined);
  }

  const isRawTextMode = session ? !session.structured : false;
  // Modified = session says dirty, OR raw text has unsynced local edits
  const modified = session ? session.dirty || rawTextDirty : false;

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
    if (!session || !session.structured) return session?.entries || [];
    if (!showAffectedRows || !analysisResult) return session.entries;
    const affectedLines = new Set<number>();
    for (const d of analysisResult.diagnostics) {
      if (d.line != null) affectedLines.add(d.line);
    }
    return session.entries.filter(e => affectedLines.has(e.source_line));
  }, [session, showAffectedRows, analysisResult]);

  // ── Load session on mount ─────────────────────────────────────
  useEffect(() => {
    if (!outputFileId) return;
    loadSession(outputFileId);
  }, [outputFileId]);

  async function loadSession(id: string) {
    setLoading(true);
    setError(null);
    setSession(null);
    setAnalysisResult(null);
    setSaveResult(null);
    setHighlightedLine(null);
    setFileContents(null);
    setFileContentsError(null);
    setRawTextDraft('');
    setRawTextDirty(false);
    try {
      const data = await api.openEditorSession(id);
      setSession(data);
      setRawTextDraft(data.translated_text);
      // Initialize synced translations from the backend response
      syncedTranslations.current = {};
      for (const e of data.entries) {
        syncedTranslations.current[e.key] = e.translated_text;
      }
      loadLatestAnalysis(id);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load editor session');
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
    const container = editorScrollRef.current;
    if (!container) return;

    // Scope the query to the editor container so we don't scroll the page
    const rows = container.querySelectorAll('[data-entry-line]');
    for (const row of rows) {
      if (Number(row.getAttribute('data-entry-line')) === line) {
        const rowEl = row as HTMLElement;
        const containerRect = container.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        const relativeTop = rowRect.top - containerRect.top;

        // Only scroll if the row is not already fully visible
        const scrollNeeded =
          relativeTop < 0 ||
          relativeTop + rowEl.offsetHeight > container.clientHeight;

        if (scrollNeeded) {
          const targetScroll =
            container.scrollTop +
            relativeTop -
            container.clientHeight / 2 +
            rowEl.offsetHeight / 2;
          container.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }

        setHighlightedLine(line);
        setTimeout(() => setHighlightedLine(null), 1500);
        const input = row.querySelector('input, textarea') as HTMLElement | null;
        if (input) input.focus();
        return;
      }
    }
    // Fallback: scroll textarea to approximate position
    const textareas = container.querySelectorAll('textarea');
    if (textareas.length > 0) {
      const text = isRawTextMode ? rawTextDraft : (session?.translated_text || '');
      const lines = text.split('\n');
      let charPos = 0;
      for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
        charPos += lines[i].length + 1;
      }
      textareas[textareas.length - 1]?.focus();
    }
  }

  // ── Navigation guard ─────────────────────────────────────────
  const { confirmNavigation } = useUnsavedChangesWarning({ dirty: modified });

  // ── Entry update (table mode: on blur) ────────────────────────
  async function handleEntryBlur(entryKey: string, value: string) {
    if (!outputFileId) return;

    // ── Skip save if the text hasn't actually changed since last sync ──
    // Prevents spurious blur events (e.g. caused by layout reflow or
    // textarea height recalculation) from triggering a backend rebuild
    // cycle that can corrupt null/unparseable entries.
    const synced = syncedTranslations.current[entryKey];
    if (synced !== undefined && (synced ?? '') === value) {
      return;
    }

    // Clear any pending debounce for this entry
    const timer = entryBlurTimers.current.get(entryKey);
    if (timer) clearTimeout(timer);
    entryBlurTimers.current.delete(entryKey);

    setSavingEntryKeys(prev => {
      const next = new Set(prev);
      next.add(entryKey);
      return next;
    });

    try {
      const res = await api.updateSessionEntry(outputFileId, entryKey, { translated_text: value });
      // Update synced translations from the canonical backend response
      for (const e of res.entries) {
        syncedTranslations.current[e.key] = e.translated_text;
      }
      setSession(prev => prev ? {
        ...prev,
        translated_text: res.translated_text,
        entries: res.entries,
        revision: res.revision,
        dirty: res.dirty,
      } : prev);
    } catch (err) {
      // On failure, re-fetch canonical state from backend
      toast.showToast('Entry update failed — reverting', 'error');
      try {
        const fresh = await api.getEditorSession(outputFileId);
        // Update synced translations from the fresh backend state
        syncedTranslations.current = {};
        for (const e of fresh.entries) {
          syncedTranslations.current[e.key] = e.translated_text;
        }
        setSession(fresh);
      } catch {
        // Session fetch also failed — mark critical error
        setError('Session error after failed entry update');
      }
    } finally {
      setSavingEntryKeys(prev => {
        const next = new Set(prev);
        next.delete(entryKey);
        return next;
      });
    }
  }

  // ── Entry change (table mode: optimistic local update) ────────
  function handleEntryChange(entryKey: string, idx: number, value: string) {
    if (!session) return;

    // Optimistic local update
    const newEntries = session.entries.map((e, i) =>
      i === idx ? { ...e, translated_text: value } : e,
    );
    setSession({ ...session, entries: newEntries, dirty: true });

    // Debounce blur save: reset timer on each keystroke
    const existing = entryBlurTimers.current.get(entryKey);
    if (existing) clearTimeout(existing);
  }

  // ── Raw text change (local draft only) ────────────────────────
  function handleRawTextChange(value: string) {
    setRawTextDraft(value);
    setRawTextDirty(true);
  }

  // ── Raw text Save (send to backend, reparse) ──────────────────
  async function handleRawTextSave() {
    if (!outputFileId) return;
    setSavingToDisk(true);
    setSaveResult(null);
    try {
      const res = await api.updateEditorRawText(outputFileId, { translated_text: rawTextDraft });
      setSession(prev => prev ? {
        ...prev,
        translated_text: res.translated_text,
        entries: res.entries,
        revision: res.revision,
        dirty: res.dirty,
        structured: res.structured,
      } : prev);
      setRawTextDraft(res.translated_text);
      setRawTextDirty(false);
      if (res.parse_error) {
        toast.showToast(`Parsed with warnings: ${res.parse_error}`, 'error');
      } else {
        toast.showToast('Raw text saved to session');
      }
      // Clear analysis since content changed
      setAnalysisResult(null);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.showToast(err.message, 'error');
      } else {
        toast.showToast('Raw text save failed', 'error');
      }
    } finally {
      setSavingToDisk(false);
    }
  }

  // ── Raw text Cancel (restore from session) ────────────────────
  function handleRawTextCancel() {
    if (session) {
      setRawTextDraft(session.translated_text);
      setRawTextDirty(false);
    }
  }

  // ── Save to disk ──────────────────────────────────────────────
  async function handleSaveToDisk() {
    if (!outputFileId) return;

    // If in raw text mode with unsaved edits, save to session first
    if (isRawTextMode && rawTextDirty) {
      await handleRawTextSave();
    }

    setSavingToDisk(true);
    setSaveResult(null);
    try {
      const res = await api.saveEditorSessionToDisk(outputFileId);
      setSession(prev => prev ? {
        ...prev,
        metadata: {
          ...prev.metadata,
          updated_at: res.updated_at,
          translated_size_bytes: res.translated_size_bytes,
        },
        dirty: false,
        revision: res.revision,
      } : prev);
      setSaveResult({ success: true, message: 'Saved to disk' });
      toast.showToast('File saved to disk');
      // Clear analysis since content changed
      setAnalysisResult(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveResult({ success: false, message: err.message });
        toast.showToast(err.message, 'error');
      } else {
        setSaveResult({ success: false, message: 'Save to disk failed' });
        toast.showToast('Save to disk failed', 'error');
      }
    } finally {
      setSavingToDisk(false);
    }
  }

  // ── Reload / Revert ────────────────────────────────────────────
  function handleRevert() {
    if (modified) {
      const ok = window.confirm('Discard changes and reload?');
      if (!ok) return;
    }
    if (outputFileId) loadSession(outputFileId);
  }

  // ── Helpers ───────────────────────────────────────────────────

  function getRowSeverity(entry: EditorSessionEntry): string | null {
    return lineDiagnosticMap.get(entry.source_line) || null;
  }

  function getRowStyle(entry: EditorSessionEntry): React.CSSProperties {
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

  function isEntrySaving(entryKey: string): boolean {
    return savingEntryKeys.has(entryKey);
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
        <button className="btn" onClick={goBackToTranslatedFiles}>Back to Translated Files</button>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <div className="page-header">
          <h1>Output File Editor</h1>
        </div>
        <div className="alert alert-error">No editor data available.</div>
        <button className="btn" onClick={goBackToTranslatedFiles}>Back to Translated Files</button>
      </div>
    );
  }

  const meta = session.metadata;
  const missingSource = !session.source_file.exists;
  const missingTranslated = !session.translated_file.exists;

  // Stale analysis warning
  const isOutdated = meta.latest_analysis_state === 'outdated';
  const showStaleWarning = (meta.analysis_stale || isOutdated) && analysisResult;

  // Freshness state for display
  const freshnessState = meta.latest_analysis_state || undefined;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Output File Editor</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {meta.file_name} &middot; ID: {session.output_file_id.slice(0, 16)}
            {session.structured ? ' \u00b7 Structured' : ' \u00b7 Raw text'}
            {modified && <span style={{ color: 'var(--color-warning)', marginLeft: '0.5rem' }}>(modified)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={() => confirmNavigation(goBackToTranslatedFiles)}>Back</button>
          <button className="btn btn-sm" onClick={handleRevert} disabled={loading}>Revert</button>
          <button className="btn btn-sm" onClick={handleAnalyze} disabled={analysisLoading}>
            {analysisLoading ? 'Analyzing...' : 'Analyze'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSaveToDisk} disabled={savingToDisk || !modified}>
            {savingToDisk ? 'Saving...' : 'Save to Disk'}
          </button>
        </div>
      </div>

      {missingSource && (
        <div className="alert alert-warning">Source file does not exist: {session.source_file.relative_path || session.source_file.path}</div>
      )}
      {missingTranslated && (
        <div className="alert alert-warning">Translated file does not exist: {session.translated_file.relative_path || session.translated_file.path}</div>
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
              <span style={{ marginLeft: '0.5rem' }}>
                <ResultBadge
                  status={analysisResult.status}
                  errorsCount={analysisResult.errors_count}
                  warningsCount={analysisResult.warnings_count}
                />
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
            {session.structured && (
              <label className="diag-toggle-label">
                <input type="checkbox" checked={showAffectedRows} onChange={e => setShowAffectedRows(e.target.checked)} />
                Affected only
              </label>
            )}
          </div>

          {/* Diagnostic items */}
          <div className="custom-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: '0.25rem 0' }}>
            {analysisResult.diagnostics.some(
              d => d.code === 'SNAPSHOT_UNAVAILABLE' && d.severity === 'error'
            ) && (
              <div className="alert alert-warning" style={{ fontSize: '0.75rem', margin: '0.25rem 0.5rem', padding: '0.4rem 0.6rem' }}>
                <strong>Authoritative analysis unavailable.</strong>{' '}
                Snapshot-based checks could not be performed.
                Supplementary findings below are non-authoritative.
              </div>
            )}
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
                        {d.details?.reason != null && typeof d.details.reason === 'string' && <span className="diagnostic-meta-chip">reason: {d.details.reason as string}</span>}
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
            {session.structured && showAffectedRows && analysisResult && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                ({filteredEntries.length} / {session.entries.length} rows)
              </span>
            )}
          </span>
        </button>

        {!editorCollapsed && (
          <div className="collapsible-body" style={{ padding: 0 }}>
            <div ref={editorScrollRef} className="editor-scroll-container">
            {session.structured && session.entries.length > 0 ? (
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
                      const saving = isEntrySaving(entry.key);
                      return (
                        <tr
                          key={entry.key || idx}
                          data-entry-line={entry.source_line}
                          style={rowStyle}
                          className={nonEditable ? 'row-non-editable' : ''}
                        >
                          <td style={{ fontSize: '0.7rem', textAlign: 'center', color: severity === 'error' ? 'var(--color-error, #e74c3c)' : severity === 'warning' ? 'var(--color-warning, #f39c12)' : 'transparent' }}>
                            {saving ? '\u231B' : (marker || '\u2014')}
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
                            ) : entry.translated_text === null ? (
                              <div className="editor-missing-translation">
                                <AutoResizeTextarea
                                  className="form-control form-control-missing"
                                  placeholder="No translation"
                                  style={{
                                    width: '100%',
                                    fontSize: '0.8rem',
                                    minHeight: '1.8rem',
                                    resize: 'vertical',
                                    overflow: 'hidden',
                                    lineHeight: '1.3',
                                    color: 'var(--color-text-muted)',
                                    fontStyle: 'italic',
                                  }}
                                  value={''}
                                  onChange={e => handleEntryChange(entry.key, idx, e.target.value)}
                                  onBlur={e => handleEntryBlur(entry.key, e.target.value)}
                                  rows={1}
                                />
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
                                onChange={e => handleEntryChange(entry.key, idx, e.target.value)}
                                onBlur={e => handleEntryBlur(entry.key, e.target.value)}
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
                      value={session.source_content}
                      readOnly
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>
                      Translated {rawTextDirty && <span style={{ color: 'var(--color-warning)' }}>(unsaved)</span>}
                    </div>
                    <textarea
                      className="form-control"
                      style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem', resize: 'none' }}
                      value={rawTextDraft}
                      onChange={e => handleRawTextChange(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-sm"
                        onClick={handleRawTextCancel}
                        disabled={!rawTextDirty}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={handleRawTextSave}
                        disabled={savingToDisk || !rawTextDirty}
                      >
                        {savingToDisk ? 'Saving...' : 'Save Raw'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
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
          <div><strong>Status:</strong> {meta.status}{freshnessState ? <span style={{ marginLeft: '0.25rem' }}><FreshnessBadge state={freshnessState} /></span> : null}</div>
          <div><strong>Source Size:</strong> {meta.source_size_bytes} B</div>
          <div><strong>Translated Size:</strong> {meta.translated_size_bytes} B</div>
          <div><strong>Updated:</strong> {meta.updated_at ? new Date(meta.updated_at).toLocaleString() : '\u2014'}</div>
          <div><strong>Revision:</strong> {session.revision}</div>
          <div><strong>Session:</strong> {session.dirty ? 'Modified' : 'Clean'}</div>
          {analysisResult && (
            <>
              <div><strong>Analysis:</strong> <ResultBadge status={analysisResult.status} errorsCount={analysisResult.errors_count} warningsCount={analysisResult.warnings_count} /></div>
              <div><strong>Compilability:</strong> {analysisResult.compilability_score ?? '\u2014'}</div>
              <div><strong>Placeholders:</strong> {analysisResult.placeholders_score ?? '\u2014'}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
