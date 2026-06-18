import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, useToast } from '../../App';
import { mapSettingsResponse } from '../../domain/settings';
import { PathPicker } from '..';
import { groupLocalisationFiles, detectLanguageFromPath } from '../../utils/localisationGrouping';
import type { LocalisationGroup } from '../../utils/localisationGrouping';
import {
  filterFilesByLanguage,
  groupFilesByLanguage,
  displayNameForLanguage,
  getLanguageBadge,
  normaliseLocalisationLanguage,
} from '../../utils/localisationLanguage';
import { usePersistentState } from '../../hooks/usePersistentState';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { useDraftJobSelectionApi } from '../../hooks/useDraftJobSelectionApi';
import { useTranslateDiscoveryFiles } from '../../hooks/useTranslateDiscoveryFiles';
import {
  getModStableKey,
  canTranslateMod,
  getInstallButtonLabel,
  getLocalisationPaths,
  getLocalisationCountForLanguage,
  hasInstallConflict,
  isSelfInstalled,
  getDescriptorPath,
  getInstalledPath,
  getModStatusLabel,
  getSupportedVersion,
  type ModModel,
} from '../../domain';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCommonParentDir(paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) {
    return paths[0].substring(0, paths[0].lastIndexOf('/')) || paths[0];
  }
  let prefix = paths[0];
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix)) {
      prefix = prefix.substring(0, prefix.lastIndexOf('/'));
      if (!prefix) return null;
    }
  }
  return prefix;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ModListSectionProps {
  mods: ModModel[];
  onRefreshMods: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ModListSection({ mods, onRefreshMods }: ModListSectionProps) {
  const toast = useToast();
  const navigate = useNavigate();

  // Expanded/collapsed state for each mod
  const [expandedMods, setExpandedMods] = usePersistentState<Record<string, boolean>>(
    STORAGE_KEYS.expandedMods,
    {},
  );

  // Expanded/collapsed state for each group within a mod
  const [expandedGroups, setExpandedGroups] = usePersistentState<Record<string, boolean>>(
    STORAGE_KEYS.expandedLocalisationGroups,
    {},
  );

  // Visible file count per group for Load more
  const [visibleFilesByGroup, setVisibleFilesByGroup] = useState<Record<string, number>>({});

  // ── Global source language filter ──────────────────────────────────
  // Single language selection applied to ALL mods, persisted.
  const [selectedSourceLanguage, setSelectedSourceLanguage] = usePersistentState<string>(
    STORAGE_KEYS.selectedSourceLanguage,
    'en',
  );

  // Global toggle: when true, only files matching selectedSourceLanguage are shown.
  const [showOnlySelected, setShowOnlySelected] = usePersistentState<boolean>(
    STORAGE_KEYS.showOnlySelectedLanguage,
    true,
  );

  // Compute all languages present across ALL mods (for the global dropdown)
  const allAvailableLangs = useMemo(() => {
    const langSet = new Set<string>();
    for (const mod of mods) {
      const groups = groupFilesByLanguage(getLocalisationPaths(mod));
      for (const lang of Object.keys(groups)) {
        if (lang !== 'unknown') langSet.add(lang);
      }
    }
    return Array.from(langSet).sort();
  }, [mods]);

  // Resolve the effective language: ensure it exists in the available set.
  const effectiveSelectedLang = useMemo(() => {
    if (allAvailableLangs.length === 0) return 'en';
    if (allAvailableLangs.includes(selectedSourceLanguage)) return selectedSourceLanguage;
    if (allAvailableLangs.includes('en')) return 'en';
    return allAvailableLangs[0];
  }, [allAvailableLangs, selectedSourceLanguage]);

  // ── Advanced action confirmation state for mixed-language bulk ops ──
  const [mixedLangConfirm, setMixedLangConfirm] = useState<{
    type: 'add_all' | 'translate_all';
    visibleFiles: string[];
    modName: string;
    modKey: string;
    mixedLanguages: string[];
  } | null>(null);

  // Draft job file selection (Part 2: Add to job UX)
  const draftApi = useDraftJobSelectionApi();
  const { draftFiles, addFile: draftAddFile, addFiles: draftAddFiles, removeFile: draftRemoveFile, isFileAdded } = draftApi;

  // Unified translate flow
  const { translateAll } = useTranslateDiscoveryFiles();

  // Descriptor
  const [descriptorPath, setDescriptorPath] = useState('');
  const [descriptorText, setDescriptorText] = useState<string | null>(null);
  const [descriptorLoading, setDescriptorLoading] = useState(false);

  // Install
  const [installSource, setInstallSource] = useState('');
  const [installTarget, setInstallTarget] = useState('');
  const [installTargetDirty, setInstallTargetDirty] = useState(false);
  const [installTargetDefault, setInstallTargetDefault] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<{ success: boolean; message: string } | null>(null);
  const [installingModKey, setInstallingModKey] = useState<string | null>(null);

  // Stellaris cache
  const [cachePreview, setCachePreview] = useState<{ items_to_delete: any[]; total_size_bytes: number } | null>(null);
  const [cacheCleaning, setCacheCleaning] = useState(false);
  const [cacheResult, setCacheResult] = useState<{ success: boolean; message: string } | null>(null);

  // Prune stale entries from expandedMods when mods change (re-scan, initial load).
  // Removes entries whose mod keys are no longer in the current mods list,
  // preventing stale state from a previous session from keeping mods expanded.
  useEffect(() => {
    if (mods.length === 0) return;
    const currentKeys = new Set(mods.map(getModStableKey));
    setExpandedMods(prev => {
      const staleKey = Object.keys(prev).find(k => !currentKeys.has(k));
      if (!staleKey) return prev;
      const pruned: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) {
        if (currentKeys.has(k)) pruned[k] = prev[k];
      }
      return pruned;
    });
    // Also prune expandedGroups for removed mods.
    setExpandedGroups(prev => {
      const staleKey = Object.keys(prev).find(k => {
        // Group keys are "${modKey}::${group.id}"
        const modPart = k.split('::')[0];
        return !currentKeys.has(modPart);
      });
      if (!staleKey) return prev;
      const pruned: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) {
        const modPart = k.split('::')[0];
        if (currentKeys.has(modPart)) pruned[k] = prev[k];
      }
      return pruned;
    });
  }, [mods, setExpandedMods, setExpandedGroups]);

  // Load settings on mount for install target default
  useEffect(() => {
    api.getSettings()
      .then(res => {
        const model = mapSettingsResponse(res.settings);
        const stellarisGs = model.game_settings?.stellaris;
        // Prefer game_settings.stellaris.mods_dir, fallback to paths.stellaris_mods_dir
        const stellarisModsDir = stellarisGs?.mods_dir || model.paths?.stellaris_mods_dir;
        if (stellarisModsDir && typeof stellarisModsDir === 'string' && stellarisModsDir.trim()) {
          const dir = stellarisModsDir.trim();
          setInstallTargetDefault(dir);
          if (!installTarget.trim() && !installTargetDirty) {
            setInstallTarget(dir);
          }
        }
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Helpers: visible localisation files for a mod ---- */

  /** Return the filtered localisation files for a mod based on global filter state. */
  function getVisibleFiles(mod: ModModel): string[] {
    const locFiles = getLocalisationPaths(mod);
    if (!showOnlySelected) return locFiles;
    return filterFilesByLanguage(locFiles, effectiveSelectedLang);
  }

  /** Detect languages present in a list of file paths. */
  function detectLanguagesInFiles(filePaths: string[]): string[] {
    const langs = new Set<string>();
    for (const p of filePaths) {
      const norm = normaliseLocalisationLanguage(
        p.match(/l_(\w+)\.yml$/) ? p.match(/l_(\w+)\.yml$/)![1] : null,
      );
      if (norm) langs.add(norm);
    }
    return Array.from(langs).sort();
  }

  /* ---- Handlers ---- */

  async function handleReadDescriptor(path: string) {
    setDescriptorLoading(true);
    setDescriptorPath(path);
    setDescriptorText(null);
    try {
      const res = await api.readDescriptor({ path });
      setDescriptorText(res.descriptor_text);
      toast.showToast('Descriptor loaded', 'success');
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to read descriptor', 'error');
    } finally {
      setDescriptorLoading(false);
    }
  }

  async function handleInstall(sourcePath: string, action: string, modKey: string) {
    if (!installTarget.trim()) {
      toast.showToast('Enter target directory', 'error');
      return;
    }
    setInstallingModKey(modKey);
    setInstallResult(null);
    try {
      const opts: { source_path: string; target_dir: string; overwrite?: boolean; backup_on_overwrite?: boolean } = {
        source_path: sourcePath,
        target_dir: installTarget.trim(),
      };
      if (action === 'reinstall') {
        opts.overwrite = true;
        opts.backup_on_overwrite = true;
      }
      const res = await api.installMod(opts);
      if (res.success) {
        const parts = [`${res.files_copied} files copied`];
        if (res.backup_path) parts.push(`backup: ${res.backup_path}`);
        setInstallResult({ success: true, message: parts.join('; ') });
        toast.showToast(action === 'reinstall' ? 'Mod reinstalled' : 'Mod installed');
        onRefreshMods();
      } else {
        setInstallResult({ success: false, message: res.errors?.join(', ') || 'Install failed' });
      }
    } catch (err) {
      if (err instanceof ApiError) setInstallResult({ success: false, message: err.message });
      else setInstallResult({ success: false, message: 'Install error' });
    } finally {
      setInstallingModKey(null);
    }
  }

  async function handleRevealPath(path: string) {
    try {
      const res = await api.revealPath({ path });
      if (!res.success) {
        toast.showToast(res.message, 'error');
      }
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to open folder', 'error');
    }
  }

  /* ---- Mod-level bulk actions ---- */

  /** Add all visible (filtered) localisation files for a mod to the job draft. */
  function handleAddAllToJob(mod: ModModel) {
    const paths = getVisibleFiles(mod);
    if (paths.length === 0) return;

    // Show mixed-language warning when filter is OFF and mod has multiple languages
    if (!showOnlySelected) {
      const languages = detectLanguagesInFiles(paths);
      if (languages.length > 1) {
        setMixedLangConfirm({
          type: 'add_all',
          visibleFiles: paths,
          modName: mod.name,
          modKey: getModStableKey(mod),
          mixedLanguages: languages,
        });
        return;
      }
    }

    performAddAll(paths, mod);
  }

  function performAddAll(paths: string[], mod: ModModel) {
    const newPaths = paths.filter(p => !isFileAdded(p));
    if (newPaths.length === 0) {
      toast.showToast('All files already added to job draft', 'info');
      return;
    }
    draftAddFiles(newPaths, { modId: getModStableKey(mod), modName: mod.name });
    toast.showToast(`${newPaths.length} file(s) added to job draft`, 'info');
  }

  /** Perform unified translate via the shared hook (with duplicate detection). */
  function performTranslateAll(paths: string[], mod: ModModel) {
    translateAll(
      { files: paths, gameId: getModStableKey(mod), gameLabel: mod.name },
      true,
    );
  }

  /** Translate all visible (filtered) localisation files for a mod:
   *  adds them to the draft and navigates to the Create Job form
   *  via the unified translate flow (with duplicate detection). */
  function handleTranslateMod(mod: ModModel) {
    const paths = getVisibleFiles(mod);
    if (paths.length === 0) return;

    // Show mixed-language warning when filter is OFF and mod has multiple languages
    if (!showOnlySelected) {
      const languages = detectLanguagesInFiles(paths);
      if (languages.length > 1) {
        setMixedLangConfirm({
          type: 'translate_all',
          visibleFiles: paths,
          modName: mod.name,
          modKey: getModStableKey(mod),
          mixedLanguages: languages,
        });
        return;
      }
    }

    // Use unified translate flow
    performTranslateAll(paths, mod);
  }

  function handleMixedLangConfirm() {
    if (!mixedLangConfirm) return;
    const { type, visibleFiles, modName, modKey } = mixedLangConfirm;
    setMixedLangConfirm(null);

    // For translate type, use the unified translate flow (add to draft, duplicate detection, navigate)
    if (type === 'translate_all') {
      translateAll({ files: visibleFiles, gameId: modKey, gameLabel: modName }, true);
      return;
    }

    // For 'add_all' type, use inline draft logic
    const newPaths = visibleFiles.filter(p => !isFileAdded(p));
    if (newPaths.length === 0) {
      toast.showToast('All files already added to job draft', 'info');
      return;
    }
    draftAddFiles(newPaths, { modId: modKey, modName });
    toast.showToast(`${newPaths.length} file(s) added to job draft`, 'info');
  }

  /* ---- File / group level actions ---- */

  function handleAddLocalisationToJob(mod: ModModel, filePath: string) {
    if (isFileAdded(filePath)) {
      draftRemoveFile(filePath);
    } else {
      draftAddFile(filePath, { modId: getModStableKey(mod), modName: mod.name });
    }
  }

  function addFilesToJob(filePaths: string[], modName: string, modKey: string, gameConfig?: Record<string, unknown>) {
    const newPaths = filePaths.filter(p => !isFileAdded(p));
    if (newPaths.length === 0) {
      toast.showToast('All files already added to job draft', 'info');
      return;
    }
    draftAddFiles(newPaths, { modId: modKey, modName: modName });
    toast.showToast(`${newPaths.length} file(s) added to job draft`, 'info');
  }

  async function handleOpenLocalisationFolder(mod: ModModel) {
    const paths = getVisibleFiles(mod);
    if (paths.length === 0) return;
    const commonDir = getCommonParentDir(paths);
    if (commonDir) {
      await handleRevealPath(commonDir);
    } else {
      const firstDir = paths[0].substring(0, paths[0].lastIndexOf('/'));
      if (firstDir) {
        await handleRevealPath(firstDir);
      }
    }
  }

  function handleAddGroupToJob(mod: ModModel, group: LocalisationGroup) {
    addFilesToJob(group.files, `${mod.name} / ${group.label}`, getModStableKey(mod), { src_lang: effectiveSelectedLang });
  }

  /** Translate a localisation group: uses the unified translate flow
   *  (adds to draft, duplicate detection, navigates to /jobs). */
  function handleTranslateGroup(mod: ModModel, group: LocalisationGroup) {
    performTranslateAll(group.files, mod);
  }

  async function handleOpenGroupFolder(group: LocalisationGroup) {
    if (group.files.length === 0) return;
    const commonDir = getCommonParentDir(group.files);
    if (commonDir) {
      await handleRevealPath(commonDir);
    } else {
      const firstDir = group.files[0].substring(0, group.files[0].lastIndexOf('/'));
      if (firstDir) {
        await handleRevealPath(firstDir);
      }
    }
  }

  function handleUseInstallTargetDefault() {
    if (installTargetDefault) {
      setInstallTarget(installTargetDefault);
      setInstallTargetDirty(true);
    }
  }

  async function handlePreviewCache() {
    try {
      const res = await api.previewCleanCache();
      setCachePreview(res);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to preview cache clean', 'error');
    }
  }

  async function handleCleanCache() {
    setCacheCleaning(true);
    try {
      const res = await api.cleanCache({ cache_path: cachePreview?.items_to_delete[0]?.path || '', mode: 'selective' });
      setCacheResult({ success: res.success, message: `Deleted ${res.deleted_items.length} items` });
      setCachePreview(null);
      toast.showToast('Cache cleaned');
    } catch (err) {
      if (err instanceof ApiError) setCacheResult({ success: false, message: err.message });
      else setCacheResult({ success: false, message: 'Clean failed' });
    } finally {
      setCacheCleaning(false);
    }
  }

  /* ---- Render ---- */

  if (mods.length === 0) return null;

  return (
    <div>
      {/* Mods list */}
      <div className="card">
        <div className="card-title">Discovered Mods ({mods.length})</div>

        {/* ── Global source language filter bar ──────────────────── */}
        {allAvailableLangs.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
              marginBottom: '0.75rem',
            }}
          >
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--color-text-muted)',
              }}
            >
              Source language:
            </span>
            <select
              className="form-control"
              value={effectiveSelectedLang}
              onChange={(e) => setSelectedSourceLanguage(e.target.value)}
              style={{
                width: 'auto',
                minWidth: '110px',
                fontSize: '0.8rem',
                padding: '0.3rem 0.5rem',
              }}
            >
              {allAvailableLangs.map(lang => (
                <option key={lang} value={lang}>
                  {displayNameForLanguage(lang)}
                </option>
              ))}
            </select>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: '0.8rem',
                color: 'var(--color-text)',
              }}
            >
              <input
                type="checkbox"
                className="form-checkbox"
                checked={showOnlySelected}
                onChange={(e) => setShowOnlySelected(e.target.checked)}
              />
              Show only selected source language files
            </label>
          </div>
        )}

        {mods.map((mod) => {
          const key = getModStableKey(mod);
          const isExpanded = !!expandedMods[key];
          const locFiles = getLocalisationPaths(mod);
          const modTags = mod.tags;

          // Visible files after applying the global filter
          const visibleLocalisationFiles = getVisibleFiles(mod);

          // Whether any localisation file in this mod is already in the job draft
          const modHasAdded = locFiles.some(f => isFileAdded(f));

          // Count of files matching the selected language (or total if filter is off)
          const selectedLangCount = showOnlySelected
            ? getLocalisationCountForLanguage(mod, effectiveSelectedLang)
            : locFiles.length;

          return (
            <div key={key} className={`mod-item${modHasAdded ? ' mod-item-has-added' : ''}`}>
              {/* Compact header — always visible */}
              <div
                className="mod-item-header"
                onClick={() => setExpandedMods(prev => ({ ...prev, [key]: !prev[key] }))}
              >
                <div className="mod-item-header-content">
                  <div className="mod-name">{mod.name}</div>
                  <div className="mod-path">{mod.path}</div>
                  <div className="mod-meta">
                    <span className={`badge ${mod.isValid ? 'badge-success' : 'badge-error'}`}>
                      {getModStatusLabel(mod)}
                    </span>
                    <span className="badge badge-info">{mod.source}</span>
                    <span className={`badge ${mod.installed ? 'badge-success' : 'badge-muted'}`}>
                      {mod.installed ? 'INSTALLED' : 'NOT INSTALLED'}
                    </span>
                    {locFiles.length > 0 && (
                      <span className={`badge ${selectedLangCount > 0 ? 'badge-success' : 'badge-warning'}`}>
                        {showOnlySelected
                          ? `Has localisation (${selectedLangCount} / ${locFiles.length})`
                          : `Has localisation (${locFiles.length})`}
                      </span>
                    )}
                    {hasInstallConflict(mod) && (
                      <span className="badge badge-error">Descriptor mismatch</span>
                    )}
                    {isSelfInstalled(mod) && (
                      <span className="badge badge-warning">Self-hosted</span>
                    )}
                  </div>
                </div>
                <div className="mod-item-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => handleReadDescriptor(getDescriptorPath(mod) || mod.path)}>
                    Read Descriptor
                  </button>
                  {mod.installed ? (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleInstall(mod.path, mod.installAction, key)}
                      disabled={installingModKey === key || isSelfInstalled(mod)}
                      title={isSelfInstalled(mod) ? 'Source and installed folder are the same; reinstall not needed' : ''}
                    >
                      {installingModKey === key ? 'Installing...' : getInstallButtonLabel(mod)}
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={() => handleInstall(mod.path, 'install', key)} disabled={installingModKey === key}>
                      {installingModKey === key ? 'Installing...' : getInstallButtonLabel(mod)}
                    </button>
                  )}
                  {mod.installed && getInstalledPath(mod) && (
                    <button className="btn btn-sm" onClick={() => handleRevealPath(getInstalledPath(mod)!)}>
                      Open installed folder
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => handleRevealPath(mod.path)}>
                    Open source folder
                  </button>
                  {canTranslateMod(mod) && (!showOnlySelected || selectedLangCount > 0) && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleTranslateMod(mod)}
                    >
                      Translate Mod
                    </button>
                  )}
                  <button
                    className={`expand-toggle${isExpanded ? ' open' : ''}`}
                    title={isExpanded ? 'Collapse' : 'Expand'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedMods(prev => ({ ...prev, [key]: !prev[key] }));
                    }}
                  >
                    &#9654;
                  </button>
                </div>
              </div>

              {/* Expanded detail body */}
              {isExpanded && (
                <div className="mod-item-body">
                  {hasInstallConflict(mod) && (
                    <div className="alert alert-warning" style={{ marginTop: '0.3rem', padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}>
                      <strong>Install conflict:</strong> Descriptor path does not match installed folder.
                      <button
                        className="btn btn-sm"
                        style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                        onClick={() => {
                          toast.showToast(
                            `The descriptor.mod references a different path than where the mod is installed. ` +
                            `This can happen when the mod was moved or the descriptor was edited manually. ` +
                            `Reinstall the mod to fix this.`
                          );
                        }}
                      >
                        Show details
                      </button>
                    </div>
                  )}

                  <div className="mod-detail-section">
                    {getDescriptorPath(mod) && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Descriptor path</span>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          {getDescriptorPath(mod)}
                        </div>
                      </div>
                    )}
                    {getSupportedVersion(mod) && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Supported version</span>
                        <span className="badge badge-muted">v{getSupportedVersion(mod)}</span>
                      </div>
                    )}
                    {modTags && modTags.length > 0 && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Tags</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          {modTags.join(', ')}
                        </div>
                      </div>
                    )}
                    {mod.installed && getInstalledPath(mod) && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Installed at</span>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          {getInstalledPath(mod)}
                        </div>
                      </div>
                    )}
                  </div>

                  {mod.diagnostics && (mod.diagnostics as Array<{ level: string; message: string }>).length > 0 && (
                    <div className="mod-detail-section">
                      <div className="mod-detail-label">Diagnostics</div>
                      <div style={{ fontSize: '0.75rem' }}>
                        {(mod.diagnostics as Array<{ level: string; message: string }>).map((d, i) => (
                          <div key={i} className={`badge ${d.level === 'error' || d.level === 'critical' ? 'badge-error' : 'badge-warning'}`} style={{ marginRight: '0.3rem', marginBottom: '0.2rem' }}>
                            {d.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Localisation section ───────────────────────── */}
                  {locFiles.length > 0 && (
                    <div className="mod-detail-section">
                      {/* Localisation header + bulk actions */}
                      <div className="mod-localisation-header">
                        <span className="mod-detail-label" style={{ margin: 0 }}>
                          Localisation files
                          {showOnlySelected && !(visibleLocalisationFiles.length === 0 && locFiles.length > 0)
                            ? ` (${displayNameForLanguage(effectiveSelectedLang)}, ${visibleLocalisationFiles.length})`
                            : ` (${visibleLocalisationFiles.length})`}
                        </span>
                        <div className="mod-bulk-actions">
                          {(() => {
                            const allVisibleAdded = visibleLocalisationFiles.length > 0 && visibleLocalisationFiles.every(f => isFileAdded(f));
                            return (
                              <button
                                className={`btn btn-sm${allVisibleAdded ? ' btn-added' : ''}`}
                                style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                onClick={() => handleAddAllToJob(mod)}
                                disabled={visibleLocalisationFiles.length === 0}
                              >
                                {allVisibleAdded ? 'All added' : 'Add all to Translation Job'}
                              </button>
                            );
                          })()}
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                            onClick={() => handleTranslateMod(mod)}
                            disabled={visibleLocalisationFiles.length === 0}
                          >
                            Translate all localisation
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                            onClick={() => handleOpenLocalisationFolder(mod)}
                            disabled={visibleLocalisationFiles.length === 0}
                          >
                            Open localisation folder
                          </button>
                        </div>
                      </div>

                      {/* Empty state when filter excludes all files */}
                      {showOnlySelected && visibleLocalisationFiles.length === 0 && locFiles.length > 0 && (
                        <div style={{ fontSize: '0.75rem', padding: '0.5rem 0', color: 'var(--color-text-muted)' }}>
                          No localisation files found for {displayNameForLanguage(effectiveSelectedLang)}.
                        </div>
                      )}

                      {/* Groups */}
                      {visibleLocalisationFiles.length > 0 && (() => {
                        const groups = groupLocalisationFiles(visibleLocalisationFiles);
                        return (
                          <div className="loc-groups-container">
                            {groups.map((group, gi) => {
                              const groupKey = `${key}::${group.id}`;
                              const isGroupExpanded = !!expandedGroups[groupKey];
                              const visibleCount = visibleFilesByGroup[groupKey] || 10;
                              const groupFilesToShow = group.files.slice(0, visibleCount);
                              const hasMore = group.files.length > visibleCount;
                              const hasMixedLanguages = group.languages.length > 1;
                              const hasGroupAdded = group.files.some(f => isFileAdded(f));

                              return (
                                <div key={gi} className={`loc-group-item${hasGroupAdded ? ' loc-group-has-added' : ''}`}>
                                  <div
                                    className="loc-group-header"
                                    onClick={() =>
                                      setExpandedGroups(prev => ({
                                        ...prev,
                                        [groupKey]: !prev[groupKey],
                                      }))
                                    }
                                  >
                                    <span className={`loc-group-arrow${isGroupExpanded ? ' open' : ''}`}>
                                      &#9654;
                                    </span>
                                    <span className="loc-group-label">{group.label}</span>
                                    <span className="badge badge-muted" style={{ fontSize: '0.6rem' }}>
                                      {group.files.length} {group.files.length === 1 ? 'file' : 'files'}
                                    </span>
                                    {group.languages.map(raw => {
                                      const norm = normaliseLocalisationLanguage(raw);
                                      return norm ? (
                                        <span key={raw} className="badge badge-info" style={{ fontSize: '0.6rem' }}>
                                          {getLanguageBadge(norm)}
                                        </span>
                                      ) : null;
                                    })}
                                    {!showOnlySelected && hasMixedLanguages && (
                                      <span className="badge badge-warning" style={{ fontSize: '0.6rem' }}>
                                        mixed languages
                                      </span>
                                    )}
                                  </div>

                                  <div className="loc-group-actions">
                                    {(() => {
                                      const allGroupAdded = group.files.every(f => isFileAdded(f));
                                      return (
                                        <button
                                          className={`btn btn-sm${allGroupAdded ? ' btn-added' : ''}`}
                                          style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                          onClick={() => handleAddGroupToJob(mod, group)}
                                        >
                                          {allGroupAdded ? 'All added' : 'Add group to Translation Job'}
                                        </button>
                                      );
                                    })()}
                                    <button
                                      className="btn btn-sm"
                                      style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                      onClick={() => handleTranslateGroup(mod, group)}
                                    >
                                      Translate group
                                    </button>
                                    <button
                                      className="btn btn-sm"
                                      style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                      onClick={() => handleOpenGroupFolder(group)}
                                    >
                                      Open group folder
                                    </button>
                                  </div>

                                  {isGroupExpanded && (
                                    <div className="loc-group-body">
                                      {groupFilesToShow.map((locPath, fi) => {
                                        const rawLang = detectLanguageFromPath(locPath) || '';
                                        const normLang = normaliseLocalisationLanguage(rawLang);
                                        const alreadyAdded = isFileAdded(locPath);
                                        return (
                                          <div
                                            key={fi}
                                            className={alreadyAdded ? 'loc-file-added' : undefined}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '0.4rem',
                                              fontSize: '0.7rem',
                                              padding: '0.15rem 0',
                                              flexWrap: 'wrap',
                                            }}
                                          >
                                            <span
                                              className="mono"
                                              style={{
                                                flex: 1,
                                                minWidth: 0,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                              }}
                                            >
                                              {locPath.split('/').pop()}
                                            </span>
                                            {normLang ? (
                                              <span className="badge badge-info" style={{ fontSize: '0.6rem' }}>
                                                {getLanguageBadge(normLang)}
                                              </span>
                                            ) : null}
                                            <button
                                              className={`btn btn-sm${alreadyAdded ? ' btn-added' : ''}`}
                                              style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                              onClick={() => handleAddLocalisationToJob(mod, locPath)}
                                            >
                                              {alreadyAdded ? 'Added' : 'Add to Translation Job'}
                                            </button>
                                            <button
                                              className="btn btn-sm"
                                              style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                              onClick={() => handleRevealPath(locPath)}
                                            >
                                              Open folder
                                            </button>
                                          </div>
                                        );
                                      })}
                                      {group.files.length > 10 && (
                                        <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.25rem' }}>
                                          {hasMore && (
                                            <button
                                              className="btn btn-sm"
                                              style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                              onClick={() =>
                                                setVisibleFilesByGroup(prev => ({
                                                  ...prev,
                                                  [groupKey]: (prev[groupKey] || 10) + 20,
                                                }))
                                              }
                                            >
                                              Load 20 more
                                            </button>
                                          )}
                                          {visibleCount > 10 && (
                                            <button
                                              className="btn btn-sm"
                                              style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                              onClick={() =>
                                                setVisibleFilesByGroup(prev => ({
                                                  ...prev,
                                                  [groupKey]: 10,
                                                }))
                                              }
                                            >
                                              Show less
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Install target */}
      <div className="card">
        <div className="card-title">Install Target</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <PathPicker
            value={installTarget}
            onChange={(val: string) => {
              setInstallTarget(val);
              setInstallTargetDirty(true);
            }}
            mode="directory"
            label="Stellaris mods directory"
            placeholder="/path/to/Stellaris/mods"
          />
          {installTargetDefault && (
            <button className="btn btn-sm" onClick={handleUseInstallTargetDefault} type="button" style={{ alignSelf: 'flex-start' }}>
              Use Stellaris Mods Directory from Settings
            </button>
          )}
        </div>
        {installResult && (
          <div className={`alert ${installResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '0.5rem' }}>
            {installResult.message}
          </div>
        )}
      </div>

      {/* Descriptor preview */}
      {descriptorText && (
        <div className="card">
          <div className="card-title">Descriptor Preview</div>
          <div className="pre-block">{descriptorText}</div>
        </div>
      )}

      {/* Stellaris cache */}
      <div className="card">
        <div className="card-title">Stellaris Cache</div>
        <div className="form-actions">
          <button className="btn" onClick={handlePreviewCache}>Preview Cache Clean</button>
          <button className="btn btn-danger" onClick={handleCleanCache} disabled={cacheCleaning}>
            {cacheCleaning ? 'Cleaning...' : 'Clean Cache'}
          </button>
        </div>
        {cachePreview && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <div>Items to delete: {cachePreview.items_to_delete.length}</div>
            <div>Total size: {(cachePreview.total_size_bytes / 1024 / 1024).toFixed(1)} MB</div>
            <div className="pre-block" style={{ maxHeight: 150, marginTop: '0.3rem' }}>
              {cachePreview.items_to_delete.map(item => item.path).join('\n')}
            </div>
          </div>
        )}
        {cacheResult && (
          <div className={`alert ${cacheResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '0.5rem' }}>
            {cacheResult.message}
          </div>
        )}
      </div>

      {/* Mixed-language confirmation modal */}
      {mixedLangConfirm && (
        <div className="modal-overlay" onClick={() => setMixedLangConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mixed localisation languages</h3>
            </div>
            <div className="modal-body" style={{ fontSize: '0.75rem' }}>
              <p>
                You are about to use localisation files from multiple source languages
                ({mixedLangConfirm.mixedLanguages.map(l => displayNameForLanguage(l)).join(', ')}).
                This may produce mixed-language translation jobs.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setMixedLangConfirm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleMixedLangConfirm}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating bar: Go to job when draft files exist */}
      {draftFiles.length > 0 && (
        <div className="floating-job-bar">
          <span className="floating-job-bar-label">
            {draftFiles.length} file(s) selected
          </span>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/jobs')}
          >
            Go to job ({draftFiles.length})
          </button>
        </div>
      )}
    </div>
  );
}
