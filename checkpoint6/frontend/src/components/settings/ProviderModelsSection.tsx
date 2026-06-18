import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../../App';
import type {
  ProviderModelsResponse,
  ProviderModelEntry,
  ProviderGroup,
  ProviderLink,
} from '../../api/types';

/* ================================================================== */
/*  Provider Models Section — Settings UI for managing provider models  */
/* ================================================================== */

export default function ProviderModelsSection() {
  const [data, setData] = useState<ProviderModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('groq');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingModel, setEditingModel] = useState<ProviderModelEntry | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add/Edit form state
  const [formModelId, setFormModelId] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formContextWindow, setFormContextWindow] = useState('');
  const [formMaxOutputTokens, setFormMaxOutputTokens] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formSaving, setFormSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getProviderModels();
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load provider models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When data loads, auto-select the first provider if current selection not found
  useEffect(() => {
    if (data && !data.providers[selectedProvider]) {
      const providers = Object.keys(data.providers);
      if (providers.length > 0) setSelectedProvider(providers[0]);
    }
  }, [data, selectedProvider]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const currentGroup: ProviderGroup | undefined = data?.providers[selectedProvider];

  // --- Handlers ---

  const resetForm = () => {
    setFormModelId('');
    setFormDisplayName('');
    setFormDescription('');
    setFormContextWindow('');
    setFormMaxOutputTokens('');
    setFormTags('');
    setFormEnabled(true);
  };

  const openAddForm = () => {
    resetForm();
    setEditingModel(null);
    setShowAddForm(true);
  };

  const openEditForm = (model: ProviderModelEntry) => {
    setFormModelId(model.model_id);
    setFormDisplayName(model.display_name ?? '');
    setFormDescription(model.description ?? '');
    setFormContextWindow(model.context_window != null ? String(model.context_window) : '');
    setFormMaxOutputTokens(model.max_output_tokens != null ? String(model.max_output_tokens) : '');
    setFormTags(model.tags ? model.tags.join(', ') : '');
    setFormEnabled(model.is_enabled);
    setEditingModel(model);
    setShowAddForm(true);
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditingModel(null);
  };

  const handleSave = async () => {
    if (!formModelId.trim()) {
      showMsg('error', 'Model ID is required');
      return;
    }
    setFormSaving(true);
    try {
      const tags = formTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      const contextWindow = formContextWindow ? parseInt(formContextWindow, 10) : null;
      const maxOutputTokens = formMaxOutputTokens ? parseInt(formMaxOutputTokens, 10) : null;

      if (editingModel) {
        await api.updateProviderModel(editingModel.id, {
          display_name: formDisplayName || null,
          description: formDescription || null,
          context_window: contextWindow,
          max_output_tokens: maxOutputTokens,
          tags: tags.length > 0 ? tags : [],
          is_enabled: formEnabled,
        });
        showMsg('success', 'Model updated');
      } else {
        await api.createProviderModel({
          provider: selectedProvider,
          model_id: formModelId.trim(),
          display_name: formDisplayName || null,
          description: formDescription || null,
          context_window: contextWindow,
          max_output_tokens: maxOutputTokens,
          tags,
          is_enabled: formEnabled,
        });
        showMsg('success', 'Model created');
      }
      closeForm();
      await load();
    } catch (err) {
      if (err instanceof ApiError) showMsg('error', err.message);
      else showMsg('error', 'Failed to save model');
    } finally {
      setFormSaving(false);
    }
  };

  const handleToggleEnabled = async (model: ProviderModelEntry) => {
    try {
      await api.updateProviderModel(model.id, { is_enabled: !model.is_enabled });
      showMsg('success', `${model.is_enabled ? 'Disabled' : 'Enabled'} ${model.model_id}`);
      await load();
    } catch (err) {
      if (err instanceof ApiError) showMsg('error', err.message);
      else showMsg('error', 'Failed to toggle model');
    }
  };

  const handleDelete = async (model: ProviderModelEntry) => {
    if (!window.confirm(`Delete model "${model.model_id}"?`)) return;
    try {
      await api.deleteProviderModel(model.id);
      showMsg('success', `Deleted ${model.model_id}`);
      await load();
    } catch (err) {
      if (err instanceof ApiError) showMsg('error', err.message);
      else showMsg('error', 'Failed to delete model');
    }
  };

  const handleResetDefaults = async () => {
    if (!window.confirm('Reset all built-in models? Custom models will be preserved.')) return;
    try {
      const result = await api.resetProviderModelDefaults();
      showMsg('success', result.message);
      await load();
    } catch (err) {
      if (err instanceof ApiError) showMsg('error', err.message);
      else showMsg('error', 'Failed to reset defaults');
    }
  };

  // --- Render ---

  if (loading && !data) {
    return (
      <div className="card">
        <div className="card-title">Provider Models</div>
        <div className="loading"><span className="spinner" /> Loading provider models...</div>
      </div>
    );
  }

  const providers = data ? Object.keys(data.providers) : [];
  const models = currentGroup?.models ?? [];

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Provider Models</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-sm btn-primary" onClick={openAddForm} disabled={!selectedProvider}>
            Add Model
          </button>
          <button className="btn btn-sm" onClick={handleResetDefaults}>
            Reset Defaults
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem', fontSize: '0.8rem' }}>{error}</div>}
      {actionMsg && (
        <div
          className={`alert ${actionMsg.type === 'success' ? 'alert-success' : 'alert-error'}`}
          style={{ marginBottom: '0.75rem', fontSize: '0.8rem' }}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Provider selector */}
      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {providers.map(prov => (
          <button
            key={prov}
            className={`btn btn-sm ${selectedProvider === prov ? 'btn-primary' : ''}`}
            onClick={() => setSelectedProvider(prov)}
          >
            {prov}
          </button>
        ))}
      </div>

      {currentGroup && (
        <>
          {/* Provider links */}
          {currentGroup.links.length > 0 && (
            <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem' }}>
              {currentGroup.links.map((link: ProviderLink, i: number) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: '1rem' }}>
                  {link.title} ↗
                </a>
              ))}
            </div>
          )}

          {/* Models list */}
          {models.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
              No models for this provider.
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem' }}>
              {models.map(model => (
                <div
                  key={model.id}
                  className="secret-item"
                  style={{
                    opacity: model.is_enabled ? 1 : 0.5,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.4rem 0',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>
                      <span className="mono">{model.model_id}</span>
                      {model.display_name && (
                        <span style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)' }}>
                          ({model.display_name})
                        </span>
                      )}
                      {model.is_builtin && (
                        <span className="badge badge-info" style={{ marginLeft: '0.4rem', fontSize: '0.65rem' }}>
                          builtin
                        </span>
                      )}
                    </div>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                      {model.description && <span>{model.description}</span>}
                      {model.context_window && <span style={{ marginLeft: '0.5rem' }}>ctx: {model.context_window}</span>}
                      {model.tags.length > 0 && (
                        <span style={{ marginLeft: '0.5rem' }}>
                          {model.tags.map(t => (
                            <span key={t} className="badge" style={{ marginRight: '0.2rem', fontSize: '0.6rem' }}>{t}</span>
                          ))}
                        </span>
                      )}
                      <span style={{ marginLeft: '0.5rem', fontWeight: model.is_enabled ? 'normal' : 'bold' }}>
                        {model.is_enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                    <button className="btn btn-sm" onClick={() => openEditForm(model)}>Edit</button>
                    <button className="btn btn-sm" onClick={() => handleToggleEnabled(model)}>
                      {model.is_enabled ? 'Disable' : 'Enable'}
                    </button>
                    {!model.is_builtin && (
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(model)}>Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add/Edit form modal */}
      {showAddForm && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--color-border)',
          }}
        >
          <h4 style={{ margin: '0 0 0.75rem 0' }}>
            {editingModel ? 'Edit Model' : 'Add Model'}
          </h4>
          <div className="form-row">
            <div className="form-group">
              <label>Model ID *</label>
              <input
                className="form-control mono"
                value={formModelId}
                onChange={e => setFormModelId(e.target.value)}
                disabled={!!editingModel}
                placeholder="e.g. my-custom-model"
              />
            </div>
            <div className="form-group">
              <label>Display Name</label>
              <input
                className="form-control"
                value={formDisplayName}
                onChange={e => setFormDisplayName(e.target.value)}
                placeholder="My Custom Model"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Description</label>
            <input
              className="form-control"
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Context Window</label>
              <input
                className="form-control"
                type="number"
                value={formContextWindow}
                onChange={e => setFormContextWindow(e.target.value)}
                placeholder="e.g. 131072"
              />
            </div>
            <div className="form-group">
              <label>Max Output Tokens</label>
              <input
                className="form-control"
                type="number"
                value={formMaxOutputTokens}
                onChange={e => setFormMaxOutputTokens(e.target.value)}
                placeholder="e.g. 4096"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Tags (comma-separated)</label>
            <input
              className="form-control"
              value={formTags}
              onChange={e => setFormTags(e.target.value)}
              placeholder="json, fast, experimental"
            />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="form-checkbox"
                checked={formEnabled}
                onChange={e => setFormEnabled(e.target.checked)}
              />
              Enabled
            </label>
          </div>
          <div className="form-actions" style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={formSaving}>
              {formSaving ? 'Saving...' : editingModel ? 'Update' : 'Create'}
            </button>
            <button className="btn btn-sm" onClick={closeForm}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
