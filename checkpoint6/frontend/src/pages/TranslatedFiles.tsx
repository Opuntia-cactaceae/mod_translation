import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, useToast } from '../App';
import type {
  OutputFile,
  OutputFileTreeResponse,
  OutputFilesSummaryResponse,
  OutputAnalysisResult,
  OutputAnalysisJob,
  OutputScanResultResponse,
} from '../api/types';
import OutputFilesTree from '../components/translated-files/OutputFilesTree';
import OutputFilesTable from '../components/translated-files/OutputFilesTable';
import OutputFilesToolbar from '../components/translated-files/OutputFilesToolbar';
import OutputFilesSummaryCards from '../components/translated-files/OutputFilesSummaryCards';
import OutputFileActions from '../components/translated-files/OutputFileActions';
import AnalysisJobProgress from '../components/translated-files/AnalysisJobProgress';

/* ------------------------------------------------------------------ */
/*  Filter state                                                       */
/* ------------------------------------------------------------------ */
interface FilterState {
  job_id?: string;
  mod_id?: string;
  group_key?: string;
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */
export default function TranslatedFiles() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // --- State ---
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tree, setTree] = useState<OutputFileTreeResponse | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [summary, setSummary] = useState<OutputFilesSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [selectedFile, setSelectedFile] = useState<OutputFile | null>(null);

  const [reindexLoading, setReindexLoading] = useState(false);
  const [reindexResult, setReindexResult] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<OutputScanResultResponse | null>(null);

  const [activeJob, setActiveJob] = useState<OutputAnalysisJob | null>(null);

  // Filter from query params
  const filter: FilterState = {
    job_id: searchParams.get('job_id') || undefined,
    mod_id: searchParams.get('mod_id') || undefined,
    group_key: searchParams.get('group_key') || undefined,
  };

  // Sync search to URL
  const syncSearch = useCallback((q: string) => {
    setSearch(q);
    const next = new URLSearchParams(searchParams);
    if (q) {
      next.set('q', q);
    } else {
      next.delete('q');
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Update filter in URL
  const updateFilter = useCallback((f: FilterState) => {
    const next = new URLSearchParams();
    if (f.job_id) next.set('job_id', f.job_id);
    if (f.mod_id) next.set('mod_id', f.mod_id);
    if (f.group_key) next.set('group_key', f.group_key);
    if (search) next.set('q', search);
    setSearchParams(next, { replace: true });
  }, [search, setSearchParams]);

  // --- Data loading ---
  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.listOutputFiles({
        job_id: filter.job_id,
        mod_id: filter.mod_id,
        group_key: filter.group_key,
        q: search || undefined,
        limit: 200,
      });
      setFiles(res.items);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load output files');
    } finally {
      setLoading(false);
    }
  }, [filter.job_id, filter.mod_id, filter.group_key, search]);

  const loadTree = useCallback(async () => {
    try {
      setTreeLoading(true);
      const res = await api.getOutputFilesTree({ job_id: filter.job_id });
      setTree(res);
    } catch {
      // Tree loading failures are non-critical
    } finally {
      setTreeLoading(false);
    }
  }, [filter.job_id]);

  const loadSummary = useCallback(async () => {
    if (!filter.job_id) {
      setSummary(null);
      return;
    }
    try {
      setSummaryLoading(true);
      const res = await api.getJobOutputsSummary(filter.job_id);
      setSummary(res);
    } catch {
      // Summary loading failures are non-critical
    } finally {
      setSummaryLoading(false);
    }
  }, [filter.job_id]);

  // --- Effects ---
  useEffect(() => {
    loadFiles();
    loadTree();
  }, [loadFiles, loadTree]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // --- Reindex ---
  async function handleReindex() {
    if (!filter.job_id) return;
    try {
      setReindexLoading(true);
      setReindexResult(null);
      const res = await api.reindexJobOutputs(filter.job_id);
      setLastScanResult(res);
      const parts: string[] = [];
      if (res.scanned_count > 0) parts.push(`${res.scanned_count} scanned`);
      if (res.indexed_count > 0) parts.push(`${res.indexed_count} indexed`);
      if (res.updated_count > 0) parts.push(`${res.updated_count} updated`);
      if (res.skipped_count > 0) parts.push(`${res.skipped_count} skipped`);
      if (res.missing_source_count > 0) parts.push(`${res.missing_source_count} missing source`);
      if (res.errors_count > 0) parts.push(`${res.errors_count} errors`);
      setReindexResult(parts.join(' | ') || 'No changes');
      if (res.errors_count === 0) {
        toast.showToast('Reindex complete', 'success');
      } else {
        toast.showToast(`Reindex completed with ${res.errors_count} error(s)`, 'error');
      }
      // Reload all data
      await Promise.all([loadFiles(), loadTree(), loadSummary()]);
    } catch (err) {
      if (err instanceof ApiError) {
        setReindexResult(`Reindex failed: ${err.message}`);
        toast.showToast(err.message, 'error');
      } else {
        setReindexResult('Reindex failed');
        toast.showToast('Reindex failed', 'error');
      }
    } finally {
      setReindexLoading(false);
    }
  }

  // --- Async batch analysis ---
  async function handleAnalyzeStale() {
    if (!filter.job_id) return;
    try {
      const job = await api.createOutputAnalysisJob({
        scope_type: 'job',
        job_id: filter.job_id,
        only_stale: true,
        checks: ['compilability', 'placeholders'],
      });
      setActiveJob(job);
      toast.showToast('Analysis job created', 'success');
    } catch (err) {
      if (err instanceof ApiError) {
        toast.showToast(`Failed to create analysis job: ${err.message}`, 'error');
      } else {
        toast.showToast('Failed to create analysis job', 'error');
      }
    }
  }

  // --- Analysis job callbacks ---
  function handleJobComplete(job: OutputAnalysisJob) {
    const parts: string[] = [];
    if (job.processed_count > 0) parts.push(`${job.processed_count} analyzed`);
    if (job.passed_count > 0) parts.push(`${job.passed_count} passed`);
    if (job.warning_count > 0) parts.push(`${job.warning_count} warnings`);
    if (job.failed_count > 0) parts.push(`${job.failed_count} failed`);
    if (job.error_count > 0) parts.push(`${job.error_count} errors`);

    toast.showToast(
      `Analysis ${job.status}: ${parts.join(', ') || 'no files'}`,
      job.status === 'completed' ? (job.failed_count > 0 ? 'error' : 'success') : 'success'
    );

    // Reload data
    loadFiles();
    loadTree();
    loadSummary();
  }

  function handleJobCancelled() {
    // Job was cancelled — keep the panel visible so the status updates
  }

  // --- Single-file analysis complete callback ---
  function handleAnalysisComplete(_result: OutputAnalysisResult) {
    loadFiles();
    loadSummary();
  }

  // --- Render ---
  const jobId = filter.job_id || null;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>Translated Files</h1>
            <p>
              {jobId
                ? <>Job: <span className="mono">{jobId}</span></>
                : 'Browse all translated output files'}
            </p>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Summary cards */}
      {summary && (
        <OutputFilesSummaryCards summary={summary} loading={summaryLoading} />
      )}

      {/* Active analysis job progress */}
      {activeJob && (
        <div style={{ marginBottom: '1rem' }}>
          <AnalysisJobProgress
            job={activeJob}
            onComplete={handleJobComplete}
            onCancel={handleJobCancelled}
          />
        </div>
      )}

      {/* Toolbar */}
      <OutputFilesToolbar
        jobId={jobId}
        search={search}
        onSearchChange={syncSearch}
        onRefresh={() => { loadFiles(); loadTree(); loadSummary(); }}
        onReindex={handleReindex}
        reindexLoading={reindexLoading}
        reindexResult={reindexResult}
        onAnalyzeStale={handleAnalyzeStale}
        batchAnalyzing={false}
      />

      {/* Reindex diagnostics banner */}
      {lastScanResult && lastScanResult.manifest_mode !== 'authoritative' && (
        <div
          className="alert alert-warning"
          style={{ marginBottom: '0.75rem', fontSize: '0.8rem' }}
        >
          <strong>Scanner Mode: {lastScanResult.manifest_mode}</strong>
          {lastScanResult.manifest_mode === 'fallback' && (
            <span> — No valid manifest found. Using fallback filesystem scan.</span>
          )}
          {lastScanResult.manifest_mode === 'partial' && (
            <span> — Manifest is incomplete. Supplementing with filesystem scan.</span>
          )}
          {lastScanResult.diagnostics && lastScanResult.diagnostics.length > 0 && (
            <div style={{ marginTop: '0.25rem', fontSize: '0.75rem' }}>
              <strong>Diagnostics ({lastScanResult.diagnostics.length}):</strong>
              <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                {lastScanResult.diagnostics.slice(0, 5).map((d, i) => (
                  <li key={i}>[{d.severity}] {d.code}: {d.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Tree + Table layout */}
      <div className="output-files-layout">
        <div className="output-files-tree-panel">
          <div className="card-title" style={{ padding: '0.5rem 0.75rem', margin: 0 }}>Files Tree</div>
          <OutputFilesTree
            tree={tree}
            loading={treeLoading}
            filter={filter}
            onFilterChange={updateFilter}
          />
        </div>
        <div className="output-files-table-panel">
          <OutputFilesTable
            files={files}
            loading={loading}
            total={total}
            onSelectFile={setSelectedFile}
            selectedFileId={selectedFile?.id}
          />
        </div>
      </div>

      {/* File detail modal */}
      {selectedFile && (
        <OutputFileActions
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
          onAnalysisComplete={handleAnalysisComplete}
        />
      )}
    </div>
  );
}
