import React, { useState } from 'react';
import { extractHost, isHostShieldsEnabled } from '../adblock/filterEngine';
import type {
  BlockDecision,
  BrowserState,
  FilterSyncResult,
  ShieldsConfig,
} from '../adblock/types';
import { ShieldIcon } from './Icons';

interface ShieldsPanelProps {
  state: BrowserState;
  currentUrl: string;
  syncStatus: FilterSyncResult | null;
  isSyncing: boolean;
  onUpdateConfig: (cfg: ShieldsConfig) => void;
  onToggleSite: (host: string, enabled: boolean) => void;
  onSyncFilters: () => void;
  onCheckUpdates: () => void;
  onTestUrl: (url: string, pageHost: string) => BlockDecision;
  onClose: () => void;
}

export const ShieldsPanel: React.FC<ShieldsPanelProps> = ({
  state,
  currentUrl,
  syncStatus,
  isSyncing,
  onUpdateConfig,
  onToggleSite,
  onSyncFilters,
  onCheckUpdates,
  onTestUrl,
  onClose,
}) => {
  const { shields, telemetry, filterStats, filterSources, appUpdate } = state;
  const pageHost = extractHost(currentUrl);
  const siteEnabled = isHostShieldsEnabled(shields, pageHost);

  const [probeUrl, setProbeUrl] = useState(
    'https://securepubads.g.doubleclick.net/tag/js/gpt.js'
  );
  const [probeResult, setProbeResult] = useState<BlockDecision | null>(null);

  const totalRules = filterStats.domainRuleCount + filterStats.patternRuleCount;
  const adsAndTrackers = telemetry.adsBlocked + telemetry.trackersBlocked;

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shields-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel">
        <div className="drawer-header">
          <h2 id="shields-drawer-title" className="drawer-title">
            Aegis Shields
          </h2>
          <button type="button" className="secondary-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="shields-hero-card" data-active={siteEnabled ? 'true' : 'false'}>
          <div className="toggle-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span style={{ color: siteEnabled ? 'var(--accent-hover)' : 'var(--text-muted)' }}>
                <ShieldIcon size={24} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="row-title">
                  {pageHost && !currentUrl.startsWith('aegis://')
                    ? `Shields for ${pageHost}`
                    : 'Global Aegis Shields'}
                </div>
                <div className="row-meta">
                  {siteEnabled
                    ? 'Blocking ads, trackers & redirect popups'
                    : 'Protection paused'}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Toggle Shields protection"
              aria-pressed={
                pageHost && !currentUrl.startsWith('aegis://')
                  ? siteEnabled
                  : shields.enabled
              }
              onClick={() => {
                if (pageHost && !currentUrl.startsWith('aegis://')) {
                  onToggleSite(pageHost, !siteEnabled);
                } else {
                  onUpdateConfig({ ...shields, enabled: !shields.enabled });
                }
              }}
            />
          </div>

          <div className="shields-stat-row">
            <div className="stat-tile">
              <span className="stat-value" data-tone="accent">
                {telemetry.totalBlocked.toLocaleString()}
              </span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{adsAndTrackers.toLocaleString()}</span>
              <span className="stat-label">Ads &amp; Trackers</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{telemetry.popupsBlocked.toLocaleString()}</span>
              <span className="stat-label">Popups</span>
            </div>
          </div>
        </div>

        <div className="panel-card">
          <div className="toggle-row">
            <div>
              <div className="row-title">Block Ads &amp; Trackers</div>
              <div className="row-meta">{totalRules.toLocaleString()} active rules</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Block Ads and Trackers"
              aria-pressed={shields.blockAdsAndTrackers}
              onClick={() =>
                onUpdateConfig({
                  ...shields,
                  blockAdsAndTrackers: !shields.blockAdsAndTrackers,
                })
              }
            />
          </div>

          <div className="toggle-row">
            <div>
              <div className="row-title">Block Popups &amp; Ad Redirects</div>
              <div className="row-meta">Auto-closes popup &amp; redirect tabs</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Block Popups and Ad Redirects"
              aria-pressed={shields.blockPopups}
              onClick={() =>
                onUpdateConfig({
                  ...shields,
                  blockPopups: !shields.blockPopups,
                })
              }
            />
          </div>

          <div className="toggle-row">
            <div>
              <div className="row-title">Hide Ad Placeholders</div>
              <div className="row-meta">Collapse empty banner &amp; video overlays</div>
            </div>
            <button
              type="button"
              className="toggle-switch"
              aria-label="Hide Ad Placeholders"
              aria-pressed={shields.cosmeticFiltering}
              onClick={() =>
                onUpdateConfig({
                  ...shields,
                  cosmeticFiltering: !shields.cosmeticFiltering,
                })
              }
            />
          </div>
        </div>

        <div className="panel-card">
          <div className="toggle-row">
            <div>
              <div className="row-title">Aegis Browser v{appUpdate.installedVersion}</div>
              <div className="row-meta">
                {appUpdate.checkedAtIso
                  ? `Checked ${appUpdate.checkedAtIso.slice(0, 10)}`
                  : 'Tap to check GitHub Releases'}
              </div>
            </div>
            <button
              type="button"
              className="secondary-btn"
              disabled={appUpdate.status === 'checking'}
              onClick={onCheckUpdates}
            >
              {appUpdate.status === 'checking' ? 'Checking...' : 'Check Updates'}
            </button>
          </div>
          {appUpdate.message && appUpdate.status !== 'available' && (
            <div
              className="status-banner"
              data-tone={
                appUpdate.status === 'up_to_date'
                  ? 'allowed'
                  : appUpdate.status === 'error'
                    ? 'blocked'
                    : undefined
              }
            >
              {appUpdate.message}
            </div>
          )}
        </div>

        <details className="advanced-details">
          <summary>Advanced · Filter Lists &amp; Diagnostics</summary>
          <div className="list-stack">
            <button
              type="button"
              className="primary-btn"
              disabled={isSyncing}
              onClick={onSyncFilters}
            >
              {isSyncing
                ? 'Syncing Filter Lists...'
                : 'Update Filter Lists Now'}
            </button>

            {syncStatus && (
              <div className="status-banner">{syncStatus.message}</div>
            )}

            {filterSources.map((src) => (
              <div key={src.id} className="row-item">
                <div style={{ minWidth: 0 }}>
                  <span className="row-title">{src.name}</span>
                  <span className="row-meta">
                    {src.cachedRuleCount > 0
                      ? `${src.cachedRuleCount.toLocaleString()} synced rules`
                      : src.enabled
                        ? 'Preloaded + Auto-sync'
                        : 'Optional'}
                  </span>
                </div>
              </div>
            ))}

            <form
              style={{ display: 'flex', gap: '8px', marginTop: '4px' }}
              onSubmit={(e) => {
                e.preventDefault();
                setProbeResult(onTestUrl(probeUrl, pageHost ?? 'news.example.com'));
              }}
            >
              <label htmlFor="filter-probe-input" className="sr-only">
                URL to test
              </label>
              <input
                id="filter-probe-input"
                className="text-input"
                value={probeUrl}
                onChange={(e) => setProbeUrl(e.target.value)}
              />
              <button type="submit" className="secondary-btn">
                Test
              </button>
            </form>

            {probeResult && (
              <div
                className="status-banner"
                data-tone={probeResult.blocked ? 'blocked' : 'allowed'}
              >
                {probeResult.blocked
                  ? `BLOCKED (${probeResult.category}) — ${probeResult.matchedRule}`
                  : 'ALLOWED'}
              </div>
            )}

            {telemetry.recentEvents.length > 0 && (
              <div className="list-stack" style={{ marginTop: '4px' }}>
                {telemetry.recentEvents.slice(0, 8).map((ev, idx) => (
                  <div key={`${ev.timestampMs}-${idx}`} className="row-item">
                    <div style={{ minWidth: 0 }}>
                      <span className="row-title">
                        [{ev.category.toUpperCase()}] {ev.host}
                      </span>
                      <span className="row-meta">{ev.rule}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
};
