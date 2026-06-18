/* ------------------------------------------------------------------ */
/*  FileRow — leaf-level file row component                            */
/*                                                                      */
/*  Renders a single file with checkbox, path, and action buttons.      */
/*  Supports both translation-job draft mode and custom actions.        */
/*  Accepts a `style` prop for future virtualization libraries.         */
/*  Uses stable keys (file path) for correct reconciliation.            */
/* ------------------------------------------------------------------ */

import React from 'react';

interface FileRowProps {
  filePath: string;
  relativePath: string;
  /** Display mode for the file path. 'full_path' shows the full relative path (default).
   *  'basename' shows file name as primary and parent dir as secondary muted text. */
  displayMode?: 'full_path' | 'basename';
  /** Whether file is in the translation job draft (optional). */
  isInDraft?: boolean;
  /** Whether to show a checkbox selector (default true). */
  selectable?: boolean;
  /** Whether the checkbox is checked (optional; only used when selectable=true). */
  isSelected?: boolean;
  /** Called to toggle file selection (optional; only used when selectable=true). */
  onToggleSelect?: () => void;
  /** Called to add/remove file from draft (optional — hide button if absent). */
  onToggleDraft?: () => void;
  onOpenFolder: () => void;
  style?: React.CSSProperties;
  /** Additional CSS class for the row div. */
  className?: string;
  /** If provided, replaces the draft-toggle button with custom actions. */
  customActions?: React.ReactNode;
  /** When true, adds data-reveal-path attribute for DOM-based scroll/pulse targeting. */
  revealed?: boolean;
  /** Enables native HTML5 drag on this row. The handler should set drag payload. */
  onFileDragStart?: (filePath: string, event: React.DragEvent) => void;
}

export function FileRow({
  filePath,
  relativePath,
  displayMode = 'full_path',
  isInDraft = false,
  selectable = true,
  isSelected = false,
  onToggleSelect = () => {},
  onToggleDraft,
  onOpenFolder,
  style,
  className,
  customActions,
  revealed,
  onFileDragStart,
}: FileRowProps) {
  // Compute basename and parent dir for basename display mode
  const fileName = relativePath.split('/').pop() ?? relativePath;
  const parentDir = relativePath.includes('/')
    ? relativePath.substring(0, relativePath.lastIndexOf('/'))
    : '';

  return (
    <div
      key={filePath}
      className={`${isInDraft ? 'loc-file-added' : ''}${className ? ` ${className}` : ''}`}
      {...(revealed ? { 'data-reveal-path': filePath } : {})}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.3rem 0',
        borderBottom: '1px solid var(--color-border)',
        fontSize: '0.8rem',
        ...style,
      }}
    >
      {selectable && (
        <input
          type="checkbox"
          className="form-checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
        />
      )}
      {displayMode === 'basename' ? (
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            minWidth: 0,
            cursor: onFileDragStart ? 'grab' : undefined,
          }}
        >
          {/* Primary: file name */}
          <span
            className="mono"
            draggable={!!onFileDragStart}
            onDragStart={onFileDragStart ? (e) => { onFileDragStart(filePath, e); } : undefined}
            title={relativePath}
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 'clamp(220px, 35vw, 520px)',
            }}
          >
            {fileName}
          </span>
          {/* Secondary: parent dir */}
          <div
            style={{
              fontSize: '0.65rem',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 'clamp(200px, 32vw, 480px)',
            }}
          >
            {parentDir || '/'}
          </div>
        </div>
      ) : (
        <span
          className="mono"
          draggable={!!onFileDragStart}
          onDragStart={onFileDragStart ? (e) => { onFileDragStart(filePath, e); } : undefined}
          title={relativePath}
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 'clamp(220px, 35vw, 520px)',
            cursor: onFileDragStart ? 'grab' : undefined,
          }}
        >
          {relativePath}
        </span>
      )}
      {/* Custom actions (e.g. pairing Set as source/translated) */}
      {customActions}
      {/* Draft toggle button (only when onToggleDraft is provided) */}
      {onToggleDraft && (
        <button
          className={`btn btn-sm${isInDraft ? ' btn-added' : ''}`}
          style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', flexShrink: 0 }}
          onClick={onToggleDraft}
          type="button"
        >
          {isInDraft ? 'Added' : 'Add to Translation Job'}
        </button>
      )}
      <button
        className="btn btn-sm"
        style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', flexShrink: 0 }}
        onClick={onOpenFolder}
        type="button"
      >
        Open folder
      </button>
    </div>
  );
}
