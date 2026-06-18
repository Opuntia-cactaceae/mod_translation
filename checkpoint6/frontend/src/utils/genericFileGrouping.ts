/* ------------------------------------------------------------------ */
/*  Generic file grouping engine                                       */
/*                                                                      */
/*  Provides four grouping strategies for non-Stellaris file sets:      */
/*    - by_directory       — group by relative directory path           */
/*    - by_filename        — group by full basename (across dirs)       */
/*    - by_language_marker — group by detected language in filename    */
/*    - smart              — directory + prefix-based filename families */
/*                                                                      */
/*  The *Node() variants now return a recursive tree (FileGroupNode[])  */
/*  that preserves directory hierarchy.  Grouping is applied within     */
/*  each directory node rather than globally.                           */
/*                                                                      */
/*  Backward-compatible wrapper: re-exports core utilities from the     */
/*  shared grouping domain (frontend/src/domain/grouping/) and keeps    */
/*  the flat FileGroup-returning functions for existing test coverage.  */
/* ------------------------------------------------------------------ */

import {
  detectLanguageMarker as _detect,
  stripLanguageSuffix as _strip,
  getBasenameFamily as _family,
  deduplicatePaths as _dedup,
  getRelativePath as _rel,
  normalizePath as _norm,
  basename as _basename,
  isAbsolutePath as _isAbsolute,
  type FileGroupNode,
} from '../domain/grouping';

import { type FlatFileGroup } from '../domain/grouping/groupingTypes';

/* ---- Re-export shared helpers for backward compat ---- */

export const detectLanguageMarker = _detect;
export const stripLanguageSuffix = _strip;
export const getBasenameFamily = _family;
export const deduplicatePaths = _dedup;
export const getRelativePath = _rel;
export const normalizePath = _norm;
export const isAbsolutePath = _isAbsolute;

export type { FileGroupNode };

/* ---- Public types (backward-compatible) ---- */

export type GroupingMode = 'folder' | 'filename' | 'language_marker' | 'flat' | 'smart';

export interface FileGroup {
  id: string;
  label: string;
  parentDir: string;
  files: string[];
  fileCount: number;
}

/**
 * Internal grouping mode used by buildDirectoryTree.
 * Maps one-to-one to the public GroupingMode except
 * 'folder' maps to itself, 'filename' maps to 'filename', etc.
 */
type GroupChildrenMode = 'folder' | 'filename' | 'language' | 'smart';

/* ================================================================== */
/*  Internal — build a recursive directory tree                        */
/* ================================================================== */

/**
 * Build a recursive directory tree from file paths.
 *
 * 1. Groups files by relative directory (deduplicating paths).
 * 2. Ensures every intermediate directory path has a node.
 * 3. Within each directory, groups files according to `childrenMode`.
 *
 * Returns a flat array of top-level nodes (each may have nested children).
 * Every directory node carries `files` = all files in its subtree.
 */
function buildDirectoryTree(
  files: string[],
  rootDir: string,
  childrenMode: GroupChildrenMode,
): FileGroupNode[] {
  const deduped = _dedup(files);
  if (deduped.length === 0) return [];

  /* ---- Phase 1: group files by relative directory ---- */
  const dirToFiles = new Map<string, string[]>();
  const allDirPaths = new Set<string>();

  for (const fp of deduped) {
    const rel = _rel(fp, rootDir);
    const parts = rel.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

    if (!dirToFiles.has(dir)) dirToFiles.set(dir, []);
    dirToFiles.get(dir)!.push(fp);

    // Track every intermediate directory so we get a node for each
    let accum = '';
    for (let i = 0; i < parts.length - 1; i++) {
      accum = accum ? `${accum}/${parts[i]}` : parts[i];
      allDirPaths.add(accum);
    }
  }

  // Ensure all intermediate directories have an entry
  for (const dirPath of allDirPaths) {
    if (!dirToFiles.has(dirPath)) {
      dirToFiles.set(dirPath, []);
    }
  }

  /* ---- Phase 2: parent → children directory map ---- */
  const parentChildren = new Map<string, string[]>();
  for (const dirPath of dirToFiles.keys()) {
    if (dirPath === '') continue; // root has no parent
    const parent = dirPath.includes('/')
      ? dirPath.substring(0, dirPath.lastIndexOf('/'))
      : '';
    if (!parentChildren.has(parent)) parentChildren.set(parent, []);
    parentChildren.get(parent)!.push(dirPath);
  }

  const rootDirPaths = (parentChildren.get('') || []).sort();

  /* ---- Phase 3: recursively build tree nodes ---- */

  /**
   * Build a FileGroupNode for a single directory path.
   * Returns null if the directory has no files and no children.
   */
  function buildDirNode(dirPath: string): FileGroupNode | null {
    const directFiles = dirToFiles.get(dirPath);
    if (!directFiles) return null;

    const childDirPaths = (parentChildren.get(dirPath) || []).sort();
    const childNodes: FileGroupNode[] = [];
    let totalFiles = 0;
    const allFiles: string[] = [];

    // 1. Subdirectory nodes first
    for (const childPath of childDirPaths) {
      const child = buildDirNode(childPath);
      if (child) {
        childNodes.push(child);
        totalFiles += child.fileCount;
        allFiles.push(...child.files);
      }
    }

    // 2. Group files directly inside this directory
    const fileGroups = groupDirectoryFiles(directFiles, rootDir, dirPath, childrenMode);
    for (const g of fileGroups) {
      childNodes.push(g);
      totalFiles += g.fileCount;
      allFiles.push(...g.files);
    }

    // If this directory has no content at all, skip it
    if (childNodes.length === 0) return null;

    const label = dirPath ? dirPath.split('/').pop()! : '(root)';

    return {
      id: `dir:${dirPath}`,
      label,
      relativePath: dirPath || undefined,
      fileCount: totalFiles,
      files: allFiles,
      children: childNodes,
    };
  }

  /* ---- Phase 4: handle root-level files (directly under rootDir) ---- */
  const result: FileGroupNode[] = [];

  // Subdirectory nodes
  for (const childPath of rootDirPaths) {
    const node = buildDirNode(childPath);
    if (node) result.push(node);
  }

  // Files in the root directory itself
  const rootFiles = dirToFiles.get('') || [];
  if (rootFiles.length > 0) {
    const rootFileGroups = groupDirectoryFiles(rootFiles, rootDir, '', childrenMode);
    result.push(...rootFileGroups);
  }

  return result;
}

/* ================================================================== */
/*  Internal — group files within a single directory                   */
/* ================================================================== */

/**
 * Group files that reside directly in a given directory.
 *
 * Each returned FileGroupNode is a leaf node (no children) whose
 * `files` array contains the grouped file paths.
 */
function groupDirectoryFiles(
  files: string[],
  rootDir: string,
  _dirPath: string, // relative dir path (used for id uniqueness)
  mode: GroupChildrenMode,
): FileGroupNode[] {
  if (files.length === 0) return [];

  if (mode === 'folder') {
    // Each file becomes its own leaf node
    return files.map(fp => {
      const rel = _rel(fp, rootDir);
      return {
        id: `file:${rel}`,
        label: _basename(fp),
        fileCount: 1,
        files: [fp],
      };
    });
  }

  if (mode === 'filename') {
    const groups = new Map<string, string[]>();
    for (const fp of files) {
      const name = _basename(fp);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(fp);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, gfiles]) => {
        gfiles.sort((a, b) => a.localeCompare(b));
        return {
          id: `name:${_dirPath}:${name}`,
          label: name,
          fileCount: gfiles.length,
          files: gfiles,
        };
      });
  }

  if (mode === 'language') {
    const groups = new Map<string, string[]>();
    for (const fp of files) {
      const lang = _detect(fp) || 'unknown';
      if (!groups.has(lang)) groups.set(lang, []);
      groups.get(lang)!.push(fp);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === 'unknown') return 1;
        if (b === 'unknown') return -1;
        return a.localeCompare(b);
      })
      .map(([lang, gfiles]) => {
        gfiles.sort((a, b) => _basename(a).localeCompare(_basename(b)));
        const label =
          lang === 'unknown'
            ? 'Unknown language'
            : lang.charAt(0).toUpperCase() + lang.slice(1);
        return {
          id: `lang:${_dirPath}:${lang}`,
          label,
          fileCount: gfiles.length,
          files: gfiles,
        };
      });
  }

  if (mode === 'smart') {
    const groups = new Map<string, string[]>();
    for (const fp of files) {
      const family = _family(fp);
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family)!.push(fp);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([family, gfiles]) => {
        gfiles.sort((a, b) => _basename(a).localeCompare(_basename(b)));
        const label = gfiles.length > 1 ? `${family}_*` : _basename(gfiles[0]);
        return {
          id: `smart:${_dirPath}:${family}`,
          label,
          fileCount: gfiles.length,
          files: gfiles,
        };
      });
  }

  return [];
}

/* ------------------------------------------------------------------ */
/*  Grouping strategies (flat)                                         */
/*                                                                      */
/*  Kept for backward compat — the *Node functions below use the        */
/*  tree-based buildDirectoryTree instead.                              */
/* ------------------------------------------------------------------ */

/**
 * Group files by their relative directory path.
 */
export function groupByDirectory(files: string[], rootDir: string): FileGroup[] {
  const groups = new Map<string, string[]>();
  for (const fp of _dedup(files)) {
    const rel = _rel(fp, rootDir);
    const parts = rel.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(fp);
  }

  const entries = Array.from(groups.entries());
  entries.sort(([a], [b]) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

  return entries.map(([dir, fileList]) => {
    fileList.sort((a, b) => _basename(a).localeCompare(_basename(b)));
    return {
      id: `dir:${dir}`,
      label: dir || '(root)',
      parentDir: dir,
      files: fileList,
      fileCount: fileList.length,
    };
  });
}

/**
 * Group files by their full basename (including extension).
 * Files with the same basename in different directories are grouped together.
 */
export function groupByFilename(files: string[], rootDir: string): FileGroup[] {
  const groups = new Map<string, { files: string[]; parentDir: string }>();
  for (const fp of _dedup(files)) {
    const name = _basename(fp);
    const rel = _rel(fp, rootDir);
    const parts = rel.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!groups.has(name)) {
      groups.set(name, { files: [], parentDir: dir });
    }
    groups.get(name)!.files.push(fp);
  }

  const entries = Array.from(groups.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));

  return entries.map(([name, data]) => {
    data.files.sort((a, b) => a.localeCompare(b));
    return {
      id: `name:${name}`,
      label: name,
      parentDir: data.parentDir,
      files: data.files,
      fileCount: data.files.length,
    };
  });
}

/**
 * Group files by detected language marker in the filename.
 * Files without a detectable language go into an "unknown" group.
 */
export function groupByLanguageMarker(files: string[], rootDir: string): FileGroup[] {
  const groups = new Map<string, string[]>();
  for (const fp of _dedup(files)) {
    const lang = _detect(fp) || 'unknown';
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang)!.push(fp);
  }

  const entries = Array.from(groups.entries());
  entries.sort(([a], [b]) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return a.localeCompare(b);
  });

  return entries.map(([lang, fileList]) => {
    fileList.sort((a, b) => _basename(a).localeCompare(_basename(b)));
    const label = lang === 'unknown' ? 'Unknown language' : lang.charAt(0).toUpperCase() + lang.slice(1);
    return {
      id: `lang:${lang}`,
      label,
      parentDir: '',
      files: fileList,
      fileCount: fileList.length,
    };
  });
}

/**
 * Smart grouping: directory-first, then prefix-based filename families.
 */
export function smartGroup(files: string[], rootDir: string): FileGroup[] {
  const dirMap = new Map<string, string[]>();
  for (const fp of _dedup(files)) {
    const rel = _rel(fp, rootDir);
    const parts = rel.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir)!.push(fp);
  }

  const result: FileGroup[] = [];
  const sortedDirs = Array.from(dirMap.keys()).sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

  for (const dir of sortedDirs) {
    const dirFiles = dirMap.get(dir)!;
    const familyMap = new Map<string, string[]>();

    for (const fp of dirFiles) {
      const family = _family(fp);
      if (!familyMap.has(family)) familyMap.set(family, []);
      familyMap.get(family)!.push(fp);
    }

    const sortedFamilies = Array.from(familyMap.keys()).sort();
    for (const family of sortedFamilies) {
      const familyFiles = familyMap.get(family)!;
      familyFiles.sort((a, b) => _basename(a).localeCompare(_basename(b)));

      const label = familyFiles.length > 1 ? `${family}_*` : _basename(familyFiles[0]);
      const groupDirLabel = dir || '(root)';

      result.push({
        id: `smart:${dir}:${family}`,
        label: `${groupDirLabel}/${label}`,
        parentDir: dir,
        files: familyFiles,
        fileCount: familyFiles.length,
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Flat mode — single group containing all files                      */
/* ------------------------------------------------------------------ */

/**
 * Flat grouping: all files in a single group.
 */
export function groupFlat(files: string[], rootDir: string): FileGroup[] {
  const unique = _dedup(files);
  if (unique.length === 0) return [];
  return [{
    id: 'flat:all',
    label: `All files (${unique.length})`,
    parentDir: '',
    files: unique,
    fileCount: unique.length,
  }];
}

/* ------------------------------------------------------------------ */
/*  Recursive *Node variants                                           */
/*                                                                      */
/*  Build proper directory trees with recursive children.  These are    */
/*  what GenericFileSection actually uses.                              */
/* ------------------------------------------------------------------ */

export function groupByDirectoryNode(files: string[], rootDir: string): FileGroupNode[] {
  return buildDirectoryTree(files, rootDir, 'folder');
}

export function groupByFilenameNode(files: string[], rootDir: string): FileGroupNode[] {
  return buildDirectoryTree(files, rootDir, 'filename');
}

export function groupByLanguageMarkerNode(files: string[], rootDir: string): FileGroupNode[] {
  return buildDirectoryTree(files, rootDir, 'language');
}

export function smartGroupNode(files: string[], rootDir: string): FileGroupNode[] {
  return buildDirectoryTree(files, rootDir, 'smart');
}

export function groupFlatNode(files: string[], rootDir: string): FileGroupNode[] {
  const unique = _dedup(files);
  if (unique.length === 0) return [];
  return [{
    id: 'flat:all',
    label: `All files (${unique.length})`,
    fileCount: unique.length,
    files: unique,
  }];
}
