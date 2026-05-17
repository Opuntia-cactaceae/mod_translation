import { useState, useCallback } from 'react';
import { api, ApiError } from '../../App';
import type { JobModel } from '../../domain';
import {
  getConfigValue,
  formatConfigValue,
  type JobConfigFormModel,
} from '../../domain/jobConfig';
import type { TranslationOptionsResponse } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UseJobConfigEditingOptions {
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  reloadJobs: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useJobConfigEditing(options: UseJobConfigEditingOptions) {
  const { showToast, reloadJobs } = options;

  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editConfigForm, setEditConfigForm] = useState<Partial<JobConfigFormModel>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  /** Open edit mode for a job, pre-filling the form from the job's config. */
  const startEditing = useCallback((job: JobModel) => {
    setEditingJobId(job.id);
    const cfg = job.config || {};
    setEditConfigForm({
      model: formatConfigValue(getConfigValue(cfg, 'runtime.model')),
      batch_size: formatConfigValue(getConfigValue(cfg, 'batch_size')),
      prompt_profile: formatConfigValue(getConfigValue(cfg, 'prompt.profile_name')),
      protection_strategy: formatConfigValue(getConfigValue(cfg, 'protection.strategy')),
      validator: formatConfigValue(getConfigValue(cfg, 'validation.validator_name')),
    });
  }, []);

  /** Update a single field in the edit form. */
  const updateField = useCallback((field: keyof JobConfigFormModel, value: string) => {
    setEditConfigForm(prev => ({ ...prev, [field]: value }));
  }, []);

  /** Save the config for a given job. */
  const saveConfig = useCallback(async (jobId: string) => {
    setSavingConfig(true);
    try {
      const payload: Record<string, unknown> = {};
      if (editConfigForm.model) payload['runtime.model'] = editConfigForm.model;
      if (editConfigForm.batch_size) payload.batch_size = Number(editConfigForm.batch_size);
      if (editConfigForm.prompt_profile) payload['prompt.profile_name'] = editConfigForm.prompt_profile;
      if (editConfigForm.protection_strategy) payload['protection.strategy'] = editConfigForm.protection_strategy;
      if (editConfigForm.validator) payload['validation.validator_name'] = editConfigForm.validator;

      const res = await api.updateJobConfig(jobId, { config: payload });
      if (res.success) {
        showToast('Job config updated');
        setEditingJobId(null);
        await reloadJobs();
      } else {
        showToast(res.message || 'Failed to update config', 'error');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = err.code === 'CANNOT_CHANGE_LANGUAGE'
          ? 'Cannot change source or target language after job creation'
          : err.code === 'INVALID_JOB_STATE'
          ? 'Cannot edit config for jobs in current state'
          : err.message;
        showToast(msg, 'error');
      } else {
        showToast('Failed to update config', 'error');
      }
    } finally {
      setSavingConfig(false);
    }
  }, [editConfigForm, showToast, reloadJobs]);

  /** Cancel editing. */
  const cancelEdit = useCallback(() => {
    setEditingJobId(null);
  }, []);

  return {
    editingJobId,
    editConfigForm,
    savingConfig,
    startEditing,
    updateField,
    saveConfig,
    cancelEdit,
  };
}
