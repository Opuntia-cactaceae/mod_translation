/* ------------------------------------------------------------------ */
/*  Tests: buildPairingFileStateMap helper                               */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest';
import { buildPairingFileStateMap, getActivePairPaths } from '../pairingFileState';
import type { WorkspacePair, WorkspaceFile } from '../pairingTypes';

/* ================================================================== */
/*  Fixtures                                                            */
/* ================================================================== */

function makeFile(relativePath: string, overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    id: `file-${relativePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
    projectId: 'proj-1',
    relativePath,
    fileName: relativePath.split('/').pop() ?? '',
    extension: '.' + (relativePath.split('.').pop() ?? 'yml'),
    parentDir: relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '',
    sizeBytes: 100,
    detectedLanguage: null,
    detectedRole: 'source-like',
    isIgnored: false,
    ...overrides,
  };
}

function makePair(
  id: string,
  srcPath: string | null,
  tgtPath: string | null,
): WorkspacePair {
  return {
    id,
    projectId: 'proj-1',
    sourceFileId: srcPath ? `src-${srcPath}` : null,
    translatedFileId: tgtPath ? `tgt-${tgtPath}` : null,
    sourceFile: srcPath ? makeFile(srcPath, { id: `src-${srcPath}`, detectedRole: 'source' }) : null,
    translatedFile: tgtPath ? makeFile(tgtPath, { id: `tgt-${tgtPath}`, detectedRole: 'translated' }) : null,
    status: 'manual',
    confidence: 1.0,
    reason: null,
    createdBy: 'user',
    notes: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('buildPairingFileStateMap', () => {
  it('returns empty map when there are no pairs', () => {
    const map = buildPairingFileStateMap([]);
    expect(map.size).toBe(0);
  });

  it('marks files in full pair as paired', () => {
    const pairs = [makePair('pair-1', 'en/events.yml', 'ru/events.yml')];

    const map = buildPairingFileStateMap(pairs);

    expect(map.get('en/events.yml')).toEqual({
      state: 'paired',
      pairId: 'pair-1',
      role: 'source',
    });
    expect(map.get('ru/events.yml')).toEqual({
      state: 'paired',
      pairId: 'pair-1',
      role: 'translated',
    });
  });

  it('marks source-only file (no translated)', () => {
    const pairs = [makePair('pair-1', 'en/events.yml', null)];

    const map = buildPairingFileStateMap(pairs);

    expect(map.get('en/events.yml')).toEqual({
      state: 'source_only',
      pairId: 'pair-1',
      role: 'source',
    });
  });

  it('marks translated-only file (no source)', () => {
    const pairs = [makePair('pair-1', null, 'ru/events.yml')];

    const map = buildPairingFileStateMap(pairs);

    expect(map.get('ru/events.yml')).toEqual({
      state: 'translated_only',
      pairId: 'pair-1',
      role: 'translated',
    });
  });

  it('handles multiple pairs', () => {
    const pairs = [
      makePair('pair-1', 'en/events.yml', 'ru/events.yml'),
      makePair('pair-2', 'en/gui.yml', null),
      makePair('pair-3', null, 'fr/gui.yml'),
    ];

    const map = buildPairingFileStateMap(pairs);

    expect(map.get('en/events.yml')?.state).toBe('paired');
    expect(map.get('ru/events.yml')?.state).toBe('paired');
    expect(map.get('en/gui.yml')?.state).toBe('source_only');
    expect(map.get('fr/gui.yml')?.state).toBe('translated_only');
    expect(map.size).toBe(4);
  });

  it('files not in any pair are absent from the map', () => {
    const pairs = [makePair('pair-1', 'en/events.yml', 'ru/events.yml')];

    const map = buildPairingFileStateMap(pairs);

    expect(map.has('en/unpaired.yml')).toBe(false);
  });

  it('does not mutate pair data', () => {
    const pairs = [makePair('pair-1', 'en/events.yml', 'ru/events.yml')];
    const original = JSON.stringify(pairs);

    buildPairingFileStateMap(pairs);

    expect(JSON.stringify(pairs)).toBe(original);
  });
});

describe('getActivePairPaths', () => {
  it('returns empty array when selectedPairId is null', () => {
    expect(getActivePairPaths([], null)).toEqual([]);
  });

  it('returns empty array when no pair matches selectedPairId', () => {
    const pairs = [makePair('pair-1', 'en/events.yml', 'ru/events.yml')];
    expect(getActivePairPaths(pairs, 'nonexistent')).toEqual([]);
  });

  it('returns both file paths for a complete pair', () => {
    const pairs = [makePair('pair-1', 'en/events.yml', 'ru/events.yml')];
    const paths = getActivePairPaths(pairs, 'pair-1');
    expect(paths).toEqual(['en/events.yml', 'ru/events.yml']);
  });

  it('returns single path for source-only pair', () => {
    const pairs = [makePair('pair-1', 'en/events.yml', null)];
    const paths = getActivePairPaths(pairs, 'pair-1');
    expect(paths).toEqual(['en/events.yml']);
  });

  it('returns single path for translated-only pair', () => {
    const pairs = [makePair('pair-1', null, 'ru/events.yml')];
    const paths = getActivePairPaths(pairs, 'pair-1');
    expect(paths).toEqual(['ru/events.yml']);
  });
});
