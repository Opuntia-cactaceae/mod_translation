/* ------------------------------------------------------------------ */
/*  ProjectCard — clickable project summary card for the card grid      */
/*                                                                      */
/*  Modeled after OutputJobCard in translated-files.                    */
/* ------------------------------------------------------------------ */

import type { PairingProject } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProjectCardProps {
  project: PairingProject;
  isSelected: boolean;
  onSelect: (projectId: string) => void;
  onScan?: (projectId: string) => void;
  onDelete?: (project: PairingProject) => void;
  scanning?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  try {
    const d = new Date(raw);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return raw;
  }
}

function statusBadge(status: string) {
  let className = 'badge badge-sm';
  if (status === 'active') className += ' badge-success';
  else if (status === 'archived') className += ' badge-muted';
  else if (status === 'scanning') className += ' badge-info';
  return <span className={className}>{status}</span>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProjectCard({
  project,
  isSelected,
  onSelect,
  onScan,
  onDelete,
  scanning,
}: ProjectCardProps) {
  return (
    <div
      className={`job-card${isSelected ? ' selected' : ''}`}
      onClick={() => onSelect(project.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(project.id);
        }
      }}
    >
      {/* Header: name + status */}
      <div className="project-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ minWidth: 0 }}>
          <div className="job-card-name">{project.name}</div>
          <div className="project-card-path" style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <code>{project.root_path}</code>
          </div>
        </div>
        {statusBadge(project.status)}
      </div>

      {/* Stats row */}
      <div className="job-card-stats">
        <div className="job-card-stat">
          <span className="job-card-stat-value">
            {project.last_scanned_at ? 'Scanned' : 'Not scanned'}
          </span>
          <span className="job-card-stat-label">Status</span>
        </div>
        <div className="job-card-stat">
          <span className="job-card-stat-value">
            {formatDate(project.last_scanned_at)}
          </span>
          <span className="job-card-stat-label">Last scanned</span>
        </div>
        <div className="job-card-stat">
          <span className="job-card-stat-value">
            {formatDate(project.created_at)}
          </span>
          <span className="job-card-stat-label">Created</span>
        </div>
      </div>

      {/* Languages if present */}
      {(project.source_language || project.target_language) && (
        <div className="job-card-statuses">
          {project.source_language && (
            <span className="badge badge-sm badge-muted">
              Source: {project.source_language}
            </span>
          )}
          {project.target_language && (
            <span className="badge badge-sm badge-muted">
              Target: {project.target_language}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="job-card-actions">
        {onScan && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={(e) => { e.stopPropagation(); onScan(project.id); }}
            disabled={scanning}
            title="Scan project files"
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        )}
        {onDelete && (
          <button
            className="btn btn-sm btn-ghost"
            style={{ color: 'var(--color-danger, #e53e3e)' }}
            onClick={(e) => { e.stopPropagation(); onDelete(project); }}
            title={project.status === 'archived' ? 'Delete permanently' : 'Archive project'}
          >
            {project.status === 'archived' ? 'Delete' : 'Archive'}
          </button>
        )}
      </div>
    </div>
  );
}
