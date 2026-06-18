import { getLanguageSelectOptions } from '../../utils/languageRegistry';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface LanguageDropdownProps {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  className?: string;
  allowCustom?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * A dropdown/select for choosing a language from the centralized registry.
 *
 * Displays friendly names with codes: ``Russian (ru)``, ``English (en)``.
 * Stores/sends canonical codes internally.
 *
 * When ``allowCustom`` is true, includes a text input fallback for
 * entering arbitrary codes not in the registry.
 */
export default function LanguageDropdown({
  value,
  onChange,
  placeholder = 'Select language',
  className = 'form-control',
  allowCustom = false,
}: LanguageDropdownProps) {
  const options = getLanguageSelectOptions();
  const knownCodes = new Set(options.map(o => o.value));
  const isKnown = knownCodes.has(value);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <select
        className={className}
        value={isKnown ? value : ''}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">— {placeholder} —</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {allowCustom && !isKnown && value && (
        <input
          className={className}
          type="text"
          value={value}
          placeholder="Custom language code"
          onChange={e => onChange(e.target.value)}
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
        />
      )}
    </div>
  );
}
