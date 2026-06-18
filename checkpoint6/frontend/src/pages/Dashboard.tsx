import { useEffect, useState } from 'react';
import { api, ApiError } from '../App';
import type { HealthResponse, AppStateResponse, CacheStatsResponse, TraceEvent, SettingsResponse } from '../api/types';
import { SettingsSummaryCard, CollapsibleSection } from '../components';
import { getSettingValue } from '../domain';

export default function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [appState, setAppState] = useState<AppStateResponse | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStatsResponse | null>(null);
  const [recentTraces, setRecentTraces] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadAll() {
    try {
      const [h, s, c, t, sRes] = await Promise.all([
        api.getHealth(),
        api.getAppState(),
        api.getCacheStats(),
        api.getRecentTraceEvents(),
        api.getSettings(),
      ]);
      setHealth(h);
      setAppState(s);
      setSettings(sRes.settings as Record<string, unknown>);
      setCacheStats(c);
      setRecentTraces(t);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setSettingsLoading(false);
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const activeJobs = appState?.active_jobs?.length ?? 0;

  // Use directly loaded settings for path/defaults/runtime display
  // (more reliable than appState.settings)
  const displaySettings = settings ?? (appState?.settings as Record<string, unknown> | undefined);

  const getSetting = (key: string): string | number | boolean | null | undefined => {
    if (settingsLoading) return undefined; // still loading
    const val = getSettingValue(displaySettings, key);
    return (val !== undefined && val !== '' ? val : null) as string | number | boolean | null | undefined;
  };

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Backend status and overview</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Health */}
      <div className="card">
        <div className="card-title">Backend Health</div>
        {health ? (
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span className={`badge ${health.backend_ready ? 'badge-success' : 'badge-error'}`}>
                {health.backend_ready ? 'Ready' : 'Not Ready'}
              </span>
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
              Status: <strong>{health.status}</strong> &middot; Version: <strong>{health.app_version}</strong>
            </div>
          </div>
        ) : (
          <div className="alert alert-error">Cannot reach backend</div>
        )}
      </div>

      {/* Stats grid */}
      <div className="card-grid" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="card-title">Active Jobs</div>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{activeJobs}</div>
          {activeJobs > 0 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {appState?.active_jobs?.map((j: unknown) => {
                const item = j as { id?: string; job_id?: string };
                return item.id || item.job_id;
              }).join(', ')}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Cache Stats</div>
          {cacheStats ? (
            <div style={{ fontSize: '0.8rem' }}>
              <div>Requests: <strong>{cacheStats.total_requests}</strong></div>
              <div>Hits: <strong>{cacheStats.hits}</strong> / Misses: <strong>{cacheStats.misses}</strong></div>
              <div>Hit rate: <strong>{(cacheStats.hit_rate * 100).toFixed(1)}%</strong></div>
              <div>Size: <strong>{cacheStats.size}</strong> entries</div>
              <div>Enabled: <strong>{cacheStats.enabled ? 'Yes' : 'No'}</strong></div>
            </div>
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
          )}
        </div>

        <div className="card">
          <div className="card-title">Available File Types</div>
          <div>
            {appState?.available_file_types?.length ? (
              appState.available_file_types.map(t => (
                <span key={t} className="badge badge-info" style={{ margin: '0.15rem' }}>{t}</span>
              ))
            ) : (
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>None reported</span>
            )}
          </div>
        </div>
      </div>

      {/* Settings — Paths */}
      {settingsLoading ? (
        <div className="card"><div className="loading"><span className="spinner" /> Loading settings...</div></div>
      ) : (
        <>
          <SettingsSummaryCard title="Paths" fields={[
            { label: 'Downloaded mods dir', value: getSetting('downloaded_mods_dir') || getSetting('downloaded_mods_directory'), mono: true },
            { label: 'Stellaris mods dir', value: getSetting('stellaris_mods_dir') || getSetting('stellaris_mods_directory'), mono: true },
            { label: 'Output dir', value: getSetting('output_dir') || getSetting('output_directory'), mono: true },
            { label: 'App cache dir', value: getSetting('app_cache_dir') || getSetting('app_cache_directory'), mono: true },
            { label: 'Stellaris cache path', value: getSetting('stellaris_cache_path'), mono: true },
          ]} />

          {/* Settings — Defaults */}
          <SettingsSummaryCard title="Defaults" fields={[
            { label: 'Source language', value: getSetting('source_language') || getSetting('src_lang') },
            { label: 'Target language', value: getSetting('target_language') || getSetting('dst_lang') },
            { label: 'Provider', value: getSetting('provider') },
            { label: 'Model', value: getSetting('model') },
            { label: 'Batch size', value: getSetting('batch_size') },
            { label: 'Cache enabled', value: getSetting('cache_enabled') ?? getSetting('use_cache') },
          ]} />

          {/* Settings — Runtime */}
          <SettingsSummaryCard title="Runtime" fields={[
            { label: 'Timeout', value: getSetting('timeout') || getSetting('timeout_sec') },
            { label: 'Retries', value: getSetting('retries') || getSetting('max_retries') },
            { label: 'Save raw responses', value: getSetting('save_raw_responses') },
            { label: 'Prompt preset', value: getSetting('prompt_preset') || getSetting('prompt_preset_id') },
          ]} />
        </>
      )}

      {/* Collapsible raw app state */}
      <CollapsibleSection title="Raw app state JSON">
        <div className="pre-block">{JSON.stringify(appState, null, 2)}</div>
      </CollapsibleSection>

      {/* Recent trace events */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-title">Recent Trace Events</div>
        {recentTraces.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No recent events</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Job</th>
                  <th>Event</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {recentTraces.slice(0, 20).map((ev) => (
                  <tr key={ev.id}>
                    <td className="mono">{new Date(ev.timestamp).toLocaleTimeString()}</td>
                    <td className="mono">{ev.job_id?.slice(0, 8) ?? '—'}</td>
                    <td><span className="badge badge-info">{ev.event_type}</span></td>
                    <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.data ? JSON.stringify(ev.data).slice(0, 80) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
