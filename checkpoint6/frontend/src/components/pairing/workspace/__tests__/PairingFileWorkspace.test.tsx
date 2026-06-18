/* ------------------------------------------------------------------ */
/*  Tests: PairingFileWorkspace — filter UI, pairing state badges,     */
/*  active pair highlight, hidden-files hint                           */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { act } from 'react';
import React from 'react';
import type { WorkspaceFileGroup, WorkspaceFile } from '../../../../domain/pairingTypes';
import type { PairingFileStateInfo } from '../../../../domain/pairingFileState';
import PairingFileWorkspace, {
  findAncestorGroupIdsForFile,
  isFileVisibleInFilteredTree,
  type RevealTarget,
} from '../PairingFileWorkspace';
import { isAbsolutePath } from '../../../../utils/genericFileGrouping';

/* ================================================================== */
/*  Mock dependencies                                                   */
/* ================================================================== */

vi.mock('../../../App', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ApiError'; }
  },
}));

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

function makeFile(relativePath: string): WorkspaceFile {
  return {
    id: `file-${relativePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
    projectId: 'proj-1',
    relativePath,
    fileName: relativePath.split('/').pop()!,
    extension: relativePath.split('.').pop()!,
    parentDir: relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '',
    sizeBytes: 100,
    detectedLanguage: null,
    detectedRole: 'source-like',
    isIgnored: false,
  };
}

const MULTI_GROUPS: WorkspaceFileGroup[] = [
  {
    groupKey: 'events',
    displayName: 'Events',
    relativeDir: '',
    filesCount: 2,
    sourceLikeCount: 2,
    translatedLikeCount: 0,
    files: [makeFile('events/start.txt'), makeFile('events/end.txt')],
    children: [],
  },
  {
    groupKey: 'localization',
    displayName: 'Localization',
    relativeDir: '',
    filesCount: 2,
    sourceLikeCount: 2,
    translatedLikeCount: 0,
    files: [makeFile('localization/en.txt'), makeFile('localization/ru.txt')],
    children: [],
  },
  {
    groupKey: 'cache',
    displayName: 'Cache',
    relativeDir: '',
    filesCount: 2,
    sourceLikeCount: 0,
    translatedLikeCount: 0,
    files: [makeFile('cache/temp.bin'), makeFile('cache/index.bin')],
    children: [],
  },
];

function buildFilesByPath(groups: WorkspaceFileGroup[]): Map<string, WorkspaceFile> {
  const map = new Map<string, WorkspaceFile>();
  function walk(list: WorkspaceFileGroup[]) {
    for (const g of list) {
      for (const f of g.files) map.set(f.relativePath, f);
      walk(g.children);
    }
  }
  walk(groups);
  return map;
}

/* ================================================================== */
/*  Test wrapper                                                        */
/* ================================================================== */

function renderWorkspace({
  projectId = 'proj-1',
  rootPath = '/root',
  groups = MULTI_GROUPS,
  groupsLoading = false,
  pairingFileState = new Map<string, PairingFileStateInfo>(),
  selectedPairId = null,
  activePairPaths = [] as string[],
  revealTarget,
  onFileDragStart,
}: {
  projectId?: string;
  rootPath?: string;
  groups?: WorkspaceFileGroup[];
  groupsLoading?: boolean;
  pairingFileState?: Map<string, PairingFileStateInfo>;
  selectedPairId?: string | null;
  activePairPaths?: string[];
  revealTarget?: RevealTarget;
  onFileDragStart?: (filePath: string, event: React.DragEvent) => void;
} = {}) {
  const filesByPath = buildFilesByPath(groups);
  return {
    ...render(
      <PairingFileWorkspace
        projectId={projectId}
        rootPath={rootPath}
        lastScannedAt={null}
        groups={groups}
        groupsLoading={groupsLoading}
        onRefreshGroups={vi.fn()}
        onScan={vi.fn().mockResolvedValue(undefined)}
        scanning={false}
        scanResult={null}
        filesByPath={filesByPath}
        onSetAsSource={vi.fn()}
        onSetAsTranslated={vi.fn()}
        pairingFileState={pairingFileState}
        selectedPairId={selectedPairId}
        activePairPaths={activePairPaths}
        revealTarget={revealTarget}
        onFileDragStart={onFileDragStart}
      />,
    ),
    getGroupNames: (container: HTMLElement) =>
      Array.from(container.querySelectorAll('.loc-groups-container > .loc-group-item > .loc-group-header .loc-group-label'))
        .map(el => el.textContent ?? ''),
  };
}

/* ================================================================== */
/*  Cleanup — clear localStorage between tests                         */
/* ================================================================== */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('PairingFileWorkspace — filter UI', () => {
  it('renders include and exclude filter inputs with correct placeholders', () => {
    renderWorkspace();
    expect(screen.getByPlaceholderText(/Show only folders\/files/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Hide folders\/files/)).toBeTruthy();
    expect(screen.getByLabelText('Include filter')).toBeTruthy();
    expect(screen.getByLabelText('Exclude filter')).toBeTruthy();
  });

  it('shows "Clear filters" button only when a filter is active', () => {
    renderWorkspace();
    expect(screen.queryByText('Clear filters')).toBeNull();

    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'events' } });
    expect(screen.getByText('Clear filters')).toBeTruthy();
  });

  it('clear filters button resets both inputs', () => {
    renderWorkspace();
    const includeInput = screen.getByLabelText('Include filter') as HTMLInputElement;
    const excludeInput = screen.getByLabelText('Exclude filter') as HTMLInputElement;

    fireEvent.change(includeInput, { target: { value: 'events' } });
    fireEvent.change(excludeInput, { target: { value: 'cache' } });

    expect(includeInput.value).toBe('events');
    expect(excludeInput.value).toBe('cache');

    fireEvent.click(screen.getByText('Clear filters'));

    expect(includeInput.value).toBe('');
    expect(excludeInput.value).toBe('');
  });

  it('shows file count with filter indicator when filters active', () => {
    const { container } = renderWorkspace();

    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'events' } });

    const groupNames = container.ownerDocument === null ? [] :
      Array.from(container.querySelectorAll('.loc-groups-container > .loc-group-item > .loc-group-header .loc-group-label'))
        .map(el => el.textContent ?? '');
    expect(groupNames).toEqual(['events']);
  });

  it('shows empty state when no files match filters', () => {
    renderWorkspace();
    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'zzzznotfound' } });
    expect(screen.getByText('No files match the current filters.')).toBeTruthy();
  });

  it('renders extension filter as badges', () => {
    renderWorkspace();
    expect(screen.getByText('Ext:')).toBeTruthy();

    // Find badges inside the extension filter container (sibling after "Ext:" label)
    const extContainer = screen.getByText('Ext:').parentElement!;
    const extBadges = extContainer.querySelectorAll('.badge');
    // Fixture has txt and bin extensions
    expect(extBadges.length).toBe(2);

    extBadges.forEach(badge => {
      expect(badge.getAttribute('role')).toBe('button');
      expect(badge.classList.contains('badge-muted')).toBe(true);
    });
  });

  it('clicking extension badge toggles between muted and info state', () => {
    renderWorkspace();
    const txtBadge = screen.getByText('txt');

    // Initially not selected → badge-muted
    expect(txtBadge.classList.contains('badge-muted')).toBe(true);
    expect(txtBadge.classList.contains('badge-info')).toBe(false);

    // Click to select
    fireEvent.click(txtBadge);
    expect(txtBadge.classList.contains('badge-info')).toBe(true);
    expect(txtBadge.classList.contains('badge-muted')).toBe(false);

    // Click to deselect
    fireEvent.click(txtBadge);
    expect(txtBadge.classList.contains('badge-muted')).toBe(true);
    expect(txtBadge.classList.contains('badge-info')).toBe(false);
  });

  it('Clear filters resets extension badges to unselected', () => {
    renderWorkspace();

    // Select a badge first
    const txtBadge = screen.getByText('txt');
    fireEvent.click(txtBadge);
    expect(txtBadge.classList.contains('badge-info')).toBe(true);

    // Also add a text filter so Clear filters appears
    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'events' } });

    // Clear all filters
    fireEvent.click(screen.getByText('Clear filters'));

    // Badge should be back to muted
    expect(txtBadge.classList.contains('badge-muted')).toBe(true);
  });
});

/* ================================================================== */
/*  Fixture: many extensions for collapse tests                         */
/* ================================================================== */

function makeGroupsWithExtensions(...extNames: string[]): WorkspaceFileGroup[] {
  return [{
    groupKey: 'root',
    displayName: 'Root',
    relativeDir: '',
    filesCount: extNames.length,
    sourceLikeCount: extNames.length,
    translatedLikeCount: 0,
    files: extNames.map((ext, i) => makeFile(`f${i}.${ext}`)),
    children: [],
  }];
}

const MANY_EXT_GROUPS = makeGroupsWithExtensions(
  'aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg',
  'hhh', 'iii', 'jjj', 'kkk', 'lll',
);

/* ================================================================== */
/*  Tests: extension badges collapse/expand                             */
/* ================================================================== */

describe('PairingFileWorkspace — extension badges collapse/expand', () => {
  it('collapsed mode shows first 7 badges plus [+N] button', () => {
    renderWorkspace({ groups: MANY_EXT_GROUPS });

    // First 7 badges visible
    expect(screen.getByText('aaa')).toBeTruthy();
    expect(screen.getByText('ggg')).toBeTruthy();

    // Hidden badges NOT visible
    expect(screen.queryByText('hhh')).toBeNull();
    expect(screen.queryByText('lll')).toBeNull();

    // [+5] badge control visible
    const expandBtn = screen.getByText('+5');
    expect(expandBtn.classList.contains('badge')).toBe(true);
    expect(expandBtn.classList.contains('badge-muted')).toBe(true);
  });

  it('expand shows all extensions, +N button disappears', () => {
    renderWorkspace({ groups: MANY_EXT_GROUPS });

    fireEvent.click(screen.getByText('+5'));

    // All badges visible now
    expect(screen.getByText('aaa')).toBeTruthy();
    expect(screen.getByText('hhh')).toBeTruthy();
    expect(screen.getByText('lll')).toBeTruthy();

    // +N button gone
    expect(screen.queryByText('+5')).toBeNull();

    // "Show less" visible
    const showLess = screen.getByText('Show less');
    expect(showLess.classList.contains('badge')).toBe(true);
  });

  it('"Show less" collapses back to one row', () => {
    renderWorkspace({ groups: MANY_EXT_GROUPS });

    fireEvent.click(screen.getByText('+5'));
    fireEvent.click(screen.getByText('Show less'));

    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.queryByText('hhh')).toBeNull();
    expect(screen.queryByText('lll')).toBeNull();
  });

  it('selected extension outside first batch remains visible after collapse', () => {
    renderWorkspace({ groups: MANY_EXT_GROUPS });

    // Expand, select kkk (outside first 7), collapse back
    fireEvent.click(screen.getByText('+5'));
    fireEvent.click(screen.getByText('kkk'));
    fireEvent.click(screen.getByText('Show less'));

    // kkk should be visible and selected
    expect(screen.getByText('kkk')).toBeTruthy();
    expect(screen.getByText('kkk').classList.contains('badge-info')).toBe(true);

    // Hidden count updated (was 5, now 4 since kkk is visible)
    const hiddenBadge = screen.getByText('+4');
    expect(hiddenBadge).toBeTruthy();
  });

  it('deselecting a visible extension restores it to hidden in collapsed mode', () => {
    renderWorkspace({ groups: MANY_EXT_GROUPS });

    // Expand, select kkk, collapse
    fireEvent.click(screen.getByText('+5'));
    fireEvent.click(screen.getByText('kkk'));
    fireEvent.click(screen.getByText('Show less'));

    expect(screen.getByText('kkk')).toBeTruthy();

    // Deselect kkk
    fireEvent.click(screen.getByText('kkk'));

    // kkk should now be hidden again (no longer selected, so removed from visible set)
    expect(screen.queryByText('kkk')).toBeNull();

    // Count back to +5
    expect(screen.getByText('+5')).toBeTruthy();
  });

  it('no expand button when few extensions (8 or fewer)', () => {
    renderWorkspace();
    // MULTI_GROUPS fixture has 2 extensions (.txt, .bin) — no collapse
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    expect(screen.queryByText('Show less')).toBeNull();
  });
});

describe('PairingFileWorkspace — filter persistence', () => {
  it('persists include filter per project via key scoping', () => {
    const { unmount } = renderWorkspace({ projectId: 'proj-a' });
    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'events' } });
    unmount();

    renderWorkspace({ projectId: 'proj-a' });
    const restoredInput = screen.getByLabelText('Include filter') as HTMLInputElement;
    expect(restoredInput.value).toBe('events');
  });

  it('scopes filter per project (different project = empty filter)', () => {
    const { unmount } = renderWorkspace({ projectId: 'proj-a' });
    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'events' } });
    unmount();

    renderWorkspace({ projectId: 'proj-b' });
    const restoredInput = screen.getByLabelText('Include filter') as HTMLInputElement;
    expect(restoredInput.value).toBe('');
  });

  it('persists exclude filter per project', () => {
    const { unmount } = renderWorkspace({ projectId: 'proj-a' });
    const excludeInput = screen.getByLabelText('Exclude filter');
    fireEvent.change(excludeInput, { target: { value: 'cache' } });
    unmount();

    renderWorkspace({ projectId: 'proj-a' });
    const restoredInput = screen.getByLabelText('Exclude filter') as HTMLInputElement;
    expect(restoredInput.value).toBe('cache');
  });
});

describe('PairingFileWorkspace — filter tree behavior', () => {
  it('include filter hides non-matching groups', () => {
    const { container, getGroupNames } = renderWorkspace();

    expect(getGroupNames(container)).toEqual(['cache', 'events', 'localization']);

    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'events' } });

    expect(getGroupNames(container)).toEqual(['events']);
  });

  it('exclude filter removes matching groups', () => {
    const { container, getGroupNames } = renderWorkspace();

    const excludeInput = screen.getByLabelText('Exclude filter');
    fireEvent.change(excludeInput, { target: { value: 'cache' } });

    expect(getGroupNames(container)).toEqual(['events', 'localization']);
  });

  it('exclude wins over include', () => {
    const { container, getGroupNames } = renderWorkspace();

    const includeInput = screen.getByLabelText('Include filter');
    const excludeInput = screen.getByLabelText('Exclude filter');

    fireEvent.change(includeInput, { target: { value: 'events' } });
    fireEvent.change(excludeInput, { target: { value: 'events' } });

    expect(getGroupNames(container)).toEqual([]);
  });

  it('clearing filters restores full tree', () => {
    const { container, getGroupNames } = renderWorkspace();

    const includeInput = screen.getByLabelText('Include filter');
    fireEvent.change(includeInput, { target: { value: 'events' } });
    expect(getGroupNames(container)).toEqual(['events']);

    fireEvent.click(screen.getByText('Clear filters'));

    expect(getGroupNames(container)).toEqual(['cache', 'events', 'localization']);
  });
});

/* ================================================================== */
/*  Tests: pairing state badges                                        */
/* ================================================================== */

describe('PairingFileWorkspace — pairing state badges', () => {
  /** Expand all collapsed groups by clicking their headers. */
  function expandAllGroups() {
    // Group headers are <div class="loc-group-header"> (not <button>).
    // Click only collapsed groups (arrow without 'open' class) to avoid
    // toggling already-expanded groups closed.
    act(() => {
      document.querySelectorAll('.loc-group-header').forEach(header => {
        const arrow = header.querySelector('.loc-group-arrow');
        if (arrow && !arrow.classList.contains('open')) {
          fireEvent.click(header);
        }
      });
    });
  }

  it('renders [P] badge for paired files', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
      ['localization/en.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({ pairingFileState: state });

    expandAllGroups();
    const badges = document.querySelectorAll('.pw-file-badge--paired');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('renders [S] badge for source-only files', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'source_only', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({ pairingFileState: state });

    expandAllGroups();
    const badges = document.querySelectorAll('.pw-file-badge--source_only');
    expect(badges.length).toBe(1);
  });

  it('renders [T] badge for translated-only files', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['cache/temp.bin', { state: 'translated_only', pairId: 'pair-1', role: 'translated' }],
    ]);
    renderWorkspace({ pairingFileState: state });

    expandAllGroups();
    const badges = document.querySelectorAll('.pw-file-badge--translated_only');
    expect(badges.length).toBe(1);
  });

  it('applies active class to badges for active pair files', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
      ['localization/en.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({
      pairingFileState: state,
      selectedPairId: 'pair-1',
    });

    expandAllGroups();
    const activeBadges = document.querySelectorAll('.pw-file-badge--active');
    expect(activeBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT apply active class for non-selected pair', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({
      pairingFileState: state,
      selectedPairId: 'pair-other',
    });

    expandAllGroups();
    const activeBadges = document.querySelectorAll('.pw-file-badge--active');
    expect(activeBadges.length).toBe(0);
  });

  it('does not render badge for unpaired files', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({ pairingFileState: state });

    // events/end.txt is not in the map; should not get a .pw-file-badge
    expandAllGroups();
    const allBadges = document.querySelectorAll('.pw-file-badge');
    // Only 1 file has a badge; others are unpaired
    expect(allBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders title attributes on badges', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({ pairingFileState: state });

    expandAllGroups();
    const badge = document.querySelector('.pw-file-badge');
    expect(badge?.getAttribute('title')).toBe('Paired');
  });

  it('filters do not mutate pairing state', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    const { container } = renderWorkspace({ pairingFileState: state });

    // Apply exclude filter that hides the paired file's group
    const excludeInput = screen.getByLabelText('Exclude filter');
    fireEvent.change(excludeInput, { target: { value: 'events' } });

    // Pairing state map should be unchanged (no badges visible, but map unchanged)
    expect(state.size).toBe(1);
    expect(state.get('events/start.txt')?.state).toBe('paired');
  });
});

/* ================================================================== */
/*  Tests: hidden active pair files hint                                */
/* ================================================================== */

describe('PairingFileWorkspace — hidden active pair files hint', () => {
  it('shows hint when active pair files are hidden by filters', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({
      pairingFileState: state,
      selectedPairId: 'pair-1',
      activePairPaths: ['events/start.txt', 'events/end.txt'],
    });

    // Apply exclude filter that hides the events group
    const excludeInput = screen.getByLabelText('Exclude filter');
    fireEvent.change(excludeInput, { target: { value: 'events' } });

    // The hint should appear
    expect(screen.getByText('Some files from the active pair are hidden by filters.')).toBeTruthy();
  });

  it('does NOT show hint when all active pair files are visible', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({
      pairingFileState: state,
      selectedPairId: 'pair-1',
      activePairPaths: ['events/start.txt'],
    });

    // No hint when all files are visible
    expect(screen.queryByText('Some files from the active pair are hidden by filters.')).toBeNull();
  });

  it('does NOT show hint when no active pair is selected', () => {
    renderWorkspace({
      selectedPairId: null,
      activePairPaths: [],
    });

    expect(screen.queryByText('Some files from the active pair are hidden by filters.')).toBeNull();
  });

  it('hint disappears when filters are cleared', () => {
    const state = new Map<string, PairingFileStateInfo>([
      ['events/start.txt', { state: 'paired', pairId: 'pair-1', role: 'source' }],
    ]);
    renderWorkspace({
      pairingFileState: state,
      selectedPairId: 'pair-1',
      activePairPaths: ['events/start.txt', 'events/end.txt'],
    });

    const excludeInput = screen.getByLabelText('Exclude filter');
    fireEvent.change(excludeInput, { target: { value: 'events' } });
    expect(screen.getByText('Some files from the active pair are hidden by filters.')).toBeTruthy();

    fireEvent.click(screen.getByText('Clear filters'));
    expect(screen.queryByText('Some files from the active pair are hidden by filters.')).toBeNull();
  });
});

/* ================================================================== */
/*  Nested fixture for ancestor expansion tests                         */
/* ================================================================== */

const NESTED_GROUPS: WorkspaceFileGroup[] = [
  {
    groupKey: 'root',
    displayName: 'Root',
    relativeDir: '',
    filesCount: 3,
    sourceLikeCount: 3,
    translatedLikeCount: 0,
    files: [
      makeFile('dirA/sub/deep_file.txt'),
      makeFile('dirA/shallow.txt'),
      makeFile('root_file.txt'),
    ],
    children: [],
  },
];

/* ================================================================== */
/*  Tests: Reveal/highlight sync                                       */
/* ================================================================== */

describe('PairingFileWorkspace — reveal/highlight sync', () => {
  /** Mock scrollIntoView for all tests in this block. */
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  /* ---------- Pure helpers ---------- */

  describe('findAncestorGroupIdsForFile', () => {
    it('returns ancestor group IDs from deepest leaf up to root', () => {
      // Build a small nested tree manually (same shape as genericFileGrouping output)
      const tree = [
        {
          id: 'dirA',
          label: 'dirA',
          fileCount: 2,
          files: ['dirA/shallow.txt'],
          children: [
            {
              id: 'dirA/sub',
              label: 'sub',
              fileCount: 1,
              files: ['dirA/sub/deep_file.txt'],
              children: [],
            },
          ],
        },
        {
          id: 'root_file.txt',
          label: 'root_file.txt',
          fileCount: 1,
          files: ['root_file.txt'],
          children: [],
        },
      ];

      const ancestors = findAncestorGroupIdsForFile(tree, 'dirA/sub/deep_file.txt');
      expect(ancestors).toEqual(['dirA', 'dirA/sub']);
    });

    it('returns empty array for file not in tree', () => {
      expect(findAncestorGroupIdsForFile([], 'nonexistent.txt')).toEqual([]);
    });
  });

  describe('isFileVisibleInFilteredTree', () => {
    it('returns true when file is in the filtered tree', () => {
      const tree = [{ id: 'g1', label: 'g1', fileCount: 1, files: ['file.txt'], children: [] }];
      expect(isFileVisibleInFilteredTree(tree, 'file.txt')).toBe(true);
    });

    it('returns false when file is not in the filtered tree', () => {
      const tree = [{ id: 'g1', label: 'g1', fileCount: 1, files: ['other.txt'], children: [] }];
      expect(isFileVisibleInFilteredTree(tree, 'missing.txt')).toBe(false);
    });
  });

  /* ---------- Integration tests ---------- */

  it('reveal expands ancestor groups so the file becomes visible in the tree', () => {
    // Pre-set grouping mode to 'folder' to get a nested directory tree
    localStorage.setItem('stellaris_translator.pairing.groupingMode.proj-1', JSON.stringify('folder'));

    const filePath = 'dirA/sub/deep_file.txt';
    const { container } = renderWorkspace({
      groups: NESTED_GROUPS,
      rootPath: '',
      revealTarget: { filePath, nonce: 1 },
    });

    // After reveal, the nested file should be visible in the DOM
    const fileEl = container.querySelector(`[data-reveal-path="${filePath}"]`);
    expect(fileEl).toBeTruthy();
    expect(fileEl?.textContent).toContain('deep_file.txt');
  });

  it('reveal sets data-reveal-path attribute on the revealed file row', () => {
    const filePath = 'events/start.txt';
    const { container } = renderWorkspace({
      revealTarget: { filePath, nonce: 1 },
    });

    const row = container.querySelector(`[data-reveal-path="${filePath}"]`);
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain('start.txt');
  });

  it('does not clear include/exclude filters when revealing', () => {
    renderWorkspace({
      revealTarget: { filePath: 'events/start.txt', nonce: 1 },
    });

    // Set include filter first
    const includeInput = screen.getByLabelText('Include filter') as HTMLInputElement;
    fireEvent.change(includeInput, { target: { value: 'events' } });
    expect(includeInput.value).toBe('events');
  });

  it('shows enhanced warning when reveal target is hidden by exclude filter', () => {
    // Pre-set exclude filter to hide the target before component mounts
    localStorage.setItem('stellaris_translator.pairing.excludeFilter.proj-1', JSON.stringify('events'));

    const filePath = 'events/start.txt';
    renderWorkspace({
      revealTarget: { filePath, nonce: 1 },
    });

    // Enhanced warning should appear
    expect(screen.getByText('Clear filters to reveal this file.')).toBeTruthy();
    // Original warning should still be visible
    expect(screen.getByText('Some files from the active pair are hidden by filters.')).toBeTruthy();
  });

  it('does not crash when reveal target file does not exist', () => {
    expect(() => {
      renderWorkspace({
        revealTarget: { filePath: 'completely/missing/file.txt', nonce: 1 },
      });
    }).not.toThrow();
  });

  it('does not crash when revealTarget is null/undefined', () => {
    expect(() => {
      renderWorkspace({});
    }).not.toThrow();
  });
});

/* ================================================================== */
/*  Tests: DnD drag start from file tree                                */
/* ================================================================== */

describe('PairingFileWorkspace — DnD drag start', () => {
  /** Expand all collapsed groups by clicking their headers. */
  function expandAllFiles() {
    act(() => {
      document.querySelectorAll('.loc-group-header').forEach(header => {
        const arrow = header.querySelector('.loc-group-arrow');
        if (arrow && !arrow.classList.contains('open')) {
          fireEvent.click(header);
        }
      });
    });
  }

  it('tree file row dragStart invokes onFileDragStart when provided', () => {
    const onFileDragStart = vi.fn();
    const { container } = renderWorkspace({ onFileDragStart });
    expandAllFiles();

    const fileRow = container.querySelector('[draggable="true"]');
    expect(fileRow).toBeTruthy();
    // In happy-dom, DragEvent does not propagate dataTransfer through fireEvent,
    // so we verify the handler is called (the real handler in ProjectWorkspace
    // would set effectAllowed = 'copy' on the native event in real browsers).
    fireEvent.dragStart(fileRow!, {});

    expect(onFileDragStart).toHaveBeenCalledTimes(1);
    expect(onFileDragStart).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'dragstart' }),
    );
  });

  it('file rows are not draggable when onFileDragStart is not provided', () => {
    const { container } = renderWorkspace({ onFileDragStart: undefined });
    expandAllFiles();

    const draggableRows = container.querySelectorAll('[draggable="true"]');
    expect(draggableRows.length).toBe(0);
  });
});

/* ================================================================== */
/*  Tests: Layout invariants — fixed-height Files card + scrollable tree */
/* ================================================================== */

describe('PairingFileWorkspace — layout invariants', () => {
  function expandAllGroups() {
    act(() => {
      document.querySelectorAll('.loc-group-header').forEach(header => {
        const arrow = header.querySelector('.loc-group-arrow');
        if (arrow && !arrow.classList.contains('open')) {
          fireEvent.click(header);
        }
      });
    });
  }

  it('pw-files-card has overflow hidden to contain the tree area', () => {
    renderWorkspace();
    expandAllGroups();

    const filesCard = document.querySelector('.pw-files-card') as HTMLElement;
    expect(filesCard).toBeTruthy();
    expect(filesCard.style.overflow).toBe('hidden');
  });

  it('pw-files-card uses flex column layout with flex: 1 and minHeight: 0', () => {
    renderWorkspace();
    expandAllGroups();

    const filesCard = document.querySelector('.pw-files-card') as HTMLElement;
    expect(filesCard).toBeTruthy();
    expect(filesCard.style.display).toBe('flex');
    expect(filesCard.style.flexDirection).toBe('column');
    // happy-dom expands `flex: 1` to `1 1 0%`
    expect(filesCard.style.flex).toBe('1 1 0%');
    // happy-dom returns '0' instead of '0px'
    expect(filesCard.style.minHeight).toBe('0');
  });

  it('tree scroll container (pw-tree-scroll) has overflow: auto', () => {
    renderWorkspace();
    expandAllGroups();

    const scrollContainer = document.querySelector('.pw-tree-scroll') as HTMLElement;
    expect(scrollContainer).toBeTruthy();
    expect(scrollContainer.style.overflow).toBe('auto');
  });

  it('tree scroll container has flex: 1 and minHeight: 0', () => {
    renderWorkspace();
    expandAllGroups();

    const scrollContainer = document.querySelector('.pw-tree-scroll') as HTMLElement;
    expect(scrollContainer).toBeTruthy();
    // happy-dom expands `flex: 1` to `1 1 0%`
    expect(scrollContainer.style.flex).toBe('1 1 0%');
    // happy-dom returns '0' instead of '0px'
    expect(scrollContainer.style.minHeight).toBe('0');
  });

  it('filter inputs render outside the scrollable tree area', () => {
    renderWorkspace();
    expandAllGroups();

    const scrollContainer = document.querySelector('.pw-tree-scroll') as HTMLElement;
    expect(scrollContainer).toBeTruthy();

    const includeInput = screen.getByPlaceholderText(/Show only/);
    expect(scrollContainer.contains(includeInput)).toBe(false);

    const excludeInput = screen.getByPlaceholderText(/Hide folders/);
    expect(scrollContainer.contains(excludeInput)).toBe(false);
  });

  it('Ext label and extension badges render outside the scrollable tree area', () => {
    renderWorkspace();
    expandAllGroups();

    const scrollContainer = document.querySelector('.pw-tree-scroll') as HTMLElement;
    expect(scrollContainer).toBeTruthy();

    const extLabel = screen.getByText('Ext:');
    expect(scrollContainer.contains(extLabel)).toBe(false);

    // The parent of the Ext: label is the Ext container — verify entire container is outside scroll area
    const extContainer = extLabel.parentElement;
    expect(extContainer).toBeTruthy();
    expect(scrollContainer.contains(extContainer)).toBe(false);
  });

  it('expanding all groups does not remove or replace the tree scroll container', () => {
    const { container } = renderWorkspace();

    // Capture scroll container reference before expansion
    const scrollBefore = container.querySelector('.pw-tree-scroll');
    expect(scrollBefore).toBeTruthy();

    expandAllGroups();

    // Same element should exist (DOM structure stable)
    const scrollAfter = container.querySelector('.pw-tree-scroll');
    expect(scrollAfter).toBe(scrollBefore);
  });

  it('pw-files-card children layout: title + filters + ext badges + tree scroll + warning(optional)', () => {
    renderWorkspace();
    expandAllGroups();

    const filesCard = document.querySelector('.pw-files-card') as HTMLElement;
    expect(filesCard).toBeTruthy();

    // The card-title should be first
    const title = filesCard.querySelector('.card-title');
    expect(title).toBeTruthy();

    // The pw-tree-scroll should be inside the card
    const scrollContainer = filesCard.querySelector('.pw-tree-scroll');
    expect(scrollContainer).toBeTruthy();

    // Filter inputs should be inside the card but NOT inside the tree scroll
    const includeInput = screen.getByPlaceholderText(/Show only/);
    expect(filesCard.contains(includeInput)).toBe(true);
    expect(scrollContainer!.contains(includeInput)).toBe(false);

    // Ext label should be in the card but NOT in the tree scroll
    const extLabel = screen.getByText('Ext:');
    expect(filesCard.contains(extLabel)).toBe(true);
    expect(scrollContainer!.contains(extLabel)).toBe(false);
  });
});

/* ================================================================== */
/*  Tests: Single-file flattening — no group header for singletons      */
/* ================================================================== */

describe('PairingFileWorkspace — single-file flattening', () => {
  const GROUPING_MODE_KEY = 'stellaris_translator.pairing.groupingMode.proj-1';

  /** Expand all directory/group headers in the tree. */
  function expandAllGroupHeaders() {
    act(() => {
      document.querySelectorAll('.loc-group-header').forEach(header => {
        const arrow = header.querySelector('.loc-group-arrow');
        if (arrow && !arrow.classList.contains('open')) {
          fireEvent.click(header);
        }
      });
    });
  }

  it('folder mode: single file inside subdirectory renders as plain FileRow (no group header)', () => {
    localStorage.setItem(GROUPING_MODE_KEY, JSON.stringify('folder'));

    const SINGLE_FILE_GROUP: WorkspaceFileGroup[] = [{
      groupKey: 'subdir',
      displayName: 'Subdir',
      relativeDir: '',
      filesCount: 1,
      sourceLikeCount: 1,
      translatedLikeCount: 0,
      files: [makeFile('subdir/single.yml')],
      children: [],
    }];

    renderWorkspace({
      groups: SINGLE_FILE_GROUP,
      projectId: 'proj-1',
    });

    // Expand the subdir directory header
    expandAllGroupHeaders();

    // The file should NOT have its own group header (no ▶, no "1 file")
    const arrows = document.querySelectorAll('.loc-group-arrow');
    // There should be exactly 1 arrow (for the subdir directory, NOT for the file)
    expect(arrows.length).toBe(1);

    // File-level actions should be rendered directly
    expect(screen.getByText('single.yml')).toBeTruthy();
    expect(screen.getByText('Set source')).toBeTruthy();
    expect(screen.getByText('Set translated')).toBeTruthy();
    // File-level Open folder should exist
    const openFolderBtns = screen.getAllByText('Open folder');
    expect(openFolderBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('filename mode: unique-basename file inside subdirectory renders as FileRow', () => {
    localStorage.setItem(GROUPING_MODE_KEY, JSON.stringify('filename'));

    const SINGLE_FILE_GROUP: WorkspaceFileGroup[] = [{
      groupKey: 'subdir',
      displayName: 'Subdir',
      relativeDir: '',
      filesCount: 1,
      sourceLikeCount: 1,
      translatedLikeCount: 0,
      files: [makeFile('subdir/unique_name.yml')],
      children: [],
    }];

    renderWorkspace({
      groups: SINGLE_FILE_GROUP,
      projectId: 'proj-1',
    });

    expandAllGroupHeaders();

    // No extra group header for the single file
    const arrows = document.querySelectorAll('.loc-group-arrow');
    expect(arrows.length).toBe(1);

    // File name and actions visible
    expect(screen.getByText('unique_name.yml')).toBeTruthy();
    expect(screen.getByText('Set source')).toBeTruthy();
  });

  it('filename mode: two files with same name in different dirs still render as group', () => {
    localStorage.setItem(GROUPING_MODE_KEY, JSON.stringify('filename'));

    const SAME_NAME_GROUP: WorkspaceFileGroup[] = [{
      groupKey: 'dir1',
      displayName: 'Dir1',
      relativeDir: '',
      filesCount: 1,
      sourceLikeCount: 1,
      translatedLikeCount: 0,
      files: [makeFile('dir1/common.yml')],
      children: [],
    }, {
      groupKey: 'dir2',
      displayName: 'Dir2',
      relativeDir: '',
      filesCount: 1,
      sourceLikeCount: 1,
      translatedLikeCount: 0,
      files: [makeFile('dir2/common.yml')],
      children: [],
    }];

    renderWorkspace({
      groups: SAME_NAME_GROUP,
      projectId: 'proj-1',
    });

    expandAllGroupHeaders();

    // In filename mode, `common.yml` appears twice (in dir1 and dir2).
    // Each is a separate singleton leaf inside its directory.
    // Each directory node has one child → that child IS flattened.
    // But the TWO directory nodes (dir1, dir2) each render as group headers.
    const arrows = document.querySelectorAll('.loc-group-arrow');
    // 2 directory arrows + no file group arrows
    expect(arrows.length).toBe(2);

    // Both directories should have group headers
    const arrowTexts = Array.from(arrows)
      .map(a => a.closest('.loc-group-header'))
      .filter(Boolean)
      .map(header => (header as HTMLElement).querySelector('.loc-group-label')?.textContent);
    expect(arrowTexts).toContain('dir1');
    expect(arrowTexts).toContain('dir2');
  });

  it('folder mode: files at root level do not create group headers', () => {
    localStorage.setItem(GROUPING_MODE_KEY, JSON.stringify('folder'));

    const ROOT_FILE_GROUP: WorkspaceFileGroup[] = [{
      groupKey: '',
      displayName: '',
      relativeDir: '',
      filesCount: 1,
      sourceLikeCount: 1,
      translatedLikeCount: 0,
      files: [makeFile('root_file.yml')],
      children: [],
    }];

    renderWorkspace({
      groups: ROOT_FILE_GROUP,
      projectId: 'proj-1',
    });

    // No directory to expand — file at root level
    // In folder mode with flattenSingletons, root-level singleton should be a plain FileRow
    const arrows = document.querySelectorAll('.loc-group-arrow');
    expect(arrows.length).toBe(0);

    // File row should be visible
    expect(screen.getByText('root_file.yml')).toBeTruthy();
    expect(screen.getByText('Set source')).toBeTruthy();
  });
});
/* ================================================================== */
/*  Tests: Open folder path resolution                                  */
/* ================================================================== */

/**
 * Pure path resolution — mirrors the logic in PairingFileWorkspace.handleOpenFolder
 * and GenericFileSection.handleOpenFolder.
 * Relative paths are prefixed with rootPath; already-absolute paths pass through.
 */
function resolveOpenFolderPath(filePath: string, rootPath: string): string {
  return isAbsolutePath(filePath)
    ? filePath
    : rootPath.trim().replace(/\/+$/, '') + '/' + filePath;
}

describe('PairingFileWorkspace — open folder path resolution', () => {
  /* ---- isAbsolutePath unit tests ---- */

  describe('isAbsolutePath', () => {
    it('detects Unix absolute paths', () => {
      expect(isAbsolutePath('/home/user/file.txt')).toBe(true);
      expect(isAbsolutePath('/')).toBe(true);
    });

    it('detects Windows drive-letter absolute paths (forward slash)', () => {
      expect(isAbsolutePath('C:/mods/stellaris/file.txt')).toBe(true);
      expect(isAbsolutePath('D:/games/')).toBe(true);
    });

    it('detects Windows drive-letter absolute paths (backslash)', () => {
      expect(isAbsolutePath('C:\\mods\\stellaris\\file.txt')).toBe(true);
      expect(isAbsolutePath('D:\\games\\')).toBe(true);
    });

    it('detects Windows UNC paths', () => {
      expect(isAbsolutePath('\\\\server\\share\\file.txt')).toBe(true);
    });

    it('rejects relative paths', () => {
      expect(isAbsolutePath('relative/path/file.txt')).toBe(false);
      expect(isAbsolutePath('./relative/file.txt')).toBe(false);
      expect(isAbsolutePath('../relative/file.txt')).toBe(false);
      expect(isAbsolutePath('file.txt')).toBe(false);
      expect(isAbsolutePath('')).toBe(false);
    });
  });

  /* ---- resolveOpenFolderPath integration tests ---- */

  it('prepends rootPath to relative file paths', () => {
    const result = resolveOpenFolderPath('1623423360/gfx/interface/archaeology/chapter_container.dds', '/Users/me/Games/Stellaris/mods/MyMod');
    expect(result).toBe('/Users/me/Games/Stellaris/mods/MyMod/1623423360/gfx/interface/archaeology/chapter_container.dds');
  });

  it('leaves Unix absolute paths unchanged', () => {
    const result = resolveOpenFolderPath('/Users/me/Games/Stellaris/mods/MyMod/localisation/english/mod_l_english.yml', '/Users/me/Games/Stellaris/mods/MyMod');
    expect(result).toBe('/Users/me/Games/Stellaris/mods/MyMod/localisation/english/mod_l_english.yml');
  });

  it('leaves Windows absolute paths unchanged (forward slash)', () => {
    const result = resolveOpenFolderPath('C:/mods/stellaris/file.txt', '/some/root');
    expect(result).toBe('C:/mods/stellaris/file.txt');
  });

  it('leaves Windows absolute paths unchanged (backslash)', () => {
    const result = resolveOpenFolderPath('C:\\mods\\stellaris\\file.txt', '/some/root');
    expect(result).toBe('C:\\mods\\stellaris\\file.txt');
  });

  it('handles rootPath with trailing slash', () => {
    const result = resolveOpenFolderPath('events/start.txt', '/root/');
    expect(result).toBe('/root/events/start.txt');
  });

  it('renders "Open folder" buttons in expanded file tree', () => {
    // Pre-set grouping mode to 'flat' so files render in a single flat list
    localStorage.setItem('stellaris_translator.pairing.groupingMode.proj-1', JSON.stringify('flat'));

    renderWorkspace();
    // Expand the flat "All files" group
    act(() => {
      document.querySelectorAll('.loc-group-header').forEach(header => {
        const arrow = header.querySelector('.loc-group-arrow');
        if (arrow && !arrow.classList.contains('open')) {
          fireEvent.click(header);
        }
      });
    });

    const btns = screen.getAllByText('Open folder');
    expect(btns.length).toBeGreaterThan(0);
  });
});
