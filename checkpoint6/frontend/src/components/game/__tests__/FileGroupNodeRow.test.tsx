/* ------------------------------------------------------------------ */
/*  Tests: FileGroupNodeRow / FileRow components                        */
/*                                                                      */
/*  Focus: recursive rendering, callbacks, progress badges, actions.    */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { FileGroupNodeRow } from '../FileGroupNodeRow';
import type { FileGroupNode } from '../../../domain/grouping/groupingTypes';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const SINGLE_LEVEL: FileGroupNode = {
  id: 'smart:root:test_files',
  label: 'test_files_*',
  relativePath: 'root',
  fileCount: 3,
  files: ['/root/test_a.txt', '/root/test_b.txt', '/root/test_c.txt'],
};

const NESTED_PARENT: FileGroupNode = {
  id: 'parent',
  label: 'Parent Group',
  relativePath: '',
  fileCount: 3,
  files: ['/root/a/1.txt', '/root/a/2.txt', '/root/b/3.txt'],
  children: [
    {
      id: 'child-a',
      label: 'Subgroup A',
      relativePath: 'a',
      fileCount: 2,
      files: ['/root/a/1.txt', '/root/a/2.txt'],
    },
    {
      id: 'child-b',
      label: 'Subgroup B',
      relativePath: 'b',
      fileCount: 1,
      files: ['/root/b/3.txt'],
    },
  ],
};

const EMPTY_NODE: FileGroupNode = {
  id: 'empty',
  label: 'Empty Group',
  relativePath: '',
  fileCount: 0,
  files: [],
};

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('FileGroupNodeRow', () => {
  const onToggleGroup = vi.fn();
  const onAddGroupToJob = vi.fn();
  const onTranslateGroup = vi.fn();
  const isFileInDraft = vi.fn().mockReturnValue(false);
  const onToggleFile = vi.fn();
  const onToggleDraftFile = vi.fn();
  const onOpenFolder = vi.fn();

  const defaultProps = {
    depth: 0,
    expandedGroups: new Set<string>(),
    rootDir: '/root',
    onToggleGroup,
    onAddGroupToJob,
    onTranslateGroup,
    isFileInDraft,
    selectedFiles: new Set<string>(),
    onToggleFile,
    onToggleDraftFile,
    onOpenFolder,
    draftPathSet: new Set<string>(),
  };

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  describe('single-level rendering', () => {
    it('renders group header with label and file count', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
        }),
      );

      expect(screen.getByText('test_files_*')).toBeTruthy();
      expect(screen.getByText('root')).toBeTruthy();
      expect(screen.getByText('3 files')).toBeTruthy();
    });

    it('shows action buttons (Add group, Translate, Open folder)', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
        }),
      );

      expect(screen.getByText('Add group to Translation Job')).toBeTruthy();
      expect(screen.getByText('Translate group')).toBeTruthy();
      expect(screen.getByText('Open folder')).toBeTruthy();
    });

    it('shows file rows when expanded', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          expandedGroups: new Set(['smart:root:test_files']),
        }),
      );

      // File rows show relative paths (not full paths)
      expect(screen.getByText('test_a.txt')).toBeTruthy();
      expect(screen.getByText('test_b.txt')).toBeTruthy();
      expect(screen.getByText('test_c.txt')).toBeTruthy();

      // Each file should have Add to Translation Job and Open folder buttons
      const addButtons = screen.getAllByText('Add to Translation Job');
      expect(addButtons.length).toBeGreaterThanOrEqual(3);
    });

    it('calls onToggleDraftFile when file-level add button is clicked', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          expandedGroups: new Set(['smart:root:test_files']),
        }),
      );

      const addButtons = screen.getAllByText('Add to Translation Job');
      fireEvent.click(addButtons[0]);
      expect(onToggleDraftFile).toHaveBeenCalledWith('/root/test_a.txt');
    });

    it('calls onToggleFile when file checkbox is clicked', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          expandedGroups: new Set(['smart:root:test_files']),
        }),
      );

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);
      expect(onToggleFile).toHaveBeenCalledWith('/root/test_a.txt');
    });

    it('hides file checkboxes when selectable={false}', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          expandedGroups: new Set(['smart:root:test_files']),
          selectable: false,
        }),
      );

      // No checkboxes should be rendered
      expect(screen.queryByRole('checkbox')).toBeNull();

      // File-level draft actions should still be present
      expect(screen.getAllByText('Add to Translation Job').length).toBeGreaterThanOrEqual(3);
    });

    it('selectable={false} works without selectedFiles/onToggleFile props', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          expandedGroups: new Set(['smart:root:test_files']),
          selectable: false,
          // Intentionally omit selectedFiles, onToggleFile to test optional props
        }),
      );

      // No checkboxes rendered
      expect(screen.queryByRole('checkbox')).toBeNull();

      // File-level draft actions still present
      expect(screen.getAllByText('Add to Translation Job').length).toBeGreaterThanOrEqual(3);
      expect(screen.getByText('Add group to Translation Job')).toBeTruthy();
      expect(screen.getAllByText('Open folder').length).toBeGreaterThanOrEqual(1);
    });

    it('calls onOpenFolder with file path from file row', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          expandedGroups: new Set(['smart:root:test_files']),
        }),
      );

      // [0] is group-level "Open folder" (opens parent dir),
      // [1] is first file-level "Open folder"
      const openFolderButtons = screen.getAllByText('Open folder');
      fireEvent.click(openFolderButtons[1]);
      expect(onOpenFolder).toHaveBeenCalledWith('/root/test_a.txt');
    });

    it('calls onOpenFolder with parent dir from group action', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
        }),
      );

      const openFolderButtons = screen.getAllByText('Open folder');
      fireEvent.click(openFolderButtons[0]);
      expect(onOpenFolder).toHaveBeenCalledWith('/root');
    });

    it('calls onToggleGroup when header is clicked', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
        }),
      );

      fireEvent.click(screen.getByText('test_files_*'));
      expect(onToggleGroup).toHaveBeenCalledWith('smart:root:test_files');
    });

    it('calls onAddGroupToJob with node when group action clicked', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
        }),
      );

      fireEvent.click(screen.getByText('Add group to Translation Job'));
      expect(onAddGroupToJob).toHaveBeenCalledWith(SINGLE_LEVEL);
    });

    it('calls onTranslateGroup with node when translate action clicked', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
        }),
      );

      fireEvent.click(screen.getByText('Translate group'));
      expect(onTranslateGroup).toHaveBeenCalledWith(SINGLE_LEVEL);
    });

    it('shows "All added" button when all files in draft', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          isFileInDraft: vi.fn().mockReturnValue(true),
        }),
      );

      expect(screen.getByText('All added')).toBeTruthy();
      expect(screen.queryByText('Add group to Translation Job')).toBeNull();
    });
  });

  describe('empty node', () => {
    it('renders nothing for empty group (no files, no children)', () => {
      const { container } = render(
        React.createElement(FileGroupNodeRow, {
          node: EMPTY_NODE,
          ...defaultProps,
        }),
      );

      // The root loc-group-item div should exist but header should be null
      const groupItems = container.querySelectorAll('.loc-group-item');
      expect(groupItems.length).toBe(1);

      // No header should be rendered
      expect(container.querySelector('.loc-group-header')).toBeNull();
      expect(container.querySelector('.loc-group-actions')).toBeNull();
    });
  });

  describe('nested (recursive) rendering', () => {
    it('renders parent header with child groups nested', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a', 'child-b']),
        }),
      );

      // Parent header
      expect(screen.getByText('Parent Group')).toBeTruthy();
      expect(screen.getByText('3 files')).toBeTruthy();

      // Child headers
      expect(screen.getByText('Subgroup A')).toBeTruthy();
      expect(screen.getByText('Subgroup B')).toBeTruthy();

      // Child files (shown as relative paths from rootDir = /root)
      expect(screen.getByText('a/1.txt')).toBeTruthy();
      expect(screen.getByText('a/2.txt')).toBeTruthy();
      expect(screen.getByText('b/3.txt')).toBeTruthy();
    });

    it('indents child groups', () => {
      const { container } = render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a']),
        }),
      );

      // Depth 0: parent → no marginLeft
      const groupItems = container.querySelectorAll('.loc-group-item');

      // First item (parent) should have no inline margin
      expect((groupItems[0] as HTMLElement).style.marginLeft).toBe('');

      // Second item (child-a at depth 1) should have indentation
      expect((groupItems[1] as HTMLElement).style.marginLeft).toBe('0.5rem');

      // Third item (child-b at depth 1) should have indentation
      expect((groupItems[2] as HTMLElement).style.marginLeft).toBe('0.5rem');
    });

    it('calls onToggleDraftFile for nested file rows', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a']),
        }),
      );

      const addButtons = screen.getAllByText('Add to Translation Job');
      fireEvent.click(addButtons[0]);
      // First call should be for child-a's first file
      expect(onToggleDraftFile).toHaveBeenCalledWith('/root/a/1.txt');
    });

    it('parent collapse hides children', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['child-a', 'child-b']), // parent NOT expanded
        }),
      );

      // Parent header visible
      expect(screen.getByText('Parent Group')).toBeTruthy();

      // Children should NOT be visible
      expect(screen.queryByText('Subgroup A')).toBeNull();
      expect(screen.queryByText('Subgroup B')).toBeNull();
      expect(screen.queryByText('1.txt')).toBeNull();
    });

    it('group action on nested child works', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a']),
        }),
      );

      // Parent's "Add group" button is [0], child-a's is [1] in DOM order
      const addGroupButtons = screen.getAllByText('Add group to Translation Job');
      expect(addGroupButtons.length).toBeGreaterThanOrEqual(2);
      fireEvent.click(addGroupButtons[1]);

      // Should call onAddGroupToJob with child-a node
      expect(onAddGroupToJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'child-a' }),
      );
    });

    it('shows "All added" for nested child when all files in draft', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a']),
          isFileInDraft: vi.fn((fp: string) => fp.startsWith('/root/a/')),
        }),
      );

      // child-a's files are all '/root/a/...' so they match the isFileInDraft stub
      // The add group button should be "All added" for child-a
      // But child-b's files are NOT in draft, so it still shows "Add group"
      const allAddedButtons = screen.getAllByText('All added');
      expect(allAddedButtons.length).toBeGreaterThanOrEqual(1);

      const addGroupButtons = screen.getAllByText('Add group to Translation Job');
      expect(addGroupButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('renders group-level open folder for nested children', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a']),
        }),
      );

      // Each child has its own "Open folder" in group actions
      // child-a has files, so it renders group-level "Open folder"
      const openFolderButtons = screen.getAllByText('Open folder');
      // All buttons should be there
      expect(openFolderButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('hides checkboxes for nested rows when selectable={false}', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a']),
          selectable: false,
        }),
      );

      // No checkboxes in any nested level
      expect(screen.queryByRole('checkbox')).toBeNull();

      // File-level draft actions should still be present
      expect(screen.getAllByText('Add to Translation Job').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('progress badge', () => {
    it('shows partial progress badge when some files in draft', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          draftPathSet: new Set([normalize('/root/test_a.txt')]),
          isFileInDraft: vi.fn((fp: string) => fp === '/root/test_a.txt'),
        }),
      );

      expect(screen.getByText('1/3 added')).toBeTruthy();
    });

    it('shows "All added" badge when all files in draft', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          isFileInDraft: vi.fn().mockReturnValue(true),
        }),
      );

      expect(screen.getByText('All added')).toBeTruthy();
    });

    it('applies loc-group-has-added class when progress is partial', () => {
      const { container } = render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
          draftPathSet: new Set([normalize('/root/test_a.txt')]),
          isFileInDraft: vi.fn((fp: string) => fp === '/root/test_a.txt'),
        }),
      );

      const groupItem = container.querySelector('.loc-group-item');
      expect(groupItem?.className).toContain('loc-group-has-added');
    });

    it('does not apply loc-group-has-added when progress is all or none', () => {
      const { container } = render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLE_LEVEL,
          ...defaultProps,
        }),
      );

      const groupItem = container.querySelector('.loc-group-item');
      expect(groupItem?.className).not.toContain('loc-group-has-added');
    });
  });

  describe('Open folder path hardening', () => {
    it('group Open folder uses real filesystem path, not display id/relativePath', () => {
      // Simulate a group where display fields resemble a relative
      // grouping path but the underlying files are absolute.
      const node: FileGroupNode = {
        id: '1121692237/localisation/braz_por/random_names',
        label: 'random_names',
        relativePath: '1121692237/localisation/braz_por/random_names',
        fileCount: 1,
        files: ['/real/root/1121692237/localisation/braz_por/random_names/foo.yml'],
      };
      render(
        React.createElement(FileGroupNodeRow, {
          node,
          ...defaultProps,
          rootDir: '/real/root',
        }),
      );

      const openFolderButtons = screen.getAllByText('Open folder');
      // [0] is group-level "Open folder"
      fireEvent.click(openFolderButtons[0]);

      // Must NOT be called with node.id, node.label, or node.relativePath
      expect(onOpenFolder).not.toHaveBeenCalledWith(node.id);
      expect(onOpenFolder).not.toHaveBeenCalledWith(node.relativePath);
      // Must be called with the real parent directory
      expect(onOpenFolder).toHaveBeenCalledWith(
        '/real/root/1121692237/localisation/braz_por/random_names',
      );
    });

    it('synthetic group Open folder uses common parent directory', () => {
      // Simulate a "smart" filename-family group with two files
      // that share the same real parent directory.
      const node: FileGroupNode = {
        id: 'smart:subdir:giga_',
        label: 'giga_*',
        relativePath: 'subdir',
        fileCount: 2,
        files: [
          '/real/root/subdir/giga_birch_natives_names_english.yml',
          '/real/root/subdir/giga_birch_natives_names_french.yml',
        ],
      };
      render(
        React.createElement(FileGroupNodeRow, {
          node,
          ...defaultProps,
          rootDir: '/real/root',
        }),
      );

      const openFolderButtons = screen.getAllByText('Open folder');
      fireEvent.click(openFolderButtons[0]);

      // Must use the common parent directory of the real file paths,
      // not the synthetic group id or relativePath
      expect(onOpenFolder).toHaveBeenCalledWith('/real/root/subdir');
    });

    it('file row Open folder uses actual absolute file path, not display label', () => {
      // FileRow receives an absolute filePath and displays a relative
      // relativePath. Open folder must use the absolute path.
      const node: FileGroupNode = {
        id: 'smart:root:test_files',
        label: 'test_files_*',
        relativePath: 'root',
        fileCount: 1,
        files: ['/real/root/1121692237/localisation/foo.yml'],
      };
      render(
        React.createElement(FileGroupNodeRow, {
          node,
          ...defaultProps,
          rootDir: '/real/root',
          expandedGroups: new Set([node.id]),
        }),
      );

      // File row shows the relative path as display text
      expect(screen.getByText('1121692237/localisation/foo.yml')).toBeTruthy();

      // The Open folder button is the 2nd one (index 1) — first is group-level
      const openFolderButtons = screen.getAllByText('Open folder');
      fireEvent.click(openFolderButtons[1]);

      // Must use the actual absolute file path, not the display text
      expect(onOpenFolder).toHaveBeenCalledWith(
        '/real/root/1121692237/localisation/foo.yml',
      );
    });
  });  // closes describe('Open folder path hardening')

  describe('flattenSingletons', () => {
    const SINGLETON: FileGroupNode = {
      id: 'file:file.yml',
      label: 'file.yml',
      fileCount: 1,
      files: ['/root/file.yml'],
    };

    const MULTI_FILE: FileGroupNode = {
      id: 'name:group',
      label: 'group',
      fileCount: 2,
      files: ['/root/a.yml', '/root/b.yml'],
    };

    it('flattenSingletons=true renders leaf single file as FileRow (no group header)', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLETON,
          ...defaultProps,
          flattenSingletons: true,
        }),
      );

      // FileRow content should be rendered directly (no group header)
      expect(screen.getByText('file.yml')).toBeTruthy(); // FileRow basename
      // No group header elements
      expect(screen.queryByText('1 file')).toBeNull();
      expect(screen.queryByText('Add group to Translation Job')).toBeNull();
      // No arrow indicator (group header)
      expect(document.querySelector('.loc-group-arrow')).toBeNull();
    });

    it('flattenSingletons=false (default) renders singleton with group header', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLETON,
          ...defaultProps,
          // flattenSingletons not passed (defaults to false)
        }),
      );

      // Group header should render
      expect(screen.getByText('file.yml')).toBeTruthy();
      expect(screen.getByText('1 file')).toBeTruthy();
      // Group actions should be visible
      expect(screen.getByText('Add group to Translation Job')).toBeTruthy();
      expect(screen.getByText('Translate group')).toBeTruthy();
      // Expand arrow should be present
      expect(document.querySelector('.loc-group-arrow')).toBeTruthy();
    });

    it('flattenSingletons=true keeps multi-file group as expandable header', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: MULTI_FILE,
          ...defaultProps,
          flattenSingletons: true,
        }),
      );

      // Group header with label and count should render
      expect(screen.getByText('group')).toBeTruthy();
      expect(screen.getByText('2 files')).toBeTruthy();
      expect(screen.getByText('Add group to Translation Job')).toBeTruthy();
      // Arrow should be visible
      expect(document.querySelector('.loc-group-arrow')).toBeTruthy();
    });

    it('flattenSingletons=true expands multi-file group to show FileRows', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: MULTI_FILE,
          ...defaultProps,
          expandedGroups: new Set([MULTI_FILE.id]),
          flattenSingletons: true,
        }),
      );

      // File rows visible when expanded
      expect(screen.getByText('a.yml')).toBeTruthy();
      expect(screen.getByText('b.yml')).toBeTruthy();
    });

    it('flattenSingletons=true does NOT flatten directory nodes with children', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          flattenSingletons: true,
        }),
      );

      // Parent group header should still render
      expect(screen.getByText('Parent Group')).toBeTruthy();
      expect(screen.getByText('3 files')).toBeTruthy();

      // child-b (singleton fileCount=1) should be rendered directly when expanded
      // if flattenSingletons is passed down recursively
    });

    it('recursive flattenSingletons: singleton child renders as FileRow when parent expanded', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-b']),
          flattenSingletons: true,
        }),
      );

      // child-b is a singleton (1 file, no children) → should be flattened
      // child-b's file should render directly as a FileRow, not as a group header
      expect(screen.getByText('b/3.txt')).toBeTruthy();
      // There should be no separate group header for child-b (no ▶ for the file)
      // Only parent's and child-a's arrows should exist
      const arrows = document.querySelectorAll('.loc-group-arrow');
      expect(arrows.length).toBe(2); // parent + child-a (child-b has no arrow)
    });

    it('recursive flattenSingletons: multi-file child still renders as group header', () => {
      render(
        React.createElement(FileGroupNodeRow, {
          node: NESTED_PARENT,
          ...defaultProps,
          expandedGroups: new Set(['parent', 'child-a']),
          flattenSingletons: true,
        }),
      );

      // child-a has 2 files → NOT a singleton, should still render as group
      expect(screen.getByText('Subgroup A')).toBeTruthy();
      expect(screen.getByText('2 files')).toBeTruthy();
      // Group actions should be visible (parent + child-a)
      const addGroupBtns = screen.getAllByText('Add group to Translation Job');
      expect(addGroupBtns.length).toBe(2);
    });

    it('singleton with customFileActions preserves file actions after flatten', () => {
      const CustomAction = () => React.createElement('button', null, 'Set source');
      render(
        React.createElement(FileGroupNodeRow, {
          node: SINGLETON,
          ...defaultProps,
          flattenSingletons: true,
          selectable: false,
          customFileActions: () => React.createElement(CustomAction),
        }),
      );

      // File-level custom action should be rendered
      expect(screen.getByText('Set source')).toBeTruthy();
      // File-level Open folder should be rendered
      expect(screen.getByText('Open folder')).toBeTruthy();
    });
  });
});

/** Inline helper — mirrors how normalizePath works in the production code. */
function normalize(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').trim();
}
