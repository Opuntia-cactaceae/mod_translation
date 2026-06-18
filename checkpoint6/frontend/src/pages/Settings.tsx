import { useEffect, useState, useMemo } from 'react';
import { api, ApiError, useToast } from '../App';
import type { ApiKeyResponse, GameOption, FileHandlerOption, TestKeyResponse, TranslationProfile, TranslationOptionsResponse } from '../api/types';
import { PathPicker } from '../components';
import ProfileEditorModal from '../components/profiles/ProfileEditorModal';
import ProviderModelsSection from '../components/settings/ProviderModelsSection';
import ImportExportSection from '../components/settings/ImportExportSection';
import {
  mapProfile, isReadonlyProfile, deduplicateProfiles, appendProfileUnique, removeProfile,
  type ProfileModel,
} from '../domain';
import LanguageDropdown from '../components/common/LanguageDropdown';
import { flattenSettings, nestSettings } from '../domain/settings';

/* ================================================================== */
/*  Settings page — also embeds Secrets panel                          */
/* ================================================================== */

export default function Settings() {
  const toast = useToast();

  // --- Settings ---
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Path validation
  const [validatePath, setValidatePath] = useState('');
  const [pathResult, setPathResult] = useState<{ is_valid: boolean; message: string; errors: string[]; warnings: string[] } | null>(null);
  const [validating, setValidating] = useState(false);

  // --- API Keys ---
  const [keys, setKeys] = useState<ApiKeyResponse[]>([]);
  const [newKeyProvider, setNewKeyProvider] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [testProvider, setTestProvider] = useState('');
  const [testValue, setTestValue] = useState('');
  const [testResult, setTestResult] = useState<TestKeyResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [showAddKey, setShowAddKey] = useState(false);

  // --- Game options (loaded from backend) ---
  const [gameOptions, setGameOptions] = useState<GameOption[]>([]);
  const [genericFileHandlers, setGenericFileHandlers] = useState<FileHandlerOption[]>([]);
  const [allFileHandlers, setAllFileHandlers] = useState<FileHandlerOption[]>([]);
  const [gamesOptionsLoaded, setGamesOptionsLoaded] = useState(false);

  // --- Translation Profiles ---
  const [profiles, setProfiles] = useState<TranslationProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [cleaningUp, setCleaningUp] = useState(false);

  // --- Profile editor modal ---
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileEditorMode, setProfileEditorMode] = useState<'create' | 'edit' | 'view'>('create');
  const [profileEditTarget, setProfileEditTarget] = useState<TranslationProfile | undefined>(undefined);

  /* Domain-mapped profiles for snake_case-free display */
  const domainProfiles: ProfileModel[] = useMemo(
    () => profiles.map(mapProfile),
    [profiles],
  );

  // --- Translation options (for profile editor) ---
  const [translationOptions, setTranslationOptions] = useState<TranslationOptionsResponse | null>(null);

  // --- Storage Paths ---
  const [storagePaths, setStoragePaths] = useState<Record<string, string | null> | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [sRes, kRes] = await Promise.all([
        api.getSettings(),
        api.listApiKeys(),
      ]);
      setSettings(flattenSettings(sRes.settings));
      setKeys(kRes.keys);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  /* ---- Load game options ---- */
  useEffect(() => {
    (async () => {
      try {
        const [opts, transOpts] = await Promise.all([
          api.getGameOptions(),
          api.getTranslationOptions(),
        ]);
        setGameOptions(opts.games);
        setAllFileHandlers(opts.file_handlers);
        setTranslationOptions(transOpts);
        const generic = opts.games.find(g => g.id === 'generic');
        if (generic) {
          setGenericFileHandlers(
            opts.file_handlers.filter(h => generic.file_handlers.includes(h.id))
          );
        }
      } catch {
        // API unavailable — fallback remains as empty arrays
      } finally {
        setGamesOptionsLoaded(true);
      }
    })();
  }, []);

  /* ---- Load translation profiles ---- */
  useEffect(() => {
    (async () => {
      setProfilesLoading(true);
      try {
        const res = await api.listProfiles();
        const deduped = deduplicateProfiles(res.profiles);
        setProfiles(deduped);
        // Detect duplicates: if dedup reduced the count, we have duplicates
        if (res.profiles.length > deduped.length) {
          setDuplicateCount(res.profiles.length - deduped.length);
        } else {
          setDuplicateCount(0);
        }
      } catch {
        // API unavailable
      } finally {
        setProfilesLoading(false);
      }
    })();
  }, []);

  function handleSettingChange(key: string, value: unknown) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = nestSettings(settings);
      const res = await api.updateSettings({ settings: payload });
      // Hydrate local state from server response
      setSettings(flattenSettings(res.settings));
      toast.showToast('Settings saved');
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    if (!validatePath.trim()) return;
    setValidating(true);
    setPathResult(null);
    try {
      const res = await api.validatePath({ path: validatePath.trim() });
      setPathResult(res);
    } catch (err) {
      if (err instanceof ApiError) setPathResult({ is_valid: false, message: err.message, errors: [err.message], warnings: [] });
      else setPathResult({ is_valid: false, message: 'Validation failed', errors: ['Unexpected error'], warnings: [] });
    } finally {
      setValidating(false);
    }
  }

  // --- API key handlers ---
  async function handleAddKey() {
    if (!newKeyProvider.trim() || !newKeyValue.trim()) return;
    try {
      await api.createApiKey({ provider: newKeyProvider.trim(), value: newKeyValue.trim(), label: newKeyLabel.trim() });
      toast.showToast('API key added');
      setNewKeyProvider('');
      setNewKeyValue('');
      setNewKeyLabel('');
      setShowAddKey(false);
      const kRes = await api.listApiKeys();
      setKeys(kRes.keys);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to add key', 'error');
    }
  }

  async function handleDeleteKey(id: string) {
    try {
      await api.deleteApiKey(id);
      toast.showToast('Key deleted');
      const kRes = await api.listApiKeys();
      setKeys(kRes.keys);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to delete key', 'error');
    }
  }

  async function handleTestKey() {
    if (!testProvider.trim() || !testValue.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testApiKey({ provider: testProvider.trim(), value: testValue.trim() });
      setTestResult(res);
    } catch (err) {
      if (err instanceof ApiError) setTestResult({ valid: false, message: err.message });
      else setTestResult({ valid: false, message: 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  /* ---- Load storage paths ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await api.getStoragePaths();
        setStoragePaths(res as unknown as Record<string, string | null>);
      } catch {
        // API unavailable
      }
    })();
  }, []);

  // --- Profile handlers ---
  const [copyProfileId, setCopyProfileId] = useState<string | null>(null);
  const [copyProfileName, setCopyProfileName] = useState('');

  async function handleCopyProfile(profileId: string) {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const name = copyProfileId === profileId ? copyProfileName : `${profile.name} (copy)`;
    if (!name.trim()) return;
    try {
      const res = await api.copyProfile(profileId, { new_name: name.trim() });
      setProfiles(prev => appendProfileUnique(prev, res));
      setCopyProfileId(null);
      setCopyProfileName('');
      toast.showToast(`Profile copied: ${res.name}`);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to copy profile', 'error');
    }
  }

  async function handleDeleteProfile(profileId: string) {
    if (!confirm('Delete this profile?')) return;
    try {
      await api.deleteProfile(profileId);
      setProfiles(prev => removeProfile(prev, profileId));
      toast.showToast('Profile deleted');
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to delete profile', 'error');
    }
  }

  async function handleExportProfile(profileId: string) {
    try {
      const data = await api.exportProfile(profileId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `profile-${profileId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to export profile', 'error');
    }
  }

  async function handleImportProfile(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await api.importProfile({ data });
      setProfiles(prev => appendProfileUnique(prev, res));
      toast.showToast(`Profile imported: ${res.name}`);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to import profile', 'error');
    }
  }

  async function handleCleanupDuplicates() {
    if (!confirm(`Remove ${duplicateCount} duplicate user profiles? Only the newest copy of each profile will be kept.`)) return;
    setCleaningUp(true);
    try {
      const res = await api.cleanupDuplicateProfiles();
      toast.showToast(`Removed ${res.removed} duplicate profiles. ${res.remaining} profiles remaining.`);
      setDuplicateCount(0);
      // Reload profiles
      const listRes = await api.listProfiles();
      setProfiles(deduplicateProfiles(listRes.profiles));
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to clean up duplicates', 'error');
    } finally {
      setCleaningUp(false);
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading settings...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Application configuration</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Game Settings — new multi-game layer */}
      <div className="card">
        <div className="card-title">Game Settings</div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Per-game configuration paths and defaults.
        </p>

        <div className="card-title" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>Stellaris</div>
        <PathPicker
          value={getStr(settings, 'gs_stellaris_downloaded_mods_dir')}
          onChange={v => handleSettingChange('gs_stellaris_downloaded_mods_dir', v)}
          mode="directory"
          label="Downloaded Mods Directory"
        />
        <PathPicker
          value={getStr(settings, 'gs_stellaris_mods_dir')}
          onChange={v => handleSettingChange('gs_stellaris_mods_dir', v)}
          mode="directory"
          label="Stellaris Mods Directory"
        />
        <PathPicker
          value={getStr(settings, 'gs_stellaris_cache_path')}
          onChange={v => handleSettingChange('gs_stellaris_cache_path', v)}
          mode="directory"
          label="Stellaris Cache Path"
        />
        <div className="form-group">
          <label>Default File Handler</label>
          <input
            className="form-control"
            type="text"
            value="stellaris_localisation"
            disabled
            style={{ opacity: 0.7 }}
          />
        </div>

        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
          <div className="card-title" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>Generic</div>
          <PathPicker
            value={getStr(settings, 'gs_generic_root_dir')}
            onChange={v => handleSettingChange('gs_generic_root_dir', v)}
            mode="directory"
            label="Root Directory"
          />
          <PathPicker
            value={getStr(settings, 'gs_generic_output_dir')}
            onChange={v => handleSettingChange('gs_generic_output_dir', v)}
            mode="directory"
            label="Output Directory"
          />
          <div className="form-group">
            <label>Default File Handler</label>
            <select
              className="form-control"
              value={getStr(settings, 'gs_generic_default_file_handler', 'plain_text')}
              onChange={e => handleSettingChange('gs_generic_default_file_handler', e.target.value)}
            >
              {gamesOptionsLoaded && genericFileHandlers.length > 0
                ? genericFileHandlers.map(h => (
                    <option key={h.id} value={h.id}>{h.label} ({h.extensions.length})</option>
                  ))
                : <>
                    <option value="plain_text">Plain Text</option>
                    <option value="json">JSON</option>
                    <option value="yaml">YAML</option>
                  </>
              }
            </select>
            {/* Extension badges for the selected handler */}
            {(() => {
              const h = genericFileHandlers.find(fh => fh.id === getStr(settings, 'gs_generic_default_file_handler', 'plain_text'));
              if (!h || h.extensions.length === 0) return null;
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.35rem' }}>
                  {h.extensions.map(ext => (
                    <span key={ext} className="badge badge-muted" style={{ textTransform: 'none', fontSize: '0.65rem' }}>{ext}</span>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Settings form */}
      <div className="card">
        <div className="card-title">Application Settings</div>

        {renderLanguageSetting(settings, 'default_src_lang', 'Default Source Language', handleSettingChange)}
        {renderLanguageSetting(settings, 'default_dst_lang', 'Default Target Language', handleSettingChange)}
        {renderSettingInput(settings, 'default_provider', 'Default Provider', handleSettingChange)}
        {renderSettingInput(settings, 'default_model', 'Default Model', handleSettingChange)}
        {renderSettingInput(settings, 'default_batch_size', 'Default Batch Size', handleSettingChange, 'number')}
        {renderSettingInput(settings, 'cache_enabled', 'Cache Enabled', handleSettingChange, 'checkbox')}

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Path validation */}
      <div className="card">
        <div className="card-title">Validate Path</div>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <input
              className="form-control"
              placeholder="Enter a path to validate"
              value={validatePath}
              onChange={e => setValidatePath(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={handleValidate} disabled={validating}>
            {validating ? '...' : 'Validate'}
          </button>
        </div>
        {pathResult && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <div>
              <span className={`badge ${pathResult.is_valid ? 'badge-success' : 'badge-error'}`}>
                {pathResult.is_valid ? 'Valid' : 'Invalid'}
              </span>
              {pathResult.message && <span style={{ marginLeft: '0.5rem' }}>{pathResult.message}</span>}
            </div>
            {pathResult.warnings.length > 0 && (
              <div style={{ color: 'var(--color-warning)', marginTop: '0.25rem' }}>
                {pathResult.warnings.map((w, i) => <div key={i}>Warning: {w}</div>)}
              </div>
            )}
            {pathResult.errors.length > 0 && (
              <div style={{ color: 'var(--color-error)', marginTop: '0.25rem' }}>
                {pathResult.errors.map((e, i) => <div key={i}>Error: {e}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Storage Paths */}
      <div className="card">
        <div className="card-title">Storage Paths</div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Application data directory and resolved file paths (read-only).
        </p>
        {storagePaths ? (
          <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono, monospace)' }}>
            {Object.entries(storagePaths).map(([key, value]) => (
              <div key={key} style={{ display: 'flex', gap: '0.5rem', padding: '0.15rem 0' }}>
                <span style={{ color: 'var(--color-text-muted)', minWidth: '12rem', flexShrink: 0 }}>{key}:</span>
                <span style={{ wordBreak: 'break-all' }}>{value ?? '(not configured)'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Loading storage paths...</div>
        )}
      </div>

      {/* Secrets / API Keys */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>API Keys</span>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAddKey(!showAddKey)}>
            {showAddKey ? 'Cancel' : 'Add Key'}
          </button>
        </div>

        {showAddKey && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius)' }}>
            <div className="form-row">
              <div className="form-group">
                <label>Provider</label>
                <select className="form-control" value={newKeyProvider} onChange={e => setNewKeyProvider(e.target.value)}>
                  <option value="">-- Select provider --</option>
                  {(translationOptions?.providers ?? []).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label>API Key (cleared after save)</label>
                <input className="form-control" type="password" placeholder={newKeyProvider ? (KEY_PLACEHOLDER_MAP[newKeyProvider] || 'Paste API key') : 'Paste API key'} value={newKeyValue} onChange={e => setNewKeyValue(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Label</label>
                <input className="form-control" placeholder="optional" value={newKeyLabel} onChange={e => setNewKeyLabel(e.target.value)} />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddKey}>Save Key</button>
          </div>
        )}

        {keys.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No API keys configured</div>
        ) : (
          <div>
            {keys.map((key) => (
              <div key={key.id} className="secret-item">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                    {key.provider}{key.label ? ` (${key.label})` : ''}
                  </div>
                  <div className="mono" style={{ color: 'var(--color-text-muted)' }}>{key.masked_value}</div>
                </div>
                <button className="btn btn-sm btn-danger" onClick={() => handleDeleteKey(key.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Test API Key */}
      <div className="card">
        <div className="card-title">Test API Key</div>
        <div className="form-row">
          <div className="form-group">
            <label>Provider</label>
            <select className="form-control" value={testProvider} onChange={e => setTestProvider(e.target.value)}>
              <option value="">-- Select provider --</option>
              {(translationOptions?.providers ?? []).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label>Key Value</label>
            <input className="form-control" type="password" placeholder={testProvider ? (KEY_PLACEHOLDER_MAP[testProvider] || 'Paste API key') : 'Paste API key'} value={testValue} onChange={e => setTestValue(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary btn-sm" onClick={handleTestKey} disabled={testing}>
            {testing ? 'Testing...' : 'Test Key'}
          </button>
        </div>
        {testResult && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <span className={`badge ${getTestBadgeInfo(testResult).className}`}>
              {getTestBadgeInfo(testResult).label}
            </span>
            <span style={{ marginLeft: '0.5rem' }}>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Provider Models */}
      <ProviderModelsSection />

      {/* Import / Export */}
      <ImportExportSection />

      {/* Translation Profiles */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Translation Profiles</span>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="btn btn-sm btn-primary" onClick={() => {
              setProfileEditTarget(undefined);
              setProfileEditorMode('create');
              setProfileEditorOpen(true);
            }} style={{ fontSize: '0.65rem' }}>
              New profile
            </button>
            <label className="btn btn-sm" style={{ cursor: 'pointer', fontSize: '0.65rem' }}>
              Import Profile
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleImportProfile(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
        {profilesLoading ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Loading profiles...</div>
        ) : (duplicateCount > 0 ? (
          <div className="alert alert-warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
            <span>Duplicate user profiles detected ({duplicateCount} duplicates). Only the newest copy of each profile will be kept.</span>
            <button className="btn btn-sm btn-danger" onClick={handleCleanupDuplicates} disabled={cleaningUp} style={{ fontSize: '0.65rem', flexShrink: 0 }}>
              {cleaningUp ? 'Cleaning...' : 'Remove duplicate profiles'}
            </button>
          </div>
        ) : profiles.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No profiles available</div>
        ) : (
          <div>
            {domainProfiles.map(profile => (
              <div key={profile.id} className="secret-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {profile.name}
                    <span className={`badge ${profile.isSystem ? 'badge-info' : 'badge-success'}`} style={{ fontSize: '0.6rem' }}>
                      {profile.isSystem ? 'system' : 'user'}
                    </span>
                  </div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                    {profile.game}{profile.fileHandler ? ` / ${profile.fileHandler}` : ''} &middot; {profile.srcLang || '?'} &rarr; {profile.dstLang || '?'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexShrink: 0 }}>
                  {isReadonlyProfile(profile) ? (
                    <>
                      <button className="btn btn-sm" style={{ fontSize: '0.65rem' }} onClick={() => {
                        // Look up original DTO for editor
                        const original = profiles.find(p => p.id === profile.id);
                        setProfileEditTarget(original);
                        setProfileEditorMode('view');
                        setProfileEditorOpen(true);
                      }}>
                        View
                      </button>
                      {copyProfileId === profile.id ? (
                        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                          <input
                            className="form-control"
                            style={{ width: 120, fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                            placeholder="New name"
                            value={copyProfileName}
                            onChange={e => setCopyProfileName(e.target.value)}
                          />
                          <button className="btn btn-sm btn-primary" style={{ fontSize: '0.65rem' }} onClick={() => handleCopyProfile(profile.id)}>Save</button>
                          <button className="btn btn-sm" style={{ fontSize: '0.65rem' }} onClick={() => { setCopyProfileId(null); setCopyProfileName(''); }}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm" style={{ fontSize: '0.65rem' }} onClick={() => { setCopyProfileId(profile.id); setCopyProfileName(`${profile.name} (copy)`); }}>
                          Copy
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm" style={{ fontSize: '0.65rem' }} onClick={() => {
                        const original = profiles.find(p => p.id === profile.id);
                        setProfileEditTarget(original);
                        setProfileEditorMode('edit');
                        setProfileEditorOpen(true);
                      }}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" style={{ fontSize: '0.65rem' }} onClick={() => handleDeleteProfile(profile.id)}>
                        Delete
                      </button>
                    </>
                  )}
                  <button className="btn btn-sm" style={{ fontSize: '0.65rem' }} onClick={() => handleExportProfile(profile.id)}>
                    Export
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Profile editor modal */}
      <ProfileEditorModal
        open={profileEditorOpen}
        mode={profileEditorMode}
        profile={profileEditTarget}
        gameOptions={gameOptions}
        handlerOptions={allFileHandlers}
        translationOptions={translationOptions}
        onClose={() => {
          setProfileEditorOpen(false);
          setProfileEditTarget(undefined);
        }}
        onSaved={(profile) => {
          setProfiles(prev => appendProfileUnique(prev, profile));
          setProfileEditorOpen(false);
          setProfileEditTarget(undefined);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: typed settings access                                      */
/* ------------------------------------------------------------------ */

/** Read a setting as string, returning fallback if not a string. */
function getStr(set: Record<string, unknown>, key: string, fallback = ''): string {
  const val = set[key];
  return typeof val === 'string' ? val : fallback;
}

/* ------------------------------------------------------------------ */
/*  Helper: render language setting dropdown                           */
/* ------------------------------------------------------------------ */
function renderLanguageSetting(
  settings: Record<string, unknown>,
  key: string,
  label: string,
  onChange: (key: string, value: unknown) => void,
) {
  const val = settings[key] != null ? String(settings[key]) : '';
  return (
    <div className="form-group" key={key}>
      <label>{label}</label>
      <LanguageDropdown
        value={val}
        onChange={v => onChange(key, v)}
        placeholder={label}
        allowCustom
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: render setting input                                       */
/* ------------------------------------------------------------------ */
function renderSettingInput(
  settings: Record<string, unknown>,
  key: string,
  label: string,
  onChange: (key: string, value: unknown) => void,
  type: 'text' | 'number' | 'checkbox' = 'text',
) {
  const val = settings[key];

  if (type === 'checkbox') {
    return (
      <div className="form-group" key={key}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="form-checkbox"
            checked={!!val}
            onChange={e => onChange(key, e.target.checked)}
          />
          {label}
        </label>
      </div>
    );
  }

  return (
    <div className="form-group" key={key}>
      <label>{label}</label>
      <input
        className="form-control"
        type={type}
        value={val != null ? String(val) : ''}
        onChange={e => onChange(key, type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  API Key helpers                                                     */
/* ------------------------------------------------------------------ */

/** Maps provider names to plausible key prefix hints. */
const KEY_PLACEHOLDER_MAP: Record<string, string> = {
  groq: 'gsk_...',
  deepseek: 'sk-...',
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
};

/** Returns badge class and label for a test-key response. */
function getTestBadgeInfo(result: TestKeyResponse): { className: string; label: string } {
  if (result.auth_ok) {
    return { className: 'badge-success', label: 'VALID' };
  }
  if (result.provider_reachable === false) {
    if (result.message?.toLowerCase().includes('timeout')) {
      return { className: 'badge-error', label: 'TIMEOUT' };
    }
    return { className: 'badge-error', label: 'NETWORK' };
  }
  if (result.message?.toLowerCase().includes('rate limit')) {
    return { className: 'badge-error', label: 'RATE LIMIT' };
  }
  return { className: 'badge-error', label: 'INVALID' };
}
