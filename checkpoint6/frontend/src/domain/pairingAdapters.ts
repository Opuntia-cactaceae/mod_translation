/* ------------------------------------------------------------------ */
/*  Pairing Workspace — adapters between API types and domain models   */
/*                                                                      */
/*  Pure conversion functions with no side effects.                     */
/*  Also provides adapters for the old Manual/Files learning flow.      */
/* ------------------------------------------------------------------ */

import type {
  PairingProject,
  PairingProjectFile,
  FileGroupResponse,
  PairingProjectPair,
  PairPreviewResponse,
  FileContentResponse,
  LearnFromPairsRequest,
  PreviewSourceFile,
  PreviewTranslatedFile,
  SuggestedPair,
} from '../api/types';

import type {
  WorkspaceProject,
  WorkspaceFile,
  WorkspaceFileGroup,
  WorkspaceFileContent,
  WorkspacePair,
  WorkspacePairPreview,
  WorkspacePairStatus,
  WorkspaceLearningInput,
} from './pairingTypes';

import type { FileGroupNode } from './grouping/groupingTypes';

/* ================================================================== */
/*  API type → Domain model                                            */
/* ================================================================== */

export function toWorkspaceProject(p: PairingProject): WorkspaceProject {
  return {
    id: p.id,
    name: p.name,
    rootPath: p.root_path,
    sourceLanguage: p.source_language ?? null,
    targetLanguage: p.target_language ?? null,
    status: p.status,
    lastScannedAt: p.last_scanned_at ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    notes: p.notes ?? null,
  };
}

export function toWorkspaceFile(f: PairingProjectFile): WorkspaceFile {
  return {
    id: f.id,
    projectId: f.project_id,
    relativePath: f.relative_path,
    fileName: f.file_name,
    extension: f.extension,
    parentDir: f.parent_dir,
    sizeBytes: f.size_bytes,
    detectedLanguage: f.detected_language ?? null,
    detectedRole: f.detected_role,
    isIgnored: f.is_ignored,
  };
}

export function toWorkspaceFileGroup(g: FileGroupResponse): WorkspaceFileGroup {
  return {
    groupKey: g.group_key,
    displayName: g.display_name,
    relativeDir: g.relative_dir,
    filesCount: g.files_count,
    sourceLikeCount: g.source_like_count,
    translatedLikeCount: g.translated_like_count,
    children: g.children ? g.children.map(toWorkspaceFileGroup) : [],
    files: g.files ? g.files.map(toWorkspaceFile) : [],
  };
}

export function toWorkspaceFileGroups(
  groups: FileGroupResponse[],
): WorkspaceFileGroup[] {
  return groups.map(toWorkspaceFileGroup);
}

export function toWorkspacePairStatus(s: string): WorkspacePairStatus {
  switch (s) {
    case 'suggested':
    case 'accepted':
    case 'manual':
    case 'rejected':
    case 'ignored':
      return s;
    default:
      return 'suggested';
  }
}

export function toWorkspacePair(p: PairingProjectPair): WorkspacePair {
  return {
    id: p.id,
    projectId: p.project_id,
    sourceFileId: p.source_file_id ?? null,
    translatedFileId: p.translated_file_id ?? null,
    sourceFile: p.source_file ? toWorkspaceFile(p.source_file) : null,
    translatedFile: p.translated_file ? toWorkspaceFile(p.translated_file) : null,
    status: toWorkspacePairStatus(p.status),
    confidence: p.confidence,
    reason: p.reason ?? null,
    createdBy: p.created_by,
    notes: p.notes ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export function toWorkspacePairs(
  pairs: PairingProjectPair[],
): WorkspacePair[] {
  return pairs.map(toWorkspacePair);
}

export function toWorkspaceFileContent(
  c: FileContentResponse,
): WorkspaceFileContent {
  return {
    fileId: c.file_id,
    relativePath: c.relative_path,
    content: c.content,
    encoding: c.encoding,
    lineCount: c.line_count,
    sizeBytes: c.size_bytes,
  };
}

export function toWorkspacePairPreview(
  r: PairPreviewResponse,
): WorkspacePairPreview {
  return {
    pair: toWorkspacePair(r.pair),
    sourceFile: r.source_file ? toWorkspaceFileContent(r.source_file) : null,
    translatedFile: r.translated_file
      ? toWorkspaceFileContent(r.translated_file)
      : null,
  };
}

/* ================================================================== */
/*  Domain model → API type (reverse)                                  */
/* ================================================================== */

/** Convert domain status back to raw API status string. */
export function fromWorkspacePairStatus(status: WorkspacePairStatus): string {
  return status;
}

/* ================================================================== */
/*  Old learning flow adapters                                         */
/* ================================================================== */

/**
 * Convert a manual source/translated file path pair (from the old
 * "Manual" tab) into a virtual WorkspacePair.
 * The virtual pair has no real back-end project ID and uses a generated ID.
 * Useful for displaying old Manual tab data in the new Pairing Workspace.
 */
export function manualSamplesToVirtualPair(
  sourceFilePath: string,
  translatedFilePath: string,
): WorkspacePair {
  return {
    id: `virtual_${crypto.randomUUID().slice(0, 8)}`,
    projectId: '__legacy_manual__',
    sourceFileId: `src_${hashCode(sourceFilePath)}`,
    translatedFileId: `tgt_${hashCode(translatedFilePath)}`,
    sourceFile: null,
    translatedFile: null,
    status: 'manual',
    confidence: 1.0,
    reason: 'Legacy manual pair',
    createdBy: 'manual',
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Convert the old FileSourcePreviewResponse (from the "Files" tab)
 * into an array of WorkspacePair representing suggested source/translated
 * file pairings.
 */
export function filesPreviewToPairs(
  sourceFiles: PreviewSourceFile[],
  translatedFiles: PreviewTranslatedFile[],
  suggestedPairs: SuggestedPair[],
  projectId: string = '__legacy_files__',
): WorkspacePair[] {
  // Build lookup maps
  const srcById = new Map(sourceFiles.map((f) => [f.id, f]));
  const tgtById = new Map(translatedFiles.map((f) => [f.id, f]));

  return suggestedPairs.map((sp, idx) => {
    const src = srcById.get(sp.source_file_id);
    const tgt = tgtById.get(sp.translated_file_id);
    return {
      id: `legacy_suggested_${idx}_${hashCode(sp.source_file_id + sp.translated_file_id)}`,
      projectId,
      sourceFileId: sp.source_file_id,
      translatedFileId: sp.translated_file_id,
      sourceFile: null,
      translatedFile: null,
      status: 'suggested',
      confidence: sp.confidence,
      reason: sp.confidence >= 0.8 ? 'Strong match (legacy)' : 'Weak match (legacy)',
      createdBy: 'auto',
      notes: src && tgt ? `${src.file_name} ↔ ${tgt.file_name}` : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

/**
 * Convert workspace learning options into a LearnFromPairsRequest payload.
 * Optionally includes a protection profile_id if the user explicitly selected one.
 * When omitted, the backend auto-creates a project-scoped protection profile.
 */
export function workspacePairsToLearningPayload(
  input: WorkspaceLearningInput,
): LearnFromPairsRequest {
  return {
    ...(input.profileId ? { profile_id: input.profileId } : {}),
    // Omit pair_ids entirely when empty — the backend will select
    // all accepted/manual pairs for the project.
    ...(input.pairIds.length > 0 ? { pair_ids: input.pairIds } : {}),
    include_accepted_pairs: input.includeAccepted,
    include_manual_pairs: input.includeManual,
    use_alignment: input.useAlignment,
  };
}

/* ================================================================== */
/*  Cross-domain adapter: WorkspaceFileGroup → FileGroupNode           */
/* ================================================================== */

/**
 * Convert a WorkspaceFileGroup (pairing workspace recursive tree)
 * to a shared FileGroupNode.
 *
 * Additive — does not replace any existing adapter.
 */
export function toFileGroupNode(g: WorkspaceFileGroup): FileGroupNode {
  return {
    id: g.groupKey,
    label: g.displayName,
    relativePath: g.relativeDir,
    fileCount: g.filesCount,
    files: g.files.map(f => f.relativePath),
    children: g.children.length > 0 ? g.children.map(toFileGroupNode) : undefined,
    meta: { source: 'pairing' },
  };
}

/**
 * Convert an array of WorkspaceFileGroup to FileGroupNode[].
 */
export function toFileGroupNodes(groups: WorkspaceFileGroup[]): FileGroupNode[] {
  return groups.map(toFileGroupNode);
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/** Simple string hash for generating stable-but-short identifiers. */
function hashCode(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}
