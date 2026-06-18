/* ------------------------------------------------------------------ */
/*  OutputFilesToolbar                                                 */
/* ------------------------------------------------------------------ */

interface Props {
  jobId?: string | null;
  search: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  onReindex: () => void;
  reindexLoading?: boolean;
  reindexResult?: string | null;
  onAnalyzeStale?: () => void;
  batchAnalyzing?: boolean;
}

export default function OutputFilesToolbar({
  jobId,
  search,
  onSearchChange,
  onRefresh,
  onReindex,
  reindexLoading,
  reindexResult,
  onAnalyzeStale,
  batchAnalyzing,
}: Props) {
  return (
    <div>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: '0.75rem',
      }}>
        <input
          className="form-control"
          style={{ flex: '1 1 200px', minWidth: 0 }}
          placeholder="Search files by name or path"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
        <button className="btn btn-sm" onClick={onRefresh} title="Refresh list">
          Refresh
        </button>
        {jobId && (
          <>
            <button
              className="btn btn-sm btn-primary"
              onClick={onReindex}
              disabled={reindexLoading}
              title="Rescan job output directory and reindex files"
            >
              {reindexLoading ? 'Reindexing...' : 'Reindex'}
            </button>
            {onAnalyzeStale && (
              <button
                className="btn btn-sm"
                onClick={onAnalyzeStale}
                disabled={batchAnalyzing}
                title="Analyze all stale or unanalyzed files in this job"
              >
                {batchAnalyzing ? 'Analyzing stale...' : 'Analyze stale'}
              </button>
            )}
          </>
        )}
      </div>
      {reindexResult && (
        <div className="alert alert-info" style={{ marginBottom: '0.5rem', fontSize: '0.75rem' }}>
          {reindexResult}
        </div>
      )}
    </div>
  );
}
