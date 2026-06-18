import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../../App';
import type {
  TransferExportOptionItem,
  TransferExportOptionsResponse,
  TransferImportPreviewResponse,
  TransferImportApplyResponse,
} from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Conflict policy options                                            */
/* ------------------------------------------------------------------ */

const CONFLICT_POLICIES = [
  { value: 'skip_existing' as const, label: 'Skip Existing', desc: 'Keep existing items unchanged' },
  { value: 'overwrite_existing' as const, label: 'Overwrite Existing', desc: 'Replace existing custom items' },
  { value: 'import_as_copy' as const, label: 'Import as Copy', desc: 'Create new copies with generated IDs' },
];

type ConflictPolicy = 'skip_existing' | 'overwrite_existing' | 'import_as_copy';

/* ------------------------------------------------------------------ */
/*  CSS helper classes (inline)                                        */
/* ------------------------------------------------------------------ */

const styles = {
  section: { marginBottom: '1rem' },
  subsectionTitle: { fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem', color: '#ccc' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0' },
  badge: (variant: 'success' | 'warning' | 'info' | 'error') => ({
    display: 'inline-block',
    padding: '0.1rem 0.4rem',
    borderRadius: '3px',
    fontSize: '0.65rem',
    fontWeight: 600,
    backgroundColor:
      variant === 'success' ? '#1a5a2a' :
      variant === 'warning' ? '#5a4a1a' :
      variant === 'info' ? '#1a3a5a' : '#5a1a1a',
    color: '#fff',
    marginLeft: '0.3rem',
  }),
  summaryBar: {
    display: 'flex',
    gap: '1rem',
    padding: '0.5rem',
    backgroundColor: 'var(--color-surface-2)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.75rem',
    marginBottom: '0.5rem',
  },
  summaryItem: (color: string) => ({
    color,
    fontWeight: 600,
  }),
  actionBtn: {
    marginRight: '0.5rem',
    fontSize: '0.65rem',
    padding: '0.2rem 0.5rem',
  },
  warningText: { color: '#ffa500', fontSize: '0.7rem', marginLeft: '0.3rem' },
  errorText: { color: '#ff5555', fontSize: '0.7rem' },
  successText: { color: '#50fa7b', fontSize: '0.7rem' },
  countLabel: { fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ImportExportSection() {
  /* ---- Export state ---- */
  const [exportOptions, setExportOptions] = useState<TransferExportOptionsResponse | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedRuleSetIds, setSelectedRuleSetIds] = useState<Set<string>>(new Set());
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  /* ---- Import state ---- */
  const [packageData, setPackageData] = useState<Record<string, unknown> | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('skip_existing');
  const [importPreview, setImportPreview] = useState<TransferImportPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importResult, setImportResult] = useState<TransferImportApplyResponse | null>(null);
  const [importing, setImporting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  /* ---- Load export options on mount ---- */
  const loadExportOptions = useCallback(async () => {
    setExportLoading(true);
    setExportError(null);
    try {
      const options = await api.getExportOptions();
      setExportOptions(options);
      setSelectedRuleSetIds(new Set(options.rule_sets.map((rs: { id: string }) => rs.id)));
      setSelectedProfileIds(new Set(options.translation_profiles.map((p: { id: string }) => p.id)));
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Failed to load export options');
    } finally {
      setExportLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExportOptions();
  }, [loadExportOptions]);

  /* ---- Selection handlers ---- */
  function toggleRuleSet(id: string) {
    setSelectedRuleSetIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleProfile(id: string) {
    setSelectedProfileIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllRuleSets() {
    if (exportOptions) {
      setSelectedRuleSetIds(new Set(exportOptions.rule_sets.map(rs => rs.id)));
    }
  }

  function clearRuleSets() {
    setSelectedRuleSetIds(new Set());
  }

  function selectAllProfiles() {
    if (exportOptions) {
      setSelectedProfileIds(new Set(exportOptions.translation_profiles.map(p => p.id)));
    }
  }

  function clearProfiles() {
    setSelectedProfileIds(new Set());
  }

  /* ---- Export handler ---- */
  async function handleExport() {
    const rsCount = selectedRuleSetIds.size;
    const pCount = selectedProfileIds.size;
    if (rsCount === 0 && pCount === 0) {
      setExportError('Select at least one item to export.');
      return;
    }

    setExporting(true);
    setExportError(null);
    try {
      const payload = await api.createExportPackage({
        rule_set_ids: Array.from(selectedRuleSetIds),
        profile_ids: Array.from(selectedProfileIds),
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translator-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  /* ---- Import: file selection ---- */
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setPackageData(null);
    setImportPreview(null);
    setImportResult(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Basic envelope validation
      if (!data.schema || !data.payload) {
        setFileError('Invalid export file: missing schema or payload');
        return;
      }
      if (data.schema !== 'translator-app-transfer') {
        setFileError(`Unrecognized schema: ${data.schema}. Expected "translator-app-transfer".`);
        return;
      }
      setPackageData(data);
    } catch (err) {
      setFileError('Failed to read or parse the selected file. Ensure it is a valid JSON export file.');
    } finally {
      // Reset input so the same file can be re-imported
      e.target.value = '';
    }
  }

  /* ---- Import: preview ---- */
  async function handlePreviewImport() {
    if (!packageData) return;

    setPreviewLoading(true);
    setFileError(null);
    setImportResult(null);
    try {
      const result = await api.previewImport({
        package: packageData,
        conflict_policy: conflictPolicy,
      });
      setImportPreview(result);
    } catch (err) {
      setFileError(err instanceof ApiError ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }

  /* ---- Import: apply ---- */
  async function handleApplyImport() {
    if (!packageData) return;

    setImporting(true);
    try {
      const result = await api.applyImport({
        package: packageData,
        conflict_policy: conflictPolicy,
      });
      setImportResult(result);
      setImportPreview(null);
      // Reload export options to reflect new data
      loadExportOptions();
    } catch (err) {
      setFileError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  /* ---- Import: reset ---- */
  function handleResetImport() {
    setPackageData(null);
    setImportPreview(null);
    setImportResult(null);
    setFileError(null);
  }

  /* ---- Render ---- */
  return (
    <div className="card">
      <div className="card-title">Import / Export</div>

      {/* ================================================================ */}
      {/*  EXPORT SECTION                                                  */}
      {/* ================================================================ */}
      <h4 style={{ margin: '0.5rem 0', color: '#ddd', fontSize: '0.85rem' }}>
        Export Protection Rule Sets &amp; Translation Profiles
      </h4>

      {exportLoading && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Loading export options...</span>}
      {exportError && <div style={styles.errorText}>{exportError}</div>}

      {exportOptions && (
        <>
          {/* --- Rule Sets --- */}
          <div style={styles.section}>
            <div style={styles.subsectionTitle}>
              Rule Sets
              <span style={styles.countLabel}>
                {selectedRuleSetIds.size} of {exportOptions.rule_sets.length} selected
              </span>
            </div>

            {exportOptions.rule_sets.length === 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>No custom rule sets available.</div>
            )}

            {exportOptions.rule_sets.map(rs => (
              <label key={rs.id} style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={selectedRuleSetIds.has(rs.id)}
                  onChange={() => toggleRuleSet(rs.id)}
                  className="form-checkbox"
                />
                <span style={{ fontSize: '0.75rem' }}>{rs.name}</span>
                {rs.description && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>— {rs.description}</span>
                )}
              </label>
            ))}

            {exportOptions.rule_sets.length > 0 && (
              <div style={{ marginTop: '0.3rem' }}>
                <button className="btn btn-sm" style={styles.actionBtn} onClick={selectAllRuleSets}>Select All</button>
                <button className="btn btn-sm" style={styles.actionBtn} onClick={clearRuleSets}>Clear</button>
              </div>
            )}
          </div>

          {/* --- Translation Profiles --- */}
          <div style={styles.section}>
            <div style={styles.subsectionTitle}>
              Translation Profiles
              <span style={styles.countLabel}>
                {selectedProfileIds.size} of {exportOptions.translation_profiles.length} selected
              </span>
            </div>

            {exportOptions.translation_profiles.length === 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>No custom profiles available.</div>
            )}

            {exportOptions.translation_profiles.map(p => (
              <label key={p.id} style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={selectedProfileIds.has(p.id)}
                  onChange={() => toggleProfile(p.id)}
                  className="form-checkbox"
                />
                <span style={{ fontSize: '0.75rem' }}>{p.name}</span>
                {p.description && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>— {p.description}</span>
                )}
              </label>
            ))}

            {exportOptions.translation_profiles.length > 0 && (
              <div style={{ marginTop: '0.3rem' }}>
                <button className="btn btn-sm" style={styles.actionBtn} onClick={selectAllProfiles}>Select All</button>
                <button className="btn btn-sm" style={styles.actionBtn} onClick={clearProfiles}>Clear</button>
              </div>
            )}
          </div>

          {/* --- Export Button --- */}
          <button
            className="btn btn-sm"
            onClick={handleExport}
            disabled={exporting}
            style={{ fontSize: '0.65rem', marginTop: '0.25rem' }}
          >
            {exporting ? 'Exporting...' : 'Export Selected'}
          </button>
        </>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '1rem 0' }} />

      {/* ================================================================ */}
      {/*  IMPORT SECTION                                                  */}
      {/* ================================================================ */}
      <h4 style={{ margin: '0.5rem 0', color: '#ddd', fontSize: '0.85rem' }}>
        Import Configuration
      </h4>

      {/* File selector */}
      <div style={{ marginBottom: '0.5rem' }}>
        <label className="btn btn-sm" style={{ cursor: 'pointer', fontSize: '0.65rem' }}>
          Select Export File
          <input
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
        </label>
        {packageData && (
          <span style={{ fontSize: '0.7rem', color: '#50fa7b', marginLeft: '0.5rem' }}>
            File loaded: {packageData.payload ? `${(packageData.payload as Record<string, unknown[]>).rule_sets?.length ?? 0} rule sets, ${(packageData.payload as Record<string, unknown[]>).translation_profiles?.length ?? 0} profiles` : ''}
          </span>
        )}
      </div>

      {fileError && <div style={styles.errorText}>{fileError}</div>}

      {/* Conflict policy selector */}
      {packageData && !importResult && (
        <div style={{ marginBottom: '0.5rem' }}>
          <label style={{ fontSize: '0.75rem', color: '#ccc', marginRight: '0.5rem' }}>
            Conflict Policy:
          </label>
          <select
            className="form-control"
            value={conflictPolicy}
            onChange={e => setConflictPolicy(e.target.value as ConflictPolicy)}
            style={{ width: 'auto', fontSize: '0.7rem', padding: '0.15rem 0.3rem' }}
          >
            {CONFLICT_POLICIES.map(policy => (
              <option key={policy.value} value={policy.value}>
                {policy.label}
              </option>
            ))}
          </select>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginLeft: '0.3rem' }}>
            {CONFLICT_POLICIES.find(p => p.value === conflictPolicy)?.desc}
          </span>
        </div>
      )}

      {/* Preview / Apply / Reset actions */}
      {packageData && !importResult && (
        <div style={{ marginBottom: '0.5rem' }}>
          <button
            className="btn btn-sm"
            onClick={handlePreviewImport}
            disabled={previewLoading}
            style={{ fontSize: '0.65rem', marginRight: '0.5rem' }}
          >
            {previewLoading ? 'Analyzing...' : 'Preview Import'}
          </button>
          <button
            className="btn btn-sm"
            onClick={handleResetImport}
            style={{ fontSize: '0.65rem' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Preview results */}
      {importPreview && (
        <div>
          {/* Summary bar */}
          <div style={styles.summaryBar}>
            <span style={styles.summaryItem('#ccc')}>{importPreview.total} items:</span>
            <span style={styles.summaryItem('#50fa7b')}>{importPreview.create_count} create</span>
            <span style={styles.summaryItem('var(--color-text-muted)')}>{importPreview.skip_count} skip</span>
            <span style={styles.summaryItem('#ffa500')}>{importPreview.overwrite_count} overwrite</span>
            <span style={styles.summaryItem('#8be9fd')}>{importPreview.import_as_copy_count} as copy</span>
          </div>

          {/* Warnings */}
          {importPreview.warnings.length > 0 && importPreview.warnings.map((w, i) => (
            <div key={`pw-${i}`} style={styles.warningText}>⚠ {w}</div>
          ))}
          {importPreview.errors.length > 0 && importPreview.errors.map((e, i) => (
            <div key={`pe-${i}`} style={styles.errorText}>✗ {e}</div>
          ))}

          {/* Per-item details */}
          {importPreview.items.length > 0 && (
            <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '0.5rem', fontSize: '0.7rem' }}>
              {importPreview.items.map((item, i) => (
                <div key={i} style={{ padding: '0.15rem 0', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ color: '#ccc' }}>{item.name}</span>
                  <span style={styles.badge(item.kind === 'rule_set' ? 'info' : 'success')}>
                    {item.kind === 'rule_set' ? 'Rule Set' : 'Profile'}
                  </span>
                  <span style={{
                    ...styles.badge(
                      item.action === 'create' ? 'success' :
                      item.action === 'skip' ? 'warning' :
                      item.action === 'overwrite' ? 'error' : 'info'
                    ),
                  }}>
                    {item.action}
                  </span>
                  {item.warning && <span style={styles.warningText}>{item.warning}</span>}
                  {item.diagnostics.length > 0 && (
                    <span style={styles.errorText}>
                      ({item.diagnostics.length} diagnostic{item.diagnostics.length > 1 ? 's' : ''})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Apply button */}
          {importPreview.total > 0 && (
            <button
              className="btn btn-sm"
              onClick={handleApplyImport}
              disabled={importing}
              style={{ fontSize: '0.65rem', marginRight: '0.5rem' }}
            >
              {importing ? 'Importing...' : 'Proceed with Import'}
            </button>
          )}
          <button className="btn btn-sm" onClick={handleResetImport} style={{ fontSize: '0.65rem' }}>
            Cancel
          </button>
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: importResult.errors.length > 0 ? '#ff5555' : '#50fa7b' }}>
            {importResult.errors.length > 0
              ? 'Import completed with errors'
              : importResult.imported === 0 && importResult.overwritten === 0 && importResult.imported_as_copy === 0 && importResult.skipped > 0
                ? 'Import completed: all items were skipped'
                : 'Import completed'}
          </div>
          <div style={styles.summaryBar}>
            <span style={styles.summaryItem('#50fa7b')}>{importResult.imported} imported</span>
            <span style={styles.summaryItem('var(--color-text-muted)')}>{importResult.skipped} skipped</span>
            <span style={styles.summaryItem('#ffa500')}>{importResult.overwritten} overwritten</span>
            <span style={styles.summaryItem('#8be9fd')}>{importResult.imported_as_copy} as copy</span>
          </div>

          {importResult.warnings.length > 0 && (
            <div style={{ marginBottom: '0.3rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#ffa500', fontWeight: 600 }}>Warnings:</div>
              {importResult.warnings.map((w, i) => (
                <div key={`w-${i}`} style={styles.warningText}>⚠ {w}</div>
              ))}
            </div>
          )}

          {importResult.errors.length > 0 && (
            <div style={{ marginBottom: '0.3rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#ff5555', fontWeight: 600 }}>Errors:</div>
              {importResult.errors.map((e, i) => (
                <div key={`e-${i}`} style={styles.errorText}>✗ {e}</div>
              ))}
            </div>
          )}

          <button className="btn btn-sm" onClick={handleResetImport} style={{ fontSize: '0.65rem', marginTop: '0.3rem' }}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
