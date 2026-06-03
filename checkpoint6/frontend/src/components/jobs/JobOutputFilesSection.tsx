import { useMemo, useState } from 'react';
import type { JobModel, OutputFileRef } from '../../domain';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobOutputFilesSectionProps {
  job: JobModel;
  onRevealPath?: (path: string) => void;
  /** Called with output file id when user wants to open the new editor. */
  onOpenEditor?: (outputFileId: string) => void;
}

const MAX_VISIBLE = 20;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getParentDir(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '.';
}

/**
 * Build a lookup map from translated_file_path → OutputFileRef.
 */
function buildRefMap(refs: OutputFileRef[]): Map<string, OutputFileRef> {
  const map = new Map<string, OutputFileRef>();
  for (const ref of refs) {
    map.set(ref.path, ref);
  }
  return map;
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

  // Build ref lookup from the job's outputFileRefs
  // NOTE: useMemo must be called before any early return to keep hook order stable.
  const refMap = useMemo(() => buildRefMap(job.outputFileRefs ?? []), [job.outputFileRefs]);

  if (files.length === 0) return null;

  const visible = showAll ? files : files.slice(0, MAX_VISIBLE);
  const hasMore = files.length > MAX_VISIBLE;

  return (
    <div className="job-detail-section">
      <div className="job-detail-section-title">Output Files</div>
      <div>
        {visible.map((fp, i) => {
          const ref = refMap.get(fp);
          const hasEditorId = Boolean(ref?.id);

          return (
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
                    onClick={() => {
                      if (hasEditorId) {
                        onOpenEditor(ref!.id);
                      }
                    }}
                    disabled={!hasEditorId}
                    title={
                      hasEditorId
                        ? 'Open translated file in the new Editor'
                        : 'Editor not available — file not indexed. Run "Reindex" on the Translated Files page.'
                    }
                  >
                    Open in editor
                  </button>
                )}
              </div>
            </div>
          );
        })}
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
