import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { JobModel } from '../../../domain';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockApi = vi.hoisted(() => ({
  updateJobConfig: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
}));

vi.mock('../../../App', () => ({
  api: mockApi,
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

import { useJobConfigEditing } from '../useJobConfigEditing';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const mockJob: JobModel = {
  id: 'job-1',
  name: 'Test Job',
  status: 'running',
  filePaths: ['/path/to/file.txt'],
  config: {
    runtime: { model: 'gpt-4' },
    batch_size: 50,
    prompt: { profile_name: 'default' },
    protection: { strategy: 'none' },
    validation: { validator_name: 'standard' },
  },
  totalUnits: 10,
  completedUnits: 5,
  failedUnits: 0,
  cachedUnits: 0,
  progress: 50,
  currentBatchIndex: 1,
  totalBatches: 2,
  diagnostics: [],
  outputFiles: [],
};

const mockJobMinimalConfig: JobModel = {
  ...mockJob,
  config: {},
};

const mockJobNullConfig: JobModel = {
  ...mockJob,
  config: null,
};

function setup() {
  const showToast = vi.fn();
  const reloadJobs = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useJobConfigEditing({ showToast, reloadJobs }));
  return { result, showToast, reloadJobs };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useJobConfigEditing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /*  Initial state                                                      */
  /* ------------------------------------------------------------------ */

  describe('initial state', () => {
    it('editingJobId starts null', () => {
      const { result } = setup();
      expect(result.current.editingJobId).toBeNull();
    });

    it('editConfigForm starts empty', () => {
      const { result } = setup();
      expect(result.current.editConfigForm).toEqual({});
    });

    it('savingConfig starts false', () => {
      const { result } = setup();
      expect(result.current.savingConfig).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  startEditing                                                       */
  /* ------------------------------------------------------------------ */

  describe('startEditing', () => {
    it('sets editingJobId and prefills form from job.config', () => {
      const { result } = setup();

      act(() => {
        result.current.startEditing(mockJob);
      });

      expect(result.current.editingJobId).toBe('job-1');
      expect(result.current.editConfigForm).toEqual({
        model: 'gpt-4',
        batch_size: '50',
        prompt_profile: 'default',
        protection_strategy: 'none',
        validator: 'standard',
      });
    });

    it('uses em-dash for missing config values', () => {
      const { result } = setup();

      act(() => {
        result.current.startEditing(mockJobMinimalConfig);
      });

      expect(result.current.editingJobId).toBe('job-1');
      expect(result.current.editConfigForm).toEqual({
        model: '\u2014',
        batch_size: '\u2014',
        prompt_profile: '\u2014',
        protection_strategy: '\u2014',
        validator: '\u2014',
      });
    });

    it('handles null config gracefully', () => {
      const { result } = setup();

      act(() => {
        result.current.startEditing(mockJobNullConfig);
      });

      expect(result.current.editingJobId).toBe('job-1');
      // All values become em-dash since config is null
      expect(result.current.editConfigForm.model).toBe('\u2014');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  updateField                                                        */
  /* ------------------------------------------------------------------ */

  describe('updateField', () => {
    it('updates a single field in the form', () => {
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      act(() => result.current.updateField('model', 'claude-3'));

      expect(result.current.editConfigForm.model).toBe('claude-3');
      expect(result.current.editConfigForm.batch_size).toBe('50');
    });

    it('updates batch_size field', () => {
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      act(() => result.current.updateField('batch_size', '100'));

      expect(result.current.editConfigForm.batch_size).toBe('100');
    });

    it('preserves other fields when updating one', () => {
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      act(() => result.current.updateField('model', 'claude-3'));

      expect(result.current.editConfigForm).toEqual({
        model: 'claude-3',
        batch_size: '50',
        prompt_profile: 'default',
        protection_strategy: 'none',
        validator: 'standard',
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  cancelEdit                                                         */
  /* ------------------------------------------------------------------ */

  describe('cancelEdit', () => {
    it('clears editingJobId', () => {
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      expect(result.current.editingJobId).toBe('job-1');

      act(() => result.current.cancelEdit());
      expect(result.current.editingJobId).toBeNull();
    });

    it('preserves editConfigForm values', () => {
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      act(() => result.current.cancelEdit());

      // Form data is preserved but editing state is cleared
      expect(result.current.editConfigForm).not.toEqual({});
      expect(result.current.editingJobId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  saveConfig — success                                                */
  /* ------------------------------------------------------------------ */

  describe('saveConfig success', () => {
    it('calls API with expected payload', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: true, message: 'ok' });
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(mockApi.updateJobConfig).toHaveBeenCalledTimes(1);
      expect(mockApi.updateJobConfig).toHaveBeenCalledWith('job-1', {
        config: {
          'runtime.model': 'gpt-4',
          batch_size: 50,
          'prompt.profile_name': 'default',
          'protection.strategy': 'none',
          'validation.validator_name': 'standard',
        },
      });
    });

    it('shows success toast and reloads jobs', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: true, message: 'ok' });
      const { result, showToast, reloadJobs } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(showToast).toHaveBeenCalledWith('Job config updated');
      expect(reloadJobs).toHaveBeenCalledTimes(1);
    });

    it('clears editingJobId after successful save', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: true, message: 'ok' });
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      expect(result.current.editingJobId).toBe('job-1');

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(result.current.editingJobId).toBeNull();
    });

    it('only sends non-empty fields in payload', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: true, message: 'ok' });
      const { result } = setup();

      // Start with a job that has config, then clear some form fields
      act(() => result.current.startEditing(mockJob));
      act(() => result.current.updateField('model', ''));
      act(() => result.current.updateField('batch_size', ''));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      const payload = mockApi.updateJobConfig.mock.calls[0][1] as { config: Record<string, unknown> };
      expect(payload.config['runtime.model']).toBeUndefined();
      expect(payload.config.batch_size).toBeUndefined();
      expect(payload.config['prompt.profile_name']).toBe('default');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  saveConfig — error                                                  */
  /* ------------------------------------------------------------------ */

  describe('saveConfig error', () => {
    it('shows error toast when API returns success=false', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: false, message: 'Config invalid' });
      const { result, showToast } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(showToast).toHaveBeenCalledWith('Config invalid', 'error');
    });

    it('shows fallback error toast when API returns success=false with no message', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: false, message: '' });
      const { result, showToast } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(showToast).toHaveBeenCalledWith('Failed to update config', 'error');
    });

    it('shows CANNOT_CHANGE_LANGUAGE error for that ApiError code', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.updateJobConfig.mockRejectedValue(
        new ApiError({
          message: 'Language locked',
          code: 'CANNOT_CHANGE_LANGUAGE',
          details: {},
          recoverable: false,
        }),
      );
      const { result, showToast } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(showToast).toHaveBeenCalledWith(
        'Cannot change source or target language after job creation',
        'error',
      );
    });

    it('shows INVALID_JOB_STATE error for that ApiError code', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.updateJobConfig.mockRejectedValue(
        new ApiError({
          message: 'Bad state',
          code: 'INVALID_JOB_STATE',
          details: {},
          recoverable: false,
        }),
      );
      const { result, showToast } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(showToast).toHaveBeenCalledWith(
        'Cannot edit config for jobs in current state',
        'error',
      );
    });

    it('uses ApiError.message for other error codes', async () => {
      const { ApiError } = await import('../../../App');
      mockApi.updateJobConfig.mockRejectedValue(
        new ApiError({
          message: 'Some other error',
          code: 'SOME_OTHER_CODE',
          details: {},
          recoverable: false,
        }),
      );
      const { result, showToast } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(showToast).toHaveBeenCalledWith('Some other error', 'error');
    });

    it('shows generic error toast on unknown error', async () => {
      mockApi.updateJobConfig.mockRejectedValue(new Error('Network failure'));
      const { result, showToast } = setup();

      act(() => result.current.startEditing(mockJob));

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(showToast).toHaveBeenCalledWith('Failed to update config', 'error');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  savingConfig state                                                  */
  /* ------------------------------------------------------------------ */

  describe('savingConfig state', () => {
    it('is false before and after a successful save', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: true, message: 'ok' });
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      expect(result.current.savingConfig).toBe(false);

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(result.current.savingConfig).toBe(false);
    });

    it('is false before and after a failed save', async () => {
      mockApi.updateJobConfig.mockRejectedValue(new Error('fail'));
      const { result } = setup();

      act(() => result.current.startEditing(mockJob));
      expect(result.current.savingConfig).toBe(false);

      await act(async () => {
        await result.current.saveConfig('job-1');
      });

      expect(result.current.savingConfig).toBe(false);
    });

    it('sets savingConfig to true during the operation', async () => {
      let deferredResolve!: (v: { success: boolean; message: string }) => void;
      mockApi.updateJobConfig.mockImplementation(
        () => new Promise(resolve => { deferredResolve = resolve; }),
      );

      const { result } = setup();
      act(() => result.current.startEditing(mockJob));

      const promise = result.current.saveConfig('job-1');

      await waitFor(() => {
        expect(result.current.savingConfig).toBe(true);
      });

      await act(async () => {
        deferredResolve({ success: true, message: 'ok' });
      });
      await promise;

      expect(result.current.savingConfig).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  saveConfig — edge cases                                              */
  /* ------------------------------------------------------------------ */

  describe('saveConfig edge cases', () => {
    it('does not crash when jobId is undefined', async () => {
      // Simulate a race condition where jobId is missing
      mockApi.updateJobConfig.mockRejectedValue(new Error('Bad request'));
      const { result, showToast } = setup();

      act(() => result.current.startEditing(mockJob));

      await expect(
        act(async () => {
          await (result.current.saveConfig as (jobId: string) => Promise<void>)(undefined as unknown as string);
        }),
      ).resolves.not.toThrow();

      expect(showToast).toHaveBeenCalledWith('Failed to update config', 'error');
    });

    it('does not crash when saveConfig is called without startEditing', async () => {
      mockApi.updateJobConfig.mockResolvedValue({ success: true, message: 'ok' });
      const { result } = setup();

      // Save with an empty form (no prior startEditing)
      await expect(
        act(async () => {
          await result.current.saveConfig('job-1');
        }),
      ).resolves.not.toThrow();

      // API should be called with an empty config (all fields are falsy)
      expect(mockApi.updateJobConfig).toHaveBeenCalledWith('job-1', { config: {} });
    });
  });
});
