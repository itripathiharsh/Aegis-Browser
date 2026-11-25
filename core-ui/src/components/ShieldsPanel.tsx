import React, { useState } from 'react';
import { extractHost, isHostShieldsEnabled } from '../adblock/filterEngine';
import type {
  BlockDecision,
  BrowserState,
  FilterSyncResult,
  ShieldsConfig,
} from '../adblock/types';

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

        <div className="telemetry-strip">
          <div className="stat-tile">
            <span className="stat-value" data-tone="accent">
              {telemetry.totalBlocked.toLocaleString()}
            </span>
            <span className="stat-label">Total Blocked</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{telemetry.adsBlocked.toLocaleString()}</span>
            <span className="stat-label">Ads</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{telemetry.trackersBlocked.toLocaleString()}</span>
            <span className="stat-label">Trackers</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{telemetry.popupsBlocked.toLocaleString()}</span>
            <span className="stat-label">Popups</span>
          </div>
        </div>

        <div className="panel-card">
          {pageHost && !currentUrl.startsWith('aegis://') && (
            <div className="toggle-row">
              <div>
                <div className="row-title">Shields for {pageHost}</div>
                <div className="row-meta">Per-site override</div>
              </div>
              <button
                type="button"
                className="toggle-btn"
                aria-pressed={siteEnabled}
                onClick={() => onToggleSite(pageHost, !siteEnabled)}
              >
                {siteEnabled ? 'UP' : 'DOWN'}
              </button>
            </div>
          )}

          <div className="toggle-row">
            <div>
              <div className="row-title">Global Shields Master</div>
              <div className="row-meta">Network &amp; cosmetic protection</div>
            </div>
            <button
              type="button"
              className="toggle-btn"
              aria-pressed={shields.enabled}
              onClick={() =>
                onUpdateConfig({ ...shields, enabled: !shields.enabled })
              }
            >
              {shields.enabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="toggle-row">
            <div>
              <div className="row-title">Block Ads &amp; Trackers</div>
              <div className="row-meta">EasyList + EasyPrivacy + uBlock</div>
            </div>
            <button
              type="button"
              className="toggle-btn"
              aria-pressed={shields.blockAdsAndTrackers}
              onClick={() =>
                onUpdateConfig({
                  ...shields,
                  blockAdsAndTrackers: !shields.blockAdsAndTrackers,
                })
              }
            >
              {shields.blockAdsAndTrackers ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="toggle-row">
            <div>
              <div className="row-title">Block Popups &amp; Redirects</div>
              <div className="row-meta">onCreateWindow + pop-under guard</div>
            </div>
            <button
              type="button"
              className="toggle-btn"
              aria-pressed={shields.blockPopups}
              onClick={() =>
                onUpdateConfig({
                  ...shields,
                  blockPopups: !shields.blockPopups,
                })
              }
            >
              {shields.blockPopups ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="toggle-row">
            <div>
              <div className="row-title">Cosmetic Ad Hiding</div>
              <div className="row-meta">Hide empty ad slots &amp; video overlays</div>
            </div>
            <button
              type="button"
              className="toggle-btn"
              aria-pressed={shields.cosmeticFiltering}
              onClick={() =>
                onUpdateConfig({
                  ...shields,
                  cosmeticFiltering: !shields.cosmeticFiltering,
                })
              }
            >
              {shields.cosmeticFiltering ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className="panel-card">
          <div className="section-head">
            <span className="row-title">
              Filter Lists ({totalRules.toLocaleString()} rules)
            </span>
            <span className="row-meta">
              {filterStats.lastUpdatedIso
                ? `Synced ${filterStats.lastUpdatedIso.slice(0, 10)}`
                : 'Bundled Local'}
            </span>
          </div>

          <button
            type="button"
            className="primary-btn"
            disabled={isSyncing}
            onClick={onSyncFilters}
          >
            {isSyncing
              ? 'Updating from GitHub Mirrors...'
              : 'Sync GitHub Filter Mirrors'}
          </button>

          {syncStatus && (
            <div className="status-banner">{syncStatus.message}</div>
          )}

          <div className="list-stack">
            {filterSources.map((src) => (
              <div key={src.id} className="row-item">
                <div style={{ minWidth: 0 }}>
                  <span className="row-title">{src.name}</span>
                  <span className="row-meta">
                    {src.category} •{' '}
                    {src.cachedRuleCount > 0
                      ? `${src.cachedRuleCount.toLocaleString()} cached`
                      : src.enabled
                        ? 'Bundled + Auto-Sync'
                        : 'Optional'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-card">
          <div className="toggle-row">
            <div>
              <div className="row-title">App Updates</div>
              <div className="row-meta">
                {appUpdate.checkedAtIso
                  ? `Last checked: ${appUpdate.checkedAtIso.slice(0, 10)}`
                  : 'Not checked yet'}
                {' • '} Installed: v{appUpdate.installedVersion}
              </div>
            </div>
            <button
              type="button"
              className="primary-btn"
              disabled={appUpdate.status === 'checking'}
              onClick={onCheckUpdates}
            >
              {appUpdate.status === 'checking' ? 'Checking...' : 'Check for Updates'}
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

        <div className="panel-card">
          <span className="row-title">Test URL Against Local Filters</span>
          <form
            style={{ display: 'flex', gap: '0.5rem' }}
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
                : 'ALLOWED — did not match any active block rule'}
            </div>
          )}
        </div>

        <div className="panel-card">
          <span className="row-title">
            Recent Blocked Requests ({telemetry.recentEvents.length})
          </span>
          {telemetry.recentEvents.length === 0 ? (
            <p className="row-meta">
              No blocked requests logged yet in this session.
            </p>
          ) : (
            <div className="list-stack">
              {telemetry.recentEvents.slice(0, 12).map((ev, idx) => (
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
      </div>
    </div>
  );
};
