/* ------------------------------------------------------------------ */
/*  OutputFilesTable                                                   */
/* ------------------------------------------------------------------ */
import type { OutputFile } from '../../api/types';
import OutputFileStatusBadge from './OutputFileStatusBadge';
import ResultBadge from '../common/ResultBadge';

interface Props {
  files: OutputFile[];
  loading?: boolean;
  total: number;
  onSelectFile: (file: OutputFile) => void;
  selectedFileId?: string;
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '\u2014';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AnalysisBadge({ analysis, stale }: { analysis: OutputFile['latest_analysis']; stale?: boolean }) {
  if (!analysis) {
    return <span className="badge badge-muted">Not analyzed</span>;
  }
  return (
    <ResultBadge
      status={analysis.status}
      errorsCount={analysis.errors_count}
      warningsCount={analysis.warnings_count}
    />
  );
}

export default function OutputFilesTable({ files, loading, total, onSelectFile, selectedFileId }: Props) {
  if (loading) {
    return (
      <div className="loading" style={{ padding: '2rem', justifyContent: 'flex-start' }}>
        <span className="spinner" /> Loading files...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        No translated files found
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Mod</th>
            <th>Group</th>
            <th>Translated Path</th>
            <th>Status</th>
            <th>Analysis</th>
            <th>Size</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {files.map(f => (
            <tr
              key={f.id}
              className={selectedFileId === f.id ? 'selected-row' : ''}
              onClick={() => onSelectFile(f)}
              style={{ cursor: 'pointer' }}
            >
              <td className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.file_name}
              </td>
              <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.mod_name || '\u2014'}
              </td>
              <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.group_label || '\u2014'}
              </td>
              <td className="mono" style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.relative_translated_path || '\u2014'}
              </td>
              <td><OutputFileStatusBadge status={f.status} stale={f.analysis_stale} analysisState={f.latest_analysis_state} /></td>
              <td><AnalysisBadge analysis={f.latest_analysis} stale={f.analysis_stale} /></td>
              <td className="mono">{formatSize(f.translated_size_bytes)}</td>
              <td style={{ fontSize: '0.7rem' }}>
                {f.updated_at ? new Date(f.updated_at).toLocaleDateString() : '\u2014'}
              </td>
              <td>
                <span
                  className="btn btn-sm"
                  onClick={(e) => { e.stopPropagation(); onSelectFile(f); }}
                  title="View details"
                >
                  Details
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > files.length && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.5rem 0.75rem' }}>
          Showing {files.length} of {total} files
        </div>
      )}
    </div>
  );
}
