/* ------------------------------------------------------------------ */
/*  OutputFilesSummaryCards tests                                       */
/*  Regression: must NOT crash on null/undefined summary                */
/* ------------------------------------------------------------------ */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import OutputFilesSummaryCards from '../OutputFilesSummaryCards';
import type { OutputFilesSummaryResponse } from '../../../api/types';

afterEach(() => cleanup());

const validSummary: OutputFilesSummaryResponse = {
  files_count: 5,
  mods_count: 2,
  groups_count: 3,
  analyzed_count: 4,
  passed_count: 3,
  warning_count: 1,
  failed_count: 0,
  error_count: 0,
  missing_count: 0,
  stale_count: 0,
};

function getAllValues(container: HTMLElement): string[] {
  const divs = container.querySelectorAll('div[style*="font-weight: 700"]');
  return Array.from(divs).map(d => d.textContent || '');
}

describe('OutputFilesSummaryCards', () => {
  it('renders summary cards when data is provided', () => {
    const { container } = render(React.createElement(OutputFilesSummaryCards, {
      summary: validSummary,
      loading: false,
    }));

    expect(screen.getByText('Files')).toBeTruthy();
    expect(screen.getByText('Mods')).toBeTruthy();
    expect(screen.getByText('Groups')).toBeTruthy();
    const values = getAllValues(container);
    expect(values).toContain('5');
    expect(values).toContain('2');
    expect(values).toContain('3');
  });

  it('shows spinner while loading', () => {
    render(React.createElement(OutputFilesSummaryCards, {
      summary: null,
      loading: true,
    }));

    expect(screen.getByText('Loading summary...')).toBeTruthy();
  });

  it('returns null without crashing when summary is null and not loading', () => {
    const { container } = render(React.createElement(OutputFilesSummaryCards, {
      summary: null,
      loading: false,
    }));

    // Should render nothing — no crash, no DOM content
    expect(container.textContent).toBe('');
  });

  it('returns null without crashing when summary is undefined', () => {
    const { container } = render(React.createElement(OutputFilesSummaryCards, {
      summary: undefined,
      loading: false,
    }));

    expect(container.textContent).toBe('');
  });

  it('renders passed/error/warning count badges with correct classNames', () => {
    const summaryWithCounts: OutputFilesSummaryResponse = {
      ...validSummary,
      passed_count: 10,
      warning_count: 2,
      failed_count: 3,
      error_count: 1,
    };

    const { container } = render(React.createElement(OutputFilesSummaryCards, {
      summary: summaryWithCounts,
      loading: false,
    }));

    const values = getAllValues(container);
    expect(values).toContain('10');
    expect(values).toContain('2');
    expect(values).toContain('3');
    expect(values).toContain('1');
    expect(screen.getByText('Passed')).toBeTruthy();
    expect(screen.getByText('Warnings')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Errors')).toBeTruthy();
  });

  it('renders missing and stale badges', () => {
    const summaryWithMissing: OutputFilesSummaryResponse = {
      ...validSummary,
      missing_count: 2,
      stale_count: 1,
    };

    const { container } = render(React.createElement(OutputFilesSummaryCards, {
      summary: summaryWithMissing,
      loading: false,
    }));

    expect(screen.getByText('Missing')).toBeTruthy();
    expect(screen.getByText('Stale')).toBeTruthy();
    const values = getAllValues(container);
    expect(values).toContain('2');
    expect(values).toContain('1');
  });
});
