import React, { useMemo, useRef, useState } from 'react';
import type {
  BookmarkItem,
  BrowserState,
  HistoryEntry,
  SearchEngineId,
} from '../adblock/types';
import { buildOmniboxSuggestions, type OmniboxSuggestion } from '../utils/suggestions';
import { SEARCH_ENGINES, resolveOmniboxInput } from '../utils/urlResolver';
import {
  BookmarkToggleIcon,
  DownloadIcon,
  HistoryIcon,
  SettingsIcon,
  TrashIcon,
} from './BrowserIcons';
import { AegisCrest, PlusIcon, SearchIcon, StopIcon } from './Icons';
import { SuggestionDropdown } from './SuggestionDropdown';

interface HomeStartPageProps {
  state: BrowserState;
  bookmarks: BookmarkItem[];
  historyEntries: HistoryEntry[];
  searchEngine: SearchEngineId;
  onChangeEngine: (engine: SearchEngineId) => void;
  onOpenUrl: (url: string) => void;
  onAddFavorite: (title: string, url: string) => void;
  onRemoveFavorite: (id: string) => void;
  onDismissRecommendation: (host: string) => void;
  onOpenShields: () => void;
  onOpenBookmarks: () => void;
  onOpenHistory: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
}

const DIAL_PALETTES = [
  { bg: 'rgba(220, 38, 38, 0.14)', fg: '#ef4444' },
  { bg: 'rgba(37, 99, 235, 0.14)', fg: '#3b82f6' },
  { bg: 'rgba(16, 185, 129, 0.14)', fg: '#10b981' },
  { bg: 'rgba(139, 92, 246, 0.14)', fg: '#8b5cf6' },
  { bg: 'rgba(245, 158, 11, 0.14)', fg: '#f59e0b' },
  { bg: 'rgba(240, 100, 40, 0.14)', fg: '#f06428' },
];

function getSitePalette(urlOrTitle: string) {
  let hash = 0;
  for (let i = 0; i < urlOrTitle.length; i += 1) {
    hash = (hash * 31 + urlOrTitle.charCodeAt(i)) >>> 0;
  }
  return DIAL_PALETTES[hash % DIAL_PALETTES.length];
}

function formatCleanHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const HomeStartPage: React.FC<HomeStartPageProps> = ({
  state,
  bookmarks,
  historyEntries,
  searchEngine,
  onChangeEngine,
  onOpenUrl,
  onAddFavorite,
  onRemoveFavorite,
  onDismissRecommendation,
  onOpenShields,
  onOpenBookmarks,
  onOpenHistory,
  onOpenDownloads,
  onOpenSettings,
}) => {
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [addingFav, setAddingFav] = useState(false);
  const [editingFavs, setEditingFavs] = useState(false);
  const [favTitle, setFavTitle] = useState('');
  const [favUrl, setFavUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const activeRules =
    state.filterStats.domainRuleCount + state.filterStats.patternRuleCount;
  const engineLabel = SEARCH_ENGINES[searchEngine]?.label ?? 'DuckDuckGo';
  const showRecs = state.settings?.showRecommendations !== false;
  const recommendations = showRecs ? state.recommendations ?? [] : [];
  const activeDownloads = state.downloadsSummary?.activeCount ?? 0;

  const suggestions = useMemo(
    () =>
      searchFocused
        ? buildOmniboxSuggestions(query, historyEntries, bookmarks, 6)
        : [],
    [bookmarks, historyEntries, query, searchFocused]
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchFocused(false);
    onOpenUrl(query.trim());
  };

  const handleSelectSuggestion = (item: OmniboxSuggestion) => {
    setSearchFocused(false);
    onOpenUrl(item.navigateTarget);
  };

  const handleSaveFavorite = (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = favUrl.trim();
    if (!rawUrl) return;
    const normalized = resolveOmniboxInput(rawUrl, searchEngine);
    onAddFavorite(favTitle.trim() || formatCleanHost(normalized), normalized);
    setFavTitle('');
    setFavUrl('');
    setAddingFav(false);
  };

  return (
    <main className="main-stage" id="main">
      <div className="home-container">
        <section className="home-hero" aria-labelledby="aegis-home-title">
          <div className="home-brand-row">
            <AegisCrest size={38} />
            <div className="home-brand-copy">
              <h1 id="aegis-home-title" className="home-title">
                Aegis
              </h1>
              <button
                type="button"
                className="home-shield-caption"
                onClick={onOpenShields}
              >
                <span
                  className="home-shield-dot"
                  data-active={state.shields.enabled ? 'true' : 'false'}
                />
                <span>
                  {state.telemetry.totalBlocked.toLocaleString()} blocked ·{' '}
                  {activeRules.toLocaleString()} rules
                </span>
              </button>
            </div>
          </div>

          <div className="home-search-wrap">
            <form className="home-search-box" onSubmit={handleSearch} role="search">
              <span className="home-search-lead" aria-hidden="true">
                <SearchIcon size={18} />
              </span>
              <label htmlFor="home-search-input" className="sr-only">
                Search with {engineLabel} or enter website URL
              </label>
              <input
                ref={inputRef}
                id="home-search-input"
                className="home-search-input"
                type="text"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                placeholder={`Search ${engineLabel} or type URL`}
                value={query}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setSearchFocused(false), 140);
                }}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query.length > 0 && (
                <button
                  type="button"
                  className="omnibox-inline-btn"
                  aria-label="Clear search"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                >
                  <StopIcon size={15} />
                </button>
              )}
              <button type="submit" className="home-search-submit">
                Go
              </button>
            </form>

            {searchFocused && suggestions.length > 0 && (
              <div className="home-suggestions-pop">
                <SuggestionDropdown
                  variant="home"
                  suggestions={suggestions}
                  onSelect={handleSelectSuggestion}
                  onFill={(text) => {
                    setQuery(text);
                    inputRef.current?.focus();
                  }}
                />
              </div>
            )}
          </div>

          <div className="engine-tabs" role="group" aria-label="Search engine">
            {(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => (
              <button
                key={id}
                type="button"
                className="engine-tab-btn"
                aria-pressed={searchEngine === id}
                onClick={() => onChangeEngine(id)}
              >
                {SEARCH_ENGINES[id].label}
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="speed-dial-heading" className="home-section">
          <div className="section-head">
            <h2 id="speed-dial-heading" className="section-title">
              Favorites
            </h2>
            <button
              type="button"
              className="text-link-btn"
              aria-pressed={editingFavs}
              onClick={() => {
                setEditingFavs((prev) => !prev);
                setAddingFav(false);
              }}
            >
              {editingFavs ? 'Done' : 'Edit'}
            </button>
          </div>

          {addingFav && (
            <form className="panel-card home-add-fav-card" onSubmit={handleSaveFavorite}>
              <input
                type="text"
                className="text-input"
                placeholder="Shortcut name (optional)"
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
                  Add Shortcut
                </button>
              </div>
            </form>
          )}

          <div className="dial-grid">
            {bookmarks.map((bm) => {
              const initial = (bm.title.trim()[0] ?? 'A').toUpperCase();
              const tone = getSitePalette(bm.url || bm.title);
              return (
                <div key={bm.id} className="dial-tile-wrap">
                  <button
                    type="button"
                    className="dial-tile"
                    onClick={() => onOpenUrl(bm.url)}
                  >
                    <span
                      className="dial-icon"
                      style={{ background: tone.bg, color: tone.fg }}
                      aria-hidden="true"
                    >
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

            <div className="dial-tile-wrap">
              <button
                type="button"
                className="dial-tile dial-add-tile"
                aria-expanded={addingFav}
                onClick={() => {
                  setAddingFav((prev) => !prev);
                  setEditingFavs(false);
                }}
              >
                <span className="dial-icon dial-add-icon" aria-hidden="true">
                  <PlusIcon size={20} />
                </span>
                <span className="dial-title">Add</span>
              </button>
            </div>
          </div>
        </section>

        {showRecs && recommendations.length > 0 && (
          <section aria-labelledby="recommended-heading" className="home-section">
            <div className="section-head">
              <h2 id="recommended-heading" className="section-title">
                Frequently Visited
              </h2>
              <button
                type="button"
                className="text-link-btn"
                onClick={onOpenHistory}
              >
                See all
              </button>
            </div>

            <div className="rec-grid">
              {recommendations.map((rec) => {
                const cleanHost = rec.host.replace(/^www\./, '');
                const monogram = (rec.title.trim()[0] ?? cleanHost[0] ?? 'W').toUpperCase();
                const tone = getSitePalette(cleanHost);
                return (
                  <div key={rec.host} className="rec-item">
                    <button
                      type="button"
                      className="rec-card"
                      onClick={() => onOpenUrl(rec.url)}
                    >
                      <span
                        className="rec-icon"
                        style={{ background: tone.bg, color: tone.fg }}
                        aria-hidden="true"
                      >
                        {monogram}
                      </span>
                      <span className="rec-body">
                        <span className="rec-title">{rec.title || cleanHost}</span>
                        <span className="rec-meta">{cleanHost}</span>
                      </span>
                    </button>
                    {editingFavs && (
                      <button
                        type="button"
                        className="rec-dismiss-btn"
                        aria-label={`Hide ${cleanHost} from Frequently Visited`}
                        onClick={() => onDismissRecommendation(rec.host)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="home-bottom-spacer" />

        <nav className="home-quick-nav" aria-label="Browser tools">
          <button type="button" className="home-quick-btn" onClick={onOpenHistory}>
            <HistoryIcon size={16} />
            <span>History</span>
          </button>
          <button type="button" className="home-quick-btn" onClick={onOpenDownloads}>
            <DownloadIcon size={16} />
            <span>Downloads{activeDownloads > 0 ? ` (${activeDownloads})` : ''}</span>
          </button>
          <button type="button" className="home-quick-btn" onClick={onOpenBookmarks}>
            <BookmarkToggleIcon size={16} />
            <span>Bookmarks</span>
          </button>
          <button type="button" className="home-quick-btn" onClick={onOpenSettings}>
            <SettingsIcon size={16} />
            <span>Settings</span>
          </button>
        </nav>

        <footer className="home-footer">
          <p className="home-footer-tagline">
            Made for self, now used by many like us.
          </p>
          <p className="home-footer-meta">
            For any feedback:{' '}
            <a
              className="home-footer-mail"
              href="mailto:harsh.tripathi.cs@gmail.com"
            >
              harsh.tripathi.cs@gmail.com
            </a>{' '}
            · Thanks!
          </p>
        </footer>
      </div>
    </main>
  );
};
