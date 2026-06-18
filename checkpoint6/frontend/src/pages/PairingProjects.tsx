/* ------------------------------------------------------------------ */
/*  PairingProjects — single-route page with card grid + workspace      */
/*                                                                      */
/*  Project cards above with date grouping, selected project workspace  */
/*  rendered below the cards. No route change, no full-page swap.       */
/* ------------------------------------------------------------------ */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PairingProject, CreatePairingProjectRequest } from '../api/types';
import { api, ApiError, useToast } from '../App';
import ProjectCard from '../components/pairing/ProjectCard';
import ProjectCreateDialog from '../components/pairing/ProjectCreateDialog';
import ProjectWorkspace from '../components/pairing/ProjectWorkspace';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { groupByDateBucket } from '../utils/dateGrouping';
import { usePersistentState } from '../hooks/usePersistentState';
import { STORAGE_KEYS } from '../utils/storageKeys';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PairingProjects() {
  const toast = useToast();

  /* ================================================================ */
  /*  Project list state                                               */
  /* ================================================================ */

  const [projects, setProjects] = useState<PairingProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  /* ================================================================ */
  /*  Selection / workspace state                                      */
  /* ================================================================ */

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  // URL query params for cross-navigation
  const [searchParams] = useSearchParams();

  /* ================================================================ */
  /*  Dialog state                                                     */
  /* ================================================================ */

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PairingProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  /* ================================================================ */
  /*  Loading guard                                                    */
  /* ================================================================ */

  const initialRestoreDoneRef = useRef(false);

  /* ================================================================ */
  /*  Data loading                                                     */
  /* ================================================================ */

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const data = await api.listPairingProjects();
      setProjects(data);
      setProjectsLoading(false);
    } catch (err: unknown) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load projects';
      setProjectsError(message);
      setProjectsLoading(false);
      toast.showToast(message, 'error');
    }
  }, [toast]);

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================================================================ */
  /*  Auto-restore from sessionStorage                                 */
  /* ================================================================ */

  useEffect(() => {
    if (initialRestoreDoneRef.current) return;
    if (projectsLoading || projects.length === 0) return;

    initialRestoreDoneRef.current = true;

    // URL query param takes priority over sessionStorage restore
    const projectIdFromUrl = searchParams.get('project');
    if (projectIdFromUrl) {
      const match = projects.find((p) => p.id === projectIdFromUrl);
      if (match) {
        setSelectedProjectId(match.id);
        sessionStorage.setItem('pairingProjects_activeProjectId', match.id);
        return;
      }
    }

    const savedProjectId = sessionStorage.getItem('pairingProjects_activeProjectId');
    if (savedProjectId) {
      const project = projects.find((p) => p.id === savedProjectId);
      if (project) {
        setSelectedProjectId(project.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsLoading, projects, searchParams]);

  /* ================================================================ */
  /*  Collapse/expand state for date-grouped sections                  */
  /* ================================================================ */

  const [expandedGroups, setExpandedGroups] = usePersistentState<Record<string, boolean>>(
    STORAGE_KEYS.pairingExpandedGroups,
    {},
  );

  const handleToggleGroup = useCallback((bucketKey: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [bucketKey]: prev[bucketKey] === undefined ? false : !prev[bucketKey],
    }));
  }, [setExpandedGroups]);

  function isGroupExpanded(key: string): boolean {
    return expandedGroups[key] !== false;
  }

  /* ================================================================ */
  /*  Selection handler                                                */
  /* ================================================================ */

  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId((prev) => {
      const next = prev === projectId ? null : projectId;
      if (next) {
        sessionStorage.setItem('pairingProjects_activeProjectId', next);
      } else {
        sessionStorage.removeItem('pairingProjects_activeProjectId');
      }
      return next;
    });
  }, []);

  /* ================================================================ */
  /*  Create / Delete handlers                                         */
  /* ================================================================ */

  const handleCreate = useCallback(async (payload: CreatePairingProjectRequest) => {
    setCreating(true);
    try {
      await api.createPairingProject(payload);
      toast.showToast('Project created');
      await loadProjects();
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to create project';
      toast.showToast(message, 'error');
      throw err; // Re-throw so the dialog's catch can handle it
    } finally {
      setCreating(false);
    }
  }, [toast, loadProjects]);

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

      // Clear selection if the deleted project was selected
      if (selectedProjectId === deleteTarget.id) {
        setSelectedProjectId(null);
        sessionStorage.removeItem('pairingProjects_activeProjectId');
      }

      await loadProjects();
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete project';
      toast.showToast(message, 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, selectedProjectId, toast, loadProjects]);

  /* Scan handler for ProjectCard */
  const handleScan = useCallback(async (projectId: string) => {
    try {
      await api.scanPairingProject(projectId);
      toast.showToast('Scan completed');
      await loadProjects();
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Scan failed';
      toast.showToast(message, 'error');
    }
  }, [toast, loadProjects]);

  /* ================================================================ */
  /*  Date-grouped project list                                        */
  /* ================================================================ */

  const projectGroups = groupByDateBucket(
    projects,
    (p) => {
      const raw = p.updated_at || p.created_at;
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    },
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="pairing-page">
      {/* Row 1 — page header */}
      <div className="page-header pairing-page__header">
        <h2>Pairing Projects</h2>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreateDialog(true)}
        >
          Create Project
        </button>
      </div>

      {/* Row 2 — project shelf (scrolls inside, max 220px) */}
      <div className="pairing-page__project-shelf">
        {projectsLoading && (
          <div className="empty-state">
            <p>Loading projects...</p>
          </div>
        )}

        {!projectsLoading && projectsError && (
          <div className="alert alert-error">
            {projectsError}
          </div>
        )}

        {!projectsLoading && !projectsError && projects.length === 0 && (
          <div className="empty-state">
            <p>No projects yet. Create one to get started.</p>
          </div>
        )}

        {!projectsLoading && !projectsError && projects.length > 0 && (
          <div className="output-job-list">
            {projectGroups.map((group) => {
              const expanded = isGroupExpanded(group.bucketKey);
              return (
                <div key={group.bucketKey} className="output-job-group">
                  {/* Collapsible group header */}
                  <div
                    className="output-job-group-header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={() => handleToggleGroup(group.bucketKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggleGroup(group.bucketKey);
                      }
                    }}
                  >
                    <span className={`group-header-arrow${expanded ? ' open' : ''}`}>
                      ▶
                    </span>
                    <span className="output-job-group-title">{group.bucket}</span>
                    <span className="tree-node-count">{group.items.length}</span>
                  </div>

                  {/* Expanded content: project cards */}
                  {expanded && (
                    <div className="job-list-grid">
                      {group.items.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          isSelected={selectedProjectId === project.id}
                          onSelect={handleSelectProject}
                          onScan={handleScan}
                          onDelete={confirmDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Row 3 — workspace (fills remaining space, flex column) */}
      <div className="pairing-page__workspace">
        {selectedProject && (
          <ProjectWorkspace
            project={selectedProject}
            onProjectUpdated={loadProjects}
            onBackToList={() => {
              setSelectedProjectId(null);
              sessionStorage.removeItem('pairingProjects_activeProjectId');
            }}
          />
        )}
      </div>

      {/* Create dialog */}
      <ProjectCreateDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />

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
