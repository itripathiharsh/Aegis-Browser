import React, { useEffect, useRef, useState } from 'react';
import type { SearchEngineId, TabInfo } from '../adblock/types';
import { SEARCH_ENGINES, formatDisplayUrl } from '../utils/urlResolver';
import {
  DownloadIcon,
  HistoryIcon,
  SettingsIcon,
} from './BrowserIcons';
import {
  BackIcon,
  BookmarkIcon,
  DesktopIcon,
  ForwardIcon,
  HomeIcon,
  LockIcon,
  MoreVertIcon,
  PlayIcon,
  ReloadIcon,
  ShieldIcon,
  StopIcon,
} from './Icons';

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
  activeDrawer: DrawerKind | null;
  menuOpen: boolean;
  omniboxInputRef: React.RefObject<HTMLInputElement>;
  barRef: React.RefObject<HTMLDivElement>;
  onToggleMenu: (open: boolean) => void;
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
  activeDrawer,
  menuOpen,
  omniboxInputRef,
  barRef,
  onToggleMenu,
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
      const timer = setTimeout(() => setPulse(false), 450);
      prevBlockedRef.current = totalBlocked;
      return () => clearTimeout(timer);
    }
    prevBlockedRef.current = totalBlocked;
  }, [totalBlocked]);

  const { isSecure, isInternal } = formatDisplayUrl(activeTab.url);
  const engineLabel = SEARCH_ENGINES[searchEngine]?.label ?? 'Search';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditing(false);
    omniboxInputRef.current?.blur();
    onNavigate(draft.trim() || 'aegis://home');
  };

  return (
    <div ref={barRef} className="topbar-wrap">
      <header className="topbar" aria-label="Browser navigation controls">
        <button
          type="button"
          className="nav-btn"
          aria-label="Go back"
          disabled={!activeTab.canGoBack && isInternal}
          onClick={onBack}
        >
          <BackIcon />
        </button>

        <button
          type="button"
          className="nav-btn desktop-only-btn"
          aria-label="Go forward"
          disabled={!activeTab.canGoForward}
          onClick={onForward}
        >
          <ForwardIcon />
        </button>

        <button
          type="button"
          className="nav-btn desktop-only-btn"
          aria-label="Home start page"
          onClick={onGoHome}
        >
          <HomeIcon />
        </button>

        <form className="omnibox-pill" onSubmit={handleSubmit} role="search">
          <span
            className="omnibox-lock"
            data-secure={isSecure ? 'true' : 'false'}
            title={isSecure ? 'Secure connection' : 'Not encrypted (HTTP)'}
          >
            <LockIcon />
          </span>

          <label htmlFor="aegis-omnibox" className="sr-only">
            Address or search query
          </label>
          <input
            id="aegis-omnibox"
            ref={omniboxInputRef}
            className="omnibox-input"
            type="text"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={draft}
            placeholder={`Search ${engineLabel} or URL`}
            onFocus={(e) => {
              setIsEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => {
              setTimeout(() => setIsEditing(false), 120);
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
            !isInternal && (
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
            )
          )}
        </form>

        <button
          type="button"
          className="shields-btn"
          data-active={shieldsEnabledForSite ? 'true' : 'false'}
          data-pulse={pulse ? 'true' : 'false'}
          aria-label={`Aegis Shields: ${totalBlocked} blocked`}
          aria-expanded={activeDrawer === 'shields'}
          onClick={() => {
            onToggleMenu(false);
            onOpenDrawer('shields');
          }}
        >
          <ShieldIcon size={16} />
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

      {activeTab.isLoading && (
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
                onNavigate('aegis://player');
                onToggleMenu(false);
              }}
            >
              <span className="menu-item-left">
                <PlayIcon size={17} />
                <span>Stream Player</span>
              </span>
            </button>

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
