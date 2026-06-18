/* ------------------------------------------------------------------ */
/*  OutputFileActions — details/editor/analyze/debug buttons           */
/* ------------------------------------------------------------------ */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, useToast } from '../../App';
import type { OutputFile } from '../../api/types';
import type { OutputAnalysisResult, OutputFileDebugSnapshot } from '../../api/types';
import FreshnessBadge from '../common/FreshnessBadge';
import ResultBadge from '../common/ResultBadge';

interface Props {
  file: OutputFile;
  onClose: () => void;
  onAnalysisComplete?: (result: OutputAnalysisResult) => void;
}

export default function OutputFileActions({ file, onClose, onAnalysisComplete }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<OutputAnalysisResult | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<OutputAnalysisResult | null>(null);
  const [loadingSavedAnalysis, setLoadingSavedAnalysis] = useState(false);
  const [debugData, setDebugData] = useState<OutputFileDebugSnapshot | null>(null);
  const [loadingDebug, setLoadingDebug] = useState(false);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [openingSource, setOpeningSource] = useState(false);
  const [openingTranslated, setOpeningTranslated] = useState(false);
  const mountRef = useRef(0);

  // Fetch the latest saved analysis when the modal opens or file changes
  useEffect(() => {
    const id = ++mountRef.current;
    setLoadingSavedAnalysis(true);
    setSavedAnalysis(null);
    setAnalysisResult(null);

    api.getOutputFileLatestAnalysis(file.id)
      .then((result) => {
        // Only apply if this is still the latest mount (avoid stale responses)
        if (id === mountRef.current) {
          setSavedAnalysis(result);
        }
      })
      .catch(() => {
        // Silently ignore — the manual Analyze button is still available
      })
      .finally(() => {
        if (id === mountRef.current) {
          setLoadingSavedAnalysis(false);
        }
      });
  }, [file.id]);

  function handleOpenEditor() {
    onClose();
    navigate(`/translated-files/${file.id}/editor`, { state: { jobId: file.job_id } });
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const result = await api.analyzeOutputFile(file.id, { checks: ['compilability', 'placeholders'], save: true });
      setAnalysisResult(result);
      setSavedAnalysis(null); // fresh result supersedes saved
      toast.showToast(`Analysis: ${result.status} (E:${result.errors_count} W:${result.warnings_count})`, result.status === 'passed' ? 'success' : 'error');
      if (onAnalysisComplete) onAnalysisComplete(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.showToast(`Analysis failed: ${err.message}`, 'error');
      } else {
        toast.showToast('Analysis failed', 'error');
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleOpenSourceFolder() {
    setOpeningSource(true);
    try {
      const res = await api.openSourceFolder(file.id);
      toast.showToast(res.message || 'Source folder opened', 'success');
    } catch (err) {
      if (err instanceof ApiError) {
        toast.showToast(`Failed to open source folder: ${err.message}`, 'error');
      } else {
        toast.showToast('Failed to open source folder', 'error');
      }
    } finally {
      setOpeningSource(false);
    }
  }

  async function handleOpenTranslatedFolder() {
    setOpeningTranslated(true);
    try {
      const res = await api.openTranslatedFolder(file.id);
      toast.showToast(res.message || 'Translated folder opened', 'success');
    } catch (err) {
      if (err instanceof ApiError) {
        toast.showToast(`Failed to open translated folder: ${err.message}`, 'error');
      } else {
        toast.showToast('Failed to open translated folder', 'error');
      }
    } finally {
      setOpeningTranslated(false);
    }
  }

  async function handleToggleDebug() {
    if (debugExpanded) {
      setDebugExpanded(false);
      return;
    }
    if (!debugData) {
      setLoadingDebug(true);
      try {
        const data = await api.getOutputFileDebug(file.id);
        setDebugData(data);
      } catch (err) {
        toast.showToast('Failed to load debug info', 'error');
      } finally {
        setLoadingDebug(false);
      }
    }
    setDebugExpanded(true);
  }

  function formatHash(h: string | null | undefined): string {
    if (!h) return '\u2014';
    return h.length > 16 ? h.substring(0, 16) + '...' : h;
  }

  // Prefer fresh manual analysis result over saved result from DB
  const displayResult = analysisResult ?? savedAnalysis;

  function renderDiagnostics(diags: OutputAnalysisResult['diagnostics']) {
    if (diags.length === 0) {
      return <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #888)', marginTop: '0.5rem' }}>No diagnostics found.</p>;
    }

    // Check if SNAPSHOT_UNAVAILABLE is the root cause
    const hasSnapshotUnavailable = diags.some(
      d => d.code === 'SNAPSHOT_UNAVAILABLE' && d.severity === 'error'
    );

    return (
      <div style={{ marginTop: '0.5rem' }}>
        {hasSnapshotUnavailable && (
          <div className="alert alert-warning" style={{ fontSize: '0.75rem', marginBottom: '0.5rem', padding: '0.4rem 0.6rem' }}>
            <strong>Authoritative analysis unavailable.</strong>{' '}
            Snapshot-based token integrity and placeholder checks could not be performed.
            Supplementary findings below are non-authoritative.
          </div>
        )}
        <div className="custom-scrollbar" style={{ maxHeight: 240, overflowY: 'auto', fontSize: '0.75rem' }}>
          {diags.map((d, i) => (
            <div key={i} className={`diagnostic-row diag-${d.severity}`}>
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
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ width: 640 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>File Details</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="field-value-grid">
            <div className="field-value">
              <span className="field-value-label">File</span>
              <span className="field-value-value mono">{file.file_name}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">ID</span>
              <span className="field-value-value mono">{file.id}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Job</span>
              <span className="field-value-value mono">{file.job_id}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Mod</span>
              <span className="field-value-value">{file.mod_name || '\u2014'}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Group</span>
              <span className="field-value-value">{file.group_label || '\u2014'}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Status</span>
              <span className="field-value-value">
                <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                  <span className={`badge badge-${file.status === 'ready' ? 'success' : file.status === 'missing_source' ? 'error' : 'muted'}`}>
                    {file.status === 'ready' ? 'Ready' : file.status === 'missing_source' ? 'Missing Source' : file.status}
                  </span>
                  {file.latest_analysis_state && <FreshnessBadge state={file.latest_analysis_state} />}
                </span>
              </span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Source Path</span>
              <span className="field-value-value mono" style={{ fontSize: '0.7rem' }}>
                {file.relative_source_path || '\u2014'}
              </span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Translated Path</span>
              <span className="field-value-value mono" style={{ fontSize: '0.7rem' }}>
                {file.relative_translated_path || '\u2014'}
              </span>
            </div>
            <div className="field-value">
              <span className="field-value-label">File Type</span>
              <span className="field-value-value mono">{file.file_ext || '\u2014'}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Game</span>
              <span className="field-value-value">{file.game_id || '\u2014'}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Source Size</span>
              <span className="field-value-value mono">
                {file.source_size_bytes != null ? `${file.source_size_bytes} B` : '\u2014'}
              </span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Translated Size</span>
              <span className="field-value-value mono">
                {file.translated_size_bytes != null ? `${file.translated_size_bytes} B` : '\u2014'}
              </span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Created</span>
              <span className="field-value-value">{file.created_at ? new Date(file.created_at).toLocaleString() : '\u2014'}</span>
            </div>
            <div className="field-value">
              <span className="field-value-label">Updated</span>
              <span className="field-value-value">{file.updated_at ? new Date(file.updated_at).toLocaleString() : '\u2014'}</span>
            </div>
            {(file.latest_analysis || displayResult || loadingSavedAnalysis) && (
              <>
                <div className="field-value">
                  <span className="field-value-label">Analysis</span>
                  <span className="field-value-value">
                    {loadingSavedAnalysis ? (
                      <span className="badge badge-muted">Loading...</span>
                    ) : (
                      <ResultBadge
                        status={displayResult?.status}
                        errorsCount={displayResult?.errors_count}
                        warningsCount={displayResult?.warnings_count}
                      />
                    )}
                  </span>
                </div>
                <div className="field-value">
                  <span className="field-value-label">Compilability</span>
                  <span className="field-value-value mono">{displayResult?.compilability_score ?? '\u2014'}</span>
                </div>
                <div className="field-value">
                  <span className="field-value-label">Placeholders</span>
                  <span className="field-value-value mono">{displayResult?.placeholders_score ?? '\u2014'}</span>
                </div>
                <div className="field-value">
                  <span className="field-value-label">Errors / Warnings</span>
                  <span className="field-value-value mono">{displayResult?.errors_count ?? 0} / {displayResult?.warnings_count ?? 0}</span>
                </div>
              </>
            )}
          </div>

          {/* Analysis diagnostics */}
          {loadingSavedAnalysis && (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #888)' }}>Loading saved diagnostics...</p>
            </div>
          )}
          {displayResult && (
            <div style={{ marginTop: '1rem' }}>
              <strong style={{ fontSize: '0.8rem' }}>
                Diagnostics ({displayResult.diagnostics.length})
              </strong>
              {renderDiagnostics(displayResult.diagnostics)}
            </div>
          )}
          {!loadingSavedAnalysis && !displayResult && !analyzing && (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #888)' }}>
                No saved analysis result for this file yet. Click <strong>Analyze</strong> to run analysis.
              </p>
            </div>
          )}

          {/* Debug panel */}
          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border, #ccc)', paddingTop: '0.5rem' }}>
            <button
              className="btn btn-sm"
              onClick={handleToggleDebug}
              disabled={loadingDebug}
              style={{ fontSize: '0.75rem' }}
            >
              {loadingDebug ? 'Loading...' : debugExpanded ? 'Hide Debug' : 'Debug'}
            </button>
            {debugExpanded && debugData && (
              <div style={{ fontSize: '0.7rem', marginTop: '0.5rem', fontFamily: 'monospace' }}>
                {/* Stale reason & validity */}
                <div style={{ marginBottom: '0.5rem' }}>
                  <strong>Stale Reason:</strong> {debugData.stale_reason || '(not stale)'} &nbsp;|&nbsp;
                  <strong>Validity:</strong> {debugData.latest_analysis_state}
                </div>

                {/* Hashes */}
                <details style={{ marginBottom: '0.25rem' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Hashes</summary>
                  <div style={{ paddingLeft: '1rem', marginTop: '0.25rem' }}>
                    <div>Current Source: {formatHash(debugData.current_source_hash)}</div>
                    <div>Current Translated: {formatHash(debugData.current_translated_hash)}</div>
                    <div>Analysis Source: {formatHash(debugData.integrity.analysis_source_hash)}</div>
                    <div>Analysis Translated: {formatHash(debugData.integrity.analysis_translated_hash)}</div>
                    <div>Hash Match: {debugData.integrity.hash_match === null ? 'N/A' : debugData.integrity.hash_match ? 'Yes' : 'No'}</div>
                    <div>File on Disk: {debugData.integrity.file_exists_on_disk ? 'Yes' : 'No'}</div>
                    <div>Source on Disk: {debugData.integrity.source_exists_on_disk ? 'Yes' : 'No'}</div>
                  </div>
                </details>

                {/* Manifest info */}
                <details style={{ marginBottom: '0.25rem' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Manifest</summary>
                  <div style={{ paddingLeft: '1rem', marginTop: '0.25rem' }}>
                    <div>Mode: {debugData.manifest.manifest_mode || '(none)'}</div>
                    <div>Complete: {debugData.manifest.is_complete ? 'Yes' : 'No'}</div>
                    <div>Files Declared: {debugData.manifest.files_declared}</div>
                    <div>Files Found: {debugData.manifest.files_found}</div>
                    {debugData.manifest.missing_files.length > 0 && (
                      <div>Missing: {debugData.manifest.missing_files.join(', ')}</div>
                    )}
                    {debugData.manifest.undeclared_files.length > 0 && (
                      <div>Undeclared: {debugData.manifest.undeclared_files.join(', ')}</div>
                    )}
                  </div>
                </details>

                {/* Scanner diagnostics */}
                <details style={{ marginBottom: '0.25rem' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Scanner</summary>
                  <div style={{ paddingLeft: '1rem', marginTop: '0.25rem' }}>
                    <div>Last Scan: {debugData.scanner.last_scan_at || '(never)'}</div>
                    <div>Manifest Mode: {debugData.scanner.manifest_mode || '(none)'}</div>
                    {debugData.scanner.scan_diagnostics && debugData.scanner.scan_diagnostics.length > 0 && (
                      <div>
                        <div>Diagnostics ({debugData.scanner.scan_diagnostics.length}):</div>
                        {debugData.scanner.scan_diagnostics.map((d: any, i: number) => (
                          <div key={i} style={{ paddingLeft: '0.5rem' }}>
                            [{d.severity}] {d.code}: {d.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>

                {/* Analysis info */}
                <details style={{ marginBottom: '0.25rem' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Analysis</summary>
                  <div style={{ paddingLeft: '1rem', marginTop: '0.25rem' }}>
                    <div>Latest ID: {debugData.analysis.latest_analysis_id || '(none)'}</div>
                    <div>Status: {debugData.analysis.latest_analysis_status || '(none)'}</div>
                    <div>At: {debugData.analysis.latest_analysis_at || '(never)'}</div>
                    <div>Validity: {debugData.analysis.validity_state}</div>
                  </div>
                </details>

                {/* Recent analysis jobs */}
                {debugData.recent_analysis_jobs && debugData.recent_analysis_jobs.length > 0 && (
                  <details>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Recent Jobs ({debugData.recent_analysis_jobs.length})</summary>
                    <div style={{ paddingLeft: '1rem', marginTop: '0.25rem' }}>
                      {debugData.recent_analysis_jobs.map((j, i) => (
                        <div key={i}>
                          {j.job_id.substring(0, 12)}... | {j.status} | {j.created_at ? new Date(j.created_at).toLocaleString() : ''}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sm btn-primary" onClick={handleOpenEditor}>
            Editor
          </button>
          <button className="btn btn-sm" onClick={handleOpenSourceFolder} disabled={openingSource}>
            {openingSource ? 'Opening...' : 'Source Folder'}
          </button>
          <button className="btn btn-sm" onClick={handleOpenTranslatedFolder} disabled={openingTranslated}>
            {openingTranslated ? 'Opening...' : 'Translated Folder'}
          </button>
          <button className="btn btn-sm" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </button>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
