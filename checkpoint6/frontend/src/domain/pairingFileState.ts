/* ------------------------------------------------------------------ */
/*  Pairing File State — per-file pairing state for the file tree.     */
/*                                                                     */
/*  buildPairingFileStateMap computes a path → PairingFileStateInfo    */
/*  lookup from the current WorkspacePair array.                       */
/* ------------------------------------------------------------------ */

import type { WorkspacePair } from './pairingTypes';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type PairingFileState = 'paired' | 'source_only' | 'translated_only';

export interface PairingFileStateInfo {
  state: PairingFileState;
  pairId: string;
  /** The role this file plays in the pair. */
  role: 'source' | 'translated';
}

/* ------------------------------------------------------------------ */
/*  Helper — build file-path → state map from pairs                    */
/* ------------------------------------------------------------------ */

/**
 * Build a Map<relativePath, PairingFileStateInfo> from the current
 * WorkspacePair array.
 *
 * - Files in a complete pair (both source + translated present) → paired
 * - Files that are source without a corresponding translated → source_only
 * - Files that are translated without a corresponding source → translated_only
 * - Files not present in any pair → not added to the map (implicitly unpaired)
 *
 * @param pairs  Current workspace pairs.
 * @returns Map keyed by WorkspaceFile.relativePath.
 */
export function buildPairingFileStateMap(
  pairs: WorkspacePair[],
): Map<string, PairingFileStateInfo> {
  const map = new Map<string, PairingFileStateInfo>();

  for (const pair of pairs) {
    const srcFile = pair.sourceFile;
    const tgtFile = pair.translatedFile;

    if (srcFile) {
      const state: PairingFileState = tgtFile ? 'paired' : 'source_only';
      map.set(srcFile.relativePath, { state, pairId: pair.id, role: 'source' });
    }

    if (tgtFile) {
      const state: PairingFileState = srcFile ? 'paired' : 'translated_only';
      map.set(tgtFile.relativePath, { state, pairId: pair.id, role: 'translated' });
    }
  }

  return map;
}

/**
 * Given a pairing state map and a selected pair ID, collect the relative
 * paths of files belonging to that pair.
 */
export function getActivePairPaths(
  pairs: WorkspacePair[],
  selectedPairId: string | null,
): string[] {
  if (!selectedPairId) return [];
  const pair = pairs.find((p) => p.id === selectedPairId);
  if (!pair) return [];

  const paths: string[] = [];
  if (pair.sourceFile) paths.push(pair.sourceFile.relativePath);
  if (pair.translatedFile) paths.push(pair.translatedFile.relativePath);
  return paths;
}
