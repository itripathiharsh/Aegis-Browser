import React, { useState } from 'react';
import type {
  BookmarkItem,
  BrowserState,
  SearchEngineId,
} from '../adblock/types';
import { SEARCH_ENGINES } from '../utils/urlResolver';
import { AegisCrest, PlusIcon, SearchIcon } from './Icons';

interface HomeStartPageProps {
  state: BrowserState;
  bookmarks: BookmarkItem[];
  searchEngine: SearchEngineId;
  onChangeEngine: (engine: SearchEngineId) => void;
  onOpenUrl: (url: string) => void;
  onOpenShields: () => void;
  onOpenBookmarks: () => void;
}

export const HomeStartPage: React.FC<HomeStartPageProps> = ({
  state,
  bookmarks,
  searchEngine,
  onChangeEngine,
  onOpenUrl,
  onOpenShields,
  onOpenBookmarks,
}) => {
  const [query, setQuery] = useState('');
  const activeRules =
    state.filterStats.domainRuleCount + state.filterStats.patternRuleCount;
  const engineLabel = SEARCH_ENGINES[searchEngine]?.label ?? 'Brave Search';

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onOpenUrl(query.trim());
  };

  return (
    <main className="main-stage" id="main">
      <div className="home-container">
        <section className="home-hero" aria-labelledby="aegis-home-title">
          <div className="home-brand-row">
            <AegisCrest size={48} />
            <h1 id="aegis-home-title" className="home-title">
              Aegis
            </h1>
          </div>

          <button
            type="button"
            className="home-shield-pill"
            onClick={onOpenShields}
          >
            <span
              className="home-shield-dot"
              data-active={state.shields.enabled ? 'true' : 'false'}
            />
            <span>
              <strong>{state.telemetry.totalBlocked.toLocaleString()}</strong> blocked ·{' '}
              {activeRules.toLocaleString()} rules active
            </span>
          </button>

          <form className="home-search-box" onSubmit={handleSearch} role="search">
            <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
              <SearchIcon size={18} />
            </span>
            <label htmlFor="home-search-input" className="sr-only">
              Search with {engineLabel} or enter website URL
            </label>
            <input
              id="home-search-input"
              className="home-search-input"
              type="text"
              enterKeyHint="search"
              placeholder={`Search with ${engineLabel} or enter URL`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="home-search-submit">
              Search
            </button>
          </form>

          <div className="engine-strip" role="group" aria-label="Search engine">
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
          <div className="section-head" style={{ marginBottom: '10px' }}>
            <h2 id="speed-dial-heading" className="section-title">
              Favorites
            </h2>
            <button
              type="button"
              className="secondary-btn"
              onClick={onOpenBookmarks}
            >
              <PlusIcon size={14} />
              Edit
            </button>
          </div>

          <div className="dial-grid">
            {bookmarks.map((bm, idx) => {
              const initial = (bm.title.trim()[0] ?? 'A').toUpperCase();
              return (
                <button
                  key={bm.id}
                  type="button"
                  className="dial-tile"
                  data-accent={idx === 0 ? 'true' : 'false'}
                  onClick={() => onOpenUrl(bm.url)}
                >
                  <span className="dial-icon" aria-hidden="true">
                    {initial}
                  </span>
                  <span className="dial-title">{bm.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
};
