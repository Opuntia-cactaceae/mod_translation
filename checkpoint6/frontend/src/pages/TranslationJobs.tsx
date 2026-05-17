import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, useToast } from '../App';
import type { TranslationOptionsResponse, TranslationProfile, GameOption, FileHandlerOption } from '../api/types';
import {
  canStartJob, canPauseJob, canResumeJob,
  canCancelJob,
  isJobTerminal,
  mapJobResponse,
  mergeJobSummaries,
  type JobModel,
} from '../domain';
import { STORAGE_KEYS, LEGACY_KEYS } from '../utils/storageKeys';
import ProfileEditorModal from '../components/profiles/ProfileEditorModal';
import TracePanel from '../components/jobs/TracePanel';
import JobsTable from '../components/jobs/JobsTable';
import CreateJobForm from '../components/jobs/CreateJobForm';
import { useJobActions } from '../hooks/jobs/useJobActions';
import { useBulkJobActions } from '../hooks/jobs/useBulkJobActions';
import { useJobRecovery } from '../hooks/jobs/useJobRecovery';
import { useCreateJobForm } from '../hooks/jobs/useCreateJobForm';

import { useJobFilters } from '../hooks/jobs/useJobFilters';
import { useExpandedJobs } from '../hooks/jobs/useExpandedJobs';
import { useJobConfigEditing } from '../hooks/jobs/useJobConfigEditing';
import { useConfirmationDialog, type ConfirmActionType } from '../hooks/jobs/useConfirmationDialog';
import { useTraceSelection } from '../hooks/jobs/useTraceSelection';
import { ConfirmDialog } from '../components/common/ConfirmDialog';

/* ------------------------------------------------------------------ */
/*  Confirm dialog helpers                                             */
/* ------------------------------------------------------------------ */

function getConfirmTitle(action: ConfirmActionType | null): string {
  switch (action) {
    case 'pause':       return 'Pause Job';
    case 'cancel':      return 'Cancel Job';
    case 'restart':     return 'Restart Job';
    case 'retry':       return 'Retry Job';
    case 'bulk_pause':  return 'Pause All Jobs';
    case 'bulk_cancel': return 'Cancel All Jobs';
    default:            return 'Confirm action';
  }
}

function getConfirmMessage(action: ConfirmActionType | null, count?: number): string {
  switch (action) {
    case 'pause':
      return 'Pause this job? The job can be resumed later.';
    case 'cancel':
      return 'Cancel this job? In-progress batches will be abandoned.';
    case 'restart':
      return 'Create and start a new job with the same files and config? This creates a new job (full rerun).';
    case 'retry':
      return 'Create a new job that retries only the failed units? Successful/cached units from the original job will be preserved in the output.';
    case 'bulk_cancel':
      return `Cancel ${count} job${count !== 1 ? 's' : ''}? In-progress batches will be abandoned.`;
    case 'bulk_pause':
      return `Pause ${count} running job${count !== 1 ? 's' : ''}? They can be resumed later.`;
    default:
      return '';
  }
}

function getConfirmClass(action: ConfirmActionType | null): string {
  switch (action) {
    case 'cancel':
    case 'bulk_cancel':
      return 'btn btn-danger';
    default:
      return 'btn btn-primary';
  }
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function TranslationJobs() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // --- Toast wrapper with broader type for hooks ---
  const showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void = (message, type) => {
    toast.showToast(message, type as 'success' | 'error' | undefined);
  };

  // ===================================================================
  //  Hooks — state + logic composition
  // ===================================================================

  // --- Jobs list ---
  const [jobs, setJobs] = useState<JobModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Options (shared: form provider dropdown + JobsTable config editing) ---
  const [options, setOptions] = useState<TranslationOptionsResponse | null>(null);

  // --- Translation Profiles ---
  const [profiles, setProfiles] = useState<TranslationProfile[]>([]);

  // --- Profile editor modal ---
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileEditorInitialConfig, setProfileEditorInitialConfig] = useState<Record<string, unknown> | undefined>(undefined);

  // --- Game options (for profile editor) ---
  const [gameOptions, setGameOptions] = useState<GameOption[]>([]);
  const [fileHandlerOptions, setFileHandlerOptions] = useState<FileHandlerOption[]>([]);
  const [gameOptionsLoaded, setGameOptionsLoaded] = useState(false);

  // --- Filters ---
  const jobFilters = useJobFilters(jobs, {
    storageKey: STORAGE_KEYS.jobsFilters,
    legacyKeys: [LEGACY_KEYS[STORAGE_KEYS.jobsFilters]],
  });

  // --- Trace (declared first; used by createJobForm / jobActions / recovery) ---
  const traceSelection = useTraceSelection();
  const { selectedJobId, openTrace, closeTrace, setSelectedJobId } = traceSelection;

  // --- Create-job form (uses createFlow internally) ---
  const createJobForm = useCreateJobForm({
    showToast,
    loadJobs,
    selectJob: setSelectedJobId,
    profiles,
  });

  // --- Expanded rows ---
  const configEditing = useJobConfigEditing({ showToast, reloadJobs: loadJobs });
  const expanded = useExpandedJobs({
    onCollapse: (jobId) => {
      if (configEditing.editingJobId === jobId) {
        configEditing.cancelEdit();
      }
    },
  });

  // --- Confirmation dialog ---
  const bulkActions = useBulkJobActions({ jobs, reloadJobs: loadJobs, showToast });
  const jobActions = useJobActions({ reloadJobs: loadJobs, selectJob: setSelectedJobId, showToast });
  const recovery = useJobRecovery({ reloadJobs: loadJobs, selectJob: setSelectedJobId, showToast });
  const confirmation = useConfirmationDialog({ jobs, jobActions, bulkActions, recovery });

  // ===================================================================
  //  Data loading (page-level; form data loaded by useCreateJobForm)
  // ===================================================================

  async function loadJobs() {
    try {
      const j = await api.listJobs();
      setJobs(j.map(mapJobResponse));
      setError(null);

      const navState = location.state as { selectedJobId?: string } | null;
      if (navState?.selectedJobId) {
        setSelectedJobId(navState.selectedJobId);
        window.history.replaceState({}, document.title);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
    api.getTranslationOptions()
      .then(setOptions)
      .catch(() => {});

    api.listProfiles()
      .then(res => setProfiles(res.profiles))
      .catch(() => {});

    api.getGameOptions()
      .then(res => {
        setGameOptions(res.games);
        setFileHandlerOptions(res.file_handlers);
        setGameOptionsLoaded(true);
      })
      .catch(() => {});
  }, []);

  // Auto-refresh jobs list via lightweight summary endpoint while any job is running
  const loadJobsRef = useRef(loadJobs);
  loadJobsRef.current = loadJobs;

  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'running');
    if (!hasRunning) return;

    const interval = setInterval(async () => {
      try {
        const { jobs: summaries } = await api.getJobsSummary();

        // Check if any previously non-terminal job became terminal
        const needsFullReload = summaries.some(s => {
          const prev = jobs.find(p => p.id === s.id);
          return prev ? !isJobTerminal(prev) && isJobTerminal(s) : false;
        });

        setJobs(prev => mergeJobSummaries(prev, summaries));

        // Full reload picks up output/diagnostics/result_summary for terminal jobs
        if (needsFullReload) {
          loadJobsRef.current();
        }
      } catch {
        // Polling errors are non-fatal — just skip this cycle
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs]);

  // ===================================================================
  //  Handlers
  // ===================================================================

  function handleTableRequestConfirm(action: 'pause' | 'cancel' | 'restart' | 'retry', job?: JobModel) {
    confirmation.requestConfirm(action, job ? { jobId: job.id } : undefined);
  }

  async function handleRevealPath(path: string) {
    try {
      const res = await api.revealPath({ path });
      if (!res.success) toast.showToast(res.message, 'error');
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to open folder', 'error');
    }
  }

  function handleOpenEditor(filePath: string) {
    navigate(`/editor?filePath=${encodeURIComponent(filePath)}`);
  }

  function handleViewTranslatedFiles(jobId: string) {
    navigate(`/translated-files?job_id=${encodeURIComponent(jobId)}`);
  }

  function handleOpenProfileEditor(config: Record<string, unknown>) {
    setProfileEditorInitialConfig(config);
    setProfileEditorOpen(true);
  }

  // ===================================================================
  //  Render
  // ===================================================================

  if (loading) return <div className="loading"><span className="spinner" /> Loading jobs...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Translation Jobs</h1>
        <p>Create, run, and monitor translation jobs</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <CreateJobForm
        vm={createJobForm}
        options={options}
        profiles={profiles}
        onOpenProfileEditor={handleOpenProfileEditor}
      />

      {/* Active Jobs */}
      <div className="card">
        <div className="card-title">Jobs ({jobs.length})</div>

        {/* Filter / Search / Bulk Actions Panel */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}>
          <input
            className="form-control"
            style={{ flex: '1 1 200px', minWidth: 0 }}
            placeholder="Search jobs by name or id"
            value={jobFilters.filters.search}
            onChange={e => jobFilters.setSearch(e.target.value)}
          />
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 120 }}
            value={jobFilters.filters.status}
            onChange={e => jobFilters.setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm"
              onClick={() => confirmation.requestConfirm('bulk_pause', { count: jobs.filter(canPauseJob).length })}
              disabled={bulkActions.bulkActionRunning}
            >
              {bulkActions.bulkActionRunning ? '...' : 'Pause all'}
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => bulkActions.resumeAll()}
              disabled={bulkActions.bulkActionRunning}
            >
              {bulkActions.bulkActionRunning ? '...' : 'Resume all'}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => confirmation.requestConfirm('bulk_cancel', { count: jobs.filter(canCancelJob).length })}
              disabled={bulkActions.bulkActionRunning}
            >
              {bulkActions.bulkActionRunning ? '...' : 'Cancel all'}
            </button>
          </div>
        </div>

        <JobsTable
          jobs={jobs}
          filteredJobs={jobFilters.filteredJobs}
          expandedJobs={expanded.expandedJobs}
          editingJobId={configEditing.editingJobId}
          onToggleExpanded={expanded.toggleJobExpand}
          onOpenTrace={openTrace}
          onEditConfig={configEditing.startEditing}
          onEditConfigFieldChange={configEditing.updateField}
          onCancelEdit={configEditing.cancelEdit}
          onSaveConfig={() => { if (configEditing.editingJobId) configEditing.saveConfig(configEditing.editingJobId); }}
          editConfigForm={configEditing.editConfigForm}
          jobActions={jobActions}
          recovery={recovery}
          onRequestConfirm={handleTableRequestConfirm}
          onRefresh={loadJobs}
          onRevealPath={handleRevealPath}
          onOpenEditor={handleOpenEditor}
          onViewTranslatedFiles={handleViewTranslatedFiles}
          options={options}
          savingConfig={configEditing.savingConfig}
        />
      </div>

      {/* Trace panel for selected job */}
      {selectedJobId && (
        <TracePanel
          jobId={selectedJobId}
          jobName={jobs.find(j => j.id === selectedJobId)?.name}
          onClose={closeTrace}
        />
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmation.confirmAction !== null}
        title={getConfirmTitle(confirmation.confirmAction?.action ?? null)}
        message={getConfirmMessage(confirmation.confirmAction?.action ?? null, confirmation.confirmAction?.count)}
        confirmLabel="Confirm"
        confirmClass={getConfirmClass(confirmation.confirmAction?.action ?? null)}
        cancelLabel="Cancel"
        onConfirm={confirmation.handleConfirm}
        onCancel={confirmation.clearConfirm}
      />

      {/* Profile editor modal */}
      <ProfileEditorModal
        open={profileEditorOpen}
        mode="create"
        initialConfig={profileEditorInitialConfig}
        gameOptions={gameOptions}
        handlerOptions={fileHandlerOptions}
        translationOptions={options}
        onClose={() => {
          setProfileEditorOpen(false);
          setProfileEditorInitialConfig(undefined);
        }}
        onSaved={(profile) => {
          setProfiles(prev => [...prev, profile]);
          createJobForm.selectProfileDirect(profile.id);
          setProfileEditorOpen(false);
          setProfileEditorInitialConfig(undefined);
        }}
      />
    </div>
  );
}
