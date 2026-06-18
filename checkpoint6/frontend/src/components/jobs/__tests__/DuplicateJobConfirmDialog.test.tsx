/* ------------------------------------------------------------------ */
/*  Tests: DuplicateJobConfirmDialog                                    */
/*                                                                      */
/*  Focus: rendering with 1 vs many jobs, callback wiring, cancel.      */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { DuplicateJobConfirmDialog } from '../DuplicateJobConfirmDialog';
import type { JobModel } from '../../../domain/jobs';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const COMPLETED_JOB: JobModel = {
  id: 'job-1',
  name: 'English to Russian',
  status: 'completed',
  filePaths: ['/game/file1.yml', '/game/file2.yml'],
  config: null,
  totalUnits: 10,
  completedUnits: 10,
  failedUnits: 0,
  cachedUnits: 0,
  progress: 1,
  currentBatchIndex: 0,
  totalBatches: 1,
  diagnostics: [],
  outputFiles: [],
};

const RUNNING_JOB: JobModel = {
  ...COMPLETED_JOB,
  id: 'job-2',
  name: 'English to German',
  status: 'running',
  totalUnits: 50,
  completedUnits: 20,
  progress: 0.4,
};

const DRAFT_JOB: JobModel = {
  ...COMPLETED_JOB,
  id: 'job-3',
  name: 'English to French',
  status: 'pending',
  filePaths: ['/game/file3.yml'],
};

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('DuplicateJobConfirmDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders dialog with single existing job', () => {
    const onOpenExisting = vi.fn();
    const onContinueNew = vi.fn();
    const onCancel = vi.fn();

    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB],
        onOpenExisting,
        onContinueNew,
        onCancel,
      }),
    );

    expect(screen.getByText('Duplicate job detected')).toBeTruthy();
    expect(screen.getByText('English to Russian')).toBeTruthy();
    expect(screen.getByText('Open existing job')).toBeTruthy();
    expect(screen.getByText('Create new anyway')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('renders dialog with multiple existing jobs as select', () => {
    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB, RUNNING_JOB],
        onOpenExisting: vi.fn(),
        onContinueNew: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Should show both job names (may appear in both list and select)
    expect(screen.getAllByText('English to Russian').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('English to German').length).toBeGreaterThanOrEqual(1);

    // Should show select instead of direct button
    expect(screen.getByText('Select a job...')).toBeTruthy();
    expect(screen.queryByText('Open existing job')).toBeNull();
  });

  it('shows status badges for each job', () => {
    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB, RUNNING_JOB, DRAFT_JOB],
        onOpenExisting: vi.fn(),
        onContinueNew: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Status badges should be visible (within list items)
    // Status text also appears in the select options, so count total occurrences
    const completedBadges = screen.getAllByText(/completed/);
    const runningBadges = screen.getAllByText(/running/);
    const pendingBadges = screen.getAllByText(/pending/);
    expect(completedBadges.length).toBeGreaterThanOrEqual(1);
    expect(runningBadges.length).toBeGreaterThanOrEqual(1);
    expect(pendingBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows file count for each job', () => {
    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB],
        onOpenExisting: vi.fn(),
        onContinueNew: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(screen.getByText('(2 files)')).toBeTruthy();
  });

  it('limits displayed jobs to 5 with overflow indicator', () => {
    const jobs = Array.from({ length: 8 }, (_, i) => ({
      ...COMPLETED_JOB,
      id: `job-${i}`,
      name: `Job ${i}`,
    }));

    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: jobs,
        onOpenExisting: vi.fn(),
        onContinueNew: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // First 5 jobs appear in the <ul> list
    const job0Elements = screen.getAllByText('Job 0');
    expect(job0Elements.length).toBeGreaterThanOrEqual(1);

    // Should show overflow message
    expect(screen.getByText('...and 3 more')).toBeTruthy();

    // Job 7 appears only in the <select> dropdown (option)
    const job7Option = screen.getByRole('option', { name: 'Job 7' });
    expect(job7Option).toBeTruthy();
  });

  it('calls onOpenExisting with job id when single "Open existing" clicked', () => {
    const onOpenExisting = vi.fn();

    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB],
        onOpenExisting,
        onContinueNew: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByText('Open existing job'));
    expect(onOpenExisting).toHaveBeenCalledWith('job-1');
  });

  it('calls onOpenExisting with selected job id from dropdown', () => {
    const onOpenExisting = vi.fn();

    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB, RUNNING_JOB],
        onOpenExisting,
        onContinueNew: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'job-2' } });
    expect(onOpenExisting).toHaveBeenCalledWith('job-2');
  });

  it('calls onContinueNew when "Create new anyway" clicked', () => {
    const onContinueNew = vi.fn();

    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB],
        onOpenExisting: vi.fn(),
        onContinueNew,
        onCancel: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByText('Create new anyway'));
    expect(onContinueNew).toHaveBeenCalled();
  });

  it('calls onCancel when Cancel button clicked', () => {
    const onCancel = vi.fn();

    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB],
        onOpenExisting: vi.fn(),
        onContinueNew: vi.fn(),
        onCancel,
      }),
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when overlay background is clicked', () => {
    const onCancel = vi.fn();

    const { container } = render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB],
        onOpenExisting: vi.fn(),
        onContinueNew: vi.fn(),
        onCancel,
      }),
    );

    // Click the overlay (modal-overlay), not the modal-content
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.mouseDown(overlay!);
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not call onCancel when modal content is clicked', () => {
    const onCancel = vi.fn();

    render(
      React.createElement(DuplicateJobConfirmDialog, {
        existingJobs: [COMPLETED_JOB],
        onOpenExisting: vi.fn(),
        onContinueNew: vi.fn(),
        onCancel,
      }),
    );

    // Click on the title inside the modal content
    fireEvent.mouseDown(screen.getByText('Duplicate job detected'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
