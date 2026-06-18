import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
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
import OutputJobList from '../components/translated-files/OutputJobList';
import SelectedJobFilesPanel from '../components/translated-files/SelectedJobFilesPanel';
import { usePersistentState } from '../hooks/usePersistentState';
import { STORAGE_KEYS } from '../utils/storageKeys';

/* ------------------------------------------------------------------ */
/*  Filter state                                                       */
/* ------------------------------------------------------------------ */
interface FilterState {
  job_id?: string;
  mod_id?: string;
  group_key?: string;
}

type GroupMode = 'folder' | 'job' | 'date-job';

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */
export default function TranslatedFiles() {
  const toast = useToast();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // ===================================================================
  //  Core state
  // ===================================================================

  // Full tree (all jobs) — used to derive job list cards
  const [tree, setTree] = useState<OutputFileTreeResponse | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  // Selected job ID — primary state driving which job's files are shown
  // Priority: location.state.restoreJobId (from editor back nav) > ?job_id= (from Translation Jobs) > null
  const navState = location.state as { restoreJobId?: string } | null;
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    navState?.restoreJobId || searchParams.get('job_id') || null,
  );
  const initialJobSetRef = useRef(false);

  // Job-scoped data (loaded when selectedJobId changes)
  const [jobTree, setJobTree] = useState<OutputFileTreeResponse | null>(null);
  const [jobTreeLoading, setJobTreeLoading] = useState(false);

  const [files, setFiles] = useState<OutputFile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<OutputFilesSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [selectedFile, setSelectedFile] = useState<OutputFile | null>(null);

  // Search
  const [search, setSearch] = useState(searchParams.get('q') || '');

  // View mode: tree or table (persisted)
  const [viewMode, setViewMode] = usePersistentState<'tree' | 'table'>(
    'stellaris_translator.translatedFilesViewMode',
    'tree',
  );

  // ===================================================================
  //  Reindex state
  // ===================================================================

  const [reindexLoading, setReindexLoading] = useState(false);
  const [reindexResult, setReindexResult] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<OutputScanResultResponse | null>(null);

  // ===================================================================
  //  Analysis job state
  // ===================================================================

  const [activeJob, setActiveJob] = useState<OutputAnalysisJob | null>(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);

  // ===================================================================
  //  Grouping state (persisted)
  // ===================================================================

  const [groupMode, setGroupMode] = usePersistentState<GroupMode>(
    STORAGE_KEYS.translatedFilesGroupMode,
    'folder',
  );

  const [expandedGroups, setExpandedGroups] = usePersistentState<Record<string, boolean>>(
    STORAGE_KEYS.translatedFilesExpandedGroups,
    {},
    {
      legacyKeys: [STORAGE_KEYS.translatedFilesExpandedDateGroups],
      migrateLegacy: (old: Record<string, boolean>) => {
        const migrated: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(old)) {
          migrated[k.includes(':') ? k : `date:${k}`] = v;
        }
        return migrated;
      },
    },
  );

  // ===================================================================
  //  Output Job List grouping state (separate from files tree grouping)
  // ===================================================================

  const [outputJobExpandedGroups, setOutputJobExpandedGroups] = usePersistentState<Record<string, boolean>>(
    STORAGE_KEYS.outputJobListExpandedGroups,
    {},
  );

  function handleToggleOutputJobGroup(key: string) {
    setOutputJobExpandedGroups(prev => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key],
    }));
  }

  function handleToggleGroup(key: string) {
    setExpandedGroups(prev => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key],
    }));
  }

  // ===================================================================
  //  Filter — used for mod/group filtering within the selected job
  // ===================================================================

  const filter: FilterState = {
    job_id: selectedJobId || undefined,
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

  // ===================================================================
  //  Data loading
  // ===================================================================

  // Load full tree (all jobs) — for job list cards
  const loadTree = useCallback(async () => {
    try {
      setTreeLoading(true);
      const res = await api.getOutputFilesTree();
      setTree(res);

      // Default selectedJobId to first available job
      if (!initialJobSetRef.current && res && Object.keys(res.jobs).length > 0) {
        const jobIds = Object.keys(res.jobs);
        if (!selectedJobId || !jobIds.includes(selectedJobId)) {
          setSelectedJobId(jobIds[0]);
        }
        initialJobSetRef.current = true;
      }
    } catch {
      // Tree loading failures are non-critical
    } finally {
      setTreeLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load job-scoped data when selectedJobId changes
  const loadJobData = useCallback(async (jobId: string | null) => {
    if (!jobId) {
      setJobTree(null);
      setFiles([]);
      setTotal(0);
      setSummary(null);
      return;
    }

    try {
      setError(null);
      setJobTreeLoading(true);
      const [treeRes, fileRes, sumRes] = await Promise.all([
        api.getOutputFilesTree({ job_id: jobId }),
        api.listOutputFiles({ job_id: jobId, limit: 200 }),
        api.getJobOutputsSummary(jobId),
      ]);
      setJobTree(treeRes);
      setFiles(fileRes.items);
      setTotal(fileRes.total);
      setSummary(sumRes);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load job data');
    } finally {
      setJobTreeLoading(false);
      setLoading(false);
    }
  }, []);

  // Load data on mount
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Reload job-scoped data when selectedJobId changes
  useEffect(() => {
    loadJobData(selectedJobId);
  }, [selectedJobId, loadJobData]);

  // ===================================================================
  //  Reindex
  // ===================================================================

  async function handleReindex() {
    if (!selectedJobId) return;
    try {
      setReindexLoading(true);
      setReindexResult(null);
      const res = await api.reindexJobOutputs(selectedJobId);
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
      await Promise.all([loadTree(), loadJobData(selectedJobId)]);
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

  // ===================================================================
  //  Async batch analysis
  // ===================================================================

  async function handleAnalyzeStale(jobIdOverride?: string) {
    const targetJobId = jobIdOverride || selectedJobId;
    if (!targetJobId) return;

    if (batchAnalyzing) return;  // Prevent double-submit

    try {
      setBatchAnalyzing(true);

      // Step 1: Create the analysis job
      const job = await api.createOutputAnalysisJob({
        scope_type: 'job',
        job_id: targetJobId,
        only_stale: true,
        checks: ['compilability', 'placeholders'],
      });
      setActiveJob(job);

      // Step 2: Explicitly start the job (ensures it's submitted to the worker)
      try {
        const startedJob = await api.startOutputAnalysisJob(job.id);
        setActiveJob(startedJob);
        toast.showToast('Analysis started', 'success');
      } catch {
        // Fallback: the create endpoint already submitted to the worker,
        // so proceed with polling the original job
        toast.showToast('Analysis started', 'success');
      }
    } catch (err) {
      setActiveJob(null);
      setBatchAnalyzing(false);
      if (err instanceof ApiError) {
        toast.showToast(`Failed to start analysis: ${err.message}`, 'error');
      } else {
        toast.showToast('Failed to start analysis', 'error');
      }
    }
  }

  // ===================================================================
  //  Analysis job callbacks
  // ===================================================================

  function handleJobComplete(job: OutputAnalysisJob) {
    const parts: string[] = [];
    if (job.processed_count > 0) parts.push(`${job.processed_count} file${job.processed_count !== 1 ? 's' : ''}`);
    if (job.passed_count > 0) parts.push(`${job.passed_count} passed`);
    if (job.failed_count > 0) parts.push(`${job.failed_count} failed`);
    if (job.error_count > 0) parts.push(`${job.error_count} error${job.error_count !== 1 ? 's' : ''}`);
    if (job.warning_count > 0) parts.push(`${job.warning_count} warning${job.warning_count !== 1 ? 's' : ''}`);
    if (job.skipped_count > 0) parts.push(`${job.skipped_count} skipped`);

    const hasIssues = job.failed_count > 0 || job.error_count > 0;
    const severity = job.status === 'completed' && hasIssues ? 'warning' : job.status === 'completed' ? 'success' : 'error';
    const statusLabel = hasIssues ? 'completed with issues' : job.status;

    toast.showToast(
      `Analysis ${statusLabel}: ${parts.join(', ') || 'no files'}`,
      severity,
    );

    // Reload data
    loadJobData(selectedJobId);

    // Clear active job state
    setActiveJob(null);
    setBatchAnalyzing(false);
  }

  function handleJobCancelled() {
    setActiveJob(null);
    setBatchAnalyzing(false);
  }

  // ===================================================================
  //  Single-file analysis complete callback
  // ===================================================================

  function handleAnalysisComplete(_result: OutputAnalysisResult) {
    loadJobData(selectedJobId);
  }

  // ===================================================================
  //  Refresh handler — preserves selectedJobId
  // ===================================================================

  function handleRefresh() {
    loadTree();
    loadJobData(selectedJobId);
  }

  // ===================================================================
  //  Job selection handler — preserves selectedJobId across refreshes
  // ===================================================================

  function handleSelectJob(jobId: string) {
    setSelectedJobId(jobId);
  }

  // ===================================================================
  //  Filter change handler — forwards filter changes for tree/table
  // ===================================================================

  function handleFilterChange(f: FilterState) {
    // Job selection is handled by handleSelectJob, not filter
    // Mod/group filtering is applied via the tree selection
    const next = new URLSearchParams();
    if (f.mod_id) next.set('mod_id', f.mod_id);
    if (f.group_key) next.set('group_key', f.group_key);
    if (search) next.set('q', search);
    setSearchParams(next, { replace: true });
  }

  // ===================================================================
  //  Render
  // ===================================================================

  return (
    <div>
      <div className="page-header">
        <h1>Translated Files</h1>
        <p>Browse translated output files by job</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Job list / cards */}
      <div className="card">
        <div className="card-title">
          Output Jobs
          {tree && Object.keys(tree.jobs).length > 0 && (
            <span className="tree-node-count" style={{ marginLeft: '0.5rem' }}>
              {Object.keys(tree.jobs).length}
            </span>
          )}
        </div>
        <OutputJobList
          tree={tree}
          loading={treeLoading}
          selectedJobId={selectedJobId}
          onSelectJob={handleSelectJob}
          onRefresh={handleRefresh}
          onReindex={handleReindex}
          reindexLoading={reindexLoading}
          onAnalyzeStale={handleAnalyzeStale}
          expandedGroups={outputJobExpandedGroups}
          onToggleGroup={handleToggleOutputJobGroup}
        />
      </div>

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

      {/* Files toolbar */}
      <OutputFilesToolbar
        jobId={selectedJobId}
        search={search}
        onSearchChange={syncSearch}
        onRefresh={handleRefresh}
        onReindex={handleReindex}
        reindexLoading={reindexLoading}
        reindexResult={reindexResult}
        onAnalyzeStale={handleAnalyzeStale}
        batchAnalyzing={batchAnalyzing}
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

      {/* Selected job files panel */}
      <SelectedJobFilesPanel
        selectedJobId={selectedJobId}
        tree={jobTree}
        treeLoading={jobTreeLoading}
        files={files}
        filesLoading={loading}
        fileTotal={total}
        filter={filter}
        onFilterChange={handleFilterChange}
        groupMode={groupMode}
        expandedGroups={expandedGroups}
        onToggleGroup={handleToggleGroup}
        onSelectFile={setSelectedFile}
        selectedFileId={selectedFile?.id}
        summary={summary}
        summaryLoading={summaryLoading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

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
