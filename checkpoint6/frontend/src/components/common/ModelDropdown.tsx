import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../../App';
import type { ProviderModelEntry } from '../../api/types';

/* ================================================================== */
/*  ModelDropdown — selects a model from backend provider models list  */
/*  with a free-text "Other…" fallback for custom model_ids.           */
/*                                                                     */
/*  Supports selectionMode distinction:                                */
/*    - "saved"  = model chosen from the dropdown list                 */
/*    - "custom" = model entered manually as free text                 */
/*                                                                     */
/*  On provider change:                                                */
/*    - saved mode  → value is cleared                                 */
/*    - custom mode → value is preserved                               */
/* ================================================================== */

export type ModelSelectionMode = 'saved' | 'custom';

interface ModelDropdownProps {
  provider: string;
  value: string;
  onChange: (value: string) => void;
  selectionMode?: ModelSelectionMode;
  onSelectionModeChange?: (mode: ModelSelectionMode) => void;
  placeholder?: string;
  className?: string;
}

export default function ModelDropdown({
  provider,
  value,
  onChange,
  selectionMode,
  onSelectionModeChange,
  placeholder,
  className,
}: ModelDropdownProps) {
  const [models, setModels] = useState<ProviderModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [internalShowCustom, setInternalShowCustom] = useState(false);

  // Track previous provider to detect provider changes
  const prevProvider = useRef(provider);
  // Monotonic request counter — guards against stale async responses
  const fetchToken = useRef(0);

  // Determine selection mode (controlled or internal)
  const isCustom = selectionMode === 'custom';
  const mode = selectionMode ?? (internalShowCustom ? 'custom' : 'saved');
  const setMode = useCallback((m: ModelSelectionMode) => {
    if (onSelectionModeChange) {
      onSelectionModeChange(m);
    } else {
      setInternalShowCustom(m === 'custom');
    }
  }, [onSelectionModeChange]);

  const modelIds = models.map(m => m.model_id);
  const currentInList = value && modelIds.includes(value);

  // When mode is controlled the showCustom is derived from mode
  const showCustom = mode === 'custom' || (value !== '' && !currentInList);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    const token = ++fetchToken.current;
    setLoading(true);
    api.getProviderModelsForProvider(provider, { include_disabled: false })
      .then(group => {
        if (token === fetchToken.current) {
          setModels(group.models ?? []);
        }
      })
      .catch(() => {
        // Backend unavailable — leave models empty
      })
      .finally(() => {
        if (token === fetchToken.current) setLoading(false);
      });
  }, [provider]);

  // Detect provider change and apply mode-specific behavior
  useEffect(() => {
    if (prevProvider.current !== provider && prevProvider.current !== '') {
      if (mode === 'saved') {
        // Saved mode: clear model on provider change
        onChange('');
      }
      // Custom mode: value survives provider change (do nothing)
    }
    prevProvider.current = provider;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Initialize mode from value when models load or value changes
  useEffect(() => {
    if (!provider || !value || loading || models.length === 0) return;
    const known = modelIds.includes(value);
    setMode(known ? 'saved' : 'custom');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, models, loading]);

  const handleSelectChange = (selected: string) => {
    if (selected === '__other__') {
      setMode('custom');
      if (!value) onChange('');
    } else if (selected === '') {
      onChange('');
    } else {
      setMode('saved');
      onChange(selected);
    }
  };

  // Build select value: if value is known, select it; if unknown/custom, select __other__
  const selectValue = value && modelIds.includes(value) ? value : ((value || '') ? '__other__' : '');

  if (!provider) {
    return (
      <input
        className={className || 'form-control'}
        placeholder={placeholder || 'Select a provider first'}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled
      />
    );
  }

  if (loading) {
    return (
      <input
        className={className || 'form-control'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Loading..."
        disabled
      />
    );
  }

  return (
    <div>
      <select
        className={className || 'form-control'}
        value={selectValue}
        onChange={e => handleSelectChange(e.target.value)}
      >
        <option value="">-- Select model --</option>
        {models.map(m => (
          <option key={m.id} value={m.model_id}>
            {m.display_name ? `${m.model_id} (${m.display_name})` : m.model_id}
          </option>
        ))}
        <option value="__other__">Other / Custom…</option>
      </select>
      {showCustom && (
        <div style={{ position: 'relative' }}>
          <input
            className={className || 'form-control'}
            style={{ marginTop: '0.3rem' }}
            placeholder={placeholder || 'Enter model ID manually'}
            value={value || ''}
            onChange={e => {
              setMode('custom');
              onChange(e.target.value);
            }}
          />
          {value && (
            <span
              style={{
                position: 'absolute',
                top: '0.65rem',
                right: '0.5rem',
                fontSize: '0.6rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--color-text-muted, #888)',
                background: 'var(--color-surface-2, #f0f0f0)',
                padding: '0.1rem 0.35rem',
                borderRadius: '3px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              Custom model
            </span>
          )}
        </div>
      )}
    </div>
  );
}
