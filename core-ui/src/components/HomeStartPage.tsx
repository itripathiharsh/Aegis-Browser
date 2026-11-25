import React from 'react';
import type {
  BookmarkItem,
  BrowserState,
  SearchEngineId,
} from '../adblock/types';
import { SEARCH_ENGINES } from '../utils/urlResolver';
import { AegisCrest, PlayIcon, ShieldIcon } from './Icons';

interface HomeStartPageProps {
  state: BrowserState;
  bookmarks: BookmarkItem[];
  searchEngine: SearchEngineId;
  onChangeEngine: (engine: SearchEngineId) => void;
  onOpenUrl: (url: string) => void;
  onOpenShields: () => void;
}

export const HomeStartPage: React.FC<HomeStartPageProps> = ({
  state,
  bookmarks,
  searchEngine,
  onChangeEngine,
  onOpenUrl,
  onOpenShields,
}) => {
  const activeRules =
    state.filterStats.domainRuleCount + state.filterStats.patternRuleCount;

  return (
    <main className="main-stage" id="main">
      <div className="home-container">
        <section className="hero-deck" aria-labelledby="aegis-home-title">
          <div className="hero-brand">
            <AegisCrest size={56} />
            <div>
              <h1 id="aegis-home-title" className="hero-title">
                Aegis Privacy Browser
              </h1>
              <p className="hero-subtitle">
                Zero-bloat network ad blocker, pop-under shield, and hardware-accelerated HLS playback.
              </p>
            </div>
          </div>

          <div className="telemetry-strip" aria-label="Privacy protection telemetry">
            <div className="stat-tile">
              <span className="stat-value" data-tone="accent">
                {state.telemetry.totalBlocked.toLocaleString()}
              </span>
              <span className="stat-label">Blocked this session</span>
            </div>

            <div className="stat-tile">
              <span className="stat-value" data-tone="success">
                {activeRules.toLocaleString()}
              </span>
              <span className="stat-label">Active filter rules</span>
            </div>

            <div className="stat-tile">
              <span className="stat-value" data-tone="info">
                {state.filterStats.cosmeticSelectorCount.toLocaleString()}
              </span>
              <span className="stat-label">Cosmetic CSS rules</span>
            </div>

            <button
              type="button"
              className="stat-tile"
              onClick={onOpenShields}
              style={{ textAlign: 'left' }}
            >
              <span
                className="stat-value"
                data-tone={state.shields.enabled ? 'success' : 'accent'}
              >
                {state.shields.enabled ? 'ACTIVE' : 'PAUSED'}
              </span>
              <span className="stat-label">
                <ShieldIcon size={13} /> Inspect Shields &amp; Mirrors
              </span>
            </button>
          </div>
        </section>

        <section aria-label="Default search engine">
          <div className="engine-strip">
            <span className="stat-label">Search Engine:</span>
            {(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => (
              <button
                key={id}
                type="button"
                className="chip-btn"
                aria-pressed={searchEngine === id}
                onClick={() => onChangeEngine(id)}
              >
                {SEARCH_ENGINES[id].label}
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="speed-dial-heading">
          <div className="section-head">
            <h2 id="speed-dial-heading" className="section-title">
              Speed Dial &amp; Verification Targets
            </h2>
            <button
              type="button"
              className="secondary-btn"
              onClick={() =>
                onOpenUrl('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
              }
            >
              <PlayIcon size={15} />
              Test HLS Stream
            </button>
          </div>

          <div className="dial-grid" style={{ marginTop: '0.75rem' }}>
            {bookmarks.map((bm) => (
              <button
                key={bm.id}
                type="button"
                className="dial-card"
                onClick={() => onOpenUrl(bm.url)}
              >
                <div className="dial-card-top">
                  <span className="dial-title">{bm.title}</span>
                  <span className="dial-tag">{bm.tag}</span>
                </div>
                <span className="dial-url">{bm.url}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
};
