import { useState } from 'react';
import type { JobModel } from '../../domain';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobOutputFilesSectionProps {
  job: JobModel;
  onRevealPath?: (path: string) => void;
  onOpenEditor?: (path: string) => void;
}

const MAX_VISIBLE = 20;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getParentDir(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '.';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobOutputFilesSection({
  job,
  onRevealPath,
  onOpenEditor,
}: JobOutputFilesSectionProps) {
  const [showAll, setShowAll] = useState(false);

  const files = job.outputFiles ?? [];
  if (files.length === 0) return null;

  const visible = showAll ? files : files.slice(0, MAX_VISIBLE);
  const hasMore = files.length > MAX_VISIBLE;

  return (
    <div className="job-detail-section">
      <div className="job-detail-section-title">Output Files</div>
      <div>
        {visible.map((fp, i) => (
          <div key={i} className="job-source-file">
            <span className="mono">{fp}</span>
            <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
              {onRevealPath && (
                <button
                  className="btn btn-sm"
                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                  onClick={() => onRevealPath(getParentDir(fp))}
                  title="Reveal output folder in file manager"
                >
                  Open output folder
                </button>
              )}
              {onRevealPath && (
                <button
                  className="btn btn-sm"
                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                  onClick={() => onRevealPath(fp)}
                  title="Open translated file in file manager"
                >
                  Open translated file
                </button>
              )}
              {onOpenEditor && (
                <button
                  className="btn btn-sm btn-primary"
                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                  onClick={() => onOpenEditor(fp)}
                  title="Open translated file in the Editor page"
                >
                  Open in editor
                </button>
              )}
            </div>
          </div>
        ))}
        {hasMore && !showAll && (
          <button
            className="btn btn-sm"
            style={{ marginTop: '0.35rem' }}
            onClick={() => setShowAll(true)}
          >
            Show all ({files.length} files)
          </button>
        )}
        {showAll && hasMore && (
          <button
            className="btn btn-sm"
            style={{ marginTop: '0.35rem' }}
            onClick={() => setShowAll(false)}
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

