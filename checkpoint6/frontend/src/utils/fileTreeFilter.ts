/* ------------------------------------------------------------------ */
/*  File tree filter — pure functions for include/exclude filtering    */
/*                                                                      */
/*  Designed for the PairingFileWorkspace file tree.  Returns a new     */
/*  filtered tree without mutating the source.                          */
/*                                                                      */
/*  Include: comma-separated tokens, case-insensitive substring match.  */
/*    - Empty include → show everything (minus excluded).               */
/*    - If a folder/node matches include → show its whole subtree       */
/*      (minus excluded descendants).                                   */
/*    - If only descendants match → preserve ancestor chain, hide       */
/*      non-matching siblings.                                          */
/*                                                                      */
/*  Exclude: comma-separated tokens, case-insensitive substring match.  */
/*    - If a folder/node matches exclude → hide node + all descendants. */
/*    - Exclude wins over include.                                      */
/*                                                                      */
/*  Empty folders are hidden after filtering unless they matched        */
/*  include and still have visible descendants/files.                   */
/* ------------------------------------------------------------------ */

import type { FileGroupNode } from '../domain/grouping/groupingTypes';

/** Parse a comma-separated filter string into trimmed, non-empty tokens. */
function parseTokens(raw: string): string[] {
  return raw
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/** Case-insensitive substring match against a set of tokens. */
function matchesAny(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const lower = text.toLowerCase();
  return tokens.some(t => lower.includes(t.toLowerCase()));
}

/** Check whether a FileGroupNode matches any of the given tokens. */
function matchesNode(node: FileGroupNode, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  if (matchesAny(node.label, tokens)) return true;
  if (node.relativePath && matchesAny(node.relativePath, tokens)) return true;
  return false;
}

/** Recursively filter an array of nodes, returning a new array. */
function filterNodeList(
  nodes: FileGroupNode[],
  includeTokens: string[],
  excludeTokens: string[],
): FileGroupNode[] {
  const result: FileGroupNode[] = [];
  for (const node of nodes) {
    const filtered = filterSingleNode(node, includeTokens, excludeTokens);
    if (filtered) result.push(filtered);
  }
  return result;
}

/**
 * Filter a single FileGroupNode.
 * Returns null if the node should be hidden entirely.
 */
function filterSingleNode(
  node: FileGroupNode,
  includeTokens: string[],
  excludeTokens: string[],
): FileGroupNode | null {
  /* ---- Exclude check (wins over everything) ---- */
  if (matchesNode(node, excludeTokens)) return null;

  const hasInclude = includeTokens.length > 0;
  const selfMatchesInclude = !hasInclude || matchesNode(node, includeTokens);

  /* ---- Recurse children ---- */
  let filteredChildren: FileGroupNode[] | undefined;
  if (node.children) {
    filteredChildren = filterNodeList(node.children, includeTokens, excludeTokens);
  }

  /* ---- Filter direct files ---- */
  let filteredFiles = node.files;
  if (excludeTokens.length > 0) {
    filteredFiles = filteredFiles.filter(f => !matchesAny(f, excludeTokens));
  }
  if (!selfMatchesInclude && hasInclude) {
    filteredFiles = filteredFiles.filter(f => matchesAny(f, includeTokens));
  }

  const hasVisibleChildren = filteredChildren !== undefined && filteredChildren.length > 0;
  const hasVisibleFiles = filteredFiles.length > 0;

  /* ---- Empty folder after filtering: hide unless it matched include ---- */
  if (!hasVisibleChildren && !hasVisibleFiles) return null;

  return {
    ...node,
    children: filteredChildren !== undefined && hasVisibleChildren ? filteredChildren : undefined,
    files: filteredFiles,
    fileCount: filteredFiles.length + (filteredChildren ? filteredChildren.reduce((s, c) => s + c.fileCount, 0) : 0),
  };
}

/**
 * Main entry point: filter a FileGroupNode[] tree by include/exclude text.
 *
 * @param nodes     - The source tree (not mutated).
 * @param include   - Comma-separated include filter string (empty = show all).
 * @param exclude   - Comma-separated exclude filter string (empty = no exclude).
 * @returns A new filtered tree array.
 */
export function filterFileGroupNodes(
  nodes: FileGroupNode[],
  include: string,
  exclude: string,
): FileGroupNode[] {
  const includeTokens = parseTokens(include);
  const excludeTokens = parseTokens(exclude);

  if (includeTokens.length === 0 && excludeTokens.length === 0) {
    return nodes;
  }

  return filterNodeList(nodes, includeTokens, excludeTokens);
}

/* ------------------------------------------------------------------ */
/*  Extension filter                                                   */
/* ------------------------------------------------------------------ */

/**
 * Recursively filter a FileGroupNode[] tree by file extension.
 *
 * Only leaf nodes whose files have an extension in the allowed set are
 * kept.  Non-leaf nodes are kept if any descendant file survives.
 * Empty folders are pruned.
 *
 * @param nodes         - The source tree (not mutated).
 * @param allowedExts   - Set of extensions to keep (lowercased, e.g. '.yml').
 * @param getExtension  - Function mapping a file path to its extension.
 * @returns A new filtered tree array.
 */
export function filterFileGroupNodesByExtension(
  nodes: FileGroupNode[],
  allowedExts: Set<string>,
  getExtension: (path: string) => string,
): FileGroupNode[] {
  if (allowedExts.size === 0) return nodes;

  const result: FileGroupNode[] = [];
  for (const node of nodes) {
    const filtered = filterSingleNodeByExtension(node, allowedExts, getExtension);
    if (filtered) result.push(filtered);
  }
  return result;
}

function filterSingleNodeByExtension(
  node: FileGroupNode,
  allowedExts: Set<string>,
  getExtension: (path: string) => string,
): FileGroupNode | null {
  // Recurse children first
  let filteredChildren: FileGroupNode[] | undefined;
  if (node.children) {
    filteredChildren = filterFileGroupNodesByExtension(node.children, allowedExts, getExtension);
  }

  // Filter direct files
  const filteredFiles = node.files.filter(f => allowedExts.has(getExtension(f).toLowerCase()));

  const hasVisibleChildren = filteredChildren !== undefined && filteredChildren.length > 0;
  const hasVisibleFiles = filteredFiles.length > 0;

  if (!hasVisibleChildren && !hasVisibleFiles) return null;

  return {
    ...node,
    children: filteredChildren !== undefined && hasVisibleChildren ? filteredChildren : undefined,
    files: filteredFiles,
    fileCount: filteredFiles.length + (filteredChildren ? filteredChildren.reduce((s, c) => s + c.fileCount, 0) : 0),
  };
}
