/* ------------------------------------------------------------------ */
/*  Shared grouping domain — unified types                             */
/*                                                                      */
/*  Single source of truth for grouping-related types used across       */
/*  GenericFileSection, ModListSection, and Pairing Workspace.          */
/* ------------------------------------------------------------------ */

/**
 * Unified grouping mode — supersedes:
 * - `genericFileGrouping.ts`: 'folder' | 'filename' | 'language_marker' | 'smart'
 * - pairing workspace: 'by_directory' | 'by_filename' | 'by_language_marker' | 'flat'
 */
export type GroupingMode = 'flat' | 'directory' | 'filename' | 'language' | 'smart';

/**
 * Recursive-capable file group node.
 *
 * Supports flat rendering (no children) and tree rendering (nested children).
 * The `meta.source` field identifies which part of the app created the node.
 */
export interface FileGroupNode {
  id: string;
  label: string;
  relativePath?: string;
  groupingReason?: string;
  fileCount: number;
  files: string[];
  children?: FileGroupNode[];
  meta?: {
    language?: string;
    family?: string;
    source?: 'generic' | 'stellaris' | 'pairing';
  };
}

/**
 * Flat file group — legacy compat for GenericFileSection.
 *
 * Kept until GenericFileSection migrates fully to FileGroupNode.
 */
export interface FlatFileGroup {
  id: string;
  label: string;
  parentDir: string;
  files: string[];
  fileCount: number;
}
