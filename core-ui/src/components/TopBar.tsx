import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkItem, HistoryEntry, SearchEngineId, TabInfo } from '../adblock/types';
import { buildOmniboxSuggestions, type OmniboxSuggestion } from '../utils/suggestions';
import { SEARCH_ENGINES, formatDisplayUrl } from '../utils/urlResolver';
import {
  DownloadIcon,
  HistoryIcon,
  SettingsIcon,
} from './BrowserIcons';
import {
  AegisCrest,
  BackIcon,
  BookmarkIcon,
  DesktopIcon,
  ForwardIcon,
  HomeIcon,
  LockIcon,
  MoreVertIcon,
  ReloadIcon,
  ShieldIcon,
  StopIcon,
} from './Icons';
import { SuggestionDropdown } from './SuggestionDropdown';

export type DrawerKind =
  | 'tabs'
  | 'bookmarks'
  | 'shields'
  | 'history'
  | 'downloads'
  | 'settings';

interface TopBarProps {
  activeTab: TabInfo;
  tabCount: number;
  totalBlocked: number;
  downloadsActiveCount?: number;
  shieldsEnabledForSite: boolean;
  isBookmarked: boolean;
  searchEngine: SearchEngineId;
  historyEntries: HistoryEntry[];
  bookmarks: BookmarkItem[];
  activeDrawer: DrawerKind | null;
  menuOpen: boolean;
  omniboxInputRef: React.RefObject<HTMLInputElement>;
  barRef: React.RefObject<HTMLDivElement>;
  onToggleMenu: (open: boolean) => void;
  onSuggestionsVisibleChange: (visible: boolean) => void;
  onNavigate: (rawInput: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onGoHome: () => void;
  onToggleBookmark: () => void;
  onToggleDesktopMode: () => void;
  onOpenDrawer: (drawer: DrawerKind) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  tabCount,
  totalBlocked,
  downloadsActiveCount = 0,
  shieldsEnabledForSite,
  isBookmarked,
  searchEngine,
  historyEntries,
  bookmarks,
  activeDrawer,
  menuOpen,
  omniboxInputRef,
  barRef,
  onToggleMenu,
  onSuggestionsVisibleChange,
  onNavigate,
  onBack,
  onForward,
  onReloadOrStop,
  onGoHome,
  onToggleBookmark,
  onToggleDesktopMode,
  onOpenDrawer,
}) => {
  const [draft, setDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [pulse, setPulse] = useState(false);
  const prevBlockedRef = useRef(totalBlocked);

  useEffect(() => {
    if (!isEditing) {
      setDraft(activeTab.url === 'aegis://home' ? '' : activeTab.url);
    }
  }, [activeTab.url, isEditing]);

  useEffect(() => {
    if (totalBlocked > prevBlockedRef.current) {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 450);
      prevBlockedRef.current = totalBlocked;
      return () => window.clearTimeout(t);
    }
    prevBlockedRef.current = totalBlocked;
  }, [totalBlocked]);

  const { hostLabel, isSecure, isInternal } = formatDisplayUrl(activeTab.url);
  const engineLabel = SEARCH_ENGINES[searchEngine]?.label ?? 'DuckDuckGo';

  const suggestions = useMemo(
    () =>
      isEditing && !isInternal
        ? buildOmniboxSuggestions(draft, historyEntries, bookmarks, 6)
        : [],
    [bookmarks, draft, historyEntries, isEditing, isInternal]
  );

  useEffect(() => {
    onSuggestionsVisibleChange(isEditing && !isInternal && suggestions.length > 0);
  }, [isEditing, isInternal, onSuggestionsVisibleChange, suggestions.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    setIsEditing(false);
    omniboxInputRef.current?.blur();
    onNavigate(clean);
  };

  const handleSelectSuggestion = (item: OmniboxSuggestion) => {
    setIsEditing(false);
    omniboxInputRef.current?.blur();
    onNavigate(item.navigateTarget);
  };

  return (
    <div className="topbar-wrap" ref={barRef} data-home={isInternal ? 'true' : 'false'}>
      <header className="topbar" role="toolbar" aria-label="Browser navigation">
        {isInternal ? (
          <>
            <button
              type="button"
              className="home-topbar-brand"
              aria-label="Open Aegis Shields"
              onClick={() => {
                onToggleMenu(false);
                onOpenDrawer('shields');
              }}
            >
              <AegisCrest size={24} />
              <span className="home-topbar-name">Aegis</span>
            </button>
            <div className="topbar-spacer" />
          </>
        ) : (
          <>
            <button
              type="button"
              className="nav-btn"
              aria-label="Back"
              disabled={!activeTab.canGoBack}
              onClick={onBack}
            >
              <BackIcon />
            </button>

            <button
              type="button"
              className="nav-btn desktop-only-btn"
              aria-label="Forward"
              disabled={!activeTab.canGoForward}
              onClick={onForward}
            >
              <ForwardIcon />
            </button>

            <button
              type="button"
              className="nav-btn desktop-only-btn"
              aria-label="Home"
              onClick={onGoHome}
            >
              <HomeIcon />
            </button>

            <form className="omnibox-pill" onSubmit={handleSubmit} role="search">
              <span
                className="omnibox-lock"
                data-secure={isSecure ? 'true' : 'false'}
                title={isSecure ? 'HTTPS Secure' : 'Not Encrypted'}
              >
                <LockIcon size={14} />
              </span>

              <label htmlFor="aegis-omnibox" className="sr-only">
                Search or enter website URL
              </label>
              <input
                id="aegis-omnibox"
                ref={omniboxInputRef}
                className="omnibox-input"
                type="text"
                inputMode="url"
                enterKeyHint="go"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={`Search ${engineLabel} or type URL`}
                value={isEditing ? draft : hostLabel}
                onFocus={() => {
                  onToggleMenu(false);
                  setIsEditing(true);
                  setDraft(activeTab.url);
                  window.setTimeout(() => omniboxInputRef.current?.select(), 0);
                }}
                onBlur={() => {
                  window.setTimeout(() => setIsEditing(false), 140);
                }}
                onChange={(e) => setDraft(e.target.value)}
              />

              {isEditing && draft.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="omnibox-inline-btn"
                    aria-label="Clear address"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setDraft('');
                      omniboxInputRef.current?.focus();
                    }}
                  >
                    <StopIcon size={15} />
                  </button>
                  <button
                    type="submit"
                    className="omnibox-go-chip"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    Go
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="omnibox-inline-btn omnibox-bookmark-btn"
                    data-bookmarked={isBookmarked ? 'true' : 'false'}
                    aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                    title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                    onClick={onToggleBookmark}
                  >
                    <BookmarkIcon size={16} filled={isBookmarked} />
                  </button>
                  <button
                    type="button"
                    className="omnibox-inline-btn"
                    aria-label={activeTab.isLoading ? 'Stop loading' : 'Reload page'}
                    onClick={onReloadOrStop}
                  >
                    {activeTab.isLoading ? <StopIcon size={16} /> : <ReloadIcon size={16} />}
                  </button>
                </>
              )}
            </form>
          </>
        )}

        <button
          type="button"
          className="shields-btn"
          data-active={shieldsEnabledForSite ? 'true' : 'false'}
          data-pulse={pulse ? 'true' : 'false'}
          aria-label={`Aegis Shields (${totalBlocked} blocked)`}
          aria-expanded={activeDrawer === 'shields'}
          onClick={() => {
            onToggleMenu(false);
            onOpenDrawer('shields');
          }}
        >
          <ShieldIcon size={15} />
          <span>{totalBlocked > 999 ? '999+' : totalBlocked}</span>
        </button>

        <button
          type="button"
          className="tabs-square-btn"
          aria-label={`Open tabs (${tabCount})`}
          aria-expanded={activeDrawer === 'tabs'}
          onClick={() => {
            onToggleMenu(false);
            onOpenDrawer('tabs');
          }}
        >
          <span className="tabs-square-num">{tabCount}</span>
        </button>

        <button
          type="button"
          className="nav-btn"
          aria-label="More options"
          aria-expanded={menuOpen}
          onClick={() => onToggleMenu(!menuOpen)}
        >
          <MoreVertIcon />
        </button>
      </header>

      {isEditing && !isInternal && suggestions.length > 0 && (
        <div className="omnibox-suggestions-sheet">
          <SuggestionDropdown
            variant="topbar"
            suggestions={suggestions}
            onSelect={handleSelectSuggestion}
            onFill={(text) => {
              setDraft(text);
              omniboxInputRef.current?.focus();
            }}
          />
        </div>
      )}

      {activeTab.isLoading && !isInternal && (
        <div
          className="loading-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={activeTab.progress}
        >
          <div
            className="loading-bar-fill"
            style={{ width: `${Math.max(8, activeTab.progress)}%` }}
          />
        </div>
      )}

      {menuOpen && (
        <div
          className="menu-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) onToggleMenu(false);
          }}
        >
          <nav className="overflow-menu" aria-label="Browser menu">
            <div className="menu-nav-row">
              <button
                type="button"
                className="menu-icon-tile"
                disabled={!activeTab.canGoForward}
                onClick={() => {
                  onForward();
                  onToggleMenu(false);
                }}
              >
                <ForwardIcon size={18} />
                <span>Forward</span>
              </button>
              <button
                type="button"
                className="menu-icon-tile"
                disabled={isInternal}
                onClick={() => {
                  onReloadOrStop();
                  onToggleMenu(false);
                }}
              >
                <ReloadIcon size={18} />
                <span>Reload</span>
              </button>
              <button
                type="button"
                className="menu-icon-tile"
                onClick={() => {
                  onGoHome();
                  onToggleMenu(false);
                }}
              >
                <HomeIcon size={18} />
                <span>Home</span>
              </button>
              <button
                type="button"
                className="menu-icon-tile"
                disabled={isInternal}
                onClick={() => {
                  onToggleBookmark();
                  onToggleMenu(false);
                }}
              >
                <BookmarkIcon size={18} filled={isBookmarked} />
                <span>{isBookmarked ? 'Saved' : 'Save'}</span>
              </button>
            </div>

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onToggleMenu(false);
                onOpenDrawer('bookmarks');
              }}
            >
              <span className="menu-item-left">
                <BookmarkIcon size={17} />
                <span>Bookmarks</span>
              </span>
            </button>

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onToggleMenu(false);
                onOpenDrawer('history');
              }}
            >
              <span className="menu-item-left">
                <HistoryIcon size={17} />
                <span>History</span>
              </span>
            </button>

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onToggleMenu(false);
                onOpenDrawer('downloads');
              }}
            >
              <span className="menu-item-left">
                <DownloadIcon size={17} />
                <span>Downloads</span>
              </span>
              {downloadsActiveCount > 0 && (
                <span className="menu-badge">{downloadsActiveCount}</span>
              )}
            </button>

            {!isInternal && (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  onToggleDesktopMode();
                  onToggleMenu(false);
                }}
              >
                <span className="menu-item-left">
                  <DesktopIcon size={17} />
                  <span>Desktop site</span>
                </span>
                <span className="menu-badge">{activeTab.desktopMode ? 'ON' : 'OFF'}</span>
              </button>
            )}

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onToggleMenu(false);
                onOpenDrawer('shields');
              }}
            >
              <span className="menu-item-left">
                <ShieldIcon size={17} />
                <span>Shields &amp; Filters</span>
              </span>
            </button>

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onToggleMenu(false);
                onOpenDrawer('settings');
              }}
            >
              <span className="menu-item-left">
                <SettingsIcon size={17} />
                <span>Settings</span>
              </span>
            </button>
          </nav>
        </div>
      )}
    </div>
  );
};
