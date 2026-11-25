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
  ChevronDownIcon,
  DownloadIcon,
  HistoryIcon,
  IncognitoIcon,
  SettingsIcon,
  TrashIcon,
} from './BrowserIcons';
import { NivrokCrest, PlusIcon, ShieldIcon, StopIcon } from './Icons';
import { SuggestionDropdown } from './SuggestionDropdown';

interface HomeStartPageProps {
  state: BrowserState;
  bookmarks: BookmarkItem[];
  historyEntries: HistoryEntry[];
  searchEngine: SearchEngineId;
  incognito: boolean;
  onChangeEngine: (engine: SearchEngineId) => void;
  onOpenUrl: (url: string) => void;
  onAddFavorite: (title: string, url: string) => void;
  onRemoveFavorite: (id: string) => void;
  onDismissRecommendation: (host: string) => void;
  onOpenIncognitoTab: () => void;
  onOpenShields: () => void;
  onOpenBookmarks: () => void;
  onOpenHistory: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
}

const DIAL_PALETTES = [
  { bg: 'rgba(239, 68, 68, 0.15)', fg: '#ef4444' },
  { bg: 'rgba(59, 130, 246, 0.15)', fg: '#3b82f6' },
  { bg: 'rgba(16, 185, 129, 0.15)', fg: '#10b981' },
  { bg: 'rgba(139, 92, 246, 0.15)', fg: '#8b5cf6' },
  { bg: 'rgba(245, 158, 11, 0.15)', fg: '#f59e0b' },
  { bg: 'rgba(240, 100, 40, 0.15)', fg: '#f06428' },
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

function formatDataSaved(blockedCount: number): string {
  const kb = blockedCount * 42;
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}

function formatCompactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

const ENGINE_SHORT: Record<SearchEngineId, { tag: string; name: string }> = {
  duckduckgo: { tag: 'D', name: 'DuckDuckGo' },
  brave: { tag: 'B', name: 'Brave' },
  startpage: { tag: 'S', name: 'Startpage' },
  google: { tag: 'G', name: 'Google' },
};

const SiteTileGlyph: React.FC<{ url: string; title: string }> = ({ url, title }) => {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com')) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21.5 7.2a2.7 2.7 0 0 0-1.9-1.9C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.5A2.7 2.7 0 0 0 2.5 7.2 28.5 28.5 0 0 0 2 12a28.5 28.5 0 0 0 .5 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5a2.7 2.7 0 0 0 1.9-1.9A28.5 28.5 0 0 0 22 12a28.5 28.5 0 0 0-.5-4.8zM10 15.2V8.8l5.5 3.2-5.5 3.2z" />
      </svg>
    );
  }
  if (lower.includes('github.com')) {
    return (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  if (lower.includes('wikipedia.org')) {
    return <span style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem' }}>W</span>;
  }
  return <span>{(title.trim()[0] ?? formatCleanHost(url)[0] ?? 'A').toUpperCase()}</span>;
};

export const HomeStartPage: React.FC<HomeStartPageProps> = ({
  state,
  bookmarks,
  historyEntries,
  searchEngine,
  incognito,
  onChangeEngine,
  onOpenUrl,
  onAddFavorite,
  onRemoveFavorite,
  onDismissRecommendation,
  onOpenIncognitoTab,
  onOpenShields,
  onOpenBookmarks,
  onOpenHistory,
  onOpenDownloads,
  onOpenSettings,
}) => {
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const [addingFav, setAddingFav] = useState(false);
  const [editingFavs, setEditingFavs] = useState(false);
  const [favTitle, setFavTitle] = useState('');
  const [favUrl, setFavUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const activeRules =
    state.filterStats.domainRuleCount + state.filterStats.patternRuleCount;
  const engineLabel = SEARCH_ENGINES[searchEngine]?.label ?? 'DuckDuckGo';
  const showRecs = !incognito && state.settings?.showRecommendations !== false;
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
    setEngineMenuOpen(false);
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
    <main className="main-stage" id="main" data-incognito={incognito ? 'true' : 'false'}>
      <div className="home-container">
        {incognito ? (
          <section className="incognito-hero-card">
            <div className="incognito-hero-icon">
              <IncognitoIcon size={28} />
            </div>
            <h1 className="incognito-hero-title">You&apos;ve gone Incognito</h1>
            <p className="incognito-hero-copy">
              Nivrok will not save pages you visit to History or Recommendations, and clears cookies &amp; temporary data when this tab closes.
            </p>
          </section>
        ) : (
          <section className="home-hero-band" aria-labelledby="nivrok-home-title">
            <div className="home-brand-header">
              <div className="home-brand-row">
                <NivrokCrest size={40} />
                <div className="home-brand-copy">
                  <h1 id="nivrok-home-title" className="home-title">
                    Nivrok
                  </h1>
                  <span className="home-subtitle">Private Zero-Ad Browser</span>
                </div>
              </div>
              <button
                type="button"
                className="home-incognito-chip"
                onClick={onOpenIncognitoTab}
                title="Open New Private Tab"
              >
                <IncognitoIcon size={15} />
                <span>Private</span>
              </button>
            </div>

            <button
              type="button"
              className="privacy-pulse-card"
              onClick={onOpenShields}
              aria-label="Open Shields privacy statistics"
            >
              <div className="pulse-metric">
                <span className="pulse-value" data-tone="accent">
                  {state.telemetry.totalBlocked.toLocaleString()}
                </span>
                <span className="pulse-label">Blocked</span>
              </div>
              <span className="pulse-divider" aria-hidden="true" />
              <div className="pulse-metric">
                <span className="pulse-value">
                  {formatDataSaved(state.telemetry.totalBlocked)}
                </span>
                <span className="pulse-label">Data Saved</span>
              </div>
              <span className="pulse-divider" aria-hidden="true" />
              <div className="pulse-metric">
                <span className="pulse-value">{formatCompactCount(activeRules)}</span>
                <span className="pulse-label">Active Rules</span>
              </div>
              <span className="pulse-shield-tag" aria-hidden="true">
                <ShieldIcon size={15} />
              </span>
            </button>
          </section>
        )}

        {/* Unified Capsule Omnibox with Embedded Engine Switcher */}
        <div className="home-search-wrap">
          <form className="home-search-box" onSubmit={handleSearch} role="search">
            <button
              type="button"
              className="engine-selector-pill"
              aria-expanded={engineMenuOpen}
              aria-label={`Search engine: ${engineLabel}. Tap to switch.`}
              onClick={() => setEngineMenuOpen((prev) => !prev)}
            >
              <span className="engine-pill-badge">{ENGINE_SHORT[searchEngine].tag}</span>
              <span className="engine-pill-label">{ENGINE_SHORT[searchEngine].name}</span>
              <ChevronDownIcon size={13} />
            </button>

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
              placeholder={`Search or type URL`}
              value={query}
              onFocus={() => {
                setSearchFocused(true);
                setEngineMenuOpen(false);
              }}
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

          {engineMenuOpen && (
            <div className="engine-dropdown" role="menu" aria-label="Choose search engine">
              {(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={searchEngine === id}
                  className="engine-dropdown-item"
                  data-active={searchEngine === id ? 'true' : 'false'}
                  onClick={() => {
                    onChangeEngine(id);
                    setEngineMenuOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="engine-pill-badge">{ENGINE_SHORT[id].tag}</span>
                  <span>{SEARCH_ENGINES[id].label}</span>
                </button>
              ))}
            </div>
          )}

          {searchFocused && !engineMenuOpen && suggestions.length > 0 && (
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

        {/* Favorites Speed Dial Card */}
        {!incognito && (
          <section aria-labelledby="speed-dial-heading" className="home-card-shelf">
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
                      >
                        <SiteTileGlyph url={bm.url} title={bm.title} />
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
        )}

        {/* Frequently Visited Clean Sites */}
        {showRecs && recommendations.length > 0 && (
          <section aria-labelledby="recommended-heading" className="home-card-shelf">
            <div className="section-head">
              <h2 id="recommended-heading" className="section-title">
                Frequently Visited
              </h2>
              <button type="button" className="text-link-btn" onClick={onOpenHistory}>
                History
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

        <nav className="home-dock" aria-label="Browser tools">
          <button type="button" className="home-dock-btn" onClick={onOpenHistory}>
            <HistoryIcon size={18} />
            <span>History</span>
          </button>
          <button type="button" className="home-dock-btn" onClick={onOpenDownloads}>
            <DownloadIcon size={18} />
            <span>Downloads{activeDownloads > 0 ? ` (${activeDownloads})` : ''}</span>
          </button>
          <button type="button" className="home-dock-btn" onClick={onOpenBookmarks}>
            <BookmarkToggleIcon size={18} />
            <span>Bookmarks</span>
          </button>
          <button type="button" className="home-dock-btn" onClick={onOpenSettings}>
            <SettingsIcon size={18} />
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
