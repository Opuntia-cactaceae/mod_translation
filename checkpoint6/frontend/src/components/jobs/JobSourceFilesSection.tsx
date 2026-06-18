import type { JobModel } from '../../domain';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobSourceFilesSectionProps {
  job: JobModel;
  onRevealPath?: (path: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobSourceFilesSection({ job, onRevealPath }: JobSourceFilesSectionProps) {
  return (
    <div className="job-detail-section">
      <div className="job-detail-section-title">Source Files</div>
      {job.filePaths.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>No files</div>
      ) : (
        <div>
          {job.filePaths.map((fp, i) => (
            <div key={i} className="job-source-file">
              <span className="mono">{fp}</span>
              {onRevealPath && (
                <button
                  className="btn btn-sm"
                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', flexShrink: 0 }}
                  onClick={() => onRevealPath(fp)}
                >
                  Open folder
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
