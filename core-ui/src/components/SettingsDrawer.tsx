import React, { useState } from 'react';
import type {
  BrowserSettings,
  DiagnosticsState,
  SearchEngineId,
  ThemeMode,
} from '../adblock/types';
import { SEARCH_ENGINES } from '../utils/urlResolver';

interface ReleaseDownloadStat {
  tagName: string;
  apkName: string;
  downloads: number;
  publishedDate: string;
}

interface SettingsDrawerProps {
  settings: BrowserSettings;
  appVersion: string;
  githubRepo: string;
  checkingUpdate: boolean;
  diagnostics?: DiagnosticsState;
  onUpdateSettings: (next: BrowserSettings) => void;
  onClearHistory: () => void;
  onClearCacheAndCookies: () => void;
  onCheckForUpdates: () => void;
  onOpenShields: () => void;
  onCopyDiagnostics: () => void;
  onEmailDiagnostics: () => void;
  onOpenIssue: () => void;
  onClearDiagnostics: () => void;
  onClose: () => void;
}

const ENGINE_ORDER: SearchEngineId[] = ['duckduckgo', 'brave', 'startpage', 'google'];

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  settings,
  appVersion,
  githubRepo,
  checkingUpdate,
  diagnostics,
  onUpdateSettings,
  onClearHistory,
  onClearCacheAndCookies,
  onCheckForUpdates,
  onOpenShields,
  onCopyDiagnostics,
  onEmailDiagnostics,
  onOpenIssue,
  onClearDiagnostics,
  onClose,
}) => {
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [diagExpanded, setDiagExpanded] = useState(false);
  const [diagFeedback, setDiagFeedback] = useState<string | null>(null);
  const [releaseStats, setReleaseStats] = useState<ReleaseDownloadStat[] | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadReleaseStats = async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${githubRepo}/releases?per_page=10`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
      const items = (await res.json()) as Array<{
        tag_name?: string;
        published_at?: string;
        assets?: Array<{ name?: string; download_count?: number }>;
      }>;
      const mapped: ReleaseDownloadStat[] = items
        .map((rel) => {
          const apks = (rel.assets ?? []).filter((a) =>
            (a.name ?? '').toLowerCase().endsWith('.apk')
          );
          const count = apks.reduce((sum, a) => sum + (a.download_count ?? 0), 0);
          return {
            tagName: rel.tag_name ?? 'release',
            apkName: apks[0]?.name ?? 'APK',
            downloads: count,
            publishedDate: (rel.published_at ?? '').slice(0, 10),
          };
        })
        .filter((r) => Boolean(r.tagName));
      setReleaseStats(mapped);
    } catch (err) {
      setStatsError((err as Error).message || 'Unable to load GitHub release counts');
    } finally {
      setStatsLoading(false);
    }
  };

  const toggleKey = (
    key: keyof Pick<
      BrowserSettings,
      | 'showRecommendations'
      | 'defaultDesktopMode'
      | 'blockThirdPartyCookies'
      | 'saveHistory'
      | 'autoSyncFilters'
      | 'allowSitePermissionPrompts'
      | 'restoreTabsOnStart'
    >
  ) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  const setTheme = (theme: ThemeMode) => {
    onUpdateSettings({
      ...settings,
      theme,
    });
  };

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 id="settings-drawer-title" className="drawer-title">
            Settings
          </h2>
          <button type="button" className="secondary-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="panel-card">
          <div className="row-title" style={{ marginBottom: '0.5rem' }}>
            Appearance Theme
          </div>
          <div className="segmented-two" role="group" aria-label="Appearance theme">
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={settings.theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              Dark Mode
            </button>
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={settings.theme === 'light'}
              onClick={() => setTheme('light')}
            >
              Light Mode
            </button>
          </div>
        </div>

        <div className="panel-card">
          <div className="toggle-row" style={{ minHeight: 'auto', marginBottom: '0.25rem' }}>
            <span className="row-title">Webpage Text Size</span>
            <span className="menu-badge">{settings.textZoom}%</span>
          </div>
          <input
            type="range"
            className="zoom-slider"
            min={75}
            max={150}
            step={5}
            value={settings.textZoom}
            aria-label="Webpage text zoom percentage"
            onChange={(e) =>
              onUpdateSettings({ ...settings, textZoom: Number(e.target.value) })
            }
          />
          <div className="row-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Compact (75%)</span>
            <span>Default (100%)</span>
            <span>Large (150%)</span>
          </div>
        </div>

        <div className="panel-card">
          <div className="row-title" style={{ marginBottom: '0.5rem' }}>
            Default Search Engine
          </div>
          <div
            className="engine-strip"
            role="group"
            aria-label="Default search engine"
            style={{ justifyContent: 'flex-start' }}
          >
            {ENGINE_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={settings.searchEngine === id}
                className="chip-btn"
                onClick={() => onUpdateSettings({ ...settings, searchEngine: id })}
              >
                {SEARCH_ENGINES[id].label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-card">
          <div className="row-title" style={{ marginBottom: '0.35rem' }}>
            Tabs &amp; Browsing
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Restore Open Tabs on Start</div>
              <div className="row-meta">Keep normal tabs after closing Aegis</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Restore Open Tabs on Start"
              aria-pressed={settings.restoreTabsOnStart}
              onClick={() => toggleKey('restoreTabsOnStart')}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Frequently Visited on Start</div>
              <div className="row-meta">Show top visited non-ad websites on Home</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Frequently Visited"
              aria-pressed={settings.showRecommendations}
              onClick={() => toggleKey('showRecommendations')}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Desktop Mode by Default</div>
              <div className="row-meta">Request desktop pages in new tabs</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Desktop Mode by Default"
              aria-pressed={settings.defaultDesktopMode}
              onClick={() => toggleKey('defaultDesktopMode')}
            />
          </div>
        </div>

        <div className="panel-card">
          <div className="row-title" style={{ marginBottom: '0.35rem' }}>
            Privacy, Permissions &amp; Shields
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Ask for Camera / Mic / Location</div>
              <div className="row-meta">Show permission prompt instead of auto-denying</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Site Permission Prompts"
              aria-pressed={settings.allowSitePermissionPrompts}
              onClick={() => toggleKey('allowSitePermissionPrompts')}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Block Third-Party Cookies</div>
              <div className="row-meta">Isolate cross-site tracking cookies</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Block Third-Party Cookies"
              aria-pressed={settings.blockThirdPartyCookies}
              onClick={() => toggleKey('blockThirdPartyCookies')}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Save Browsing History</div>
              <div className="row-meta">Enable History &amp; search autocomplete</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Save Browsing History"
              aria-pressed={settings.saveHistory}
              onClick={() => toggleKey('saveHistory')}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Daily Ad-Filter Auto-Sync</div>
              <div className="row-meta">Keep 53,000+ filter rules fresh daily</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Daily Ad-Filter Auto-Sync"
              aria-pressed={settings.autoSyncFilters}
              onClick={() => toggleKey('autoSyncFilters')}
            />
          </div>
          <div className="settings-action-row">
            <button type="button" className="secondary-btn" onClick={onOpenShields}>
              Open Ad-Block &amp; Shields Controls
            </button>
          </div>
        </div>

        <div className="panel-card">
          <div className="row-title" style={{ marginBottom: '0.5rem' }}>
            Site Data &amp; Storage
          </div>
          <div className="settings-action-grid">
            <button
              type="button"
              className="danger-btn"
              onClick={() => {
                onClearHistory();
                setFeedbackMsg('Browsing history & suggestions cleared.');
              }}
            >
              Clear History
            </button>
            <button
              type="button"
              className="danger-btn"
              onClick={() => {
                onClearCacheAndCookies();
                setFeedbackMsg('WebView cache & cookies cleared.');
              }}
            >
              Clear Cache &amp; Cookies
            </button>
          </div>
          {feedbackMsg && (
            <div className="row-meta settings-feedback" role="status">
              {feedbackMsg}
            </div>
          )}
        </div>

        <div className="panel-card">
          <div className="toggle-row">
            <div>
              <div className="row-title">Aegis Browser v{appVersion}</div>
              <div className="row-meta">Signed Android build • GitHub Releases updates</div>
            </div>
            <button
              type="button"
              className="primary-btn"
              disabled={checkingUpdate}
              onClick={onCheckForUpdates}
            >
              {checkingUpdate ? 'Checking...' : 'Check Updates'}
            </button>
          </div>
        </div>

        <div className="panel-card">
          <div className="section-head" style={{ marginBottom: '0.45rem' }}>
            <span className="row-title">Diagnostics &amp; Crash Reports</span>
            <span className="menu-badge">
              {diagnostics?.lastCrashSummary
                ? 'Crash Logged'
                : `${diagnostics?.nonFatalCount ?? 0} Warnings`}
            </span>
          </div>
          <div className="row-meta" style={{ marginBottom: '0.6rem' }}>
            {diagnostics?.lastCrashSummary
              ? `Last crash: ${diagnostics.lastCrashSummary}`
              : 'No app crashes recorded. Non-fatal errors stay stored strictly on this device unless you choose to share them.'}
          </div>
          <div className="settings-action-grid">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                onCopyDiagnostics();
                setDiagFeedback('Diagnostics report copied to clipboard.');
              }}
            >
              Copy Report
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                onEmailDiagnostics();
                setDiagFeedback('Opening email draft to harsh.tripathi.cs@gmail.com.');
              }}
            >
              Email Support
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                onOpenIssue();
                onClose();
              }}
            >
              GitHub Issue
            </button>
            <button
              type="button"
              className="danger-btn"
              disabled={!diagnostics?.lastCrashSummary && (diagnostics?.nonFatalCount ?? 0) === 0}
              onClick={() => {
                onClearDiagnostics();
                setDiagFeedback('Local diagnostic logs cleared.');
              }}
            >
              Clear Logs
            </button>
          </div>
          {diagnostics?.reportText && (
            <div style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setDiagExpanded((v) => !v)}
              >
                {diagExpanded ? 'Hide Technical Log' : 'View Technical Log'}
              </button>
              {diagExpanded && (
                <pre className="diag-trace-box">{diagnostics.reportText}</pre>
              )}
            </div>
          )}
          {diagFeedback && (
            <div className="row-meta settings-feedback" role="status">
              {diagFeedback}
            </div>
          )}
        </div>

        <div className="panel-card">
          <div className="toggle-row" style={{ minHeight: 'auto' }}>
            <div>
              <div className="row-title">Release Download Counts</div>
              <div className="row-meta">Public GitHub APK download totals</div>
            </div>
            <button
              type="button"
              className="secondary-btn"
              disabled={statsLoading}
              onClick={() => void loadReleaseStats()}
            >
              {statsLoading
                ? 'Loading...'
                : releaseStats
                  ? 'Refresh'
                  : 'Load Counts'}
            </button>
          </div>
          {statsError && (
            <div className="row-meta" style={{ marginTop: '0.45rem', color: 'var(--danger)' }}>
              {statsError}
            </div>
          )}
          {releaseStats && (
            <div className="release-stats-list">
              <div className="release-stat-row">
                <strong>Total APK Downloads</strong>
                <strong>
                  {releaseStats.reduce((sum, item) => sum + item.downloads, 0)}
                </strong>
              </div>
              {releaseStats.map((rel) => (
                <div key={rel.tagName} className="release-stat-row">
                  <span>
                    <strong>{rel.tagName}</strong>
                    {rel.publishedDate ? ` · ${rel.publishedDate}` : ''}
                  </span>
                  <span>{rel.downloads} downloads</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
