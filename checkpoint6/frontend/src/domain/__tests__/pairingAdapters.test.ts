import { describe, it, expect } from 'vitest';
import {
  toWorkspaceProject,
  toWorkspaceFile,
  toWorkspaceFileGroup,
  toWorkspaceFileGroups,
  toWorkspacePair,
  toWorkspacePairs,
  toWorkspacePairStatus,
  toWorkspaceFileContent,
  toWorkspacePairPreview,
  manualSamplesToVirtualPair,
  filesPreviewToPairs,
  workspacePairsToLearningPayload,
} from '../pairingAdapters';


/* ------------------------------------------------------------------ */
/*  Mock data (raw API shapes)                                         */
/* ------------------------------------------------------------------ */

const RAW_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  root_path: '/game/mod',
  source_language: 'en',
  target_language: 'fr',
  status: 'active',
  last_scanned_at: '2025-01-15T10:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-15T10:00:00Z',
  notes: 'My project',
};

const RAW_FILE = {
  id: 'file-1',
  project_id: 'proj-1',
  relative_path: 'localisation/en/file.yml',
  file_name: 'file.yml',
  extension: '.yml',
  parent_dir: 'localisation/en',
  size_bytes: 1024,
  content_hash: 'abc123',
  modified_at: '2025-01-10T00:00:00Z',
  detected_language: 'en',
  detected_role: 'source',
  group_key: 'group_en',
  is_ignored: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-10T00:00:00Z',
};

const RAW_GROUP = {
  group_key: 'group1',
  display_name: 'Group 1',
  relative_dir: '/',
  files_count: 2,
  source_like_count: 1,
  translated_like_count: 1,
  children: [],
  files: [RAW_FILE],
};

const RAW_PAIR = {
  id: 'pair-1',
  project_id: 'proj-1',
  source_file_id: 'file-1',
  translated_file_id: 'file-2',
  status: 'accepted',
  confidence: 0.95,
  reason: 'Language suffix match',
  created_by: 'auto',
  notes: null,
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2025-01-15T10:00:00Z',
};

const RAW_CONTENT = {
  file_id: 'file-1',
  relative_path: 'localisation/en/file.yml',
  content: 'l_english:\n key: "value"\n',
  encoding: 'utf-8',
  line_count: 3,
  size_bytes: 100,
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('toWorkspaceProject', () => {
  it('converts snake_case API project to camelCase domain model', () => {
    const result = toWorkspaceProject(RAW_PROJECT as any);
    expect(result.id).toBe('proj-1');
    expect(result.name).toBe('Test Project');
    expect(result.rootPath).toBe('/game/mod');
    expect(result.sourceLanguage).toBe('en');
    expect(result.targetLanguage).toBe('fr');
    expect(result.status).toBe('active');
    expect(result.lastScannedAt).toBe('2025-01-15T10:00:00Z');
    expect(result.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(result.updatedAt).toBe('2025-01-15T10:00:00Z');
    expect(result.notes).toBe('My project');
  });

  it('handles null optional fields', () => {
    const minimal = {
      id: 'p-1',
      name: 'Minimal',
      root_path: '/path',
      source_language: null,
      target_language: null,
      status: 'active',
      last_scanned_at: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      notes: null,
    };
    const result = toWorkspaceProject(minimal as any);
    expect(result.sourceLanguage).toBeNull();
    expect(result.targetLanguage).toBeNull();
    expect(result.lastScannedAt).toBeNull();
    expect(result.notes).toBeNull();
  });
});

describe('toWorkspaceFile', () => {
  it('converts snake_case API file to camelCase domain model', () => {
    const result = toWorkspaceFile(RAW_FILE as any);
    expect(result.id).toBe('file-1');
    expect(result.projectId).toBe('proj-1');
    expect(result.relativePath).toBe('localisation/en/file.yml');
    expect(result.fileName).toBe('file.yml');
    expect(result.extension).toBe('.yml');
    expect(result.parentDir).toBe('localisation/en');
    expect(result.sizeBytes).toBe(1024);
    expect(result.detectedLanguage).toBe('en');
    expect(result.detectedRole).toBe('source');
    expect(result.isIgnored).toBe(false);
  });
});

describe('toWorkspaceFileGroup', () => {
  it('converts single group recursively', () => {
    const result = toWorkspaceFileGroup(RAW_GROUP as any);
    expect(result.groupKey).toBe('group1');
    expect(result.displayName).toBe('Group 1');
    expect(result.filesCount).toBe(2);
    expect(result.files).toHaveLength(1);
    expect(result.children).toHaveLength(0);
    expect(result.files[0].id).toBe('file-1');
  });

  it('converts nested children', () => {
    const nested = {
      ...RAW_GROUP,
      children: [
        { ...RAW_GROUP, group_key: 'child1', display_name: 'Child 1' },
      ],
    };
    const result = toWorkspaceFileGroup(nested as any);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].groupKey).toBe('child1');
  });
});

describe('toWorkspaceFileGroups', () => {
  it('converts an array of groups', () => {
    const result = toWorkspaceFileGroups([RAW_GROUP, RAW_GROUP] as any);
    expect(result).toHaveLength(2);
    expect(result[0].groupKey).toBe('group1');
  });
});

describe('toWorkspacePairStatus', () => {
  it('returns valid statuses as-is', () => {
    expect(toWorkspacePairStatus('suggested')).toBe('suggested');
    expect(toWorkspacePairStatus('accepted')).toBe('accepted');
    expect(toWorkspacePairStatus('manual')).toBe('manual');
    expect(toWorkspacePairStatus('rejected')).toBe('rejected');
    expect(toWorkspacePairStatus('ignored')).toBe('ignored');
  });

  it('defaults unknown status to suggested', () => {
    expect(toWorkspacePairStatus('unknown')).toBe('suggested');
    expect(toWorkspacePairStatus('')).toBe('suggested');
  });
});

describe('toWorkspacePair', () => {
  it('converts snake_case API pair to camelCase domain model', () => {
    const result = toWorkspacePair(RAW_PAIR as any);
    expect(result.id).toBe('pair-1');
    expect(result.projectId).toBe('proj-1');
    expect(result.sourceFileId).toBe('file-1');
    expect(result.translatedFileId).toBe('file-2');
    expect(result.status).toBe('accepted');
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toBe('Language suffix match');
    expect(result.createdBy).toBe('auto');
  });

  it('handles null optional file IDs', () => {
    const raw = { ...RAW_PAIR, source_file_id: null, translated_file_id: null };
    const result = toWorkspacePair(raw as any);
    expect(result.sourceFileId).toBeNull();
    expect(result.translatedFileId).toBeNull();
  });
});

describe('toWorkspacePairs', () => {
  it('converts an array of API pairs', () => {
    const result = toWorkspacePairs([RAW_PAIR, RAW_PAIR] as any);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('pair-1');
  });
});

describe('toWorkspaceFileContent', () => {
  it('converts file content response', () => {
    const result = toWorkspaceFileContent(RAW_CONTENT as any);
    expect(result.fileId).toBe('file-1');
    expect(result.relativePath).toBe('localisation/en/file.yml');
    expect(result.content).toBe('l_english:\n key: "value"\n');
    expect(result.encoding).toBe('utf-8');
    expect(result.lineCount).toBe(3);
    expect(result.sizeBytes).toBe(100);
  });
});

describe('toWorkspacePairPreview', () => {
  it('converts preview response with source and translated files', () => {
    const raw = {
      pair: RAW_PAIR,
      source_file: RAW_CONTENT,
      translated_file: RAW_CONTENT,
    };
    const result = toWorkspacePairPreview(raw as any);
    expect(result.pair.id).toBe('pair-1');
    expect(result.sourceFile?.fileId).toBe('file-1');
    expect(result.translatedFile?.fileId).toBe('file-1');
  });

  it('handles null file content', () => {
    const raw = { pair: RAW_PAIR, source_file: null, translated_file: null };
    const result = toWorkspacePairPreview(raw as any);
    expect(result.sourceFile).toBeNull();
    expect(result.translatedFile).toBeNull();
  });
});

/* ================================================================== */
/*  Adapter tests (old learning flow)                                  */
/* ================================================================== */

describe('manualSamplesToVirtualPair', () => {
  it('creates a manual WorkspacePair from source/translated paths', () => {
    const result = manualSamplesToVirtualPair(
      'localisation/en/file.yml',
      'localisation/fr/file.yml',
    );
    expect(result.status).toBe('manual');
    expect(result.confidence).toBe(1.0);
    expect(result.createdBy).toBe('manual');
    expect(result.reason).toBe('Legacy manual pair');
    expect(result.projectId).toBe('__legacy_manual__');
    expect(result.sourceFileId).toContain('src_');
    expect(result.translatedFileId).toContain('tgt_');
  });
});

describe('filesPreviewToPairs', () => {
  const srcFiles = [
    { id: 'src-1', file_name: 'en.yml', relative_path: 'en.yml' },
    { id: 'src-2', file_name: 'en2.yml', relative_path: 'en2.yml' },
  ];
  const tgtFiles = [
    { id: 'tgt-1', file_name: 'fr.yml', relative_path: 'fr.yml' },
  ];
  const suggestions = [
    { source_file_id: 'src-1', translated_file_id: 'tgt-1', confidence: 0.9 },
  ];

  it('converts suggestions to WorkspacePairs', () => {
    const result = filesPreviewToPairs(
      srcFiles as any,
      tgtFiles as any,
      suggestions as any,
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('suggested');
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].sourceFileId).toBe('src-1');
    expect(result[0].translatedFileId).toBe('tgt-1');
    expect(result[0].createdBy).toBe('auto');
    expect(result[0].projectId).toBe('__legacy_files__');
  });

  it('adds notes with file names when source/target are found', () => {
    const result = filesPreviewToPairs(
      srcFiles as any,
      tgtFiles as any,
      suggestions as any,
    );
    expect(result[0].notes).toContain('en.yml');
    expect(result[0].notes).toContain('fr.yml');
  });

  it('handles empty suggestions gracefully', () => {
    const result = filesPreviewToPairs(
      srcFiles as any,
      tgtFiles as any,
      [] as any,
    );
    expect(result).toHaveLength(0);
  });
});

describe('workspacePairsToLearningPayload', () => {
  it('builds correct API request from WorkspaceLearningInput', () => {
    const result = workspacePairsToLearningPayload({
      pairIds: ['pair-1', 'pair-2'],
      includeAccepted: true,
      includeManual: false,
      useAlignment: true,
    });
    // No profile_id — backend auto-creates a project-scoped protection profile
    expect(result).not.toHaveProperty('profile_id');
    expect(result.pair_ids).toEqual(['pair-1', 'pair-2']);
    expect(result.include_accepted_pairs).toBe(true);
    expect(result.include_manual_pairs).toBe(false);
    expect(result.use_alignment).toBe(true);
  });

  it('omits pair_ids when empty (no specific pairs selected)', () => {
    const result = workspacePairsToLearningPayload({
      pairIds: [],
      includeAccepted: true,
      includeManual: true,
      useAlignment: false,
    });
    // pair_ids should be undefined (not null) — backend selects all pairs
    expect(result.pair_ids).toBeUndefined();
  });

  it('includes profile_id when provided', () => {
    const result = workspacePairsToLearningPayload({
      profileId: 'prof-1',
      pairIds: ['pair-1'],
      includeAccepted: true,
      includeManual: true,
      useAlignment: false,
    });
    expect(result.profile_id).toBe('prof-1');
  });

  it('omits profile_id when null', () => {
    const result = workspacePairsToLearningPayload({
      profileId: null,
      pairIds: ['pair-1'],
      includeAccepted: true,
      includeManual: true,
      useAlignment: false,
    });
    expect(result).not.toHaveProperty('profile_id');
  });

  it('omits profile_id when undefined', () => {
    const result = workspacePairsToLearningPayload({
      pairIds: ['pair-1'],
      includeAccepted: true,
      includeManual: true,
      useAlignment: false,
    });
    expect(result).not.toHaveProperty('profile_id');
  });
});

/* ================================================================== */
/*  Manual/file helpers                                                */
/* ================================================================== */

describe('manualSamplesToVirtualPair', () => {
  it('creates a manual WorkspacePair from source/translated paths', () => {
    const result = manualSamplesToVirtualPair(
      'localisation/en/file.yml',
      'localisation/fr/file.yml',
    );
    expect(result.status).toBe('manual');
    expect(result.createdBy).toBe('manual');
    expect(result.confidence).toBe(1.0);
  });

  it('empty/invalid paths still produce valid pair', () => {
    const pair = manualSamplesToVirtualPair('', '');
    expect(pair.status).toBe('manual');
    expect(pair.sourceFileId).toContain('src_');
    expect(pair.translatedFileId).toContain('tgt_');
    expect(pair.id).toMatch(/^virtual_/);
  });
});
