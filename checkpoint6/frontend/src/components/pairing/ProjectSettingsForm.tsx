/* ------------------------------------------------------------------ */
/*  ProjectSettingsForm — compact inline form for selected project      */
/*                                                                      */
/*  Name + Root Path in one grid row; Notes below; Save aligned right. */
/* ------------------------------------------------------------------ */

import { useState, useCallback, useEffect } from 'react';
import type { PairingProject, UpdatePairingProjectRequest } from '../../api/types';
import { api, ApiError, useToast } from '../../App';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProjectSettingsFormProps {
  project: PairingProject;
  onSaved: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProjectSettingsForm({
  project,
  onSaved,
}: ProjectSettingsFormProps) {
  const toast = useToast();

  const [name, setName] = useState(project.name);
  const [notes, setNotes] = useState(project.notes ?? '');
  const [rootPath, setRootPath] = useState(project.root_path);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  /* Reset local state when project changes */
  useEffect(() => {
    setName(project.name);
    setNotes(project.notes ?? '');
    setRootPath(project.root_path);
    setDirty(false);
  }, [project.id, project.name, project.notes, project.root_path]);

  /* Track dirty state */
  useEffect(() => {
    const changed =
      name !== project.name ||
      notes !== (project.notes ?? '') ||
      rootPath !== project.root_path;
    setDirty(changed);
  }, [name, notes, rootPath, project]);

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const payload: UpdatePairingProjectRequest = {};
      if (name !== project.name) payload.name = name.trim();
      if (notes !== (project.notes ?? '')) payload.notes = notes.trim() || null;
      if (rootPath !== project.root_path) payload.root_path = rootPath.trim();

      await api.updatePairingProject(project.id, payload);
      toast.showToast('Project updated');
      setDirty(false);
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to update project';
      toast.showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }, [dirty, name, notes, rootPath, project, toast, onSaved]);

  return (
    <div className="project-settings-form">
      <h4 className="project-settings-form__title">Project Settings</h4>

      {/* Name + Root Path in one grid row */}
      <div className="project-settings-form__grid">
        <div className="project-settings-form__field">
          <label>Name</label>
          <input
            className="form-control"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="project-settings-form__field">
          <label>Root Path</label>
          <input
            className="form-control"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
          />
        </div>
      </div>

      {/* Notes below */}
      <div className="project-settings-form__notes">
        <div className="project-settings-form__field">
          <label>Notes</label>
          <textarea
            className="form-control"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional notes"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="project-settings-form__actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
