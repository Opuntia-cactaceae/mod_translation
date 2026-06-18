import type { JobModel } from '../../domain';
import { type JobConfigFormModel } from '../../domain/jobConfig';
import type { JobActionsApi, JobRecoveryApi } from '../../hooks/jobs/types';
import type { TranslationOptionsResponse } from '../../api/types';

import JobSummarySection from './JobSummarySection';
import JobSourceFilesSection from './JobSourceFilesSection';
import JobOutputFilesSection from './JobOutputFilesSection';
import JobConfigSection from './JobConfigSection';
import JobDiagnosticsSection from './JobDiagnosticsSection';
import JobActionsSection from './JobActionsSection';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobExpandedDetailsProps {
  job: JobModel;
  editing: boolean;
  editConfigForm: Partial<JobConfigFormModel>;
  onEditConfig: (job: JobModel) => void;
  onEditConfigFieldChange: (field: keyof JobConfigFormModel, value: string) => void;
  onCancelEdit: () => void;
  onSaveConfig: () => void;
  recovery: JobRecoveryApi;
  jobActions: JobActionsApi;
  onRequestConfirm: (action: 'pause' | 'cancel' | 'restart' | 'retry', job?: JobModel) => void;
  onOpenTrace: (jobId: string) => void;
  onRefresh: () => void;
  options?: TranslationOptionsResponse | null;
  savingConfig?: boolean;
  onRevealPath?: (path: string) => void;
  /** Called with output file id to open the new session-based editor. */
  onOpenEditor?: (outputFileId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobExpandedDetails({
  job,
  editing,
  editConfigForm,
  onEditConfig,
  onEditConfigFieldChange,
  onCancelEdit,
  onSaveConfig,
  recovery,
  jobActions,
  onRequestConfirm,
  onOpenTrace,
  onRefresh,
  options,
  savingConfig,
  onRevealPath,
  onOpenEditor,
}: JobExpandedDetailsProps) {
  return (
    <div className="job-detail-panel">
      {/* Section A: Summary */}
      <JobSummarySection job={job} />

      {/* Section B: Source files */}
      <JobSourceFilesSection job={job} onRevealPath={onRevealPath} />

      {/* Section C: Output files (completed jobs only) */}
      <JobOutputFilesSection
        job={job}
        onRevealPath={onRevealPath}
        onOpenEditor={onOpenEditor}
      />

      {/* Section D: Translation config */}
      <JobConfigSection
        job={job}
        editing={editing}
        editConfigForm={editConfigForm}
        onEditConfig={onEditConfig}
        onEditConfigFieldChange={onEditConfigFieldChange}
        onCancelEdit={onCancelEdit}
        onSaveConfig={onSaveConfig}
        options={options}
        savingConfig={savingConfig}
      />

      {/* Section E: Diagnostics */}
      <JobDiagnosticsSection job={job} />

      {/* Section F: Actions */}
      <JobActionsSection
        job={job}
        jobActions={jobActions}
        onRequestConfirm={onRequestConfirm}
        onRefresh={onRefresh}
        onOpenTrace={onOpenTrace}
      />

      {/* Error message */}
      {job.errorMessage && (
        <div className="alert alert-error" style={{ marginTop: '0.5rem', marginBottom: 0, fontSize: '0.75rem' }}>
          {job.errorMessage}
        </div>
      )}
    </div>
  );
}
