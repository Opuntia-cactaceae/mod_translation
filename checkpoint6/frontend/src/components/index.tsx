/* ------------------------------------------------------------------ */
/*  Shared UI components                                               */
/* ------------------------------------------------------------------ */

import { useState } from 'react';
import { displayPathTail } from '../utils/pathDisplay';

/* ------------------------------------------------------------------ */
/*  EmptyValue — dim placeholder for null/empty values                 */
/* ------------------------------------------------------------------ */
export function EmptyValue() {
  return <span className="empty-value">Not set</span>;
}

/* ------------------------------------------------------------------ */
/*  FieldValue — label + value pair                                    */
/* ------------------------------------------------------------------ */
interface FieldValueProps {
  label: string;
  value: string | number | boolean | null | undefined;
  mono?: boolean;
}

export function FieldValue({ label, value, mono }: FieldValueProps) {
  const display = value === null || value === undefined || value === ''
    ? <EmptyValue />
    : String(value);

  return (
    <div className="field-value">
      <span className="field-value-label">{label}</span>
      <span className={`field-value-value${mono ? ' mono' : ''}`}>
        {display}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SettingsSummaryCard — grouped field display                        */
/* ------------------------------------------------------------------ */
interface SettingsSummaryCardProps {
  title: string;
  fields: { label: string; value: string | number | boolean | null | undefined; mono?: boolean }[];
}

export function SettingsSummaryCard({ title, fields }: SettingsSummaryCardProps) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="field-value-grid">
        {fields.map(f => (
          <FieldValue key={f.label} label={f.label} value={f.value} mono={f.mono} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CollapsibleSection — toggleable content section                    */
/* ------------------------------------------------------------------ */
interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className={`collapsible-arrow${open ? ' open' : ''}`}>&#9654;</span>
        {title}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FileSuggestionList — found localisation files with add buttons     */
/* ------------------------------------------------------------------ */
export interface FoundFile {
  path: string;
  file_type: string;
  language: string;
  translatable_entries: number;
}

interface FileSuggestionListProps {
  files: FoundFile[];
  addedPaths: Set<string>;
  onAdd: (file: FoundFile) => void;
  onAddAll: () => void;
  onRemove: (path: string) => void;
}

export function FileSuggestionList({ files, addedPaths, onAdd, onAddAll, onRemove }: FileSuggestionListProps) {
  if (files.length === 0) return null;

  return (
    <div className="file-suggestions">
      <div className="file-suggestions-header">
        <span className="field-value-label">Found localisation files ({files.length})</span>
        <button className="btn btn-sm" onClick={onAddAll} type="button">Add all</button>
      </div>
      <div className="file-suggestions-list">
        {files.map(f => {
          const added = addedPaths.has(f.path);
          return (
            <div key={f.path} className={`file-suggestion-item${added ? ' added' : ''}`}>
              <div className="file-suggestion-info">
                <span className="file-suggestion-path mono" title={f.path}>
                  {f.path}
                </span>
                <span className="file-suggestion-meta">
                  {f.language && <span className="badge badge-info">{f.language}</span>}
                  <span className="badge badge-muted">{f.translatable_entries} entries</span>
                </span>
              </div>
              {added ? (
                <button className="btn btn-sm btn-danger" onClick={() => onRemove(f.path)} type="button">Remove</button>
              ) : (
                <button className="btn btn-sm" onClick={() => onAdd(f)} type="button">Add</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AddedFilesChips — chips showing added files with remove           */
/* ------------------------------------------------------------------ */
interface AddedFilesChipsProps {
  paths: string[];
  onRemove: (path: string) => void;
}

export function AddedFilesChips({ paths, onRemove }: AddedFilesChipsProps) {
  if (paths.length === 0) return null;
  return (
    <div className="added-files-chips">
      {paths.length > 1 && (
        <div className="added-files-count">{paths.length} files selected</div>
      )}
      <div className="added-files-chips-scroll">
        {paths.map(p => (
          <span key={p} className="file-chip">
            <span className="mono" title={p}>{displayPathTail(p, paths)}</span>
            <button className="file-chip-remove" onClick={() => onRemove(p)} type="button">&times;</button>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CollapsiblePanel — expandable panel with title and subtitle       */
/* ------------------------------------------------------------------ */
interface CollapsiblePanelProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsiblePanel({ title, subtitle, defaultOpen = false, children }: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-panel">
      <button
        className="collapsible-panel-header"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className={`collapsible-panel-arrow${open ? ' open' : ''}`}>&#9654;</span>
        <div className="collapsible-panel-title-group">
          <span className="collapsible-panel-title">{title}</span>
          {subtitle && <span className="collapsible-panel-subtitle">{subtitle}</span>}
        </div>
      </button>
      {open && <div className="collapsible-panel-body">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PathPicker — re-export from dedicated module                      */
/* ------------------------------------------------------------------ */
export { PathPicker } from './PathPicker';
export type { PathPickerProps } from './PathPicker';
