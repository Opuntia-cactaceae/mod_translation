/* ------------------------------------------------------------------ */
/*  PathPicker — reusable filesystem browser modal                     */
/*  Lets users browse the local filesystem and pick a file/directory   */
/*  without a native dialog. Manual text input is preserved.           */
/* ------------------------------------------------------------------ */

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../App';
import type { DirectoryItem } from '../api/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PathPickerProps {
  value: string;
  onChange: (path: string) => void;
  mode: 'file' | 'directory';
  extensions?: string[];
  label?: string;
  placeholder?: string;
}

/* ------------------------------------------------------------------ */
/*  PathPicker Component                                               */
/* ------------------------------------------------------------------ */

export function PathPicker({ value, onChange, mode, extensions, label, placeholder }: PathPickerProps) {
  const [showModal, setShowModal] = useState(false);
  const [browsePath, setBrowsePath] = useState(value || '');
  const [items, setItems] = useState<DirectoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalInitialised, setModalInitialised] = useState(false);

  // Initialise modal contents when opened
  useEffect(() => {
    if (showModal && !modalInitialised) {
      setModalInitialised(true);
      setError(null);
      const initial = value.trim();
      if (initial) {
        setBrowsePath(initial);
        loadDirectory(initial);
      } else {
        loadHome();
      }
    }
    if (!showModal) {
      setModalInitialised(false);
    }
  }, [showModal, value]);

  // Reset when modal closes
  function handleClose() {
    setShowModal(false);
    setError(null);
  }

  // Only close modal when clicking the backdrop itself, not its children
  function handleBackdropMouseDown(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  function handleOpen() {
    setShowModal(true);
  }

  async function loadHome() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHome();
      setBrowsePath(res.home);
      await loadDirect(res.home);
    } catch {
      setBrowsePath(value || '');
      setError('Could not determine home directory. Enter a path manually.');
    } finally {
      setLoading(false);
    }
  }

  async function loadDirectory(path: string) {
    setLoading(true);
    setError(null);
    try {
      await loadDirect(path);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to list directory');
    } finally {
      setLoading(false);
    }
  }

  async function loadDirect(path: string) {
    const res = await api.listDirectory({
      path: path.trim(),
      mode: 'both',
      extensions: mode === 'file' ? extensions : undefined,
      show_hidden: false,
    });
    setBrowsePath(res.path);
    setItems(res.items);
  }

  async function handleNavigateUp() {
    setLoading(true);
    setError(null);
    try {
      const info = await api.pathInfo({ path: browsePath });
      if (info.parent) {
        await loadDirect(info.parent);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to navigate up');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    await loadDirectory(browsePath);
  }

  function handleItemClick(item: DirectoryItem) {
    if (item.type === 'directory') {
      loadDirectory(item.path);
    } else if (mode === 'file') {
      onChange(item.path);
      handleClose();
    }
  }

  function handleSelectCurrentDirectory() {
    if (mode === 'directory') {
      onChange(browsePath);
      handleClose();
    }
  }

  function handleManualPathChange(e: React.ChangeEvent<HTMLInputElement>) {
    setBrowsePath(e.target.value);
  }

  function handleManualPathKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      loadDirectory(browsePath);
    }
  }

  return (
    <div className="path-picker-wrapper">
      <div className="form-row" style={{ gap: '0.5rem' }}>
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          {label && <label>{label}</label>}
          <input
            className="form-control"
            placeholder={placeholder || 'Enter path...'}
            value={value}
            onChange={e => onChange(e.target.value)}
          />
        </div>
        <button
          className="btn"
          onClick={handleOpen}
          type="button"
          style={{ alignSelf: label ? 'flex-end' : 'center', whiteSpace: 'nowrap' }}
        >
          Browse
        </button>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onMouseDown={handleBackdropMouseDown}>
          <div className="modal-content path-picker-modal" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Path Picker — {mode === 'file' ? 'Select File' : 'Select Directory'}</span>
              <button className="modal-close" onClick={handleClose} type="button" aria-label="Close">&times;</button>
            </div>

            <div className="modal-body">
              {/* Path navigation toolbar */}
              <div className="form-row" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <input
                    className="form-control mono"
                    value={browsePath}
                    onChange={handleManualPathChange}
                    onKeyDown={handleManualPathKeyDown}
                    placeholder="Enter path and press Enter"
                  />
                </div>
                <button className="btn btn-sm" onClick={handleNavigateUp} type="button" title="Parent directory">
                  Up
                </button>
                <button className="btn btn-sm" onClick={handleRefresh} type="button" title="Refresh">
                  Refresh
                </button>
              </div>

              {/* Error */}
              {error && (
                <div className="alert alert-error" style={{ marginBottom: '0.5rem' }}>
                  {error}
                </div>
              )}

              {/* Loading */}
              {loading && (
                <div className="loading">
                  <span className="spinner" /> Loading...
                </div>
              )}

              {/* Items list */}
              {!loading && (
                <div className="path-picker-items">
                  {items.length === 0 ? (
                    <div className="path-picker-empty">No items found</div>
                  ) : (
                    items.map(item => (
                      <div
                        key={item.path}
                        className="path-picker-item"
                        onClick={() => handleItemClick(item)}
                      >
                        <span className="path-picker-item-icon">
                          {item.type === 'directory' ? '\u25B8' : ''}
                        </span>
                        <span
                          className={`path-picker-item-name${item.type === 'directory' ? ' path-picker-item-dir' : ''}`}
                        >
                          {item.name}
                        </span>
                        <span className="path-picker-item-meta">
                          {item.type === 'file' && item.size_bytes != null
                            ? formatSize(item.size_bytes)
                            : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              {mode === 'directory' && (
                <button
                  className="btn btn-primary"
                  onClick={handleSelectCurrentDirectory}
                  disabled={loading}
                  type="button"
                >
                  Select this directory
                </button>
              )}
              <button className="btn" onClick={handleClose} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
