/* ------------------------------------------------------------------ */
/*  OutputFilesTree tests                                              */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { OutputFileTreeResponse } from '../../../api/types';
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
    it('calls onFilterChange with only job_id when a file node is clicked', () => {
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

      // MUST NOT pass group_key or mod_id — only job_id.
      expect(onFilterChange).toHaveBeenCalledTimes(1);
      const callArgs = onFilterChange.mock.calls[0][0];
      expect(callArgs).toEqual({ job_id: validJobId });
      expect(callArgs).not.toHaveProperty('group_key');
      expect(callArgs).not.toHaveProperty('mod_id');
    });

    it('does not set group_key to the file id when a missing_source file is clicked', () => {
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

      expect(onFilterChange).toHaveBeenCalledTimes(1);
      const callArgs = onFilterChange.mock.calls[0][0];
      expect(callArgs).toEqual({ job_id: validJobId });
      // This was the bug: group_key was set to the file's DB id
      expect(callArgs).not.toHaveProperty('group_key');
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
});
