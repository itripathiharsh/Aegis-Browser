import React, { useEffect, useRef, useState } from 'react';
import type { SearchEngineId, TabInfo } from '../adblock/types';
import { formatDisplayUrl } from '../utils/urlResolver';
import {
  BackIcon,
  BookmarkIcon,
  ForwardIcon,
  HomeIcon,
  LockIcon,
  ReloadIcon,
  ShieldIcon,
  StopIcon,
  TabsIcon,
} from './Icons';

interface TopBarProps {
  activeTab: TabInfo;
  tabCount: number;
  totalBlocked: number;
  shieldsEnabledForSite: boolean;
  isBookmarked: boolean;
  searchEngine: SearchEngineId;
  activeDrawer: 'tabs' | 'bookmarks' | 'shields' | null;
  omniboxInputRef: React.RefObject<HTMLInputElement>;
  barRef: React.RefObject<HTMLElement>;
  onNavigate: (rawInput: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onGoHome: () => void;
  onToggleBookmark: () => void;
  onOpenDrawer: (drawer: 'tabs' | 'bookmarks' | 'shields') => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  tabCount,
  totalBlocked,
  shieldsEnabledForSite,
  isBookmarked,
  searchEngine,
  activeDrawer,
  omniboxInputRef,
  barRef,
  onNavigate,
  onBack,
  onForward,
  onReloadOrStop,
  onGoHome,
  onToggleBookmark,
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditing(false);
    omniboxInputRef.current?.blur();
    onNavigate(draft.trim() || 'aegis://home');
  };

  return (
    <header ref={barRef} className="topbar" aria-label="Browser navigation controls">
      <div className="topbar-nav-group">
        <button
          type="button"
          className="icon-btn"
          aria-label="Go back"
          disabled={!activeTab.canGoBack && isInternal}
          onClick={onBack}
        >
          <BackIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Go forward"
          disabled={!activeTab.canGoForward}
          onClick={onForward}
        >
          <ForwardIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label={activeTab.isLoading ? 'Stop loading' : 'Reload page'}
          disabled={isInternal}
          onClick={onReloadOrStop}
        >
          {activeTab.isLoading ? <StopIcon /> : <ReloadIcon />}
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Home start page"
          aria-pressed={activeTab.url === 'aegis://home'}
          onClick={onGoHome}
        >
          <HomeIcon />
        </button>
      </div>

      <form className="omnibox-form" onSubmit={handleSubmit} role="search">
        <span
          className="omnibox-status-icon"
          data-secure={isSecure ? 'true' : 'false'}
          title={isSecure ? 'Encrypted or internal Aegis page' : 'Unencrypted HTTP'}
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
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          placeholder={`Search ${searchEngine} or enter URL / .m3u8`}
          onFocus={(e) => {
            setIsEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setIsEditing(false)}
          onChange={(e) => setDraft(e.target.value)}
        />

        {!isInternal && (
          <button
            type="button"
            className="icon-btn"
            aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            aria-pressed={isBookmarked}
            onClick={onToggleBookmark}
          >
            <BookmarkIcon filled={isBookmarked} />
          </button>
        )}

        <button type="submit" className="omnibox-go-btn">
          Go
        </button>
      </form>

      <div className="topbar-actions-group">
        <button
          type="button"
          className="icon-btn"
          aria-label={`Open tabs switcher (${tabCount} open)`}
          aria-expanded={activeDrawer === 'tabs'}
          onClick={() => onOpenDrawer('tabs')}
        >
          <TabsIcon />
          <span className="btn-label-sm">{tabCount}</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Open bookmarks"
          aria-expanded={activeDrawer === 'bookmarks'}
          onClick={() => onOpenDrawer('bookmarks')}
        >
          <BookmarkIcon />
        </button>

        <button
          type="button"
          className="shields-pill"
          data-active={shieldsEnabledForSite ? 'true' : 'false'}
          data-pulse={pulse ? 'true' : 'false'}
          aria-label={`Aegis Shields: ${totalBlocked} ads and trackers blocked`}
          aria-expanded={activeDrawer === 'shields'}
          onClick={() => onOpenDrawer('shields')}
        >
          <ShieldIcon size={16} />
          <span>Shields</span>
          <span className="shields-count" aria-live="polite">
            {totalBlocked.toLocaleString()}
          </span>
        </button>
      </div>

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
    </header>
  );
};
