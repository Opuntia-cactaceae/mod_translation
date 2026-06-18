/* ------------------------------------------------------------------ */
/*  RuleSetSelector — multi-select checkboxes for protection rule sets */
/* ------------------------------------------------------------------ */

import type { ProtectionRuleSet } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface RuleSetSelectorProps {
  ruleSets: ProtectionRuleSet[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RuleSetSelector({
  ruleSets,
  selectedIds,
  onChange,
  disabled = false,
  className = 'form-control',
}: RuleSetSelectorProps) {
  if (!ruleSets || ruleSets.length === 0) {
    return (
      <div className={className} style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        No rule sets available
      </div>
    );
  }

  const handleToggle = (id: string) => {
    if (disabled) return;
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(sid => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className={className} style={{ maxHeight: '200px', overflowY: 'auto', padding: '0.25rem' }}>
      {ruleSets.map(rs => (
        <label
          key={rs.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.2rem 0.25rem',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: '0.85rem',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            className="form-checkbox"
            checked={selectedIds.includes(rs.id)}
            onChange={() => handleToggle(rs.id)}
            disabled={disabled}
          />
          <span>{rs.name}</span>
          {rs.builtin && (
            <span
              style={{
                fontSize: '0.65rem',
                color: 'var(--color-text-muted)',
                background: 'var(--color-surface-2)',
                padding: '0.05rem 0.3rem',
                borderRadius: '3px',
                marginLeft: '0.15rem',
              }}
            >
              builtin
            </span>
          )}
        </label>
      ))}
    </div>
  );
}
