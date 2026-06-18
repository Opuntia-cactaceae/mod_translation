/* ------------------------------------------------------------------ */
/*  AnalysisJobProgress tests                                          */
/*  Verifies structured counters display and status badge logic        */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import AnalysisJobProgress from '../AnalysisJobProgress';
import type { OutputAnalysisJob } from '../../../api/types';

afterEach(() => cleanup());

// ------------------------------------------------------------------ //
//  Mocks
// ------------------------------------------------------------------ //
vi.mock('../../../App', () => ({
  api: {
    getOutputAnalysisJob: vi.fn(),
    cancelOutputAnalysisJob: vi.fn(),
  },
}));

// ------------------------------------------------------------------ //
//  Helpers
// ------------------------------------------------------------------ //
function makeJob(overrides: Partial<OutputAnalysisJob> = {}): OutputAnalysisJob {
  return {
    id: 'test-job-1',
    scope_type: 'job',
    scope: {},
    checks: ['compilability', 'placeholders'],
    status: 'completed',
    total_count: 5,
    processed_count: 5,
    skipped_count: 0,
    passed_count: 4,
    warning_count: 0,
    failed_count: 1,
    error_count: 0,
    created_at: '2025-01-01T00:00:00Z',
    started_at: '2025-01-01T00:00:01Z',
    finished_at: '2025-01-01T00:00:10Z',
    cancel_requested: false,
    error_message: null,
    ...overrides,
  };
}

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

describe('AnalysisJobProgress status badge', () => {

  it('shows "Completed with issues" badge (warning) when failed_count > 0', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', failed_count: 1, error_count: 0 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    const badge = screen.getByText('Completed with issues');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('badge-warning');
  });

  it('shows "Completed with issues" badge (warning) when error_count > 0', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', failed_count: 0, error_count: 2 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    const badge = screen.getByText('Completed with issues');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('badge-warning');
  });

  it('shows "Completed" badge (success) when no issues', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', failed_count: 0, error_count: 0 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    const badge = screen.getByText('Completed');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('badge-success');
  });

  it('shows "Failed" badge (danger) for failed status', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'failed' }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    const badge = screen.getByText('Failed');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('badge-danger');
  });

  it('shows "Cancelled" badge (secondary) for cancelled status', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'cancelled' }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    const badge = screen.getByText('Cancelled');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('badge-secondary');
  });

  it('shows "Running" badge (primary) for running status', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'running', processed_count: 2, total_count: 5 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    const badge = screen.getByText('Running');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('badge-primary');
  });
});

describe('AnalysisJobProgress counters display', () => {

  it('renders Files section with Total, Successful, Failed, Skipped', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({
        total_count: 10,
        passed_count: 7,
        failed_count: 2,
        skipped_count: 1,
      }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText('Files')).toBeTruthy();
    expect(screen.getByText('Total: 10')).toBeTruthy();
    expect(screen.getByText('Successful: 7')).toBeTruthy();
    expect(screen.getByText('Failed: 2')).toBeTruthy();
    expect(screen.getByText('Skipped: 1')).toBeTruthy();
  });

  it('renders Analysis section with Errors found, Warnings found, Processed', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({
        error_count: 3,
        warning_count: 2,
        processed_count: 10,
      }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText('Analysis')).toBeTruthy();
    expect(screen.getByText('Errors found: 3')).toBeTruthy();
    expect(screen.getByText('Warnings found: 2')).toBeTruthy();
    expect(screen.getByText('Processed: 10')).toBeTruthy();
  });

  it('shows zero counts explicitly (not hidden)', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({
        total_count: 0,
        passed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        error_count: 0,
        warning_count: 0,
        processed_count: 0,
      }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    // All counters should be visible even when zero
    expect(screen.getByText('Total: 0')).toBeTruthy();
    expect(screen.getByText('Successful: 0')).toBeTruthy();
    expect(screen.getByText('Failed: 0')).toBeTruthy();
    expect(screen.getByText('Skipped: 0')).toBeTruthy();
    expect(screen.getByText('Errors found: 0')).toBeTruthy();
    expect(screen.getByText('Warnings found: 0')).toBeTruthy();
  });
});

describe('AnalysisJobProgress issues alert', () => {

  it('shows issues alert when completed with failed files', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', failed_count: 2, error_count: 0 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText(/Completed with 2 issues/)).toBeTruthy();
    expect(screen.getByText(/2 failed files/)).toBeTruthy();
  });

  it('shows issues alert when completed with analysis errors', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', failed_count: 0, error_count: 3 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText(/Completed with 3 issues/)).toBeTruthy();
    expect(screen.getByText(/3 errors/)).toBeTruthy();
  });

  it('shows issues alert with both failed files and errors', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', failed_count: 2, error_count: 1 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText(/Completed with 3 issues/)).toBeTruthy();
    expect(screen.getByText(/2 failed files/)).toBeTruthy();
    expect(screen.getByText(/1 error/)).toBeTruthy();
  });

  it('does not show issues alert when clean completed', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', failed_count: 0, error_count: 0 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.queryByText(/Completed with/)).toBeNull();
  });
});

describe('AnalysisJobProgress error message', () => {

  it('shows error_message when present', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ error_message: 'Something went wrong' }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('does not show error_message div when null', () => {
    const { container } = render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ error_message: null }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    const alerts = container.querySelectorAll('.alert');
    // There should be no alert for error_message (but there could be one for issues)
    const errorAlerts = Array.from(alerts).filter(
      el => el.className.includes('alert-error')
    );
    expect(errorAlerts.length).toBe(0);
  });
});

describe('AnalysisJobProgress progress bar', () => {

  it('shows progress bar for running jobs', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'running', processed_count: 3, total_count: 10 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText('3 / 10 files')).toBeTruthy();
  });

  it('shows progress bar for queued jobs', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'queued', processed_count: 0, total_count: 5 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText('0 / 5 files')).toBeTruthy();
  });

  it('hides progress bar for completed jobs', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob({ status: 'completed', processed_count: 5, total_count: 5 }),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.queryByText(/\/.*files/)).toBeNull();
  });
});

describe('AnalysisJobProgress render without crashing', () => {

  it('renders the title', () => {
    render(React.createElement(AnalysisJobProgress, {
      job: makeJob(),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(screen.getByText('Analysis Job')).toBeTruthy();
  });
});
