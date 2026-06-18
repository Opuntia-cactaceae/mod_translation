import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import type { JobModel } from '../../../domain';
import type { JobActionsApi, JobRecoveryApi } from '../../../hooks/jobs/types';
import type { JobConfigFormModel } from '../../../domain/jobConfig';
import type { TranslationOptionsResponse } from '../../../api/types';

/* ------------------------------------------------------------------ */
/*  Cleanup after each test                                            */
/* ------------------------------------------------------------------ */

afterEach(() => cleanup());

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function createJob(overrides: Partial<JobModel> = {}): JobModel {
  return {
    id: 'job-001',
    name: 'Test Job',
    status: 'running',
    filePaths: ['/game/mod/localisation/english/mod_l_english.yml'],
    config: {
      src_lang: 'english',
      dst_lang: 'russian',
      runtime: { provider: 'openai', model: 'gpt-4' },
      batch_size: 50,
      use_cache: true,
      save_raw_responses: false,
      prompt: { profile_name: 'default' },
      protection: { strategy: 'strict' },
      validation: { validator_name: 'exact' },
    },
    totalUnits: 200,
    completedUnits: 50,
    failedUnits: 3,
    cachedUnits: 10,
    progress: 25,
    createdAt: '2025-01-01T12:00:00Z',
    updatedAt: '2025-01-02T12:00:00Z',
    currentBatchIndex: 1,
    totalBatches: 4,
    diagnostics: [],
    outputFiles: [],
    ...overrides,
  };
}

function createJobActions(overrides: Partial<JobActionsApi> = {}): JobActionsApi {
  return {
    startingJobId: null,
    pausingJobId: null,
    resumingJobId: null,
    cancellingJobId: null,
    startJob: vi.fn(),
    pauseJob: vi.fn(),
    resumeJob: vi.fn(),
    cancelJob: vi.fn(),
    ...overrides,
  };
}

function createRecovery(overrides: Partial<JobRecoveryApi> = {}): JobRecoveryApi {
  return {
    restartingJobId: null,
    retryingJobId: null,
    restartJob: vi.fn(),
    retryFailedJob: vi.fn(),
    ...overrides,
  };
}

const emptyOptions: TranslationOptionsResponse = {
  providers: [],
  prompt_profiles: [],
  protection_strategies: [],
  validators: [],
};

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

interface ExpandedDetailsProps {
  job?: JobModel;
  editing?: boolean;
  editConfigForm?: Partial<JobConfigFormModel>;
  onEditConfig?: (job: JobModel) => void;
  onEditConfigFieldChange?: (field: keyof JobConfigFormModel, value: string) => void;
  onCancelEdit?: () => void;
  onSaveConfig?: () => void;
  recovery?: JobRecoveryApi;
  jobActions?: JobActionsApi;
  onRequestConfirm?: (action: 'pause' | 'cancel' | 'restart' | 'retry', job?: JobModel) => void;
  onOpenTrace?: (jobId: string) => void;
  onRefresh?: () => void;
  options?: TranslationOptionsResponse | null;
  savingConfig?: boolean;
  onRevealPath?: (path: string) => void;
}

async function renderDetails(props: ExpandedDetailsProps = {}) {
  const JobExpandedDetails = (await import('../JobExpandedDetails')).default;
  const job = props.job ?? createJob();
  const defaultProps = {
    job,
    editing: false,
    editConfigForm: {},
    onEditConfig: vi.fn(),
    onEditConfigFieldChange: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveConfig: vi.fn(),
    recovery: createRecovery(),
    jobActions: createJobActions(),
    onRequestConfirm: vi.fn(),
    onOpenTrace: vi.fn(),
    onRefresh: vi.fn(),
    options: emptyOptions,
    savingConfig: false,
    ...props,
  };
  return render(React.createElement(JobExpandedDetails, defaultProps));
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('JobExpandedDetails', () => {

  /* ------------------------------------------------------------------ */
  /*  Summary section                                                    */
  /* ------------------------------------------------------------------ */

  describe('summary grid', () => {
    it('renders summary section with job detail fields', async () => {
      await renderDetails();
      expect(screen.getByText('Job ID')).toBeTruthy();
      expect(screen.getByText('Name')).toBeTruthy();
      expect(screen.getByText('Status')).toBeTruthy();
      expect(screen.getByText('Progress')).toBeTruthy();
      expect(screen.getByText('Created')).toBeTruthy();
      expect(screen.getByText('Updated')).toBeTruthy();
      expect(screen.getByText('Total units')).toBeTruthy();
      expect(screen.getByText('Completed')).toBeTruthy();
      expect(screen.getByText('Failed')).toBeTruthy();
      expect(screen.getByText('Cached')).toBeTruthy();
      expect(screen.getByText('Batch')).toBeTruthy();
    });

    it('displays job id and name in summary', async () => {
      await renderDetails();
      expect(screen.getByText('job-001')).toBeTruthy();
      expect(screen.getByText('Test Job')).toBeTruthy();
    });

    it('displays progress percentage', async () => {
      await renderDetails({ job: createJob({ progress: 25 }) });
      expect(screen.getByText('25.0%')).toBeTruthy();
    });

    it('displays unit counts', async () => {
      await renderDetails();
      expect(screen.getByText('200')).toBeTruthy();  // total
      // "50" appears in summary (completed) and config (batch_size)
      const fifties = screen.getAllByText('50');
      expect(fifties.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('3')).toBeTruthy();    // failed
      expect(screen.getByText('10')).toBeTruthy();   // cached
    });

    it('displays batch info', async () => {
      await renderDetails();
      expect(screen.getByText('1 / 4')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  No units warning                                                   */
  /* ------------------------------------------------------------------ */

  describe('no units warning', () => {
    it('shows warning when totalUnits is 0 and files exist', async () => {
      const job = createJob({ totalUnits: 0, filePaths: ['/file.yml'] });
      await renderDetails({ job });
      expect(screen.getByText('No translation units found.')).toBeTruthy();
    });

    it('does not show warning when totalUnits > 0', async () => {
      const job = createJob({ totalUnits: 100 });
      await renderDetails({ job });
      expect(screen.queryByText('No translation units found.')).toBeNull();
    });

    it('does not show warning when filePaths is empty', async () => {
      const job = createJob({ totalUnits: 0, filePaths: [] });
      await renderDetails({ job });
      expect(screen.queryByText('No translation units found.')).toBeNull();
    });

    it('references diagnostics section when relevant diagnostic codes exist', async () => {
      const job = createJob({
        totalUnits: 0,
        filePaths: ['/file.yml'],
        diagnostics: [{ level: 'warning', message: 'No units', code: 'NO_TRANSLATABLE_UNITS' }],
      });
      await renderDetails({ job });
      // "Diagnostics" appears as both section title and in warning hint text
      const diagTexts = screen.getAllByText(/Diagnostics/);
      expect(diagTexts.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Source files section                                               */
  /* ------------------------------------------------------------------ */

  describe('source files section', () => {
    it('renders section title', async () => {
      await renderDetails();
      expect(screen.getByText('Source Files')).toBeTruthy();
    });

    it('displays file paths', async () => {
      const job = createJob({ filePaths: ['/path/to/file1.yml', '/path/to/file2.yml'] });
      await renderDetails({ job });
      expect(screen.getByText('/path/to/file1.yml')).toBeTruthy();
      expect(screen.getByText('/path/to/file2.yml')).toBeTruthy();
    });

    it('shows "No files" when filePaths is empty', async () => {
      const job = createJob({ filePaths: [] });
      await renderDetails({ job });
      expect(screen.getByText('No files')).toBeTruthy();
    });

    it('renders Open folder button when onRevealPath is provided', async () => {
      const onRevealPath = vi.fn();
      await renderDetails({ onRevealPath });
      const buttons = screen.getAllByText('Open folder');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('does not show Open folder when onRevealPath is undefined', async () => {
      await renderDetails({ onRevealPath: undefined });
      expect(screen.queryByText('Open folder')).toBeNull();
    });

    it('calls onRevealPath when Open folder is clicked', async () => {
      const onRevealPath = vi.fn();
      await renderDetails({ onRevealPath });
      fireEvent.click(screen.getByText('Open folder'));
      expect(onRevealPath).toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Config section — read-only mode                                    */
  /* ------------------------------------------------------------------ */

  describe('config section read-only', () => {
    it('renders section title', async () => {
      await renderDetails();
      expect(screen.getByText('Translation Config')).toBeTruthy();
    });

    it('displays config field labels', async () => {
      await renderDetails();
      expect(screen.getByText('Source Language')).toBeTruthy();
      expect(screen.getByText('Target Language')).toBeTruthy();
      expect(screen.getByText('Provider')).toBeTruthy();
      expect(screen.getByText('Model')).toBeTruthy();
      expect(screen.getByText('Batch Size')).toBeTruthy();
      expect(screen.getByText('Use Cache')).toBeTruthy();
      expect(screen.getByText('Save Raw Responses')).toBeTruthy();
      expect(screen.getByText('Prompt Profile')).toBeTruthy();
      expect(screen.getByText('Protection')).toBeTruthy();
      expect(screen.getByText('Validator')).toBeTruthy();
    });

    it('displays config values from job.config', async () => {
      await renderDetails();
      expect(screen.getByText('english')).toBeTruthy();
      expect(screen.getByText('russian')).toBeTruthy();
      expect(screen.getByText('openai')).toBeTruthy();
      expect(screen.getByText('gpt-4')).toBeTruthy();
      expect(screen.getByText('Yes')).toBeTruthy();  // use_cache
      expect(screen.getByText('No')).toBeTruthy();   // save_raw_responses
    });

    it('shows Edit config button for pending job', async () => {
      const job = createJob({ status: 'pending' });
      await renderDetails({ job });
      expect(screen.getByText('Edit config')).toBeTruthy();
    });

    it('shows Edit config button for paused job', async () => {
      const job = createJob({ status: 'paused' });
      await renderDetails({ job });
      expect(screen.getByText('Edit config')).toBeTruthy();
    });

    it('hides Edit config button for non-editable statuses', async () => {
      const job = createJob({ status: 'running' });
      await renderDetails({ job });
      expect(screen.queryByText('Edit config')).toBeNull();
    });

    it('calls onEditConfig when Edit config is clicked', async () => {
      const onEditConfig = vi.fn();
      const job = createJob({ status: 'pending' });
      await renderDetails({ job, onEditConfig });
      fireEvent.click(screen.getByText('Edit config'));
      expect(onEditConfig).toHaveBeenCalledWith(job);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Config section — edit mode                                         */
  /* ------------------------------------------------------------------ */

  describe('config section edit mode', () => {
    it('renders read-only fields for source/target/provider', async () => {
      await renderDetails({ editing: true });
      expect(screen.getByDisplayValue('english')).toBeTruthy();
      expect(screen.getByDisplayValue('russian')).toBeTruthy();
      expect(screen.getByDisplayValue('openai')).toBeTruthy();
    });

    it('renders editable model input', async () => {
      const editConfigForm = { model: 'gpt-4-turbo' } as Partial<JobConfigFormModel>;
      await renderDetails({ editing: true, editConfigForm });
      const modelInput = screen.getByDisplayValue('gpt-4-turbo') as HTMLInputElement;
      expect(modelInput).toBeTruthy();
      expect(modelInput.tagName).toBe('INPUT');
    });

    it('calls onEditConfigFieldChange when model field changes', async () => {
      const onEditConfigFieldChange = vi.fn();
      await renderDetails({ editing: true, onEditConfigFieldChange });
      const modelInput = screen.getByPlaceholderText('e.g. gpt-4');
      fireEvent.change(modelInput, { target: { value: 'gpt-5' } });
      expect(onEditConfigFieldChange).toHaveBeenCalledWith('model', 'gpt-5');
    });

    it('renders Save Config and Cancel buttons', async () => {
      const job = createJob({ status: 'pending' });
      await renderDetails({ job, editing: true });
      expect(screen.getByText('Save Config')).toBeTruthy();
      // Cancel also appears in Actions section (Start + Cancel for pending jobs),
      // so use getAllByText to confirm at least one exists
      const cancelButtons = screen.getAllByText('Cancel');
      expect(cancelButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('calls onSaveConfig when Save Config is clicked', async () => {
      const onSaveConfig = vi.fn();
      await renderDetails({ editing: true, onSaveConfig });
      fireEvent.click(screen.getByText('Save Config'));
      expect(onSaveConfig).toHaveBeenCalledOnce();
    });

    it('calls onCancelEdit when Cancel is clicked', async () => {
      const onCancelEdit = vi.fn();
      const job = createJob({ status: 'pending' });
      await renderDetails({ job, editing: true, onCancelEdit });
      // Scope Cancel click to the config section — there's also a Cancel button
      // in the Actions section (Start + Cancel for pending jobs)
      const saveConfigBtn = screen.getByText('Save Config');
      const configActions = saveConfigBtn.closest('.job-detail-actions') as HTMLElement;
      fireEvent.click(within(configActions).getByText('Cancel'));
      expect(onCancelEdit).toHaveBeenCalledOnce();
    });

    it('shows "Saving..." and disables buttons when saving', async () => {
      await renderDetails({ editing: true, savingConfig: true });
      expect(screen.getByText('Saving...')).toBeTruthy();
      expect(screen.getByText('Saving...')).toBeInstanceOf(HTMLButtonElement);
      expect((screen.getByText('Saving...') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Diagnostics section                                                */
  /* ------------------------------------------------------------------ */

  describe('diagnostics section', () => {
    it('renders nothing when diagnostics array is empty', async () => {
      const job = createJob({ diagnostics: [] });
      const { container } = await renderDetails({ job });
      // The title should not be present in the DOM
      const titles = container.querySelectorAll('.job-detail-section-title');
      const diagTitles = Array.from(titles).filter(el => el.textContent === 'Diagnostics');
      expect(diagTitles.length).toBe(0);
    });

    it('renders diagnostics section with messages', async () => {
      const diagnostics = [
        { level: 'warning', message: 'Low disk space', code: 'LOW_DISK' },
      ];
      const job = createJob({ diagnostics });
      await renderDetails({ job });
      expect(screen.getByText('Diagnostics')).toBeTruthy();
      expect(screen.getByText('Low disk space')).toBeTruthy();
    });

    it('renders multiple diagnostic messages', async () => {
      const diagnostics = [
        { level: 'warning', message: 'Low disk space', code: 'LOW_DISK' },
        { level: 'error', message: 'Config missing', code: 'MISSING_CONFIG' },
      ];
      const job = createJob({ diagnostics });
      await renderDetails({ job });
      expect(screen.getByText('Low disk space')).toBeTruthy();
      expect(screen.getByText('Config missing')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Actions section                                                    */
  /* ------------------------------------------------------------------ */

  describe('actions section', () => {
    it('renders actions section title', async () => {
      await renderDetails();
      expect(screen.getByText('Actions')).toBeTruthy();
    });

    it('shows Start button for pending job', async () => {
      const job = createJob({ status: 'pending' });
      await renderDetails({ job });
      expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    });

    it('shows Pause and Cancel for running job', async () => {
      const job = createJob({ status: 'running' });
      await renderDetails({ job });
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('shows Resume and Cancel for paused job', async () => {
      const job = createJob({ status: 'paused' });
      await renderDetails({ job });
      expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('shows Refresh and Open trace buttons always', async () => {
      await renderDetails();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open trace' })).toBeTruthy();
    });

    it('shows Restart job button for completed job', async () => {
      const job = createJob({ status: 'completed' });
      await renderDetails({ job });
      expect(screen.getByRole('button', { name: 'Restart job' })).toBeTruthy();
    });

    it('calls jobActions.startJob when Start is clicked', async () => {
      const startJob = vi.fn();
      const job = createJob({ status: 'pending' });
      await renderDetails({ job, jobActions: createJobActions({ startJob }) });
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      expect(startJob).toHaveBeenCalledWith(job);
    });

    it('calls onRequestConfirm("pause") when Pause is clicked', async () => {
      const onRequestConfirm = vi.fn();
      const job = createJob({ status: 'running' });
      await renderDetails({ job, onRequestConfirm });
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(onRequestConfirm).toHaveBeenCalledWith('pause', job);
    });

    it('calls onRequestConfirm("cancel") when Cancel is clicked on running job', async () => {
      const onRequestConfirm = vi.fn();
      const job = createJob({ status: 'running' });
      await renderDetails({ job, onRequestConfirm });
      const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButtons[0]);
      expect(onRequestConfirm).toHaveBeenCalledWith('cancel', job);
    });

    it('calls jobActions.resumeJob when Resume is clicked', async () => {
      const resumeJob = vi.fn();
      const job = createJob({ status: 'paused' });
      await renderDetails({ job, jobActions: createJobActions({ resumeJob }) });
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      expect(resumeJob).toHaveBeenCalledWith(job);
    });

    it('calls onRefresh when Refresh is clicked', async () => {
      const onRefresh = vi.fn();
      await renderDetails({ onRefresh });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('calls onOpenTrace when Open trace is clicked', async () => {
      const onOpenTrace = vi.fn();
      await renderDetails({ onOpenTrace });
      fireEvent.click(screen.getByRole('button', { name: 'Open trace' }));
      expect(onOpenTrace).toHaveBeenCalledWith('job-001');
    });

    it('shows Retry failed units button for failed job with failed units', async () => {
      const job = createJob({ status: 'failed', failedUnits: 5 });
      await renderDetails({ job });
      expect(screen.getByRole('button', { name: 'Retry failed units' })).toBeTruthy();
    });

    it('does not show Retry failed units when no failed units', async () => {
      const job = createJob({ status: 'failed', failedUnits: 0 });
      await renderDetails({ job });
      expect(screen.queryByRole('button', { name: 'Retry failed units' })).toBeNull();
    });

    it('shows help text for recoverable job states', async () => {
      const job = createJob({ status: 'failed', failedUnits: 3 });
      await renderDetails({ job });
      expect(screen.getByText(/Restart job creates a full rerun/)).toBeTruthy();
      expect(screen.getByText(/Retry failed units reuses successful/)).toBeTruthy();
    });

    it('hides help text for non-recoverable job states', async () => {
      const job = createJob({ status: 'running' });
      await renderDetails({ job });
      expect(screen.queryByText(/Restart job creates a full rerun/)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Error message block                                                */
  /* ------------------------------------------------------------------ */

  describe('error message block', () => {
    it('renders error message when job has errorMessage', async () => {
      const job = createJob({ errorMessage: 'Job failed with error' });
      await renderDetails({ job });
      expect(screen.getByText('Job failed with error')).toBeTruthy();
    });

    it('does not render error message when errorMessage is absent', async () => {
      const job = createJob({ errorMessage: undefined });
      await renderDetails({ job });
      expect(screen.queryByText('Job failed with error')).toBeNull();
    });
  });
});
