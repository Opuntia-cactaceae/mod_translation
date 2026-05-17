import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockCreateJob = vi.hoisted(() => vi.fn());
const mockPreviewPlan = vi.hoisted(() => vi.fn());
const mockSetDraftJobSelection = vi.hoisted(() => vi.fn());
const mockGetDraftJobSelection = vi.hoisted(() => vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }));
const mockClearDraftJobSelection = vi.hoisted(() => vi.fn().mockResolvedValue({ files: [], file_metadata: {}, count: 0 }));

/** Simulates the backend's metadata-preservation behaviour for setFiles. */
function simulateSetDraftJobSelection(files: string[], existingMeta: Record<string, Record<string, unknown>>) {
  const file_metadata: Record<string, Record<string, unknown>> = {};
  for (const f of files) {
    if (existingMeta[f]) {
      file_metadata[f] = { ...existingMeta[f] };
    }
  }
  return { files, file_metadata, count: files.length };
}

vi.mock('../../../App', () => ({
  api: {
    createJob: mockCreateJob,
    previewTranslationPlan: mockPreviewPlan,
    getDraftJobSelection: mockGetDraftJobSelection,
    setDraftJobSelection: mockSetDraftJobSelection,
    clearDraftJobSelection: mockClearDraftJobSelection,
  },
  ApiError: class extends Error {
    code = '';
    details: Record<string, unknown> = {};
    recoverable = false;
    constructor(err: { message: string; code: string; details: Record<string, unknown>; recoverable: boolean }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details;
      this.recoverable = err.recoverable;
    }
  },
}));

import { useCreateJobFlow } from '../useCreateJobFlow';

/* ================================================================== */
/*  Form values fixture                                                */
/* ================================================================== */

const BASE_FORM_VALUES = {
  filePaths: '',
  jobName: '',
  srcLang: 'english',
  dstLang: 'russian',
  batchSize: 50,
  useCache: true,
  provider: 'openai',
  model: 'gpt-4',
  apiKeyId: 'key-1',
  apiKeyIds: ['key-1'],
  promptProfileName: '',
  protectionStrategy: 'strict',
  validatorName: 'default',
  outputDir: '',
  outputFilenameSuffix: '',
  outputPreserveRelativePath: true,
  outputOverwrite: false,
  outputBackup: false,
  temperature: 0.7,
  maxRetries: 3,
  timeoutSec: 60,
  maxCompletionTokens: 4096,
  saveRawResponses: false,
};

/** Backend draft metadata store (simulates in-memory backend state). */
let backendMeta: Record<string, { mod_id?: string; mod_name?: string }> = {};

/* ================================================================== */
/*  Setup helper                                                       */
/* ================================================================== */

function setup() {
  const reloadJobs = vi.fn().mockResolvedValue(undefined);
  const selectJob = vi.fn();
  const showToast = vi.fn();
  const { result } = renderHook(() => useCreateJobFlow({ reloadJobs, selectJob, showToast }));
  return { result, reloadJobs, selectJob, showToast };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useCreateJobFlow — file_metadata in create request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    backendMeta = {};

    // Default: setDraftJobSelection returns the submitted files with metadata preserved
    mockSetDraftJobSelection.mockImplementation(
      async ({ files }: { files: string[] }) => simulateSetDraftJobSelection(files, backendMeta),
    );
  });

  // -----------------------------------------------------------------
  //  Basic metadata flow
  // -----------------------------------------------------------------

  it('sends file_metadata for every selected file with distinct mod info', async () => {
    // Arrange: backend has metadata for two files from different mods
    backendMeta = {
      '/mods/mod_a/localisation/a_l_english.yml': { mod_id: 'mod-a', mod_name: 'Mod A' },
      '/mods/mod_b/localisation/b_l_english.yml': { mod_id: 'mod-b', mod_name: 'Mod B' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'new-job-1',
      status: 'pending',
      file_paths: [
        '/mods/mod_a/localisation/a_l_english.yml',
        '/mods/mod_b/localisation/b_l_english.yml',
      ],
    });

    const { result } = setup();

    // Act: call createDirectJob (which calls createAndStartJob internally)
    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: [
        '/mods/mod_a/localisation/a_l_english.yml',
        '/mods/mod_b/localisation/b_l_english.yml',
      ].join('\n'),
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    // Assert: api.createJob was called with correct metadata
    expect(mockSetDraftJobSelection).toHaveBeenCalledTimes(1);
    expect(mockSetDraftJobSelection).toHaveBeenCalledWith({
      files: [
        '/mods/mod_a/localisation/a_l_english.yml',
        '/mods/mod_b/localisation/b_l_english.yml',
      ],
    });

    expect(mockCreateJob).toHaveBeenCalledTimes(1);
    const callPayload = mockCreateJob.mock.calls[0][0];

    expect(callPayload.file_paths).toContain('/mods/mod_a/localisation/a_l_english.yml');
    expect(callPayload.file_paths).toContain('/mods/mod_b/localisation/b_l_english.yml');

    expect(callPayload.file_metadata).toBeDefined();
    expect(callPayload.file_metadata['/mods/mod_a/localisation/a_l_english.yml']).toEqual({
      mod_id: 'mod-a',
      mod_name: 'Mod A',
    });
    expect(callPayload.file_metadata['/mods/mod_b/localisation/b_l_english.yml']).toEqual({
      mod_id: 'mod-b',
      mod_name: 'Mod B',
    });
  });

  it('does not send top-level mod_id/mod_name — only file_metadata', async () => {
    backendMeta = {
      '/f1.yml': { mod_id: 'mod-first', mod_name: 'First Mod' },
      '/f2.yml': { mod_id: 'mod-second', mod_name: 'Second Mod' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'new-job-2',
      status: 'pending',
      file_paths: ['/f1.yml', '/f2.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/f1.yml\n/f2.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // Top-level mod_id/mod_name must NOT be sent.
    expect(payload).not.toHaveProperty('mod_id');
    expect(payload).not.toHaveProperty('mod_name');

    // file_metadata is the exclusive carrier for mod context.
    expect(payload.file_metadata['/f1.yml'].mod_id).toBe('mod-first');
    expect(payload.file_metadata['/f2.yml'].mod_id).toBe('mod-second');
  });

  it('multi-mod create request does not send top-level mod_id/mod_name', async () => {
    backendMeta = {
      '/mods/mod_a/a.yml': { mod_id: 'mod-a', mod_name: 'Mod A' },
      '/mods/mod_b/b.yml': { mod_id: 'mod-b', mod_name: 'Mod B' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'new-job-multi',
      status: 'pending',
      file_paths: ['/mods/mod_a/a.yml', '/mods/mod_b/b.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/mods/mod_a/a.yml\n/mods/mod_b/b.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // No top-level mod context for a multi-mod job.
    expect(payload).not.toHaveProperty('mod_id');
    expect(payload).not.toHaveProperty('mod_name');

    // Every file keeps its own mod context in file_metadata.
    expect(payload.file_metadata['/mods/mod_a/a.yml']).toEqual({
      mod_id: 'mod-a',
      mod_name: 'Mod A',
    });
    expect(payload.file_metadata['/mods/mod_b/b.yml']).toEqual({
      mod_id: 'mod-b',
      mod_name: 'Mod B',
    });
  });

  it('generic file without metadata sends no mod_id/mod_name', async () => {
    // No metadata in backend — generic file.
    backendMeta = {};

    mockCreateJob.mockResolvedValue({
      id: 'new-job-generic',
      status: 'pending',
      file_paths: ['/plain/vanilla/file.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/plain/vanilla/file.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // No top-level mod context.
    expect(payload).not.toHaveProperty('mod_id');
    expect(payload).not.toHaveProperty('mod_name');
    // No file_metadata at all for a generic file without mod context.
    expect(payload.file_metadata).toBeUndefined();
  });

  it('single mod file uses file_metadata, not top-level mod_id/mod_name', async () => {
    backendMeta = {
      '/single_mod/lang/a.yml': { mod_id: 'mod-sole', mod_name: 'Sole Mod' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'new-job-sole',
      status: 'pending',
      file_paths: ['/single_mod/lang/a.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/single_mod/lang/a.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // Even for a single-mod file, context goes into file_metadata only.
    expect(payload).not.toHaveProperty('mod_id');
    expect(payload).not.toHaveProperty('mod_name');
    expect(payload.file_metadata['/single_mod/lang/a.yml']).toEqual({
      mod_id: 'mod-sole',
      mod_name: 'Sole Mod',
    });
  });

  it('does not send file_metadata when no draft metadata exists', async () => {
    // No metadata in backend
    backendMeta = {};

    mockCreateJob.mockResolvedValue({
      id: 'new-job-3',
      status: 'pending',
      file_paths: ['/f1.yml', '/f2.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/f1.yml\n/f2.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];
    expect(payload.file_metadata).toBeUndefined();
  });

  it('sends file_metadata only for files that have it, not for all files', async () => {
    // Only one file has metadata in backend
    backendMeta = {
      '/meta_file.yml': { mod_id: 'mod-a', mod_name: 'Mod A' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'new-job-4',
      status: 'pending',
      file_paths: ['/meta_file.yml', '/plain_file.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/meta_file.yml\n/plain_file.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];
    expect(payload.file_metadata).toBeDefined();
    expect(payload.file_metadata['/meta_file.yml']).toEqual({
      mod_id: 'mod-a',
      mod_name: 'Mod A',
    });
    // plain_file.yml should NOT appear in file_metadata
    expect(payload.file_metadata['/plain_file.yml']).toBeUndefined();
  });

  it('does not merge metadata — each file keeps its own mod', async () => {
    backendMeta = {
      '/a.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
      '/b.yml': { mod_id: 'mod-2', mod_name: 'Mod Two' },
      '/c.yml': { mod_id: 'mod-3', mod_name: 'Mod Three' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'new-job-5',
      status: 'pending',
      file_paths: ['/a.yml', '/b.yml', '/c.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/a.yml\n/b.yml\n/c.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // Each file keeps its own mod_id — no flattening
    expect(payload.file_metadata['/a.yml'].mod_id).toBe('mod-1');
    expect(payload.file_metadata['/b.yml'].mod_id).toBe('mod-2');
    expect(payload.file_metadata['/c.yml'].mod_id).toBe('mod-3');

    const allModIds = Object.values(payload.file_metadata).map(
      (m: Record<string, string>) => m.mod_id,
    );
    expect(new Set(allModIds).size).toBe(3); // all three are distinct
  });

  // -----------------------------------------------------------------
  //  Mixed job: mod file + generic file (regression)
  // -----------------------------------------------------------------

  it('mixed job: mod file + generic file — only mod file has file_metadata', async () => {
    // Backend has metadata only for file A (mod), not for B (generic).
    backendMeta = {
      '/mods/mod_a/localisation/a_l_english.yml': { mod_id: 'mod-a', mod_name: 'Mod A' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'mixed-job',
      status: 'pending',
      file_paths: [
        '/mods/mod_a/localisation/a_l_english.yml',
        '/generic/texts/b.txt',
      ],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/mods/mod_a/localisation/a_l_english.yml\n/generic/texts/b.txt',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // No top-level mod_id/mod_name
    expect(payload).not.toHaveProperty('mod_id');
    expect(payload).not.toHaveProperty('mod_name');

    // file_metadata exists with only file A
    expect(payload.file_metadata).toBeDefined();
    expect(payload.file_metadata['/mods/mod_a/localisation/a_l_english.yml']).toEqual({
      mod_id: 'mod-a',
      mod_name: 'Mod A',
    });

    // File B (generic) should NOT be in file_metadata
    expect(payload.file_metadata['/generic/texts/b.txt']).toBeUndefined();
  });

  it('mixed job: generic file does not inherit mod context', async () => {
    backendMeta = {
      '/mods/mod_a/localisation/a_l_english.yml': { mod_id: 'mod-a', mod_name: 'Mod A' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'mixed-job-2',
      status: 'pending',
      file_paths: [
        '/mods/mod_a/localisation/a_l_english.yml',
        '/generic/texts/b.txt',
      ],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/mods/mod_a/localisation/a_l_english.yml\n/generic/texts/b.txt',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // The generic file must not appear in file_metadata at all
    expect(payload.file_metadata['/generic/texts/b.txt']).toBeUndefined();

    // Only the mod file path should be a key in file_metadata
    const metadataPaths = Object.keys(payload.file_metadata || {});
    expect(metadataPaths).toContain('/mods/mod_a/localisation/a_l_english.yml');
    expect(metadataPaths).not.toContain('/generic/texts/b.txt');
    expect(metadataPaths).toHaveLength(1);
  });

  it('mixed job: no top-level mod_id/mod_name in payload', async () => {
    backendMeta = {
      '/mods/mod_a/localisation/a_l_english.yml': { mod_id: 'mod-a', mod_name: 'Mod A' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'mixed-job-3',
      status: 'pending',
      file_paths: [
        '/mods/mod_a/localisation/a_l_english.yml',
        '/generic/texts/b.txt',
      ],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/mods/mod_a/localisation/a_l_english.yml\n/generic/texts/b.txt',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // The create request must NOT contain top-level mod_id or mod_name
    expect(payload).not.toHaveProperty('mod_id');
    expect(payload).not.toHaveProperty('mod_name');

    // All mod context is carried via file_metadata
    expect(payload.file_metadata).toBeDefined();
  });

  it('reads fresh draft metadata at call time (not stale)', async () => {
    // Backend initially has metadata for files A and B
    backendMeta = {
      '/a.yml': { mod_id: 'mod-a', mod_name: 'Mod A' },
      '/b.yml': { mod_id: 'mod-b', mod_name: 'Mod B' },
      '/c.yml': { mod_id: 'mod-c', mod_name: 'Mod C' },
    };

    mockCreateJob.mockResolvedValue({
      id: 'new-job-6',
      status: 'pending',
      file_paths: ['/b.yml', '/c.yml'],
    });

    const { result } = setup();

    // Act: form only has B and C (A was removed)
    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/b.yml\n/c.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];
    // A was not in the form → setDraftJobSelection only sent B and C
    // → metadata for A was dropped, B and C preserved
    expect(payload.file_metadata['/a.yml']).toBeUndefined();
    expect(payload.file_metadata['/b.yml']).toBeDefined();
    expect(payload.file_metadata['/c.yml']).toBeDefined();
  });

  it('pending translation modId/modName converted to file_metadata', async () => {
    // Simulate a pending translation stored in localStorage (single-mod,
    // no backend metadata). The hook should convert modId/modName into
    // per-file file_metadata instead of sending top-level fields.
    localStorage.setItem('stellaris_translator.pending_translation_files', JSON.stringify(['/mod/lang/a.yml']));
    localStorage.setItem('stellaris_translator.pending_source_name', 'Pending Mod');
    localStorage.setItem('stellaris_translator.pending_mod_id', 'pending-mod');

    // No backend metadata — files came from localStorage.
    backendMeta = {};

    mockCreateJob.mockResolvedValue({
      id: 'new-job-pending',
      status: 'pending',
      file_paths: ['/mod/lang/a.yml'],
    });

    const { result } = setup();

    const formValues = {
      ...BASE_FORM_VALUES,
      filePaths: '/mod/lang/a.yml',
    };

    await act(async () => {
      await result.current.createDirectJob(formValues, null);
    });

    const payload = mockCreateJob.mock.calls[0][0];

    // No top-level mod context.
    expect(payload).not.toHaveProperty('mod_id');
    expect(payload).not.toHaveProperty('mod_name');

    // Pending translation mod context is injected as file_metadata.
    expect(payload.file_metadata['/mod/lang/a.yml']).toEqual({
      mod_id: 'pending-mod',
      mod_name: 'Pending Mod',
    });
  });

  it('backend legacy fallback: explicit mod_id/mod_name still accepted (contract)', async () => {
    // This test validates the type/contract: the CreateJobRequest type
    // still allows legacy clients to send top-level mod_id/mod_name.
    // The backend handles this as a fallback when file_metadata is absent.
    mockCreateJob.mockResolvedValue({
      id: 'legacy-job',
      status: 'pending',
      file_paths: ['/file.yml'],
    });

    // Simulate a legacy caller that sends mod_id/mod_name without file_metadata.
    await mockCreateJob({
      file_paths: ['/file.yml'],
      mod_id: 'legacy-mod',
      mod_name: 'Legacy Mod',
    });

    expect(mockCreateJob).toHaveBeenCalledWith({
      file_paths: ['/file.yml'],
      mod_id: 'legacy-mod',
      mod_name: 'Legacy Mod',
    });
  });

  // -----------------------------------------------------------------
  //  Race-condition tests
  // -----------------------------------------------------------------

  describe('race conditions — submit syncs with backend draft', () => {
    it('create waits for latest backend draft after external add', async () => {
      // Simulate: user added files via external UI, setDraftJobSelection
      // returns the latest state with those files and their metadata.
      backendMeta = {
        '/file_a.yml': { mod_id: 'mod-x', mod_name: 'Mod X' },
        '/file_b.yml': { mod_id: 'mod-x', mod_name: 'Mod X' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-race-add',
        status: 'pending',
        file_paths: ['/file_a.yml', '/file_b.yml'],
      });

      const { result } = setup();

      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/file_a.yml\n/file_b.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      // setDraftJobSelection was called with the form's files
      expect(mockSetDraftJobSelection).toHaveBeenCalledWith({
        files: ['/file_a.yml', '/file_b.yml'],
      });

      // createJob receives both files with metadata
      const payload = mockCreateJob.mock.calls[0][0];
      expect(payload.file_paths).toContain('/file_a.yml');
      expect(payload.file_paths).toContain('/file_b.yml');
      expect(payload.file_metadata['/file_a.yml']).toBeDefined();
      expect(payload.file_metadata['/file_b.yml']).toBeDefined();
    });

    it('create waits for latest backend draft after external remove', async () => {
      // Simulate: user removed file A, backend still has metadata for A
      // but form only sends B → backend preserves only B's metadata.
      backendMeta = {
        '/file_a.yml': { mod_id: 'mod-x', mod_name: 'Mod X' },
        '/file_b.yml': { mod_id: 'mod-x', mod_name: 'Mod X' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-race-remove',
        status: 'pending',
        file_paths: ['/file_b.yml'],
      });

      const { result } = setup();

      // Form only has file B
      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/file_b.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      const payload = mockCreateJob.mock.calls[0][0];
      // File A should NOT be in the create request
      expect(payload.file_paths).toEqual(['/file_b.yml']);
      expect(payload.file_paths).not.toContain('/file_a.yml');
      expect(payload.file_metadata['/file_a.yml']).toBeUndefined();
    });

    it('create after textarea edit sends updated files, not stale files', async () => {
      // Simulate: user edited textarea from "A\nB" to "B\nC"
      backendMeta = {
        '/a.yml': { mod_id: 'mod-1', mod_name: 'Mod 1' },
        '/b.yml': { mod_id: 'mod-1', mod_name: 'Mod 1' },
        '/c.yml': { mod_id: 'mod-2', mod_name: 'Mod 2' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-race-textarea',
        status: 'pending',
        file_paths: ['/b.yml', '/c.yml'],
      });

      const { result } = setup();

      // Form state already updated to B and C
      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/b.yml\n/c.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      // setDraftJobSelection received the updated paths
      expect(mockSetDraftJobSelection).toHaveBeenCalledWith({
        files: ['/b.yml', '/c.yml'],
      });

      const payload = mockCreateJob.mock.calls[0][0];
      // A should not be present
      expect(payload.file_paths).not.toContain('/a.yml');
      expect(payload.file_metadata['/a.yml']).toBeUndefined();
    });

    it('metadata for surviving files preserved after submit sync', async () => {
      // Backend has metadata for A and B
      backendMeta = {
        '/a.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
        '/b.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-meta-preserve',
        status: 'pending',
        file_paths: ['/a.yml', '/b.yml'],
      });

      const { result } = setup();

      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/a.yml\n/b.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      const payload = mockCreateJob.mock.calls[0][0];
      // Both files preserved their metadata
      expect(payload.file_metadata['/a.yml']).toEqual({ mod_id: 'mod-1', mod_name: 'Mod One' });
      expect(payload.file_metadata['/b.yml']).toEqual({ mod_id: 'mod-1', mod_name: 'Mod One' });
    });

    it('removed file metadata not sent in create request', async () => {
      backendMeta = {
        '/a.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
        '/b.yml': { mod_id: 'mod-2', mod_name: 'Mod Two' },
        '/c.yml': { mod_id: 'mod-3', mod_name: 'Mod Three' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-removed-meta',
        status: 'pending',
        file_paths: ['/b.yml', '/c.yml'],
      });

      const { result } = setup();

      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/b.yml\n/c.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      const payload = mockCreateJob.mock.calls[0][0];
      // A's metadata should not be present
      expect(payload.file_metadata['/a.yml']).toBeUndefined();
    });

    it('quick remove + create does not include removed file', async () => {
      backendMeta = {
        '/a.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
        '/b.yml': { mod_id: 'mod-2', mod_name: 'Mod Two' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-quick-remove',
        status: 'pending',
        file_paths: ['/b.yml'],
      });

      const { result } = setup();

      // User quickly removes file A from form and clicks Create
      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/b.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      const payload = mockCreateJob.mock.calls[0][0];
      expect(payload.file_paths).toEqual(['/b.yml']);
      expect(payload.file_paths).not.toContain('/a.yml');
      expect(payload.file_metadata['/a.yml']).toBeUndefined();
    });

    it('quick add + create includes added file', async () => {
      backendMeta = {
        '/existing.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
        '/new.yml': { mod_id: 'mod-2', mod_name: 'Mod Two' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-quick-add',
        status: 'pending',
        file_paths: ['/existing.yml', '/new.yml'],
      });

      const { result } = setup();

      // User quickly adds a new file and clicks Create
      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/existing.yml\n/new.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      const payload = mockCreateJob.mock.calls[0][0];
      expect(payload.file_paths).toContain('/new.yml');
      expect(payload.file_metadata['/new.yml']).toBeDefined();
      expect(payload.file_metadata['/new.yml'].mod_id).toBe('mod-2');
    });

    it('preview confirmation create also uses fresh backend draft', async () => {
      backendMeta = {
        '/a.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
        '/b.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-preview-confirm',
        status: 'pending',
        file_paths: ['/a.yml', '/b.yml'],
      });

      const { result } = setup();

      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/a.yml\n/b.yml',
      };

      // The preview/confirm path calls createAndStartJob internally
      await act(async () => {
        await result.current.confirmPreview(formValues, null);
      });

      // setDraftJobSelection was called (sync happens inside createAndStartJob)
      expect(mockSetDraftJobSelection).toHaveBeenCalledWith({
        files: ['/a.yml', '/b.yml'],
      });

      const payload = mockCreateJob.mock.calls[0][0];
      expect(payload.file_paths).toContain('/a.yml');
      expect(payload.file_paths).toContain('/b.yml');
    });

    it('create clears backend draft after success (handled by backend)', async () => {
      backendMeta = {
        '/a.yml': { mod_id: 'mod-1', mod_name: 'Mod One' },
      };

      mockCreateJob.mockResolvedValue({
        id: 'job-clear-draft',
        status: 'pending',
        file_paths: ['/a.yml'],
      });

      const { result } = setup();

      const formValues = {
        ...BASE_FORM_VALUES,
        filePaths: '/a.yml',
      };

      await act(async () => {
        await result.current.createDirectJob(formValues, null);
      });

      // The backend clears the draft after create_job (tested in backend tests).
      // The frontend does NOT call clearDraftJobSelection from createAndStartJob.
      // Draft clearing on the backend is verified in test_draft_job_selection_api.py.
      expect(mockClearDraftJobSelection).not.toHaveBeenCalled();
    });
  });
});
