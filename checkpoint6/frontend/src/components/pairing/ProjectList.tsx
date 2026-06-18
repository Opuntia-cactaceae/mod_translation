import { useState, useCallback } from 'react';
import type { PairingProject, CreatePairingProjectRequest } from '../../api/types';
import { api, ApiError, useToast } from '../../App';
import { ConfirmDialog } from '../common/ConfirmDialog';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ProjectListProps {
  projects: PairingProject[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenProject: (project: PairingProject) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_CREATE_FORM: CreatePairingProjectRequest = {
  name: '',
  root_path: '',
  source_language: null,
  target_language: null,
  notes: null,
};

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

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ProjectList({
  projects,
  loading,
  error,
  onRefresh,
  onOpenProject,
}: ProjectListProps) {
  const toast = useToast();

  // ---- Create form state ----
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreatePairingProjectRequest>({ ...DEFAULT_CREATE_FORM });
  const [creating, setCreating] = useState(false);

  // ---- Rename state ----
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  // ---- Delete state ----
  const [deleteTarget, setDeleteTarget] = useState<PairingProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* ---- Create ---- */

  const resetCreateForm = useCallback(() => {
    setShowCreateForm(false);
    setCreateForm({ ...DEFAULT_CREATE_FORM });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!createForm.name.trim() || !createForm.root_path.trim()) {
      toast.showToast('Name and Root Path are required', 'error');
      return;
    }
    setCreating(true);
    try {
      const payload: CreatePairingProjectRequest = {
        name: createForm.name.trim(),
        root_path: createForm.root_path.trim(),
        source_language: createForm.source_language?.trim() || null,
        target_language: createForm.target_language?.trim() || null,
        notes: createForm.notes?.trim() || null,
      };
      await api.createPairingProject(payload);
      toast.showToast('Project created');
      resetCreateForm();
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to create project', 'error');
    } finally {
      setCreating(false);
    }
  }, [createForm, resetCreateForm, onRefresh, toast]);

  /* ---- Rename ---- */

  const startRename = useCallback((project: PairingProject) => {
    setRenamingProjectId(project.id);
    setRenameValue(project.name);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingProjectId(null);
    setRenameValue('');
  }, []);

  const handleRename = useCallback(async (projectId: string) => {
    if (!renameValue.trim()) return;
    setRenameSaving(true);
    try {
      await api.updatePairingProject(projectId, { name: renameValue.trim() });
      toast.showToast('Project renamed');
      setRenamingProjectId(null);
      setRenameValue('');
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to rename project', 'error');
    } finally {
      setRenameSaving(false);
    }
  }, [renameValue, onRefresh, toast]);

  /* ---- Delete ---- */

  const confirmDelete = useCallback((project: PairingProject) => {
    setDeleteTarget(project);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deletePairingProject(deleteTarget.id);
      toast.showToast('Project deleted');
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to delete project', 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, onRefresh, toast]);

  /* ---- Status badge helper ---- */

  const statusBadge = (status: string) => {
    let className = 'badge';
    if (status === 'active') className += ' badge-success';
    else if (status === 'archived') className += ' badge-muted';
    else if (status === 'scanning') className += ' badge-info';
    return <span className={className}>{status}</span>;
  };

  /* ---- Render ---- */

  return (
    <div className="card">
      {/* Header */}
      <div className="card-title">
        <div className="page-header">
          <h3>Pairing Projects</h3>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreateForm(prev => !prev)}
          >
            {showCreateForm ? 'Cancel' : 'Create Project'}
          </button>
        </div>
      </div>

      <div className="card-body">
        {/* Create form */}
        {showCreateForm && (
          <div
            style={{
              padding: '0.75rem',
              background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)',
              marginBottom: 12,
            }}
          >
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Name *</label>
                <input
                  className="form-control"
                  value={createForm.name}
                  onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Project name"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Root Path *</label>
                <input
                  className="form-control"
                  value={createForm.root_path}
                  onChange={e => setCreateForm(prev => ({ ...prev, root_path: e.target.value }))}
                  placeholder="/path/to/project"
                />
              </div>
            </div>
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Source Language</label>
                <input
                  className="form-control"
                  value={createForm.source_language || ''}
                  onChange={e => setCreateForm(prev => ({ ...prev, source_language: e.target.value || null }))}
                  placeholder="e.g. en"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Target Language</label>
                <input
                  className="form-control"
                  value={createForm.target_language || ''}
                  onChange={e => setCreateForm(prev => ({ ...prev, target_language: e.target.value || null }))}
                  placeholder="e.g. fr"
                />
              </div>
            </div>
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Notes</label>
                <input
                  className="form-control"
                  value={createForm.notes || ''}
                  onChange={e => setCreateForm(prev => ({ ...prev, notes: e.target.value || null }))}
                  placeholder="Optional notes"
                />
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 8 }}>
              <button
                className="btn btn-sm"
                onClick={resetCreateForm}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreate}
                disabled={creating || !createForm.name.trim() || !createForm.root_path.trim()}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="empty-state">
            <p>Loading projects...</p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && projects.length === 0 && (
          <div className="empty-state">
            <p>No projects yet. Create one to get started.</p>
          </div>
        )}

        {/* Table */}
        {!loading && !error && projects.length > 0 && (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Root Path</th>
                  <th>Source Lang</th>
                  <th>Target Lang</th>
                  <th>Status</th>
                  <th>Last Scanned</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(project => (
                  <tr key={project.id}>
                    {/* Name column with inline rename */}
                    <td>
                      {renamingProjectId === project.id ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            className="form-control"
                            style={{ width: 140 }}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename(project.id);
                              if (e.key === 'Escape') cancelRename();
                            }}
                          />
                          <button
                            className="btn btn-sm"
                            onClick={handleRename.bind(null, project.id)}
                            disabled={renameSaving || !renameValue.trim()}
                          >
                            {renameSaving ? '...' : 'Save'}
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={cancelRename}
                            disabled={renameSaving}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontWeight: 500 }}>{project.name}</span>
                      )}
                    </td>

                    {/* Root Path */}
                    <td>
                      <code style={{ fontSize: '0.8rem' }}>{project.root_path}</code>
                    </td>

                    {/* Source Lang */}
                    <td>{project.source_language || '-'}</td>

                    {/* Target Lang */}
                    <td>{project.target_language || '-'}</td>

                    {/* Status */}
                    <td>{statusBadge(project.status)}</td>

                    {/* Last Scanned */}
                    <td>{formatDate(project.last_scanned_at)}</td>

                    {/* Created */}
                    <td>{formatDate(project.created_at)}</td>

                    {/* Actions */}
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => onOpenProject(project)}
                          title="Open project"
                        >
                          Open
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => startRename(project)}
                          title="Rename project"
                        >
                          Rename
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => confirmDelete(project)}
                          title="Archive / Delete project"
                        >
                          {project.status === 'archived' ? 'Delete' : 'Archive'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget && deleteTarget.status === 'archived' ? 'Delete Project' : 'Archive Project'}
        message={
          deleteTarget
            ? deleteTarget.status === 'archived'
              ? `Permanently delete "${deleteTarget.name}"? This action cannot be undone.`
              : `Archive "${deleteTarget.name}"? The project and its data will be preserved but hidden.`
            : ''
        }
        confirmLabel={deleteTarget?.status === 'archived' ? 'Delete' : 'Archive'}
        confirmClass="btn btn-danger"
        onConfirm={handleDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}
