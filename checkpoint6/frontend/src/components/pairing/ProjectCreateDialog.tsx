/* ------------------------------------------------------------------ */
/*  ProjectCreateDialog — modal dialog for creating a pairing project   */
/*                                                                      */
/*  Only requires name + root_path; no source/target language fields.   */
/* ------------------------------------------------------------------ */

import { useState, useCallback } from 'react';
import type { CreatePairingProjectRequest } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProjectCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: CreatePairingProjectRequest) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProjectCreateDialog({
  open,
  onClose,
  onCreate,
}: ProjectCreateDialogProps) {
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const reset = useCallback(() => {
    setName('');
    setRootPath('');
    setNotes('');
    setCreating(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !rootPath.trim()) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        root_path: rootPath.trim(),
        notes: notes.trim() || null,
      });
      reset();
      onClose();
    } catch {
      // Error handling is done by the parent (toast)
    } finally {
      setCreating(false);
    }
  }, [name, rootPath, notes, onCreate, reset, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Create pairing project"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '480px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        <div className="modal-header">
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Create Pairing Project</h3>
                    <button className="modal-close" onClick={() => { reset(); onClose(); }} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          {/* Name */}
          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
              Name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My paired dataset"
              autoFocus
            />
          </div>

          {/* Root path */}
          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
              Root Path <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              className="form-control"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="/path/to/project/files"
            />
          </div>

          {/* Notes */}
          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
              Notes
            </label>
            <textarea
              className="form-control"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Actions */}
          <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button
              className="btn btn-sm"
              onClick={() => { reset(); onClose(); }}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSubmit}
              disabled={creating || !name.trim() || !rootPath.trim()}
            >
              {creating ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
