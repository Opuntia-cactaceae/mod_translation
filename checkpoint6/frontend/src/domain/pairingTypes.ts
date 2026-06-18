/* ------------------------------------------------------------------ */
/*  Pairing Workspace — shared domain models                           */
/*                                                                      */
/*  These types decouple UI components from raw API types.              */
/*  Both the old Manual/Files flow and the new Pairing Workspace        */
/*  use these as their canonical internal representation.               */
/* ------------------------------------------------------------------ */

/* ---- Pair status (string union instead of raw string) ---- */

export type WorkspacePairStatus =
  | 'suggested'
  | 'accepted'
  | 'manual'
  | 'rejected'
  | 'ignored';

/* ---- Project ---- */

export interface WorkspaceProject {
  id: string;
  name: string;
  rootPath: string;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  status: string;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
}

/* ---- File in a workspace ---- */

export interface WorkspaceFile {
  id: string;
  projectId: string;
  relativePath: string;
  fileName: string;
  extension: string;
  parentDir: string;
  sizeBytes: number;
  detectedLanguage: string | null;
  detectedRole: string;
  isIgnored: boolean;
}

/* ---- File group (recursive tree node) ---- */

export interface WorkspaceFileGroup {
  groupKey: string;
  displayName: string;
  relativeDir: string;
  filesCount: number;
  sourceLikeCount: number;
  translatedLikeCount: number;
  children: WorkspaceFileGroup[];
  files: WorkspaceFile[];
}

/* ---- Pair between two files ---- */

export interface WorkspacePair {
  id: string;
  projectId: string;
  sourceFileId: string | null;
  translatedFileId: string | null;
  sourceFile: WorkspaceFile | null;
  translatedFile: WorkspaceFile | null;
  status: WorkspacePairStatus;
  confidence: number;
  reason: string | null;
  createdBy: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ---- File content (from preview) ---- */

export interface WorkspaceFileContent {
  fileId: string;
  relativePath: string;
  content: string;
  encoding: string;
  lineCount: number;
  sizeBytes: number;
}

/* ---- Preview for a pair ---- */

export interface WorkspacePairPreview {
  pair: WorkspacePair;
  sourceFile: WorkspaceFileContent | null;
  translatedFile: WorkspaceFileContent | null;
}

/* ---- Learning input (for adapter to old flow) ---- */

export interface WorkspaceLearningInput {
  profileId?: string | null;
  pairIds: string[];
  includeAccepted: boolean;
  includeManual: boolean;
  useAlignment: boolean;
}

/* ---- View state for the workspace page ---- */

export interface WorkspaceViewState {
  view: 'list' | 'workspace';
  activeProjectId: string | null;
  groupingMode: string;
  fileFilter: string;
  searchQuery: string;
  selectedSourceFileId: string | null;
  selectedTranslatedFileId: string | null;
  selectedPairId: string | null;
  showAlignment: boolean;
}
