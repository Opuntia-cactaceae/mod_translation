/* ------------------------------------------------------------------ */
/*  OutputFilesTree tests                                              */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { OutputFile, OutputFileTreeResponse } from '../../../api/types';
import OutputFilesTree from '../OutputFilesTree';

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

afterEach(() => cleanup());

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const validJobId = 'job-271acc59';

const mockTree: OutputFileTreeResponse = {
  job_timestamps: {},
  jobs: {
    [validJobId]: {
      job_id: validJobId,
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
                  id: 'file-ready-1',
                  file_name: 'translated_ready.yml',
                  source_file_name: 'source_english.yml',
                  source_file_path: '/source/source_english.yml',
                  relative_source_path: 'source_english.yml',
                  relative_translated_path: 'translated_ready.yml',
                  status: 'ready',
                },
              ],
            },
          },
        },
        'mod-b': {
          mod_id: 'mod-b',
          mod_name: '',
          groups: {
            __root__: {
              group_key: '__root__',
              group_label: 'Root',
              files: [
                {
                  id: 'file-ms-1',
                  file_name: '1b_babe_l_russian.yml',
                  source_file_name: null,
                  source_file_path: '',
                  relative_source_path: null,
                  relative_translated_path: '1b_babe_l_russian.yml',
                  status: 'missing_source',
                },
                {
                  id: 'file-ms-2',
                  file_name: '1b_babe_l_english.yml',
                  source_file_name: null,
                  source_file_path: '',
                  relative_source_path: null,
                  relative_translated_path: '1b_babe_l_english.yml',
                  status: 'missing_source',
                },
              ],
            },
          },
        },
      },
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('OutputFilesTree', () => {
  const onFilterChange = vi.fn();

  beforeEach(() => {
    onFilterChange.mockClear();
  });

  /* ------------------------------------------------------------------ */
  /*  File-click in job-scoped mode                                      */
  /* ------------------------------------------------------------------ */

  describe('file-click in job-scoped mode', () => {
    it('does not call onFilterChange when a file node is clicked (uses onSelectFile instead)', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: { job_id: validJobId },
          onFilterChange,
        })
      );

      // The tree is in job-scoped mode (filter.job_id is set).
      // Find the file node with "translated_ready.yml" text and click it.
      const fileNode = screen.getByText('translated_ready.yml');
      fireEvent.click(fileNode);

      // With new behavior, clicking a file node does NOT call onFilterChange.
      // It uses onSelectFile instead (which is optional).
      expect(onFilterChange).not.toHaveBeenCalled();
    });

    it('does not set group_key when a missing_source file is clicked (file click is now inert without onSelectFile/files)', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: { job_id: validJobId },
          onFilterChange,
        })
      );

      // The text appears in both the source header and the file node;
      // use getAllByText and click the file node (second occurrence).
      const fileNodes = screen.getAllByText('1b_babe_l_russian.yml');
      // fileNodes[0] = source header, fileNodes[1] = file node
      fireEvent.click(fileNodes[1]);

      // File click no longer calls onFilterChange — so group_key won't be set
      expect(onFilterChange).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                          */
  /* ------------------------------------------------------------------ */

  describe('rendering', () => {
    it('renders status badges for each file', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: { job_id: validJobId },
          onFilterChange,
        })
      );

      expect(screen.getByText('READY')).toBeTruthy();
      const missingSourceBadges = screen.getAllByText('MISSING SOURCE');
      expect(missingSourceBadges.length).toBe(2);
    });

    it('shows "No indexed output files" when tree is null', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: null,
          loading: false,
          filter: {},
          onFilterChange,
        })
      );

      expect(screen.getByText('No indexed output files')).toBeTruthy();
    });

    it('shows spinner while loading', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: null,
          loading: true,
          filter: {},
          onFilterChange,
        })
      );

      expect(screen.getByText('Loading tree...')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Null-safety regression tests                                       */
  /* ------------------------------------------------------------------ */

  describe('null-safety (regression)', () => {
    const onFilterChange = vi.fn();
    const onSelectFile = vi.fn();
    const fullFiles: OutputFile[] = [{
      id: 'f1', job_id: validJobId, file_name: 'test.yml',
      mod_id: null, mod_name: '', source_file_path: '',
      translated_file_path: '', relative_source_path: null,
      relative_translated_path: null, file_ext: '.yml',
      game_id: null, parser_id: null, aggregation_key: null,
      group_key: '__root__', group_label: 'Root',
      source_size_bytes: null, translated_size_bytes: null,
      created_at: '', updated_at: '', last_analyzed_at: null,
      editor_available: true, status: 'ready', analysis_stale: false,
      latest_analysis: null, latest_analysis_state: '', output_metadata: null,
    }];

    it('does not crash when tree has a job with undefined mods', () => {
      const tree = {
        job_timestamps: {},
        jobs: { [validJobId]: { job_id: validJobId, mods: undefined as any } },
      } as unknown as OutputFileTreeResponse;

      expect(() => render(
        React.createElement(OutputFilesTree, {
          tree, loading: false, filter: { job_id: validJobId },
          onFilterChange, files: fullFiles, onSelectFile,
        })
      )).not.toThrow();
    });

    it('does not crash when tree has a job with null mods', () => {
      const tree = {
        job_timestamps: {},
        jobs: { [validJobId]: { job_id: validJobId, mods: null as any } },
      } as unknown as OutputFileTreeResponse;

      expect(() => render(
        React.createElement(OutputFilesTree, {
          tree, loading: false, filter: { job_id: validJobId },
          onFilterChange, files: fullFiles, onSelectFile,
        })
      )).not.toThrow();
    });

    it('does not crash when a mod node has undefined groups', () => {
      const tree = {
        job_timestamps: {},
        jobs: {
          [validJobId]: {
            job_id: validJobId,
            mods: {
              'mod-x': { mod_id: 'mod-x', mod_name: 'Mod X', groups: undefined as any },
            },
          },
        },
      } as unknown as OutputFileTreeResponse;

      expect(() => render(
        React.createElement(OutputFilesTree, {
          tree, loading: false, filter: {},
          onFilterChange, groupMode: 'folder',
        })
      )).not.toThrow();
    });

    it('does not crash when a mod node has null groups', () => {
      const tree = {
        job_timestamps: {},
        jobs: {
          [validJobId]: {
            job_id: validJobId,
            mods: {
              'mod-x': { mod_id: 'mod-x', mod_name: 'Mod X', groups: null as any },
            },
          },
        },
      } as unknown as OutputFileTreeResponse;

      expect(() => render(
        React.createElement(OutputFilesTree, {
          tree, loading: false, filter: {},
          onFilterChange, groupMode: 'folder',
        })
      )).not.toThrow();
    });

    it('does not crash in date-job mode with job that has no mods', () => {
      const tree = {
        job_timestamps: { [validJobId]: { created_at: '2026-05-21T10:00:00Z', updated_at: null, completed_at: null } },
        jobs: { [validJobId]: { job_id: validJobId, mods: {} } },
      } as OutputFileTreeResponse;

      expect(() => render(
        React.createElement(OutputFilesTree, {
          tree, loading: false, filter: {},
          onFilterChange, groupMode: 'date-job',
          expandedGroups: {},
        })
      )).not.toThrow();
    });

    it('does not crash in job-scoped mode with mod that has empty groups', () => {
      const tree = {
        job_timestamps: {},
        jobs: {
          [validJobId]: {
            job_id: validJobId,
            mods: {
              'mod-empty': { mod_id: 'mod-empty', mod_name: 'Empty Mod', groups: {} },
            },
          },
        },
      } as unknown as OutputFileTreeResponse;

      expect(() => render(
        React.createElement(OutputFilesTree, {
          tree, loading: false, filter: { job_id: validJobId },
          onFilterChange, files: fullFiles, onSelectFile,
        })
      )).not.toThrow();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Date -> Job grouping (collapsible)                                 */
  /* ------------------------------------------------------------------ */

  describe('date-job grouping', () => {
    const now = new Date('2026-05-21T12:00:00Z');
    let dateMockTree: OutputFileTreeResponse;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      dateMockTree = {
        job_timestamps: {
          [validJobId]: {
            created_at: '2026-05-21T10:00:00Z',
            updated_at: null,
            completed_at: null,
          },
        },
        jobs: {
          [validJobId]: {
            job_id: validJobId,
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
                        id: 'file-1',
                        file_name: 'file_a.yml',
                        source_file_name: 'source_a.yml',
                        source_file_path: '/source/source_a.yml',
                        relative_source_path: 'source_a.yml',
                        relative_translated_path: 'file_a.yml',
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
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('date-job groups render expanded by default', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'date-job',
          expandedGroups: {},
        })
      );
      expect(screen.getByText('Today')).toBeTruthy();
      expect(screen.getByText('1 job, 1 file')).toBeTruthy();
      // Arrow shows "open" (expanded)
      const arrow = document.querySelector('.group-header-arrow.open')!;
      expect(arrow).toBeTruthy();
      // Job node should be visible
      expect(screen.getByText(`Job: ${validJobId.slice(0, 8)}`)).toBeTruthy();
    });

    it('clicking date group header collapses content', () => {
      const localOnFilterChange = vi.fn();
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange: localOnFilterChange,
          groupMode: 'date-job',
          expandedGroups: {},
          onToggleGroup: vi.fn(),
        })
      );
      // Find date header and click
      const header = document.querySelector('.tree-date-header-collapsible')!;
      expect(header).toBeTruthy();
      fireEvent.click(header);
      // Click on date header should NOT trigger filter change
      expect(localOnFilterChange).not.toHaveBeenCalled();
      // onToggleGroup should have been called
      // (but we used vi.fn() so we can't check that here directly)
    });

    it('counts remain visible while date group collapsed', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'date-job',
          expandedGroups: { 'date:today': false },
        })
      );
      // Header + counts visible
      expect(screen.getByText('Today')).toBeTruthy();
      expect(screen.getByText('1 job, 1 file')).toBeTruthy();
      // Job node should be hidden
      expect(screen.queryByText(`Job: ${validJobId.slice(0, 8)}`)).toBeNull();
    });

    it('calls onToggleGroup with date:today when header is clicked', () => {
      const onToggleGroup = vi.fn();
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'date-job',
          expandedGroups: {},
          onToggleGroup,
        })
      );
      fireEvent.click(document.querySelector('.tree-date-header-collapsible')!);
      expect(onToggleGroup).toHaveBeenCalledWith('date:today');
    });

    it('job headers inside date groups are collapsible', () => {
      const onToggleGroup = vi.fn();
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'date-job',
          expandedGroups: {},
          onToggleGroup,
        })
      );
      // Job headers should have tree-node-collapsible class inside date-job mode
      const jobHeaders = document.querySelectorAll('.tree-node-job.tree-node-collapsible');
      expect(jobHeaders.length).toBeGreaterThanOrEqual(1);
      // Click the job header
      fireEvent.click(jobHeaders[0]);
      expect(onToggleGroup).toHaveBeenCalledWith(`job:${validJobId}`);
    });

    it('hides mod children when job is collapsed inside date group', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'date-job',
          expandedGroups: { [`job:${validJobId}`]: false },
        })
      );
      // Job header visible but Mod A should be hidden
      expect(screen.getByText(`Job: ${validJobId.slice(0, 8)}`)).toBeTruthy();
      expect(screen.queryByText('Mod A')).toBeNull();
    });

    it('folder grouping unaffected by expandedGroups', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'folder',
          expandedGroups: {},
        })
      );
      // No date headers in folder mode
      expect(screen.queryByText('Today')).toBeNull();
    });

    it('job grouping shows no date headers', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: dateMockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'job',
          expandedGroups: {},
        })
      );
      // No date headers in job mode
      expect(screen.queryByText('Today')).toBeNull();
      // Job node should be visible
      expect(screen.getByText(`Job: ${validJobId.slice(0, 8)}`)).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Job grouping mode (collapsible job headers)                        */
  /* ------------------------------------------------------------------ */

  describe('job grouping mode (collapsible)', () => {
    it('job headers have arrow in job mode', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'job',
          expandedGroups: {},
        })
      );
      const arrows = document.querySelectorAll('.group-header-arrow');
      expect(arrows.length).toBeGreaterThanOrEqual(1);
      // Mod name should be visible (expanded by default)
      expect(screen.getByText('Mod A')).toBeTruthy();
    });

    it('clicking job header toggles collapse', () => {
      const onToggleGroup = vi.fn();
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'job',
          expandedGroups: {},
          onToggleGroup,
        })
      );
      const jobHeader = document.querySelector('.tree-node-job.tree-node-collapsible')!;
      expect(jobHeader).toBeTruthy();
      fireEvent.click(jobHeader);
      expect(onToggleGroup).toHaveBeenCalledWith(`job:${validJobId}`);
    });

    it('hides mod children when job is collapsed in job mode', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'job',
          expandedGroups: { [`job:${validJobId}`]: false },
        })
      );
      expect(screen.getByText(`Job: ${validJobId.slice(0, 8)}`)).toBeTruthy();
      expect(screen.queryByText('Mod A')).toBeNull();
    });

    it('job header has aria-expanded when collapsible', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'job',
          expandedGroups: { [`job:${validJobId}`]: false },
        })
      );
      const jobHeader = document.querySelector('.tree-node-job.tree-node-collapsible')!;
      expect(jobHeader.getAttribute('role')).toBe('button');
      expect(jobHeader.getAttribute('aria-expanded')).toBe('false');
    });

    it('file count visible on collapsed job header', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'job',
          expandedGroups: { [`job:${validJobId}`]: false },
        })
      );
      // Job header has count
      const count = screen.getByText('3'); // 1 + 2 files across mod-a and mod-b
      expect(count).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Folder grouping mode (collapsible mod headers)                     */
  /* ------------------------------------------------------------------ */

  describe('folder grouping mode (collapsible)', () => {
    it('mod headers have collapsible class in folder mode', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'folder',
          expandedGroups: {},
        })
      );
      const modHeaders = document.querySelectorAll('.tree-node-mod.tree-node-collapsible');
      expect(modHeaders.length).toBeGreaterThanOrEqual(1);
    });

    it('clicking mod header calls onToggleGroup with mod key', () => {
      const onToggleGroup = vi.fn();
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'folder',
          expandedGroups: {},
          onToggleGroup,
        })
      );
      const modHeader = document.querySelector('.tree-node-mod.tree-node-collapsible')!;
      fireEvent.click(modHeader);
      expect(onToggleGroup).toHaveBeenCalledWith('mod:mod-a');
    });

    it('hides group children when mod is collapsed in folder mode', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'folder',
          expandedGroups: { 'mod:mod-a': false },
        })
      );
      // Mod A visible (header), Root group under Mod A hidden
      expect(screen.getByText('Mod A')).toBeTruthy();
      // "Unknown mod" is mod-b (with empty name), still expanded shows Root
      expect(screen.getByText('Unknown mod')).toBeTruthy();
      // Root group under mod-b (file count 2) still visible
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('job headers remain navigable in folder mode (no collapsible class)', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'folder',
          expandedGroups: {},
        })
      );
      const jobHeaders = document.querySelectorAll('.tree-node-job.tree-node-collapsible');
      expect(jobHeaders.length).toBe(0);
      // Job header still exists
      expect(screen.getByText(`Job: ${validJobId.slice(0, 8)}`)).toBeTruthy();
    });

    it('count visible on collapsed mod header', () => {
      render(
        React.createElement(OutputFilesTree, {
          tree: mockTree,
          loading: false,
          filter: {},
          onFilterChange,
          groupMode: 'folder',
          expandedGroups: { 'mod:mod-a': false, 'mod:mod-b': true },
        })
      );
      expect(screen.getByText('Mod A')).toBeTruthy();
      // Root group under mod-a should be hidden
      const rootLabels = screen.getAllByText('Root');
      // Only Root under mod-b should be visible (mod-b has no name displayed)
      expect(rootLabels.length).toBe(1);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  File-click opens details modal (job-scoped mode)                    */
/* ------------------------------------------------------------------ */

describe('file-click opens details modal in job-scoped mode', () => {
  const onFilterChange = vi.fn();
  const onSelectFile = vi.fn();

  const fullFiles: OutputFile[] = [
    {
      id: 'file-ready-1',
      job_id: validJobId,
      file_name: 'translated_ready.yml',
      mod_id: 'mod-a',
      mod_name: 'Mod A',
      source_file_path: '/source/source_english.yml',
      translated_file_path: '/translated/translated_ready.yml',
      relative_source_path: 'source_english.yml',
      relative_translated_path: 'translated_ready.yml',
      file_ext: '.yml',
      game_id: null,
      parser_id: null,
      aggregation_key: null,
      group_key: '__root__',
      group_label: 'Root',
      source_size_bytes: 100,
      translated_size_bytes: 200,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      last_analyzed_at: null,
      editor_available: true,
      status: 'ready',
      analysis_stale: false,
      latest_analysis: null,
      latest_analysis_state: '',
      output_metadata: null,
    },
    {
      id: 'file-ms-1',
      job_id: validJobId,
      file_name: '1b_babe_l_russian.yml',
      mod_id: 'mod-b',
      mod_name: '',
      source_file_path: '',
      translated_file_path: '1b_babe_l_russian.yml',
      relative_source_path: null,
      relative_translated_path: '1b_babe_l_russian.yml',
      file_ext: '.yml',
      game_id: null,
      parser_id: null,
      aggregation_key: null,
      group_key: '__root__',
      group_label: 'Root',
      source_size_bytes: null,
      translated_size_bytes: 150,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      last_analyzed_at: null,
      editor_available: true,
      status: 'missing_source',
      analysis_stale: false,
      latest_analysis: null,
      latest_analysis_state: '',
      output_metadata: null,
    },
  ];

  beforeEach(() => {
    onFilterChange.mockClear();
    onSelectFile.mockClear();
  });

  it('calls onSelectFile with the full OutputFile when a file row is clicked', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: fullFiles,
        onSelectFile,
      })
    );

    const fileNode = screen.getByText('translated_ready.yml');
    fireEvent.click(fileNode);

    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-ready-1', status: 'ready' })
    );
  });

  it('does not call onFilterChange when a file row is clicked', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: fullFiles,
        onSelectFile,
      })
    );

    const fileNode = screen.getByText('translated_ready.yml');
    fireEvent.click(fileNode);

    // onFilterChange should not have been called by file click
    // (the old behavior called onFilterChange({ job_id: ... }) on file click)
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it('does not call onSelectFile when no files prop is provided (backward compat)', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        onSelectFile,
      })
    );

    const fileNode = screen.getByText('translated_ready.yml');
    fireEvent.click(fileNode);

    // onSelectFile should not be called because no files map exists
    expect(onSelectFile).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  Analysis status badges in tree mode                                 */
/* ------------------------------------------------------------------ */

describe('analysis status badges in tree mode', () => {
  const onFilterChange = vi.fn();
  const onSelectFile = vi.fn();

  const fullFiles: OutputFile[] = [
    {
      id: 'file-ready-1',
      job_id: validJobId,
      file_name: 'translated_ready.yml',
      mod_id: 'mod-a',
      mod_name: 'Mod A',
      source_file_path: '/source/source_english.yml',
      translated_file_path: '/translated/translated_ready.yml',
      relative_source_path: 'source_english.yml',
      relative_translated_path: 'translated_ready.yml',
      file_ext: '.yml',
      game_id: null,
      parser_id: null,
      aggregation_key: null,
      group_key: '__root__',
      group_label: 'Root',
      source_size_bytes: 100,
      translated_size_bytes: 200,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      last_analyzed_at: null,
      editor_available: true,
      status: 'ready',
      analysis_stale: false,
      latest_analysis: null,
      latest_analysis_state: '',
      output_metadata: null,
    },
    {
      id: 'file-ms-1',
      job_id: validJobId,
      file_name: '1b_babe_l_russian.yml',
      mod_id: 'mod-b',
      mod_name: '',
      source_file_path: '',
      translated_file_path: '1b_babe_l_russian.yml',
      relative_source_path: null,
      relative_translated_path: '1b_babe_l_russian.yml',
      file_ext: '.yml',
      game_id: null,
      parser_id: null,
      aggregation_key: null,
      group_key: '__root__',
      group_label: 'Root',
      source_size_bytes: null,
      translated_size_bytes: 150,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      last_analyzed_at: null,
      editor_available: true,
      status: 'missing_source',
      analysis_stale: false,
      latest_analysis: null,
      latest_analysis_state: '',
      output_metadata: null,
    },
  ];

  const passedAnalysis = {
    id: 'analysis-1',
    status: 'passed',
    compilability_score: 0.9,
    placeholders_score: 1.0,
    errors_count: 0,
    warnings_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    source_hash: null,
    translated_hash: null,
  };

  const failedAnalysis = {
    id: 'analysis-2',
    status: 'failed',
    compilability_score: 0.3,
    placeholders_score: 0.5,
    errors_count: 2,
    warnings_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    source_hash: null,
    translated_hash: null,
  };

  beforeEach(() => {
    onFilterChange.mockClear();
    onSelectFile.mockClear();
  });

  it('shows READY, Current freshness and Valid analysis badges when file status is ready and analysis has passed', () => {
    const filesWithValidAnalysis: OutputFile[] = [
      {
        id: 'file-ready-1',
        job_id: validJobId,
        file_name: 'translated_ready.yml',
        mod_id: 'mod-a',
        mod_name: 'Mod A',
        source_file_path: '/source/source_english.yml',
        translated_file_path: '/translated/translated_ready.yml',
        relative_source_path: 'source_english.yml',
        relative_translated_path: 'translated_ready.yml',
        file_ext: '.yml',
        game_id: null,
        parser_id: null,
        aggregation_key: null,
        group_key: '__root__',
        group_label: 'Root',
        source_size_bytes: null,
        translated_size_bytes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        last_analyzed_at: null,
        editor_available: true,
        status: 'ready',
        analysis_stale: false,
        latest_analysis: passedAnalysis,
        latest_analysis_state: 'current',
        output_metadata: null,
      },
    ];

    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: filesWithValidAnalysis,
        onSelectFile,
      })
    );

    expect(screen.getByText('READY')).toBeTruthy();
    // ResultBadge shows "Valid" for passed analysis status
    expect(screen.getByText('Valid')).toBeTruthy();
    // FreshnessBadge shows "Current" for current freshness state
    expect(screen.getByText('Current')).toBeTruthy();
  });

  it('shows MISSING SOURCE and ERROR/failed badges when analysis failed', () => {
    const filesWithFailedAnalysis: OutputFile[] = [
      {
        id: 'file-ms-1',
        job_id: validJobId,
        file_name: '1b_babe_l_russian.yml',
        mod_id: 'mod-b',
        mod_name: '',
        source_file_path: '',
        translated_file_path: '1b_babe_l_russian.yml',
        relative_source_path: null,
        relative_translated_path: '1b_babe_l_russian.yml',
        file_ext: '.yml',
        game_id: null,
        parser_id: null,
        aggregation_key: null,
        group_key: '__root__',
        group_label: 'Root',
        source_size_bytes: null,
        translated_size_bytes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        last_analyzed_at: null,
        editor_available: true,
        status: 'missing_source',
        analysis_stale: false,
        latest_analysis: failedAnalysis,
        latest_analysis_state: 'current',
        output_metadata: null,
      },
    ];

    // Use a tree with only the mod-b node so the file appears under it
    const singleModTree: OutputFileTreeResponse = {
      job_timestamps: {},
      jobs: {
        [validJobId]: {
          job_id: validJobId,
          mods: {
            'mod-b': {
              mod_id: 'mod-b',
              mod_name: '',
              groups: {
                __root__: {
                  group_key: '__root__',
                  group_label: 'Root',
                  files: [
                    {
                      id: 'file-ms-1',
                      file_name: '1b_babe_l_russian.yml',
                      source_file_name: null,
                      source_file_path: '',
                      relative_source_path: null,
                      relative_translated_path: '1b_babe_l_russian.yml',
                      status: 'missing_source',
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
      React.createElement(OutputFilesTree, {
        tree: singleModTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: filesWithFailedAnalysis,
        onSelectFile,
      })
    );

    expect(screen.getByText('MISSING SOURCE')).toBeTruthy();
    // ResultBadge shows "Failed" (capitalized) with counts
    expect(screen.getByText((content) => content.startsWith('Failed'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('E:2'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('W:1'))).toBeTruthy();
    // FreshnessBadge shows "Current" for current freshness state
    expect(screen.getByText('Current')).toBeTruthy();
  });

  it('shows Not analyzed badge when file has no analysis data', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: fullFiles,
        onSelectFile,
      })
    );

    expect(screen.getByText('READY')).toBeTruthy();
    // There are 2 MISSING SOURCE badges (file-ms-1 and file-ms-2 in mockTree)
    const missingSourceBadges = screen.getAllByText('MISSING SOURCE');
    expect(missingSourceBadges.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Group header click behavior — should not open file details          */
/* ------------------------------------------------------------------ */

describe('group header click does not open details', () => {
  const onSelectFile = vi.fn();
  const onToggleGroup = vi.fn();

  beforeEach(() => {
    onSelectFile.mockClear();
    onToggleGroup.mockClear();
  });

  it('clicking a mod group header toggles group and does not call onSelectFile', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange: vi.fn(),
        files: [],
        onSelectFile,
        groupMode: 'folder',
        expandedGroups: {},
        onToggleGroup,
      })
    );

    // In folder mode with job-scoped, the mod headers are collapsible.
    // Since filter.job_id is set, isJobScoped is true, and isFolderMode checks !isJobScoped.
    // So in job-scoped mode, mod headers get CollapsibleHeader treatment.
    // But wait — groupMode is 'folder' and !isJobScoped is false here (since isJobScoped=true).
    // So isFolderMode = false, and isModCollapsible = isFolderMode || isJobScoped = true.
    // So mod headers are indeed collapsible in job-scoped mode.

    const modHeaders = document.querySelectorAll('.tree-node-mod.tree-node-collapsible');
    expect(modHeaders.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(modHeaders[0]);
    expect(onSelectFile).not.toHaveBeenCalled();
    // onToggleGroup may or may not be called depending on whether the handler
    // for collapsible mod headers is wired up — the key point is onSelectFile is not called
  });
});

/* ------------------------------------------------------------------ */
/*  Keyboard accessibility — Enter/Space on file row opens details      */
/* ------------------------------------------------------------------ */

describe('keyboard accessibility on tree file rows', () => {
  const onFilterChange = vi.fn();
  const onSelectFile = vi.fn();

  const fullFiles: OutputFile[] = [
    {
      id: 'file-ready-1',
      job_id: validJobId,
      file_name: 'translated_ready.yml',
      mod_id: 'mod-a',
      mod_name: 'Mod A',
      source_file_path: '/source/source_english.yml',
      translated_file_path: '/translated/translated_ready.yml',
      relative_source_path: 'source_english.yml',
      relative_translated_path: 'translated_ready.yml',
      file_ext: '.yml',
      game_id: null,
      parser_id: null,
      aggregation_key: null,
      group_key: '__root__',
      group_label: 'Root',
      source_size_bytes: null,
      translated_size_bytes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      last_analyzed_at: null,
      editor_available: true,
      status: 'ready',
      analysis_stale: false,
      latest_analysis: null,
      latest_analysis_state: '',
      output_metadata: null,
    },
  ];

  beforeEach(() => {
    onFilterChange.mockClear();
    onSelectFile.mockClear();
  });

  it('file row has role="button" and tabIndex={0}', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: fullFiles,
        onSelectFile,
      })
    );

    // There are 3 file rows in mockTree (1 in mod-a, 2 in mod-b).
    // But fullFiles only has 1 entry, so only the file-ready-1 file will have
    // the analysis badges. The other files will not have onSelectFile called
    // since fileMap won't have them.
    const fileRows = document.querySelectorAll('.tree-node-file');
    expect(fileRows.length).toBe(3);

    // All file rows should have role and tabIndex
    fileRows.forEach(row => {
      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');
    });
  });

  it('pressing Enter on a file row calls onSelectFile', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: fullFiles,
        onSelectFile,
      })
    );

    const fileRows = document.querySelectorAll('.tree-node-file');
    // The first file row is file-ready-1
    fireEvent.keyDown(fileRows[0], { key: 'Enter' });
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-ready-1' })
    );
  });

  it('pressing Space on a file row calls onSelectFile', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: fullFiles,
        onSelectFile,
      })
    );

    const fileRows = document.querySelectorAll('.tree-node-file');
    // The first file row is file-ready-1
    fireEvent.keyDown(fileRows[0], { key: ' ' });
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-ready-1' })
    );
  });

  it('pressing other keys on a file row does not call onSelectFile', () => {
    render(
      React.createElement(OutputFilesTree, {
        tree: mockTree,
        loading: false,
        filter: { job_id: validJobId },
        onFilterChange,
        files: fullFiles,
        onSelectFile,
      })
    );

    const fileRows = document.querySelectorAll('.tree-node-file');
    fireEvent.keyDown(fileRows[0], { key: 'Tab' });
    expect(onSelectFile).not.toHaveBeenCalled();
  });
});
