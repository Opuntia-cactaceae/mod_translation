import { describe, it, expect } from 'vitest';
import { mapJobResponse, hasOutputFiles, getOutputFiles, mergeJobSummaries, isJobTerminal, getProcessedUnits } from '../jobs';
import type { JobResponse, JobSummaryResponse } from '../../api/types';

/* ================================================================== */
/*  mapJobResponse — output_fields                                     */
/* ================================================================== */

describe('mapJobResponse output files', () => {
  function makeDto(overrides: Partial<JobResponse> = {}): JobResponse {
    return {
      id: 'job-1',
      name: 'test',
      status: 'completed',
      progress: 100,
      total_units: 100,
      completed_units: 100,
      failed_units: 0,
      cached_units: 0,
      current_batch_index: 5,
      total_batches: 5,
      created_at: '2025-01-01T00:00:00Z',
      file_paths: ['/source/file.yml'],
      output_files: [],
      diagnostics: [],
      ...overrides,
    };
  }

  it('maps output_files from top-level field', () => {
    const dto = makeDto({
      output_files: ['/output/file1.yml'],
      output_root_dir: '/output',
    });
    const model = mapJobResponse(dto);
    expect(model.outputFiles).toEqual(['/output/file1.yml']);
    expect(model.outputRootDir).toBe('/output');
  });

  it('maps empty output_files', () => {
    const dto = makeDto({ output_files: [] });
    const model = mapJobResponse(dto);
    expect(model.outputFiles).toEqual([]);
    expect(model.outputRootDir).toBeUndefined();
  });

  it('maps missing output_files gracefully', () => {
    const dto = makeDto();
    delete (dto as any).output_files;
    const model = mapJobResponse(dto);
    expect(model.outputFiles).toEqual([]);
  });

  it('maps multiple output files', () => {
    const dto = makeDto({
      output_files: ['/out/a.yml', '/out/b.yml', '/out/c.yml'],
      output_root_dir: '/out',
    });
    const model = mapJobResponse(dto);
    expect(model.outputFiles).toHaveLength(3);
    expect(model.outputFiles[0]).toBe('/out/a.yml');
    expect(model.outputFiles[2]).toBe('/out/c.yml');
  });

  it('maps legacy result_summary.output_files', () => {
    const dto = makeDto({
      result_summary: {
        output_files: [{ output_path: '/legacy/out.yml' }],
      },
    });
    const model = mapJobResponse(dto);
    expect(model.resultSummary?.outputFiles).toHaveLength(1);
    expect(model.resultSummary!.outputFiles[0].outputPath).toBe('/legacy/out.yml');
  });
});

/* ================================================================== */
/*  hasOutputFiles                                                      */
/* ================================================================== */

describe('hasOutputFiles', () => {
  function makeModel(overrides: Record<string, unknown> = {}) {
    return {
      id: 'j1',
      name: '',
      status: 'completed',
      filePaths: [],
      config: null,
      totalUnits: 100,
      completedUnits: 100,
      failedUnits: 0,
      cachedUnits: 0,
      progress: 100,
      currentBatchIndex: 0,
      totalBatches: 0,
      diagnostics: [],
      outputFiles: [],
      ...overrides,
    } as any;
  }

  it('returns true when outputFiles has items', () => {
    const job = makeModel({ outputFiles: ['/out/a.yml'] });
    expect(hasOutputFiles(job)).toBe(true);
  });

  it('returns false when outputFiles is empty', () => {
    const job = makeModel({ outputFiles: [] });
    expect(hasOutputFiles(job)).toBe(false);
  });

  it('returns false when outputFiles is missing', () => {
    const job = makeModel({});
    delete job.outputFiles;
    expect(hasOutputFiles(job)).toBe(false);
  });
});

/* ================================================================== */
/*  getOutputFiles                                                      */
/* ================================================================== */

describe('getOutputFiles', () => {
  function makeModel(overrides: Record<string, unknown> = {}) {
    return {
      id: 'j1',
      name: '',
      status: 'completed',
      filePaths: [],
      config: null,
      totalUnits: 100,
      completedUnits: 100,
      failedUnits: 0,
      cachedUnits: 0,
      progress: 100,
      currentBatchIndex: 0,
      totalBatches: 0,
      diagnostics: [],
      outputFiles: [],
      ...overrides,
    } as any;
  }

  it('returns mapped OutputFileInfo array', () => {
    const job = makeModel({ outputFiles: ['/out/a.yml', '/out/b.yml'] });
    const result = getOutputFiles(job);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ outputPath: '/out/a.yml' });
    expect(result[1]).toEqual({ outputPath: '/out/b.yml' });
  });

  it('returns empty array when no output files', () => {
    const job = makeModel({ outputFiles: [] });
    expect(getOutputFiles(job)).toEqual([]);
  });
});

/* ================================================================== */
/*  mergeJobSummaries                                                   */
/* ================================================================== */

describe('mergeJobSummaries', () => {
  function makeModel(overrides: Record<string, unknown> = {}): ReturnType<typeof mapJobResponse> {
    return {
      id: 'j1',
      name: 'test-job',
      status: 'running',
      filePaths: ['/src/file.yml'],
      config: { provider: 'groq' },
      totalUnits: 100,
      completedUnits: 30,
      failedUnits: 2,
      cachedUnits: 5,
      progress: 35,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T01:00:00Z',
      errorMessage: undefined,
      currentBatchIndex: 2,
      totalBatches: 10,
      diagnostics: [],
      resultSummary: null,
      currentActivity: undefined,
      outputFiles: ['/out/file.yml'],
      outputRootDir: '/out',
      ...overrides,
    };
  }

  function makeSummary(overrides: Partial<JobSummaryResponse> = {}): JobSummaryResponse {
    return {
      id: 'j1',
      status: 'running',
      progress: 35,
      total_units: 100,
      completed_units: 30,
      failed_units: 2,
      cached_units: 5,
      current_batch_index: 2,
      total_batches: 10,
      updated_at: '2025-01-01T01:00:00Z',
      active_worker: true,
      error_message: undefined,
      ...overrides,
    };
  }

  it('updates progress fields from summary', () => {
    const jobs = [makeModel()];
    const summaries = [makeSummary({ progress: 80, completed_units: 75, failed_units: 3 })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].progress).toBe(80);
    expect(merged[0].completedUnits).toBe(75);
    expect(merged[0].failedUnits).toBe(3);
  });

  it('preserves filePaths and config', () => {
    const jobs = [makeModel()];
    const summaries = [makeSummary({ status: 'completed', progress: 100 })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].filePaths).toEqual(['/src/file.yml']);
    expect(merged[0].config).toEqual({ provider: 'groq' });
  });

  it('preserves resultSummary and diagnostics', () => {
    const jobs = [makeModel({
      resultSummary: { outputFiles: [{ outputPath: '/out/file.yml' }] },
      diagnostics: [{ level: 'info', code: 'TEST', message: 'test', batchIndex: undefined, details: undefined }],
    })];
    const summaries = [makeSummary({ status: 'completed' })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].resultSummary).toEqual({ outputFiles: [{ outputPath: '/out/file.yml' }] });
    expect(merged[0].diagnostics).toHaveLength(1);
    expect(merged[0].diagnostics[0].code).toBe('TEST');
  });

  it('preserves name and createdAt', () => {
    const jobs = [makeModel({ name: 'original-name' })];
    const summaries = [makeSummary()];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].name).toBe('original-name');
    expect(merged[0].createdAt).toBe('2025-01-01T00:00:00Z');
  });

  it('updates status', () => {
    const jobs = [makeModel({ status: 'running' })];
    const summaries = [makeSummary({ status: 'completed' })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].status).toBe('completed');
  });

  it('does not affect jobs not in summaries', () => {
    const jobs = [makeModel({ id: 'j1' }), makeModel({ id: 'j2' })];
    const summaries = [makeSummary({ id: 'j1', progress: 99 })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].progress).toBe(99);
    expect(merged[1].progress).toBe(35);  // unchanged
  });

  it('updates updatedAt', () => {
    const jobs = [makeModel()];
    const summaries = [makeSummary({ updated_at: '2025-02-01T00:00:00Z' })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].updatedAt).toBe('2025-02-01T00:00:00Z');
  });

  it('copies errorMessage from summary', () => {
    const jobs = [makeModel()];
    const summaries = [makeSummary({ status: 'failed', error_message: 'Something broke' })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].errorMessage).toBe('Something broke');
  });

  it('does NOT clear outputFiles and outputRootDir on terminal transition', () => {
    const jobs = [makeModel({
      outputFiles: ['/out/file1.yml', '/out/file2.yml'],
      outputRootDir: '/out',
    })];
    const summaries = [makeSummary({ status: 'completed', progress: 100 })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].outputFiles).toEqual(['/out/file1.yml', '/out/file2.yml']);
    expect(merged[0].outputRootDir).toBe('/out');
  });

  it('does NOT clear filePaths and config on terminal transition', () => {
    const jobs = [makeModel({
      filePaths: ['/src/a.yml', '/src/b.yml'],
      config: { provider: 'groq', model: 'llama' },
    })];
    const summaries = [makeSummary({ status: 'completed' })];
    const merged = mergeJobSummaries(jobs, summaries);
    expect(merged[0].filePaths).toEqual(['/src/a.yml', '/src/b.yml']);
    expect(merged[0].config).toEqual({ provider: 'groq', model: 'llama' });
  });

  it('handles empty jobs array', () => {
    const summaries = [makeSummary({ id: 'orphan' })];
    const merged = mergeJobSummaries([], summaries);
    expect(merged).toEqual([]);
  });

  it('handles empty summaries array (returns jobs unchanged)', () => {
    const jobs = [makeModel()];
    const merged = mergeJobSummaries(jobs, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].progress).toBe(35);
    expect(merged[0].status).toBe('running');
  });
});

/* ================================================================== */
/*  isJobTerminal                                                       */
/* ================================================================== */

describe('isJobTerminal', () => {
  function makeLike(status: string) {
    return { status };
  }

  it('returns true for completed', () => {
    expect(isJobTerminal(makeLike('completed'))).toBe(true);
  });

  it('returns true for failed', () => {
    expect(isJobTerminal(makeLike('failed'))).toBe(true);
  });

  it('returns true for cancelled', () => {
    expect(isJobTerminal(makeLike('cancelled'))).toBe(true);
  });

  it('returns false for running', () => {
    expect(isJobTerminal(makeLike('running'))).toBe(false);
  });

  it('returns false for pending', () => {
    expect(isJobTerminal(makeLike('pending'))).toBe(false);
  });

  it('returns false for paused', () => {
    expect(isJobTerminal(makeLike('paused'))).toBe(false);
  });
});

/* ================================================================== */
/*  getProcessedUnits                                                   */
/* ================================================================== */

describe('getProcessedUnits', () => {
  function makeModel(overrides: Record<string, unknown> = {}) {
    return {
      id: 'j1',
      name: '',
      status: 'running',
      filePaths: [],
      config: null,
      totalUnits: 100,
      completedUnits: 50,
      failedUnits: 5,
      cachedUnits: 10,
      progress: 65,
      currentBatchIndex: 0,
      totalBatches: 0,
      diagnostics: [],
      outputFiles: [],
      ...overrides,
    } as any;
  }

  it('returns completed + failed + cached', () => {
    expect(getProcessedUnits(makeModel())).toBe(65); // 50 + 5 + 10
  });

  it('works when all units are completed (no failed/cached)', () => {
    expect(getProcessedUnits(makeModel({ completedUnits: 445, failedUnits: 0, cachedUnits: 0 }))).toBe(445);
  });

  it('works when all units are cached', () => {
    expect(getProcessedUnits(makeModel({ completedUnits: 0, failedUnits: 0, cachedUnits: 445 }))).toBe(445);
  });

  it('works when all units failed', () => {
    expect(getProcessedUnits(makeModel({ completedUnits: 0, failedUnits: 163, cachedUnits: 1 }))).toBe(164);
  });

  it('works when no units processed yet', () => {
    expect(getProcessedUnits(makeModel({ completedUnits: 0, failedUnits: 0, cachedUnits: 0 }))).toBe(0);
  });

  it('works with mixed counts', () => {
    expect(getProcessedUnits(makeModel({ completedUnits: 20, failedUnits: 5, cachedUnits: 15 }))).toBe(40);
  });
});
