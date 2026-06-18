import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { ModListSection } from '../ModListSection';
import type { ModModel } from '../../../domain';
import { DraftJobSelectionProvider } from '../../../contexts/DraftJobSelectionContext';

/* ================================================================== */
/*  Tests for expansion state pruning — uses REAL usePersistentState   */
/*  to verify that stale localStorage entries are cleaned up when      */
/*  mods change.                                                       */
/* ================================================================== */

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

/* ================================================================== */
/*  Mocks (everything EXCEPT usePersistentState)                        */
/* ================================================================== */

vi.mock('../../../api/client', () => {
  const mock = {
    getDraftJobSelection: vi.fn(),
    addDraftFiles: vi.fn(),
    removeDraftFiles: vi.fn(),
    setDraftJobSelection: vi.fn(),
    clearDraftJobSelection: vi.fn(),
  };
  return {
    api: mock,
    ApiError: class ApiError extends Error {
      constructor(msg: string) { super(msg); this.name = 'ApiError'; }
    },
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: function MockLink(props: any) {
    return React.createElement('a', { href: props.to }, props.children);
  },
}));

vi.mock('../../../App', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ settings: {} }),
    readDescriptor: vi.fn(),
    installMod: vi.fn(),
    previewTranslationPlan: vi.fn(),
    createJob: vi.fn(),
    startJob: vi.fn(),
    revealPath: vi.fn(),
    previewCleanCache: vi.fn(),
    cleanCache: vi.fn(),
    getDraftJobSelection: vi.fn(),
    addDraftFiles: vi.fn(),
    removeDraftFiles: vi.fn(),
    setDraftJobSelection: vi.fn(),
    clearDraftJobSelection: vi.fn(),
  },
  useToast: () => ({ showToast: vi.fn() }),
  ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg); }
  },
}));

vi.mock('../../index', () => ({
  PathPicker: function MockPathPicker(props: any) {
    return React.createElement('div', { 'data-testid': 'path-picker' },
      React.createElement('input', {
        value: props.value,
        onChange: (e: any) => props.onChange(e.target.value),
        'data-testid': 'path-input',
      }),
    );
  },
}));

vi.mock('../TranslationPreviewModal', () => ({
  TranslationPreviewModal: function MockPreviewModal() {
    return React.createElement('div', { 'data-testid': 'translation-preview-modal' });
  },
}));

/* ================================================================== */
/*  Test helpers                                                        */
/* ================================================================== */

import { STORAGE_KEYS } from '../../../utils/storageKeys';
import { api as clientApi } from '../../../api/client';

function makeMod(id: string, name?: string, overrides: Partial<ModModel> = {}): ModModel {
  return {
    id,
    name: name || `Mod ${id}`,
    path: `/path/to/${id}`,
    descriptorPath: null,
    isValid: true,
    source: 'steam',
    localisationPaths: [
      `/path/to/${id}/localisation/english/test_l_english.yml`,
    ],
    installed: false,
    installedPath: null,
    installAction: 'install',
    installConflict: false,
    selfInstalled: false,
    diagnostics: [],
    tags: [],
    supportedVersion: null,
    version: null,
    ...overrides,
  };
}

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <DraftJobSelectionProvider>
      {ui}
    </DraftJobSelectionProvider>,
  );
}

/** Click the Expand toggle for a given mod by its name. */
function expandMod(modName: string) {
  // Find the mod header by name, then click its expand toggle
  const modNameEl = screen.getByText(modName);
  const header = modNameEl.closest('.mod-item-header');
  if (!header) throw new Error(`Mod header not found for "${modName}"`);
  const toggle = header.querySelector('.expand-toggle') as HTMLElement;
  if (!toggle) throw new Error(`Expand toggle not found for "${modName}"`);
  fireEvent.click(toggle);
}

/** Check if a mod body is visible by looking for a child element. */
function isModExpanded(modName: string): boolean {
  const modNameEl = screen.queryByText(modName);
  if (!modNameEl) return false;
  const header = modNameEl.closest('.mod-item-header');
  if (!header) return false;
  const toggle = header.querySelector('.expand-toggle') as HTMLElement;
  if (!toggle) return false;
  return toggle.classList.contains('open');
}

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('ModListSection — expansion state pruning', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 0,
    });
  });

  it('stale localStorage entry is pruned when mods mount without that mod', async () => {
    // Seed localStorage with a stale entry for a mod that does not exist in the current scan
    const staleKey = 'stellaris_translator.expandedMods';
    localStorage.setItem(
      staleKey,
      JSON.stringify({ '/path/to/stale-mod': true, '/path/to/current-mod': true }),
    );

    renderWithProvider(
      <ModListSection
        mods={[makeMod('current-mod', 'Current Mod')]}
        onRefreshMods={vi.fn()}
      />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // '/path/to/stale-mod' should have been pruned from localStorage
    const saved = JSON.parse(localStorage.getItem(staleKey)!);
    expect(saved).not.toHaveProperty('/path/to/stale-mod');
    expect(saved).toHaveProperty('/path/to/current-mod');

    // 'Current Mod' should still be expanded (its entry was not stale)
    expect(isModExpanded('Current Mod')).toBe(true);
  });

  it('prunes stale entries when mods list changes via new props', async () => {
    const key = STORAGE_KEYS.expandedMods;
    // Seed: '/path/to/current-mod' is collapsed, '/path/to/stale-mod' is expanded
    localStorage.setItem(
      key,
      JSON.stringify({ '/path/to/current-mod': false, '/path/to/stale-mod': true }),
    );

    const { rerender } = render(
      <DraftJobSelectionProvider>
        <ModListSection
          mods={[makeMod('current-mod', 'Current Mod')]}
          onRefreshMods={vi.fn()}
        />
      </DraftJobSelectionProvider>,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // After mount with pruning: 'stale-mod' removed, 'current-mod' kept
    let saved = JSON.parse(localStorage.getItem(key)!);
    expect(Object.keys(saved)).toEqual(['/path/to/current-mod']);

    // Re-render with different mods (simulating re-scan with new mods)
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 0,
    });
    rerender(
      <DraftJobSelectionProvider>
        <ModListSection
          mods={[makeMod('new-mod', 'New Mod')]}
          onRefreshMods={vi.fn()}
        />
      </DraftJobSelectionProvider>,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // After re-render: 'current-mod' pruned (no longer in mods),
    // 'new-mod' was never expanded so no entry for it
    saved = JSON.parse(localStorage.getItem(key)!);
    expect(Object.keys(saved)).toEqual([]);
  });

  it('preserves collapse state for current mods after pruning (no false→true flip)', async () => {
    const key = STORAGE_KEYS.expandedMods;

    // Render with one mod
    const mod = makeMod('test-mod', 'Test Mod');
    renderWithProvider(
      <ModListSection mods={[mod]} onRefreshMods={vi.fn()} />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Expand then collapse
    expandMod('Test Mod');
    expect(isModExpanded('Test Mod')).toBe(true);
    expandMod('Test Mod');
    expect(isModExpanded('Test Mod')).toBe(false);

    // Verify localStorage reflects collapse (uses path-based key)
    let saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved['/path/to/test-mod']).toBe(false);

    // Verify re-render preserves collapsed state (no re-expansion)
    const { rerender } = renderWithProvider(
      <ModListSection mods={[mod]} onRefreshMods={vi.fn()} />,
    );

    // NOTE: rerender with same provider doesn't work via renderWithProvider helper.
    // Instead, verify the local state directly remains collapsed after pruning effect.
    saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved['/path/to/test-mod']).toBe(false);
  });

  it('does not prune entries when mods list is empty (defensive)', async () => {
    const key = STORAGE_KEYS.expandedMods;
    localStorage.setItem(key, JSON.stringify({ '/path/to/some-mod': true }));

    // Render with empty mods — the effect returns early
    const { rerender } = render(
      <DraftJobSelectionProvider>
        <ModListSection mods={[]} onRefreshMods={vi.fn()} />
      </DraftJobSelectionProvider>,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Empty mods → component returns null, but effect was skipped
    // localStorage should still have the old entry
    let saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved).toEqual({ '/path/to/some-mod': true });

    // Now add mods — effect should fire and prune
    vi.mocked(clientApi.getDraftJobSelection).mockResolvedValue({
      files: [],
      file_metadata: {},
      grouped: [],
      diagnostics: [],
      count: 0,
    });
    rerender(
      <DraftJobSelectionProvider>
        <ModListSection mods={[makeMod('current-mod', 'Current Mod')]} onRefreshMods={vi.fn()} />
      </DraftJobSelectionProvider>,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // After mods mount, old '/path/to/some-mod' entry should be pruned,
    // 'current-mod' was never expanded so no entry for it
    saved = JSON.parse(localStorage.getItem(key)!);
    expect(Object.keys(saved)).toEqual([]);
  });

  it('expandedGroups belonging to a removed mod are also pruned', async () => {
    const groupsKey = STORAGE_KEYS.expandedLocalisationGroups;
    localStorage.setItem(groupsKey, JSON.stringify({
      '/path/to/mod-a::group1': true,
      '/path/to/mod-a::group2': false,
      '/path/to/mod-b::group1': true,
    }));

    renderWithProvider(
      <ModListSection
        mods={[makeMod('mod-b', 'Mod B')]}
        onRefreshMods={vi.fn()}
      />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    const saved = JSON.parse(localStorage.getItem(groupsKey)!);
    // mod-a groups should be pruned, mod-b groups preserved
    expect(saved).toHaveProperty('/path/to/mod-b::group1');
    expect(saved).not.toHaveProperty('/path/to/mod-a::group1');
    expect(saved).not.toHaveProperty('/path/to/mod-a::group2');
    expect(Object.keys(saved)).toEqual(['/path/to/mod-b::group1']);
  });

  /* ------------------------------------------------------------------ */
  /*  Collision tests: same mod_id, different paths                       */
  /* ------------------------------------------------------------------ */

  it('two mods with same id but different paths have independent expansion state', async () => {
    const modA = makeMod('same-id', 'Mod A', { path: '/path/a' });
    const modB = makeMod('same-id', 'Mod B', { path: '/path/b' });

    renderWithProvider(
      <ModListSection mods={[modA, modB]} onRefreshMods={vi.fn()} />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Initially both are collapsed — no entries in expandedMods
    expect(isModExpanded('Mod A')).toBe(false);
    expect(isModExpanded('Mod B')).toBe(false);
    const key = STORAGE_KEYS.expandedMods;
    let saved = JSON.parse(localStorage.getItem(key)!);
    expect(Object.keys(saved).length).toBe(0);

    // Expand only Mod A
    expandMod('Mod A');
    expect(isModExpanded('Mod A')).toBe(true);
    expect(isModExpanded('Mod B')).toBe(false);

    // localStorage should have only the entry for Mod A's path
    saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved).toHaveProperty('/path/a');
    expect(saved).not.toHaveProperty('/path/b');

    // Expand Mod B — both should be expanded
    expandMod('Mod B');
    expect(isModExpanded('Mod A')).toBe(true);
    expect(isModExpanded('Mod B')).toBe(true);

    // Both paths in localStorage
    saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved['/path/a']).toBe(true);
    expect(saved['/path/b']).toBe(true);
  });

  it('stale pruning does not remove mod with same id but different path', async () => {
    const key = STORAGE_KEYS.expandedMods;
    // Seed with entry for '/path/to/mod-a'
    localStorage.setItem(key, JSON.stringify({ '/path/to/mod-a': true }));

    // Both mods have same id but different paths
    const modA = makeMod('shared-id', 'Mod A', { path: '/path/to/mod-a' });
    const modB = makeMod('shared-id', 'Mod B', { path: '/path/to/mod-b' });

    renderWithProvider(
      <ModListSection mods={[modA, modB]} onRefreshMods={vi.fn()} />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Both paths should survive pruning since both are in currentKeys
    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved).toHaveProperty('/path/to/mod-a');
    // mod-b was never expanded so no entry for it
    expect(saved).not.toHaveProperty('/path/to/mod-b');
  });

  it('pruning removes only truly stale mods even with id collision', async () => {
    const key = STORAGE_KEYS.expandedMods;
    // Seed with entry for a stale path that no mod uses
    localStorage.setItem(key, JSON.stringify({ '/path/to/stale-mod': true }));

    // Render only a mod with a different path
    renderWithProvider(
      <ModListSection
        mods={[makeMod('current-mod', 'Current Mod')]}
        onRefreshMods={vi.fn()}
      />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Stale path should be pruned
    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved).not.toHaveProperty('/path/to/stale-mod');
  });

  it('does not produce React duplicate key warning with same mod_id but different paths', async () => {
    // Spy on console.error to catch React duplicate key warnings
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const modA = makeMod('duplicate-id', 'Mod Alpha', { path: '/path/alpha' });
    const modB = makeMod('duplicate-id', 'Mod Beta', { path: '/path/beta' });

    renderWithProvider(
      <ModListSection mods={[modA, modB]} onRefreshMods={vi.fn()} />,
    );
    await waitFor(() => expect(vi.mocked(clientApi).getDraftJobSelection).toHaveBeenCalled());

    // Check for React duplicate key warning
    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(
      args => typeof args[0] === 'string' && args[0].includes('duplicate'),
    );
    expect(duplicateKeyWarnings.length).toBe(0);

    consoleErrorSpy.mockRestore();
  });
});
