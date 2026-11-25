import React, { useState } from 'react';
import type { BrowserSettings, SearchEngineId } from '../adblock/types';
import { SEARCH_ENGINES } from '../utils/urlResolver';

interface SettingsDrawerProps {
  settings: BrowserSettings;
  appVersion: string;
  checkingUpdate: boolean;
  onUpdateSettings: (next: BrowserSettings) => void;
  onClearHistory: () => void;
  onClearCacheAndCookies: () => void;
  onCheckForUpdates: () => void;
  onOpenShields: () => void;
  onClose: () => void;
}

const ENGINE_ORDER: SearchEngineId[] = ['duckduckgo', 'brave', 'startpage', 'google'];

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  settings,
  appVersion,
  checkingUpdate,
  onUpdateSettings,
  onClearHistory,
  onClearCacheAndCookies,
  onCheckForUpdates,
  onOpenShields,
  onClose,
}) => {
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const toggleKey = (key: keyof Pick<
    BrowserSettings,
    'showRecommendations' | 'defaultDesktopMode' | 'blockThirdPartyCookies' | 'saveHistory' | 'autoSyncFilters'
  >) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
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
            Default Search Engine
          </div>
          <div className="engine-strip" role="group" aria-label="Default search engine" style={{ justifyContent: 'flex-start' }}>
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
            Start Page & Browsing
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Recommended Sites</div>
              <div className="row-meta">Show top visited websites on the Start page</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Recommended Sites"
              aria-pressed={settings.showRecommendations}
              onClick={() => toggleKey('showRecommendations')}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="row-title">Desktop Mode by Default</div>
              <div className="row-meta">Request desktop layouts for newly opened tabs</div>
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
            Privacy & Shields
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
              <div className="row-meta">Log visited sites for History & Recommendations</div>
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
              <div className="row-meta">Keep 52,000+ filter rules fresh in the background</div>
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
              Open Ad-Block & Shields Controls
            </button>
          </div>
        </div>

        <div className="panel-card">
          <div className="row-title" style={{ marginBottom: '0.5rem' }}>
            Site Data & Storage
          </div>
          <div className="settings-action-grid">
            <button
              type="button"
              className="danger-btn"
              onClick={() => {
                onClearHistory();
                setFeedbackMsg('Browsing history & recommendations cleared.');
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
              Clear Cache & Cookies
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
      </div>
    </div>
  );
};
