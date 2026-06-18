import type { ProfileDiagnostic } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
interface ProfileValidationPanelProps {
  diagnostics: ProfileDiagnostic[];
  isValid: boolean;
  validating: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function ProfileValidationPanel({
  diagnostics,
  isValid,
  validating,
}: ProfileValidationPanelProps) {
  if (validating) {
    return (
      <div style={{
        padding: '0.5rem',
        fontSize: '0.75rem',
        color: 'var(--color-text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
      }}>
        <span className="spinner" style={{ width: 12, height: 12, display: 'inline-block' }} />
        Validating...
      </div>
    );
  }

  if (diagnostics.length === 0) {
    return null;
  }

  const errors = diagnostics.filter(d => d.level === 'error');
  const warnings = diagnostics.filter(d => d.level === 'warning');
  const infos = diagnostics.filter(d => d.level !== 'error' && d.level !== 'warning');

  return (
    <div style={{
      marginTop: '0.5rem',
      border: `1px solid ${isValid ? 'var(--color-success)' : 'var(--color-error)'}`,
      borderRadius: 'var(--radius)',
      padding: '0.5rem',
      background: isValid ? 'var(--color-surface-2)' : undefined,
    }}>
      {/* Summary badge */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        marginBottom: diagnostics.length > 0 ? '0.4rem' : 0,
      }}>
        <span className={`badge ${isValid ? 'badge-success' : 'badge-error'}`} style={{ fontSize: '0.65rem' }}>
          {isValid ? 'Valid' : 'Invalid'}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
          {errors.length} error{errors.length !== 1 ? 's' : ''},
          {' '}{warnings.length} warning{warnings.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grouped diagnostics */}
      {errors.length > 0 && (
        <div style={{ marginBottom: '0.3rem' }}>
          <div className="subsection-title" style={{ color: 'var(--color-error)' }}>Errors</div>
          {errors.map((d, i) => (
            <DiagnosticRow key={i} diagnostic={d} />
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ marginBottom: '0.3rem' }}>
          <div className="subsection-title" style={{ color: 'var(--color-warning)' }}>Warnings</div>
          {warnings.map((d, i) => (
            <DiagnosticRow key={i} diagnostic={d} />
          ))}
        </div>
      )}

      {infos.length > 0 && (
        <div>
          <div className="subsection-title" style={{ color: 'var(--color-text-muted)' }}>Info</div>
          {infos.map((d, i) => (
            <DiagnosticRow key={i} diagnostic={d} />
          ))}
        </div>
      )}

      {!isValid && (
        <div style={{
          marginTop: '0.4rem',
          fontSize: '0.7rem',
          color: 'var(--color-error)',
          fontStyle: 'italic',
        }}>
          Fix the errors above before saving.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diagnostic row                                                     */
/* ------------------------------------------------------------------ */
function DiagnosticRow({ diagnostic }: { diagnostic: ProfileDiagnostic }) {
  const color =
    diagnostic.level === 'error' ? 'var(--color-error)' :
    diagnostic.level === 'warning' ? 'var(--color-warning)' :
    'var(--color-text-muted)';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.3rem',
      fontSize: '0.7rem',
      padding: '0.15rem 0',
      color,
    }}>
      <span style={{ flexShrink: 0, fontFamily: 'monospace', fontSize: '0.65rem' }}>
        [{diagnostic.field}]
      </span>
      <span>{diagnostic.message}</span>
    </div>
  );
}
