import { getProcessedUnits, hasOutputFiles, type JobModel } from '../../domain';
import JobDetailField from './JobDetailField';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobSummarySectionProps {
  job: JobModel;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobSummarySection({ job }: JobSummarySectionProps) {
  const outputCount = hasOutputFiles(job) ? job.outputFiles.length : 0;

  return (
    <>
      <div className="job-detail-grid">
        <JobDetailField label="Job ID" value={job.id} mono />
        <JobDetailField label="Name" value={job.name || '\u2014'} />
        <JobDetailField label="Status" value={job.status} />
        <JobDetailField label="Progress" value={`${job.progress.toFixed(1)}%`} />
        <JobDetailField label="Created" value={job.createdAt ? new Date(job.createdAt).toLocaleString() : '\u2014'} />
        <JobDetailField label="Updated" value={job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '\u2014'} />
        <JobDetailField label="Total units" value={String(job.totalUnits)} />
        <JobDetailField label="Completed" value={String(job.completedUnits)} />
        <JobDetailField label="Failed" value={String(job.failedUnits)} />
        <JobDetailField label="Cached" value={String(job.cachedUnits)} />
        <JobDetailField label="Batch" value={`${job.currentBatchIndex} / ${job.totalBatches}`} />
      </div>

      {/* Output summary for completed jobs */}
      {job.status === 'completed' && job.totalUnits > 0 && outputCount > 0 && (
        <div style={{
          marginTop: '0.5rem',
          padding: '0.35rem 0.5rem',
          fontSize: '0.8rem',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text)',
        }}>
          <strong>Output:</strong>{' '}
          {getProcessedUnits(job)} units
          {job.completedUnits > 0 && ` \u00B7 ${job.completedUnits} translated`}
          {job.cachedUnits > 0 && ` \u00B7 ${job.cachedUnits} cached`}
          {job.failedUnits > 0 && ` \u00B7 ${job.failedUnits} failed`}
          {' — '}
          {outputCount === 1 ? '1 translated file generated' : `${outputCount} translated files generated`}
        </div>
      )}

      {/* Warning: no units found */}
      {job.totalUnits === 0 && job.filePaths.length > 0 && (
        <div className="alert alert-warning" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
          <strong>No translation units found.</strong> Check file format, language header, or selected files.
          {Array.isArray(job.diagnostics) && job.diagnostics.some(
            d => d.code === 'NO_TRANSLATABLE_UNITS' || d.code === 'NO_TRANSLATION_UNITS_FOUND'
          ) && (
            <span> See <strong>Diagnostics</strong> section below for details.</span>
          )}
        </div>
      )}
    </>
  );
}
