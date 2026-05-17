import type { TranslationOptionsResponse } from '../../api/types';
import type { JobModel } from '../../domain';
import { renderConfigValue, type JobConfigFormModel } from '../../domain/jobConfig';
import JobDetailField from './JobDetailField';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobConfigSectionProps {
  job: JobModel;
  editing: boolean;
  editConfigForm: Partial<JobConfigFormModel>;
  onEditConfig: (job: JobModel) => void;
  onEditConfigFieldChange: (field: keyof JobConfigFormModel, value: string) => void;
  onCancelEdit: () => void;
  onSaveConfig: () => void;
  options?: TranslationOptionsResponse | null;
  savingConfig?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobConfigSection({
  job,
  editing,
  editConfigForm,
  onEditConfig,
  onEditConfigFieldChange,
  onCancelEdit,
  onSaveConfig,
  options,
  savingConfig,
}: JobConfigSectionProps) {
  return (
    <div className="job-detail-section">
      <div className="job-detail-section-title">Translation Config</div>
      {editing ? (
        <div>
          <div className="edit-config-form">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Source Language (read-only)</label>
              <input className="form-control edit-config-readonly" value={renderConfigValue(job.config, 'src_lang')} readOnly />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Target Language (read-only)</label>
              <input className="form-control edit-config-readonly" value={renderConfigValue(job.config, 'dst_lang')} readOnly />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Provider (read-only)</label>
              <input className="form-control edit-config-readonly" value={renderConfigValue(job.config, 'runtime.provider')} readOnly />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Model</label>
              <input
                className="form-control"
                placeholder="e.g. gpt-4"
                value={editConfigForm.model ?? ''}
                onChange={e => onEditConfigFieldChange('model', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Batch Size</label>
              <input
                className="form-control"
                type="number"
                value={editConfigForm.batch_size ?? ''}
                onChange={e => onEditConfigFieldChange('batch_size', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Prompt Profile</label>
              <select
                className="form-control"
                value={editConfigForm.prompt_profile ?? ''}
                onChange={e => onEditConfigFieldChange('prompt_profile', e.target.value)}
              >
                <option value="">Default</option>
                {options?.prompt_profiles.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Protection Strategy</label>
              <select
                className="form-control"
                value={editConfigForm.protection_strategy ?? ''}
                onChange={e => onEditConfigFieldChange('protection_strategy', e.target.value)}
              >
                <option value="">Default</option>
                {options?.protection_strategies.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Validator</label>
              <select
                className="form-control"
                value={editConfigForm.validator ?? ''}
                onChange={e => onEditConfigFieldChange('validator', e.target.value)}
              >
                <option value="">Default</option>
                {options?.validators.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="job-detail-actions" style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-sm btn-primary" onClick={onSaveConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save Config'}
            </button>
            <button className="btn btn-sm" onClick={onCancelEdit} disabled={savingConfig}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="job-detail-grid">
            <JobDetailField label="Source Language" value={renderConfigValue(job.config, 'src_lang')} />
            <JobDetailField label="Target Language" value={renderConfigValue(job.config, 'dst_lang')} />
            <JobDetailField label="Provider" value={renderConfigValue(job.config, 'runtime.provider')} />
            <JobDetailField label="Model" value={renderConfigValue(job.config, 'runtime.model')} />
            <JobDetailField label="Batch Size" value={renderConfigValue(job.config, 'batch_size')} />
            <JobDetailField label="Use Cache" value={renderConfigValue(job.config, 'use_cache')} />
            <JobDetailField label="Save Raw Responses" value={renderConfigValue(job.config, 'save_raw_responses')} />
            <JobDetailField label="Prompt Profile" value={renderConfigValue(job.config, 'prompt.profile_name')} />
            <JobDetailField label="Protection Strategy" value={renderConfigValue(job.config, 'protection.strategy')} />
            <JobDetailField label="Validator" value={renderConfigValue(job.config, 'validation.validator_name')} />
          </div>
          {(job.status === 'pending' || job.status === 'paused') && (
            <button className="btn btn-sm" onClick={() => onEditConfig(job)}>
              Edit config
            </button>
          )}
        </div>
      )}
    </div>
  );
}
