import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BookmarkItem,
  FindState,
  HistoryEntry,
  PendingPermissionPrompt,
  SearchEngineId,
  TabInfo,
} from '../adblock/types';
import { buildOmniboxSuggestions, type OmniboxSuggestion } from '../utils/suggestions';
import { SEARCH_ENGINES, formatDisplayUrl } from '../utils/urlResolver';
import {
  CopyIcon,
  DownloadIcon,
  FindPageIcon,
  HistoryIcon,
  IncognitoIcon,
  ReaderIcon,
  SettingsIcon,
  ShareIcon,
} from './BrowserIcons';
import { FindBar } from './FindBar';
import {
  AegisCrest,
  BackIcon,
  BookmarkIcon,
  DesktopIcon,
  ForwardIcon,
  HomeIcon,
  LockIcon,
  MoreVertIcon,
  PlusIcon,
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
  allTabs: TabInfo[];
  totalBlocked: number;
  downloadsActiveCount?: number;
  shieldsEnabledForSite: boolean;
  isBookmarked: boolean;
  searchEngine: SearchEngineId;
  historyEntries: HistoryEntry[];
  bookmarks: BookmarkItem[];
  activeDrawer: DrawerKind | null;
  menuOpen: boolean;
  findBarOpen: boolean;
  findState: FindState | null;
  pendingPermission: PendingPermissionPrompt | null;
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
  onToggleReaderMode: () => void;
  onNewTab: () => void;
  onNewIncognitoTab: () => void;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTabToGroup: (sourceTabId: string) => void;
  onCopyCurrentUrl: () => void;
  onShareCurrentUrl: () => void;
  onOpenFindBar: () => void;
  onCloseFindBar: () => void;
  onFindQueryChange: (q: string) => void;
  onFindNext: (forward: boolean) => void;
  onRespondPermission: (id: string, allow: boolean) => void;
  hasUnacknowledgedCrash?: boolean;
  onInspectCrashReport?: () => void;
  onDismissCrashAlert?: () => void;
  onOpenDrawer: (drawer: DrawerKind) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  allTabs,
  totalBlocked,
  downloadsActiveCount = 0,
  shieldsEnabledForSite,
  isBookmarked,
  searchEngine,
  historyEntries,
  bookmarks,
  activeDrawer,
  menuOpen,
  findBarOpen,
  findState,
  pendingPermission,
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
  onToggleReaderMode,
  onNewTab,
  onNewIncognitoTab,
  onSwitchTab,
  onCloseTab,
  onAddTabToGroup,
  onCopyCurrentUrl,
  onShareCurrentUrl,
  onOpenFindBar,
  onCloseFindBar,
  onFindQueryChange,
  onFindNext,
  onRespondPermission,
  hasUnacknowledgedCrash,
  onInspectCrashReport,
  onDismissCrashAlert,
  onOpenDrawer,
}) => {
  const [draft, setDraft] = useState('');
  const [findQuery, setFindQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [pulse, setPulse] = useState(false);
  const prevBlockedRef = useRef(totalBlocked);

  useEffect(() => {
    if (!isEditing) {
      setDraft(activeTab.url === 'aegis://home' ? '' : activeTab.url);
    }
  }, [activeTab.url, isEditing]);

  useEffect(() => {
    if (!findBarOpen) setFindQuery('');
  }, [findBarOpen]);

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
  const groupTabs = useMemo(
    () => (activeTab.groupId ? allTabs.filter((t) => t.groupId === activeTab.groupId) : []),
    [activeTab.groupId, allTabs]
  );

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
    <div
      className="topbar-wrap"
      ref={barRef}
      data-home={isInternal ? 'true' : 'false'}
      data-incognito={activeTab.incognito ? 'true' : 'false'}
    >
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
              {activeTab.incognito ? (
                <span className="incognito-pill-badge">
                  <IncognitoIcon size={15} />
                  <span>Private Mode</span>
                </span>
              ) : (
                <>
                  <AegisCrest size={24} />
                  <span className="home-topbar-name">Aegis Browser</span>
                </>
              )}
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
                data-secure={activeTab.incognito ? 'incognito' : isSecure ? 'true' : 'false'}
                title={activeTab.incognito ? 'Incognito Session' : isSecure ? 'HTTPS Secure' : 'Not Encrypted'}
              >
                {activeTab.incognito ? <IncognitoIcon size={14} /> : <LockIcon size={14} />}
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
          aria-label={`Open tabs (${allTabs.length})`}
          aria-expanded={activeDrawer === 'tabs'}
          onClick={() => {
            onToggleMenu(false);
            onOpenDrawer('tabs');
          }}
        >
          <span className="tabs-square-num">{allTabs.length}</span>
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

      {/* Brave-style Tab Group Strip when active tab belongs to a group */}
      {groupTabs.length > 0 && (
        <div
          className="tab-group-strip"
          style={{ '--group-accent': activeTab.groupColor || '#3B82F6' } as React.CSSProperties}
          aria-label="Tab group switcher"
        >
          <span className="tab-group-strip-badge">
            <span className="tab-group-dot" />
            <span>{activeTab.groupTitle || 'Group'}</span>
          </span>
          <div className="tab-group-pills">
            {groupTabs.map((t) => {
              const active = t.id === activeTab.id;
              return (
                <div
                  key={t.id}
                  className="tab-group-pill"
                  data-active={active ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    className="tab-group-pill-btn"
                    onClick={() => onSwitchTab(t.id)}
                  >
                    {t.title || 'New Tab'}
                  </button>
                  <button
                    type="button"
                    className="tab-group-pill-close"
                    aria-label={`Close grouped tab ${t.title}`}
                    onClick={() => onCloseTab(t.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="tab-group-add-btn"
            aria-label="Open new tab in this group"
            onClick={() => onAddTabToGroup(activeTab.id)}
          >
            <PlusIcon size={15} />
          </button>
        </div>
      )}

      {findBarOpen && !isInternal && (
        <FindBar
          query={findQuery}
          activeOrdinal={findState?.activeOrdinal ?? 0}
          totalMatches={findState?.totalMatches ?? 0}
          onQueryChange={(q) => {
            setFindQuery(q);
            onFindQueryChange(q);
          }}
          onFindNext={onFindNext}
          onClose={onCloseFindBar}
        />
      )}

      {hasUnacknowledgedCrash && (
        <div className="perm-banner" role="status" aria-label="Previous crash recovery">
          <div className="perm-banner-text">
            Aegis recovered from an unexpected error on the previous run.
          </div>
          <div className="perm-banner-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={onDismissCrashAlert}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={onInspectCrashReport}
            >
              Report
            </button>
          </div>
        </div>
      )}

      {pendingPermission && (
        <div className="perm-banner" role="alertdialog" aria-label="Site permission request">
          <div className="perm-banner-text">
            <strong>{pendingPermission.origin}</strong> requests access to{' '}
            <span>{pendingPermission.label}</span>
          </div>
          <div className="perm-banner-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => onRespondPermission(pendingPermission.id, false)}
            >
              Block
            </button>
            <button
              type="button"
              className="primary-btn"
              style={{ minHeight: '36px' }}
              onClick={() => onRespondPermission(pendingPermission.id, true)}
            >
              Allow
            </button>
          </div>
        </div>
      )}

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
            <div className="menu-nav-row menu-nav-row-5">
              <button
                type="button"
                className="menu-icon-tile"
                disabled={!activeTab.canGoForward}
                onClick={() => {
                  onForward();
                  onToggleMenu(false);
                }}
              >
                <ForwardIcon size={17} />
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
                <ReloadIcon size={17} />
                <span>Reload</span>
              </button>
              <button
                type="button"
                className="menu-icon-tile"
                disabled={isInternal}
                onClick={() => {
                  onShareCurrentUrl();
                  onToggleMenu(false);
                }}
              >
                <ShareIcon size={17} />
                <span>Share</span>
              </button>
              <button
                type="button"
                className="menu-icon-tile"
                disabled={isInternal}
                onClick={() => {
                  onCopyCurrentUrl();
                  onToggleMenu(false);
                }}
              >
                <CopyIcon size={17} />
                <span>Copy</span>
              </button>
              <button
                type="button"
                className="menu-icon-tile"
                onClick={() => {
                  onGoHome();
                  onToggleMenu(false);
                }}
              >
                <HomeIcon size={17} />
                <span>Home</span>
              </button>
            </div>

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onNewTab();
                onToggleMenu(false);
              }}
            >
              <span className="menu-item-left">
                <PlusIcon size={17} />
                <span>New Tab</span>
              </span>
            </button>

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onNewIncognitoTab();
                onToggleMenu(false);
              }}
            >
              <span className="menu-item-left">
                <IncognitoIcon size={17} />
                <span>New Incognito Tab</span>
              </span>
            </button>

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
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    onOpenFindBar();
                    onToggleMenu(false);
                  }}
                >
                  <span className="menu-item-left">
                    <FindPageIcon size={17} />
                    <span>Find in page</span>
                  </span>
                </button>

                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    onToggleReaderMode();
                    onToggleMenu(false);
                  }}
                >
                  <span className="menu-item-left">
                    <ReaderIcon size={17} />
                    <span>Reader view</span>
                  </span>
                  <span className="menu-badge">{activeTab.readerMode ? 'ON' : 'OFF'}</span>
                </button>

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
              </>
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
