import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { JobModel } from '../../../domain';
import type { JobActionsApi, JobRecoveryApi } from '../../../hooks/jobs/types';
import type { JobConfigFormModel } from '../../../domain/jobConfig';

/* ------------------------------------------------------------------ */
/*  Cleanup after each test                                            */
/* ------------------------------------------------------------------ */

afterEach(() => cleanup());

/* ------------------------------------------------------------------ */
/*  Mock JobExpandedDetails — keeps JobsTable tests focused on table   */
/* ------------------------------------------------------------------ */

vi.mock('../JobExpandedDetails', () => ({
  default: function MockJobExpandedDetails() {
    return React.createElement('div', { className: 'mock-expanded' }, 'Expanded details');
  },
}));

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

function createJob(overrides: Partial<JobModel> = {}): JobModel {
  return {
    id: 'job-001',
    name: 'Test Job',
    status: 'pending',
    filePaths: ['/path/to/file.yml'],
    config: { src_lang: 'english', dst_lang: 'russian' },
    totalUnits: 100,
    completedUnits: 0,
    failedUnits: 0,
    cachedUnits: 0,
    progress: 0,
    createdAt: '2025-01-01T12:00:00Z',
    updatedAt: '2025-01-01T12:00:00Z',
    currentBatchIndex: 0,
    totalBatches: 1,
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

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

interface JobsTableProps {
  jobs?: JobModel[];
  filteredJobs?: JobModel[];
  expandedJobs?: Record<string, boolean>;
  expandedGroups?: Record<string, boolean>;
  onToggleGroup?: (groupKey: string) => void;
  editingJobId?: string | null;
  onToggleExpanded?: (jobId: string) => void;
  onOpenTrace?: (jobId: string) => void;
  onEditConfig?: (job: JobModel) => void;
  onEditConfigFieldChange?: (field: keyof JobConfigFormModel, value: string) => void;
  onCancelEdit?: () => void;
  onSaveConfig?: () => void;
  editConfigForm?: Partial<JobConfigFormModel>;
  jobActions?: JobActionsApi;
  recovery?: JobRecoveryApi;
  onRequestConfirm?: (action: 'pause' | 'cancel' | 'restart' | 'retry', job?: JobModel) => void;
  onRefresh?: () => void;
  savingConfig?: boolean;
  groupBy?: 'none' | 'status' | 'date';
  // Backward compat props (testing they still work)
  expandedDateGroups?: Record<string, boolean>;
  onToggleDateGroup?: (bucketKey: string) => void;
  onViewTranslatedFiles?: (jobId: string) => void;
}

async function renderTable(props: JobsTableProps = {}) {
  const JobsTable = (await import('../JobsTable')).default;
  const defaultProps = {
    jobs: [createJob()],
    filteredJobs: [createJob()],
    expandedJobs: {},
    onToggleExpanded: vi.fn(),
    onOpenTrace: vi.fn(),
    onEditConfig: vi.fn(),
    onEditConfigFieldChange: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveConfig: vi.fn(),
    editConfigForm: {},
    jobActions: createJobActions(),
    recovery: createRecovery(),
    onRequestConfirm: vi.fn(),
    onRefresh: vi.fn(),
    ...props,
  };
  return render(React.createElement(JobsTable, defaultProps));
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('JobsTable', () => {

  /* ------------------------------------------------------------------ */
  /*  Empty state                                                        */
  /* ------------------------------------------------------------------ */

  describe('empty state', () => {
    it('shows "No jobs yet" when jobs array is empty', async () => {
      await renderTable({ jobs: [], filteredJobs: [] });
      expect(screen.getByText('No jobs yet')).toBeTruthy();
    });

    it('does not render table when jobs array is empty', async () => {
      await renderTable({ jobs: [], filteredJobs: [] });
      expect(screen.queryByRole('table')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Summary text                                                       */
  /* ------------------------------------------------------------------ */

  describe('summary text', () => {
    it('shows "Showing X of Y jobs" when filtered < total', async () => {
      const job1 = createJob({ id: 'job-001', name: 'Job A' });
      const job2 = createJob({ id: 'job-002', name: 'Job B' });
      await renderTable({
        jobs: [job1, job2],
        filteredJobs: [job1],
      });
      expect(screen.getByText('Showing 1 of 2 jobs')).toBeTruthy();
    });

    it('does not show summary when filteredJobs length equals jobs length', async () => {
      const job = createJob();
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
      });
      expect(screen.queryByText(/Showing/)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Table structure                                                    */
  /* ------------------------------------------------------------------ */

  describe('table structure', () => {
    it('renders table headers', async () => {
      await renderTable();
      expect(screen.getByText('ID')).toBeTruthy();
      expect(screen.getByText('Name')).toBeTruthy();
      expect(screen.getByText('Status')).toBeTruthy();
      expect(screen.getByText('Progress')).toBeTruthy();
      expect(screen.getByText('Units')).toBeTruthy();
      expect(screen.getByText('Created')).toBeTruthy();
      expect(screen.getByText('Actions')).toBeTruthy();
    });

    it('renders job row with id slice, name and created date', async () => {
      const job = createJob({ id: 'abc-def-123', name: 'My Translation' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      // First 8 chars of id
      expect(screen.getByText('abc-def-')).toBeTruthy();
      expect(screen.getByText('My Translation')).toBeTruthy();
    });

    it('shows em dash for unnamed job', async () => {
      const job = createJob({ name: '' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText('\u2014')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Status badge                                                       */
  /* ------------------------------------------------------------------ */

  describe('status badge', () => {
    const statusCases: Array<{ status: JobModel['status']; label: string; badgeClass: string }> = [
      { status: 'pending',    label: 'Pending',   badgeClass: 'badge-muted' },
      { status: 'running',    label: 'Running',   badgeClass: 'badge-info' },
      { status: 'pausing',    label: 'Pausing',   badgeClass: 'badge-warning' },
      { status: 'paused',     label: 'Paused',    badgeClass: 'badge-warning' },
      { status: 'completed',  label: 'Completed', badgeClass: 'badge-success' },
      { status: 'failed',     label: 'Failed',    badgeClass: 'badge-error' },
      { status: 'cancelled',  label: 'Cancelled', badgeClass: 'badge-error' },
    ];

    statusCases.forEach(({ status, label }) => {
      it(`shows "${label}" for ${status} status`, async () => {
        const job = createJob({ status });
        await renderTable({ jobs: [job], filteredJobs: [job] });
        // "Failed" may appear twice (status badge + action badge), use getAllByText
        const matcher = label === 'Failed' ? screen.getAllByText(label) : [screen.getByText(label)];
        expect(matcher.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Progress bar and percent                                           */
  /* ------------------------------------------------------------------ */

  describe('progress display', () => {
    it('renders progress percentage', async () => {
      const job = createJob({ progress: 42.5 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      // toFixed(0) rounds 42.5 → '43'
      expect(screen.getByText('43%')).toBeTruthy();
    });

    it('renders 0% when progress is zero', async () => {
      const job = createJob({ progress: 0 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText('0%')).toBeTruthy();
    });

    it('renders 100% when progress is complete', async () => {
      const job = createJob({ progress: 100 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText('100%')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Units display                                                      */
  /* ------------------------------------------------------------------ */

  describe('units display', () => {
    it('shows processed/total = (completed+failed+cached)/total', async () => {
      const job = createJob({ completedUnits: 30, failedUnits: 0, cachedUnits: 0, totalUnits: 100 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText('30/100')).toBeTruthy();
    });

    it('includes failed units in numerator', async () => {
      const job = createJob({ completedUnits: 50, totalUnits: 100, failedUnits: 5 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      // processed = 50 + 5 + 0 = 55
      expect(screen.getByText('55/100')).toBeTruthy();
      expect(screen.getByText('5 failed', { exact: false })).toBeTruthy();
    });

    it('shows breakdown when all three categories present', async () => {
      const job = createJob({ completedUnits: 20, failedUnits: 5, cachedUnits: 15, totalUnits: 100 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      // processed = 20 + 5 + 15 = 40
      expect(screen.getByText('40/100')).toBeTruthy();
      expect(screen.getByText('20 translated', { exact: false })).toBeTruthy();
      expect(screen.getByText('15 cached', { exact: false })).toBeTruthy();
      expect(screen.getByText('5 failed', { exact: false })).toBeTruthy();
    });

    it('works when all units are cached', async () => {
      const job = createJob({ completedUnits: 0, failedUnits: 0, cachedUnits: 445, totalUnits: 445 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText('445/445')).toBeTruthy();
      expect(screen.getByText('445 cached', { exact: false })).toBeTruthy();
    });

    it('works when all units failed (no success)', async () => {
      const job = createJob({ completedUnits: 0, failedUnits: 163, cachedUnits: 1, totalUnits: 164 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      // processed = 0 + 163 + 1 = 164
      expect(screen.getByText('164/164')).toBeTruthy();
      expect(screen.getByText('1 cached', { exact: false })).toBeTruthy();
      expect(screen.getByText('163 failed', { exact: false })).toBeTruthy();
    });

    it('shows "No units" badge when totalUnits is 0 but files exist', async () => {
      const job = createJob({ totalUnits: 0, completedUnits: 0, filePaths: ['/some/file.yml'] });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByTitle('No translation units found. Check file format or language header.')).toBeTruthy();
    });

    it('does not show "No units" when totalUnits is 0 and no files', async () => {
      const job = createJob({ totalUnits: 0, completedUnits: 0, filePaths: [] });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.queryByText('No units')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Expand / collapse                                                  */
  /* ------------------------------------------------------------------ */

  describe('expand/collapse', () => {
    it('renders expand toggle buttons', async () => {
      const job = createJob();
      await renderTable({ jobs: [job], filteredJobs: [job] });
      const toggles = screen.getAllByTitle('Expand');
      expect(toggles.length).toBe(1);
    });

    it('calls onToggleExpanded when expand button is clicked', async () => {
      const onToggleExpanded = vi.fn();
      const job = createJob();
      await renderTable({ jobs: [job], filteredJobs: [job], onToggleExpanded });
      fireEvent.click(screen.getByTitle('Expand'));
      expect(onToggleExpanded).toHaveBeenCalledWith('job-001');
    });

    it('shows expanded details when job is expanded', async () => {
      const job = createJob();
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        expandedJobs: { 'job-001': true },
      });
      expect(screen.getByText('Expanded details')).toBeTruthy();
    });

    it('does not show expanded details when collapsed', async () => {
      const job = createJob();
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        expandedJobs: {},
      });
      expect(screen.queryByText('Expanded details')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Action buttons — Start / Pause / Cancel / Resume                   */
  /* ------------------------------------------------------------------ */

  describe('action buttons per status', () => {
    it('shows Start button for pending job', async () => {
      const job = createJob({ status: 'pending' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    });

    it('calls jobActions.startJob when Start is clicked', async () => {
      const startJob = vi.fn();
      const job = createJob({ status: 'pending' });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        jobActions: createJobActions({ startJob }),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      expect(startJob).toHaveBeenCalledWith(job);
    });

    it('shows Pause and Cancel for running job', async () => {
      const job = createJob({ status: 'running' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('calls onRequestConfirm("pause") when Pause is clicked on running job', async () => {
      const onRequestConfirm = vi.fn();
      const job = createJob({ status: 'running' });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        onRequestConfirm,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(onRequestConfirm).toHaveBeenCalledWith('pause', job);
    });

    it('calls onRequestConfirm("cancel") when Cancel is clicked on running job', async () => {
      const onRequestConfirm = vi.fn();
      const job = createJob({ status: 'running' });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        onRequestConfirm,
      });
      const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButtons[0]);
      expect(onRequestConfirm).toHaveBeenCalledWith('cancel', job);
    });

    it('shows Resume and Cancel for paused job', async () => {
      const job = createJob({ status: 'paused' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('calls jobActions.resumeJob when Resume is clicked', async () => {
      const resumeJob = vi.fn();
      const job = createJob({ status: 'paused' });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        jobActions: createJobActions({ resumeJob }),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      expect(resumeJob).toHaveBeenCalledWith(job);
    });

    it('shows Done badge for completed job (no action buttons)', async () => {
      const job = createJob({ status: 'completed' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText('Done')).toBeTruthy();
    });

    it('shows View files button for completed job and calls onViewTranslatedFiles with full job.id', async () => {
      const onViewTranslatedFiles = vi.fn();
      const fullJobId = '5b70cacb-1234-5678-abcd-ef0123456789';
      const job = createJob({ id: fullJobId, status: 'completed' });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        onViewTranslatedFiles,
      });

      const viewFilesBtn = screen.getByRole('button', { name: 'View files' });
      expect(viewFilesBtn).toBeTruthy();

      fireEvent.click(viewFilesBtn);

      // Must pass the full job.id, not a truncated/short version
      expect(onViewTranslatedFiles).toHaveBeenCalledWith(fullJobId);
      expect(onViewTranslatedFiles).not.toHaveBeenCalledWith(fullJobId.slice(0, 8));
    });

    it('shows error message for failed job', async () => {
      const job = createJob({ status: 'failed', errorMessage: 'Something went wrong' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText('Something went wrong')).toBeTruthy();
    });

    it('shows truncated error text for failed job when message > 30 chars', async () => {
      const longMsg = 'This error message is longer than thirty characters';
      const job = createJob({ status: 'failed', errorMessage: longMsg });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByText(longMsg.slice(0, 30))).toBeTruthy();
    });

    it('shows "Failed" badge when no error message on failed job', async () => {
      const job = createJob({ status: 'failed' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      // "Failed" appears twice: status badge and action badge (both are badge-error)
      const failedElements = screen.getAllByText('Failed');
      expect(failedElements.length).toBe(2);
    });

    it('shows no action buttons for running job when Start should be hidden', async () => {
      const job = createJob({ status: 'running' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Retry / Restart buttons                                            */
  /* ------------------------------------------------------------------ */

  describe('Retry/Restart buttons', () => {
    it('shows Restart button when canRestartJob is true (failed)', async () => {
      const job = createJob({ status: 'failed', failedUnits: 5 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByTitle('Restart job')).toBeTruthy();
    });

    it('shows Restart button for completed job', async () => {
      const job = createJob({ status: 'completed' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByTitle('Restart job')).toBeTruthy();
    });

    it('calls onRequestConfirm("restart") when Restart is clicked', async () => {
      const onRequestConfirm = vi.fn();
      const job = createJob({ status: 'failed', failedUnits: 3 });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        onRequestConfirm,
      });
      fireEvent.click(screen.getByTitle('Restart job'));
      expect(onRequestConfirm).toHaveBeenCalledWith('restart', job);
    });

    it('shows Retry button when canRetryFailed is true', async () => {
      const job = createJob({ status: 'failed', failedUnits: 5 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });

    it('calls onRequestConfirm("retry") when Retry is clicked', async () => {
      const onRequestConfirm = vi.fn();
      const job = createJob({ status: 'failed', failedUnits: 3 });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        onRequestConfirm,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRequestConfirm).toHaveBeenCalledWith('retry', job);
    });

    it('does not show "No failed units" badge when no failed units', async () => {
      const job = createJob({ status: 'failed', failedUnits: 0 });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.queryByTitle('No failed units to retry')).toBeNull();
    });

    it('does not show Retry for pending job', async () => {
      const job = createJob({ status: 'pending' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('does not show Restart for pending job', async () => {
      const job = createJob({ status: 'pending' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.queryByTitle('Restart job')).toBeNull();
    });

    it('does not show Restart for running job', async () => {
      const job = createJob({ status: 'running' });
      await renderTable({ jobs: [job], filteredJobs: [job] });
      expect(screen.queryByTitle('Restart job')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Date grouping (collapsible)                                        */
  /* ------------------------------------------------------------------ */

  describe('date grouping', () => {
    function makeDateJob(createdAt: string, overrides: Partial<JobModel> = {}): JobModel {
      return createJob({
        id: 'job-001',
        createdAt,
        updatedAt: createdAt,
        completedAt: undefined,
        ...overrides,
      });
    }

    it('shows date group headers when groupBy is "date"', async () => {
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z');
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
      });
      expect(screen.getByText('Today')).toBeTruthy();
      expect(screen.getByText('1 job')).toBeTruthy();
      vi.useRealTimers();
    });

    it('renders date groups expanded by default', async () => {
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z');
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        expandedGroups: {},
      });
      // Arrow should show "open" (expanded)
      const arrow = document.querySelector('.group-header-arrow.open');
      expect(arrow).toBeTruthy();
      // Job row should be visible
      expect(screen.getByText('job-001')).toBeTruthy();
      vi.useRealTimers();
    });

    it('clicking date group header collapses rows', async () => {
      const onToggleGroup = vi.fn();
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z');
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        expandedGroups: {},
        onToggleGroup,
      });
      const header = document.querySelector('.group-header-row-collapsible')!;
      expect(header).toBeTruthy();
      fireEvent.click(header);
      expect(onToggleGroup).toHaveBeenCalledTimes(1);
      expect(onToggleGroup).toHaveBeenCalledWith('date:today');
      vi.useRealTimers();
    });

    it('hides job rows when group is collapsed', async () => {
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z');
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        expandedGroups: { 'date:today': false },
      });
      // Arrow should NOT show "open"
      const arrow = document.querySelector('.group-header-arrow.open');
      expect(arrow).toBeNull();
      // Job row should be hidden
      expect(screen.queryByText('job-001')).toBeNull();
      // Group header and count should still be visible
      expect(screen.getByText('Today')).toBeTruthy();
      expect(screen.getByText('1 job')).toBeTruthy();
      vi.useRealTimers();
    });

    it('clicking collapsed date group header expands it again', async () => {
      const onToggleGroup = vi.fn();
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z');
      // Start collapsed
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        expandedGroups: { 'date:today': false },
        onToggleGroup,
      });
      fireEvent.click(document.querySelector('.group-header-row-collapsible')!);
      // Should toggle from false -> true
      expect(onToggleGroup).toHaveBeenCalledWith('date:today');
      vi.useRealTimers();
    });

    it('invalid expandedGroups does not crash', async () => {
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z');
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        // @ts-expect-error - testing invalid input (null is not a valid Record<string, boolean>)
        expandedGroups: null,
      });
      // Should not crash, should render expanded by default (fallback to {})
      expect(screen.getByText('Today')).toBeTruthy();
      vi.useRealTimers();
    });

    it('no grouping unaffected by group state', async () => {
      const onToggleGroup = vi.fn();
      const job = createJob({ id: 'job-001' });
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'none',
        expandedGroups: {},
        onToggleGroup,
      });
      // No group headers at all
      expect(screen.queryByText('Today')).toBeNull();
      // Job row should be visible
      expect(screen.getByText('job-001')).toBeTruthy();
    });

    it('shows caret in collapsed vs expanded state', async () => {
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z');

      // Expanded state
      const { unmount } = await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        expandedGroups: {},
      });
      const expandedArrow = document.querySelector('.group-header-arrow.open');
      expect(expandedArrow).toBeTruthy();
      unmount();

      // Collapsed state
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        expandedGroups: { 'date:today': false },
      });
      const collapsedArrow = document.querySelector('.group-header-arrow.open');
      expect(collapsedArrow).toBeNull();
      vi.useRealTimers();
    });

    it('date and status group keys do not collide', async () => {
      const now = new Date('2026-05-21T12:00:00Z');
      vi.setSystemTime(now);
      const job = makeDateJob('2026-05-21T10:00:00Z', { status: 'running', id: 'job-001' });
      // Collapse date:today but not status:Active — date rows should be hidden,
      // but since this test has only one job that falls into "Active" status,
      // and the job IS in "Today" date bucket, we verify the key prefix prevents collision.
      await renderTable({
        jobs: [job],
        filteredJobs: [job],
        groupBy: 'date',
        expandedGroups: { 'date:today': false, 'status:Active': false },
      });
      // date:today is collapsed = job rows hidden
      expect(screen.queryByText('job-001')).toBeNull();
      vi.useRealTimers();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Status grouping (now collapsible)                                    */
  /* ------------------------------------------------------------------ */

  describe('status grouping (collapsible)', () => {
    it('shows status group headers when groupBy is "status"', async () => {
      const running = createJob({ id: 'job-run', status: 'running', name: 'Running Job' });
      const pending = createJob({ id: 'job-pend', status: 'pending', name: 'Pending Job' });
      await renderTable({
        jobs: [running, pending],
        filteredJobs: [running, pending],
        groupBy: 'status',
      });
      expect(screen.getByText('Active')).toBeTruthy();
      // "Pending" appears as both group header and job status label
      const pendingTexts = screen.getAllByText('Pending');
      expect(pendingTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('status groups render expanded by default', async () => {
      const running = createJob({ id: 'job-run', status: 'running' });
      await renderTable({
        jobs: [running],
        filteredJobs: [running],
        groupBy: 'status',
        expandedGroups: {},
      });
      const arrow = document.querySelector('.group-header-arrow.open');
      expect(arrow).toBeTruthy();
      expect(screen.getByText('job-run')).toBeTruthy();
    });

    it('clicking status group header collapses rows', async () => {
      const onToggleGroup = vi.fn();
      const running = createJob({ id: 'job-run', status: 'running' });
      await renderTable({
        jobs: [running],
        filteredJobs: [running],
        groupBy: 'status',
        expandedGroups: {},
        onToggleGroup,
      });
      const header = document.querySelector('.group-header-row-collapsible')!;
      expect(header).toBeTruthy();
      fireEvent.click(header);
      expect(onToggleGroup).toHaveBeenCalledWith('status:Active');
    });

    it('hides job rows when status group is collapsed', async () => {
      const running = createJob({ id: 'job-run', status: 'running' });
      await renderTable({
        jobs: [running],
        filteredJobs: [running],
        groupBy: 'status',
        expandedGroups: { 'status:Active': false },
      });
      // Header and count visible
      expect(screen.getByText('Active')).toBeTruthy();
      expect(screen.getByText('1 job')).toBeTruthy();
      // Job row hidden
      expect(screen.queryByText('job-run')).toBeNull();
    });

    it('status group header has aria-expanded and role="button"', async () => {
      const running = createJob({ id: 'job-run', status: 'running' });
      await renderTable({
        jobs: [running],
        filteredJobs: [running],
        groupBy: 'status',
        expandedGroups: { 'status:Active': false },
      });
      const header = document.querySelector('.group-header-row-collapsible')!;
      expect(header.getAttribute('role')).toBe('button');
      expect(header.getAttribute('aria-expanded')).toBe('false');
    });

    it('clicking collapsed status header expands it again', async () => {
      const onToggleGroup = vi.fn();
      const running = createJob({ id: 'job-run', status: 'running' });
      await renderTable({
        jobs: [running],
        filteredJobs: [running],
        groupBy: 'status',
        expandedGroups: { 'status:Active': false },
        onToggleGroup,
      });
      fireEvent.click(document.querySelector('.group-header-row-collapsible')!);
      expect(onToggleGroup).toHaveBeenCalledWith('status:Active');
    });

    it('counts remain visible when status group is collapsed', async () => {
      const running = createJob({ id: 'job-run', status: 'running' });
      const pending = createJob({ id: 'job-pend', status: 'pending' });
      await renderTable({
        jobs: [running, pending],
        filteredJobs: [running, pending],
        groupBy: 'status',
        expandedGroups: { 'status:Active': false, 'status:Pending': true },
      });
      // Group headers visible
      expect(screen.getByText('Active')).toBeTruthy();
      const pendingHeaders = screen.getAllByText('Pending');
      expect(pendingHeaders.length).toBeGreaterThanOrEqual(1);
      // Job rows: running hidden, pending visible
      expect(screen.queryByText('job-run')).toBeNull();
      expect(screen.getByText('job-pend')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Multiple jobs                                                      */
  /* ------------------------------------------------------------------ */

  describe('multiple jobs', () => {
    it('renders one row per job', async () => {
      const job1 = createJob({ id: 'job-001', name: 'First' });
      const job2 = createJob({ id: 'job-002', name: 'Second' });
      await renderTable({
        jobs: [job1, job2],
        filteredJobs: [job1, job2],
      });
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
    });
  });
});
