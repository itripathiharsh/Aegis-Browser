import React, { useState } from 'react';
import type {
  BookmarkItem,
  BrowserState,
  SearchEngineId,
} from '../adblock/types';
import { SEARCH_ENGINES, resolveOmniboxInput } from '../utils/urlResolver';
import {
  BookmarkToggleIcon,
  DownloadIcon,
  EditIcon,
  HistoryIcon,
  SettingsIcon,
  TrashIcon,
} from './BrowserIcons';
import { AegisCrest, PlusIcon, SearchIcon } from './Icons';

interface HomeStartPageProps {
  state: BrowserState;
  bookmarks: BookmarkItem[];
  searchEngine: SearchEngineId;
  onChangeEngine: (engine: SearchEngineId) => void;
  onOpenUrl: (url: string) => void;
  onAddFavorite: (title: string, url: string) => void;
  onRemoveFavorite: (id: string) => void;
  onOpenShields: () => void;
  onOpenBookmarks: () => void;
  onOpenHistory: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
}

export const HomeStartPage: React.FC<HomeStartPageProps> = ({
  state,
  bookmarks,
  searchEngine,
  onChangeEngine,
  onOpenUrl,
  onAddFavorite,
  onRemoveFavorite,
  onOpenShields,
  onOpenBookmarks,
  onOpenHistory,
  onOpenDownloads,
  onOpenSettings,
}) => {
  const [query, setQuery] = useState('');
  const [addingFav, setAddingFav] = useState(false);
  const [editingFavs, setEditingFavs] = useState(false);
  const [favTitle, setFavTitle] = useState('');
  const [favUrl, setFavUrl] = useState('');

  const activeRules =
    state.filterStats.domainRuleCount + state.filterStats.patternRuleCount;
  const engineLabel = SEARCH_ENGINES[searchEngine]?.label ?? 'DuckDuckGo';
  const showRecs = state.settings?.showRecommendations !== false;
  const recommendations = showRecs ? state.recommendations ?? [] : [];
  const activeDownloads = state.downloadsSummary?.activeCount ?? 0;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onOpenUrl(query.trim());
  };

  const handleSaveFavorite = (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = favUrl.trim();
    if (!rawUrl) return;
    const normalized = resolveOmniboxInput(rawUrl, searchEngine);
    onAddFavorite(favTitle.trim() || rawUrl, normalized);
    setFavTitle('');
    setFavUrl('');
    setAddingFav(false);
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
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="secondary-btn"
                aria-expanded={addingFav}
                onClick={() => {
                  setAddingFav((prev) => !prev);
                  setEditingFavs(false);
                }}
              >
                <PlusIcon size={14} />
                Add
              </button>
              <button
                type="button"
                className="secondary-btn"
                aria-pressed={editingFavs}
                onClick={() => {
                  setEditingFavs((prev) => !prev);
                  setAddingFav(false);
                }}
              >
                <EditIcon size={14} />
                {editingFavs ? 'Done' : 'Edit'}
              </button>
            </div>
          </div>

          {addingFav && (
            <form className="panel-card home-add-fav-card" onSubmit={handleSaveFavorite}>
              <input
                type="text"
                className="text-input"
                placeholder="Site name (e.g., Cricbuzz)"
                aria-label="Favorite site name"
                value={favTitle}
                onChange={(e) => setFavTitle(e.target.value)}
              />
              <input
                type="text"
                className="text-input"
                placeholder="Website URL (e.g., cricbuzz.com)"
                aria-label="Favorite website URL"
                value={favUrl}
                onChange={(e) => setFavUrl(e.target.value)}
                required
              />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setAddingFav(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save Favorite
                </button>
              </div>
            </form>
          )}

          <div className="dial-grid">
            {bookmarks.map((bm, idx) => {
              const initial = (bm.title.trim()[0] ?? 'A').toUpperCase();
              return (
                <div key={bm.id} className="dial-tile-wrap">
                  <button
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
                  {editingFavs && (
                    <button
                      type="button"
                      className="dial-remove-badge"
                      aria-label={`Remove ${bm.title} from Favorites`}
                      onClick={() => onRemoveFavorite(bm.id)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {showRecs && (
          <section aria-labelledby="recommended-heading">
            <div className="section-head" style={{ marginBottom: '10px' }}>
              <h2 id="recommended-heading" className="section-title">
                Recommended for You
              </h2>
              <button
                type="button"
                className="secondary-btn"
                onClick={onOpenHistory}
              >
                History
              </button>
            </div>

            {recommendations.length === 0 ? (
              <div className="panel-card home-rec-empty">
                Websites you visit are added here automatically based on what you browse.
              </div>
            ) : (
              <div className="rec-grid">
                {recommendations.map((rec) => {
                  const cleanHost = rec.host.replace(/^www\./, '');
                  const monogram = (rec.title.trim()[0] ?? cleanHost[0] ?? 'W').toUpperCase();
                  return (
                    <button
                      key={rec.host}
                      type="button"
                      className="rec-card"
                      onClick={() => onOpenUrl(rec.url)}
                    >
                      <span className="rec-icon" aria-hidden="true">
                        {monogram}
                      </span>
                      <span className="rec-body">
                        <span className="rec-title">{rec.title || cleanHost}</span>
                        <span className="rec-meta">
                          {cleanHost} · {rec.visits} {rec.visits === 1 ? 'visit' : 'visits'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <nav className="home-quick-nav" aria-label="Browser tools">
          <button type="button" className="home-quick-btn" onClick={onOpenHistory}>
            <HistoryIcon size={17} />
            <span>History</span>
          </button>
          <button type="button" className="home-quick-btn" onClick={onOpenDownloads}>
            <DownloadIcon size={17} />
            <span>
              Downloads{activeDownloads > 0 ? ` (${activeDownloads})` : ''}
            </span>
          </button>
          <button type="button" className="home-quick-btn" onClick={onOpenBookmarks}>
            <BookmarkToggleIcon size={17} />
            <span>Bookmarks</span>
          </button>
          <button type="button" className="home-quick-btn" onClick={onOpenSettings}>
            <SettingsIcon size={17} />
            <span>Settings</span>
          </button>
        </nav>
      </div>
    </main>
  );
};
