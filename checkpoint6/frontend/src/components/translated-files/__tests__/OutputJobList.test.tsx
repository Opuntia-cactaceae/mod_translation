/* ------------------------------------------------------------------ */
/*  OutputJobList tests — grouped collapsible layout with grid         */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { OutputFileTreeResponse } from '../../../api/types';
import OutputJobList, { formatDate } from '../OutputJobList';
import { buildJobLabel } from '../OutputJobCard';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const now = new Date('2026-05-21T12:00:00Z');

function makeJobNode(jobId: string): OutputFileTreeResponse['jobs'][string] {
  return {
    job_id: jobId,
    mods: {
      'mod-a': {
        mod_id: 'mod-a',
        mod_name: 'Mod A',
        groups: {
          __root__: {
            group_key: '__root__',
            group_label: 'Root',
            files: [
              {
                id: `file-${jobId}-1`,
                file_name: `f1_${jobId}.yml`,
                source_file_name: 'source.yml',
                source_file_path: '/src/source.yml',
                relative_source_path: 'source.yml',
                relative_translated_path: `f1_${jobId}.yml`,
                status: 'ready',
              },
            ],
          },
        },
      },
    },
  };
}

/**
 * Build a tree with jobs placed in specific date buckets.
 */
function makeTimedTree(): OutputFileTreeResponse {
  // Yesterday: 2026-05-20
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Last month: 2026-04-15
  const lastMonth = new Date('2026-04-15T10:00:00Z');

  return {
    job_timestamps: {
      'today-job': {
        created_at: now.toISOString(),
        updated_at: null,
        completed_at: null,
      },
      'yesterday-job': {
        created_at: yesterday.toISOString(),
        updated_at: null,
        completed_at: null,
      },
      'old-job': {
        created_at: lastMonth.toISOString(),
        updated_at: null,
        completed_at: null,
      },
    },
    jobs: {
      'today-job': makeJobNode('today-job'),
      'yesterday-job': makeJobNode('yesterday-job'),
      'old-job': makeJobNode('old-job'),
    },
  };
}

/** Tree with no timestamps — all jobs go to "Unknown date" */
function makeUntimedTree(): OutputFileTreeResponse {
  return {
    job_timestamps: {},
    jobs: {
      'job-aaa': makeJobNode('job-aaa'),
      'job-bbb': makeJobNode('job-bbb'),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('OutputJobList', () => {
  const onSelectJob = vi.fn();
  const onToggleGroup = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /*  Empty state                                                        */
  /* ------------------------------------------------------------------ */

  describe('empty state', () => {
    it('shows "No translated output jobs" when tree is null', () => {
      render(
        React.createElement(OutputJobList, {
          tree: null,
          loading: false,
          selectedJobId: null,
          onSelectJob,
        })
      );
      expect(screen.getByText('No translated output jobs')).toBeTruthy();
    });

    it('shows "No translated output jobs" when jobs object is empty', () => {
      render(
        React.createElement(OutputJobList, {
          tree: { jobs: {}, job_timestamps: {} },
          loading: false,
          selectedJobId: null,
          onSelectJob,
        })
      );
      expect(screen.getByText('No translated output jobs')).toBeTruthy();
    });

    it('shows loading indicator when loading', () => {
      render(
        React.createElement(OutputJobList, {
          tree: null,
          loading: true,
          selectedJobId: null,
          onSelectJob,
        })
      );
      expect(screen.getByText('Loading jobs...')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Grouped rendering                                                  */
  /* ------------------------------------------------------------------ */

  describe('grouped rendering', () => {
    it('renders jobs inside date-grouped sections', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
          onToggleGroup,
        })
      );

      // Group headers should be present
      expect(screen.getByText('Today')).toBeTruthy();
      expect(screen.getByText('Yesterday')).toBeTruthy();

      // Job cards should be visible (first group expanded by default)
      expect(screen.getByText('Job: today-job')).toBeTruthy();
    });

    it('shows job count on each group header', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
          onToggleGroup,
        })
      );

      // Each group has exactly 1 job
      const countElements = document.querySelectorAll('.output-job-group-header .tree-node-count');
      expect(countElements.length).toBeGreaterThanOrEqual(2);
      // Each count should be "1"
      countElements.forEach(el => {
        expect(el.textContent).toBe('1');
      });
    });

    it('renders group headers with collapse arrow', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
          onToggleGroup,
        })
      );

      // First group (Today) expanded — arrow has "open" class
      const headers = document.querySelectorAll('.output-job-group-header');
      expect(headers.length).toBeGreaterThanOrEqual(2);

      const arrows = document.querySelectorAll('.output-job-group-header .group-header-arrow');
      expect(arrows.length).toBeGreaterThanOrEqual(2);

      // First group (Today) arrow should be open
      const firstArrow = arrows[0];
      expect(firstArrow.classList.contains('open')).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Group collapse/expand behavior                                     */
  /* ------------------------------------------------------------------ */

  describe('collapsible groups', () => {
    it('first group is expanded by default, others collapsed', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
        })
      );

      // Today group (first) — card visible
      expect(screen.getByText('Job: today-job')).toBeTruthy();

      // Yesterday group (second) — card hidden
      expect(screen.queryByText('Job: yesterday-job')).toBeNull();
    });

    it('clicking group header collapses the expanded group', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
          onToggleGroup,
        })
      );

      // Click Today header to collapse
      const todayHeader = screen.getByText('Today').closest('.output-job-group-header')!;
      fireEvent.click(todayHeader);

      expect(onToggleGroup).toHaveBeenCalledWith('today');
    });

    it('clicking collapsed group header expands it', () => {
      const tree = makeTimedTree();
      const expandedGroups: Record<string, boolean> = { today: true, yesterday: false };

      const { rerender } = render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups,
          onToggleGroup,
        })
      );

      // Yesterday is collapsed — no card
      expect(screen.queryByText('Job: yesterday-job')).toBeNull();

      // Simulate toggle: expand yesterday
      const updatedGroups = { ...expandedGroups, yesterday: true };
      rerender(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: updatedGroups,
          onToggleGroup,
        })
      );

      // Yesterday card now visible (ID truncated to 12 chars)
      expect(screen.getByText(/yesterday-jo/)).toBeTruthy();
    });

    it('persisted expandedGroups overrides default first-group-only', () => {
      const tree = makeTimedTree();
      // All groups explicitly collapsed
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: { today: false, yesterday: false, 'month:2026-04': false },
        })
      );

      // No cards visible
      expect(screen.queryByText('Job: today-job')).toBeNull();
      expect(screen.queryByText('Job: yesterday-job')).toBeNull();
      expect(screen.queryByText('Job: old-job')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Grid container instead of horizontal scroll                        */
  /* ------------------------------------------------------------------ */

  describe('responsive grid layout', () => {
    it('expanded group uses job-list-grid container', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
        })
      );

      const grids = document.querySelectorAll('.job-list-grid');
      expect(grids.length).toBeGreaterThanOrEqual(1);

      // Cards are inside the grid
      const card = grids[0].querySelector('.job-card');
      expect(card).toBeTruthy();
    });

    it('collapsed group has no job-list-grid container', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: { today: true, yesterday: false },
        })
      );

      // Only Today group has a grid (expanded)
      const grids = document.querySelectorAll('.job-list-grid');
      expect(grids.length).toBe(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Job selection                                                      */
  /* ------------------------------------------------------------------ */

  describe('job selection', () => {
    it('clicking a job card calls onSelectJob', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
        })
      );

      // Click the today-job card
      const card = screen.getByText('Job: today-job').closest('.job-card')!;
      fireEvent.click(card);

      expect(onSelectJob).toHaveBeenCalledWith('today-job');
    });

    it('selected job card has .selected class', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: 'today-job',
          onSelectJob,
          expandedGroups: {},
        })
      );

      const selectedCards = document.querySelectorAll('.job-card.selected');
      expect(selectedCards.length).toBe(1);
      expect(selectedCards[0].textContent).toContain('today-job');
    });

    it('selected job remains selected after collapsing its group', () => {
      const tree = makeTimedTree();
      const { rerender } = render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: 'today-job',
          onSelectJob,
          expandedGroups: { today: true },
        })
      );

      // Card is selected
      expect(document.querySelectorAll('.job-card.selected').length).toBe(1);

      // Collapse Today group
      rerender(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: 'today-job',
          onSelectJob,
          expandedGroups: { today: false },
        })
      );

      // Card is hidden but selectedJobId is preserved (it's a parent prop)
      expect(screen.queryByText('Job: today-job')).toBeNull();
    });

    it('collapsed group with selected job has has-selected class on header', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: 'today-job',
          onSelectJob,
          expandedGroups: { today: false },
        })
      );

      const header = screen.getByText('Today').closest('.output-job-group-header')!;
      expect(header.classList.contains('has-selected')).toBe(true);
    });

    it('shows "Selected" badge on collapsed group header when containing selected job', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: 'today-job',
          onSelectJob,
          expandedGroups: { today: false },
        })
      );

      // Badge should be visible
      expect(screen.getByText('Selected')).toBeTruthy();
    });

    it('no "Selected" badge on expanded group even if it contains selected job', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: 'today-job',
          onSelectJob,
          expandedGroups: { today: true },
        })
      );

      // "Selected" badge should NOT be visible (group is expanded)
      expect(screen.queryByText('Selected')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Grouping order                                                     */
  /* ------------------------------------------------------------------ */

  describe('grouping order', () => {
    it('groups are ordered: Today, Yesterday, then month buckets', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
        })
      );

      const headers = document.querySelectorAll('.output-job-group-title');
      expect(headers.length).toBe(3);
      expect(headers[0].textContent).toBe('Today');
      expect(headers[1].textContent).toBe('Yesterday');
      // Third group is "April 2026" (last month)
      expect(headers[2].textContent).toBe('April 2026');
    });

    it('untimed jobs go to "Unknown date" group', () => {
      const tree = makeUntimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
        })
      );

      // All jobs in one group, no timestamps → Unknown date
      expect(screen.getByText('Unknown date')).toBeTruthy();

      // Both job cards visible (first group expanded)
      expect(screen.getByText('Job: job-bbb')).toBeTruthy();
      expect(screen.getByText('Job: job-aaa')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Action buttons still work                                          */
  /* ------------------------------------------------------------------ */

  describe('action buttons', () => {
    it('renders Refresh button on cards', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          onRefresh: vi.fn(),
          expandedGroups: {},
        })
      );

      const refreshButtons = screen.getAllByTitle('Refresh');
      expect(refreshButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('renders Reindex button on cards', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          onReindex: vi.fn(),
          expandedGroups: {},
        })
      );

      const reindexButtons = screen.getAllByTitle('Reindex output files');
      expect(reindexButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('renders Analyze stale button when callback provided', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          onAnalyzeStale: vi.fn(),
          expandedGroups: {},
        })
      );

      const staleButtons = screen.getAllByTitle('Analyze stale files');
      expect(staleButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('does not render Analyze stale button when callback omitted', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
        })
      );

      const staleButtons = screen.queryAllByTitle('Analyze stale files');
      expect(staleButtons.length).toBe(0);
    });

    it('clicking Analyze stale calls onAnalyzeStale with the job id', () => {
      const onAnalyzeStale = vi.fn();
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          onAnalyzeStale,
          expandedGroups: {},
        })
      );

      const staleButtons = screen.getAllByTitle('Analyze stale files');
      expect(staleButtons.length).toBeGreaterThanOrEqual(1);

      // Click the first Analyze stale button (should correspond to "today-job")
      fireEvent.click(staleButtons[0]);

      // Callback should be called with the correct job ID
      expect(onAnalyzeStale).toHaveBeenCalledWith('today-job');
    });

    it('clicking Analyze stale does not trigger job selection', () => {
      const onSelectJob = vi.fn();
      const onAnalyzeStale = vi.fn();
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          onAnalyzeStale,
          expandedGroups: {},
        })
      );

      const staleButtons = screen.getAllByTitle('Analyze stale files');
      fireEvent.click(staleButtons[0]);

      // The card's onSelect should NOT have been called
      // (the button uses stopPropagation to prevent card selection)
      expect(onSelectJob).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Null-safety regression tests                                       */
  /* ------------------------------------------------------------------ */

  describe('null-safety regression', () => {
    const onSelectJob = vi.fn();

    it('does not crash when a job node has undefined mods', () => {
      const tree: OutputFileTreeResponse = {
        job_timestamps: {},
        jobs: {
          'job-empty': { job_id: 'job-empty', mods: undefined as any },
        },
      };

      expect(() => render(
        React.createElement(OutputJobList, {
          tree, loading: false, selectedJobId: null, onSelectJob,
          expandedGroups: {},
        })
      )).not.toThrow();
    });

    it('does not crash when a job node has null mods', () => {
      const tree: OutputFileTreeResponse = {
        job_timestamps: {},
        jobs: {
          'job-empty': { job_id: 'job-empty', mods: null as any },
        },
      };

      expect(() => render(
        React.createElement(OutputJobList, {
          tree, loading: false, selectedJobId: null, onSelectJob,
          expandedGroups: {},
        })
      )).not.toThrow();
    });

    it('does not crash when a mod node has undefined groups', () => {
      const tree: OutputFileTreeResponse = {
        job_timestamps: {},
        jobs: {
          'job-x': {
            job_id: 'job-x',
            mods: {
              'mod-x': { mod_id: 'mod-x', mod_name: 'Mod X', groups: undefined as any },
            },
          },
        },
      };

      expect(() => render(
        React.createElement(OutputJobList, {
          tree, loading: false, selectedJobId: null, onSelectJob,
          expandedGroups: {},
        })
      )).not.toThrow();
    });

    it('does not crash when a mod node has null groups', () => {
      const tree: OutputFileTreeResponse = {
        job_timestamps: {},
        jobs: {
          'job-x': {
            job_id: 'job-x',
            mods: {
              'mod-x': { mod_id: 'mod-x', mod_name: 'Mod X', groups: null as any },
            },
          },
        },
      };

      expect(() => render(
        React.createElement(OutputJobList, {
          tree, loading: false, selectedJobId: null, onSelectJob,
          expandedGroups: {},
        })
      )).not.toThrow();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  buildJobLabel — card header label builder                          */
  /* ------------------------------------------------------------------ */

  describe('buildJobLabel', () => {
    it('returns the job name when one is provided', () => {
      expect(buildJobLabel('abc-123', 'My Translation Job')).toBe('My Translation Job');
    });

    it('returns fallback "Job: <short id>" when no name is provided', () => {
      expect(buildJobLabel('abc-123')).toBe('Job: abc-123');
    });

    it('returns fallback "Job: <short id>" when name is empty string', () => {
      expect(buildJobLabel('abc-123', '')).toBe('Job: abc-123');
    });

    it('returns fallback "Job: <short id>" when name is whitespace', () => {
      expect(buildJobLabel('abc-123', '   ')).toBe('Job: abc-123');
    });

    it('truncates long job IDs in the fallback', () => {
      const longId = 'abcdefghijklm12345';
      expect(buildJobLabel(longId)).toBe('Job: abcdefghijkl...');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  formatDate — compact date string formatter                         */
  /* ------------------------------------------------------------------ */

  describe('formatDate', () => {
    it('formats a valid ISO date string as YYYY-MM-DD HH:mm', () => {
      expect(formatDate('2026-05-29T18:42:00')).toBe('2026-05-29 18:42');
    });

    it('returns empty string for invalid date strings', () => {
      expect(formatDate('not-a-date')).toBe('');
    });

    it('returns empty string for empty string input', () => {
      expect(formatDate('')).toBe('');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Job name display on cards                                          */
  /* ------------------------------------------------------------------ */

  describe('job name display', () => {
    it('shows job name instead of UUID when name is present', () => {
      const tree: OutputFileTreeResponse = {
        job_timestamps: {},
        jobs: {
          'job-with-name': {
            job_id: 'job-with-name',
            name: 'My Cool Job',
            mods: {
              'mod-a': {
                mod_id: 'mod-a',
                mod_name: 'Mod A',
                groups: {
                  __root__: {
                    group_key: '__root__',
                    group_label: 'Root',
                    files: [
                      {
                        id: 'f1',
                        file_name: 'f1.yml',
                        source_file_name: 'source.yml',
                        source_file_path: '/src/source.yml',
                        relative_source_path: 'source.yml',
                        relative_translated_path: 'f1.yml',
                        status: 'ready',
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      };

      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
        })
      );

      // The card should show the name, not the job ID
      expect(screen.getByText('My Cool Job')).toBeTruthy();
      // The raw job ID should NOT appear as header text
      expect(screen.queryByText('Job: job-with-name')).toBeNull();
    });

    it('shows "Job: <short id>" fallback when no name is set', () => {
      const tree = makeTimedTree();
      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
        })
      );

      // First group (Today) expanded — card has fallback label
      expect(screen.getByText('Job: today-job')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Date display on cards                                              */
  /* ------------------------------------------------------------------ */

  describe('date display', () => {
    it('shows created_at date on the card when available', () => {
      const dateStr = '2026-05-20T10:30:00';
      const tree: OutputFileTreeResponse = {
        job_timestamps: {
          'dated-job': {
            created_at: dateStr,
            updated_at: null,
            completed_at: null,
          },
        },
        jobs: {
          'dated-job': {
            job_id: 'dated-job',
            mods: {
              'mod-a': {
                mod_id: 'mod-a',
                mod_name: 'Mod A',
                groups: {
                  __root__: {
                    group_key: '__root__',
                    group_label: 'Root',
                    files: [
                      {
                        id: 'f1',
                        file_name: 'f1.yml',
                        source_file_name: 'source.yml',
                        source_file_path: '/src/source.yml',
                        relative_source_path: 'source.yml',
                        relative_translated_path: 'f1.yml',
                        status: 'ready',
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      };

      render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
        })
      );

      // Date should be formatted as YYYY-MM-DD HH:mm
      expect(screen.getByText('2026-05-20 10:30')).toBeTruthy();
    });

    it('does not crash when created_at is missing', () => {
      const tree: OutputFileTreeResponse = {
        job_timestamps: {
          'no-date-job': {
            created_at: '',
            updated_at: null,
            completed_at: null,
          },
        },
        jobs: {
          'no-date-job': {
            job_id: 'no-date-job',
            mods: {
              'mod-a': {
                mod_id: 'mod-a',
                mod_name: 'Mod A',
                groups: {
                  __root__: {
                    group_key: '__root__',
                    group_label: 'Root',
                    files: [
                      {
                        id: 'f1',
                        file_name: 'f1.yml',
                        source_file_name: 'source.yml',
                        source_file_path: '/src/source.yml',
                        relative_source_path: 'source.yml',
                        relative_translated_path: 'f1.yml',
                        status: 'ready',
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      };

      expect(() => render(
        React.createElement(OutputJobList, {
          tree,
          loading: false,
          selectedJobId: null,
          onSelectJob,
          expandedGroups: {},
        })
      )).not.toThrow();
    });
  });
});
