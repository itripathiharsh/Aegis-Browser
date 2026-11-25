import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractHost, isHostShieldsEnabled } from './adblock/filterEngine';
import type {
  BookmarkItem,
  BrowserState,
  FilterSyncResult,
  SearchEngineId,
} from './adblock/types';
import { getBrowserBridge } from './bridge/nativeBridge';
import { registerWebOSBackHandler } from './bridge/webosAdapter';
import { BookmarksDrawer } from './components/BookmarksDrawer';
import { HomeStartPage } from './components/HomeStartPage';
import { ShieldsPanel } from './components/ShieldsPanel';
import { StreamPlayerView } from './components/StreamPlayerView';
import { TabsDrawer } from './components/TabsDrawer';
import { TopBar } from './components/TopBar';
import { UpdateModal } from './components/UpdateModal';
import { useDpadNavigation } from './hooks/useDpadNavigation';

const BOOKMARKS_STORAGE_KEY = 'aegis_bookmarks_v2';
const ENGINE_STORAGE_KEY = 'aegis_search_engine_v1';

const DEFAULT_BOOKMARKS: BookmarkItem[] = [
  {
    id: 'bm-yt',
    title: 'YouTube',
    url: 'https://m.youtube.com',
    tag: 'Video',
    pinned: true,
  },
  {
    id: 'bm-wiki',
    title: 'Wikipedia',
    url: 'https://en.wikipedia.org',
    tag: 'Wiki',
    pinned: true,
  },
  {
    id: 'bm-github',
    title: 'GitHub',
    url: 'https://github.com',
    tag: 'Code',
    pinned: true,
  },
  {
    id: 'bm-reddit',
    title: 'Reddit',
    url: 'https://www.reddit.com',
    tag: 'Social',
    pinned: true,
  },
  {
    id: 'bm-bbc',
    title: 'BBC News',
    url: 'https://www.bbc.com',
    tag: 'News',
    pinned: true,
  },
  {
    id: 'bm-hls',
    title: 'Stream Player',
    url: 'aegis://player',
    tag: 'Video',
    pinned: true,
  },
];

function loadBookmarks(): BookmarkItem[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return DEFAULT_BOOKMARKS;
    const parsed = JSON.parse(raw) as BookmarkItem[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_BOOKMARKS;
  } catch {
    return DEFAULT_BOOKMARKS;
  }
}

function loadFallbackSearchEngine(): SearchEngineId {
  try {
    const raw = localStorage.getItem(ENGINE_STORAGE_KEY) as SearchEngineId | null;
    return raw ?? 'duckduckgo';
  } catch {
    return 'duckduckgo';
  }
}

export const App: React.FC = () => {
  const bridge = useMemo(() => getBrowserBridge(), []);
  const [state, setState] = useState<BrowserState>(() => bridge.getState());
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(loadBookmarks);
  const [localEngine, setLocalEngine] = useState<SearchEngineId>(
    () => bridge.getState().searchEngine ?? loadFallbackSearchEngine()
  );
  const [activeDrawer, setActiveDrawer] = useState<
    'tabs' | 'bookmarks' | 'shields' | null
  >(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<FilterSyncResult | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const omniboxInputRef = useRef<HTMLInputElement>(null);

  const searchEngine: SearchEngineId = state.searchEngine ?? localEngine;

  useEffect(() => {
    const unsubState = bridge.subscribe((next) => {
      setState(next);
      if (next.searchEngine) {
        setLocalEngine(next.searchEngine);
      }
    });
    const unsubSync = bridge.onSyncResult((res) => {
      setIsSyncing(false);
      setSyncStatus(res);
    });
    return () => {
      unsubState();
      unsubSync();
    };
  }, [bridge]);

  const activeTab =
    state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];

  const isInternalPage = activeTab.url.startsWith('aegis://');
  const overlayExpanded =
    activeDrawer !== null ||
    menuOpen ||
    isInternalPage ||
    state.appUpdate.popupVisible;

  useEffect(() => {
    const reportSize = () => {
      const barEl = barRef.current;
      const cssHeight = barEl ? barEl.getBoundingClientRect().height : 56;
      const physicalPx = Math.ceil(cssHeight * (window.devicePixelRatio || 1));
      bridge.setOverlayExpanded(overlayExpanded, physicalPx);
    };
    reportSize();
    const ro =
      typeof ResizeObserver !== 'undefined' && barRef.current
        ? new ResizeObserver(reportSize)
        : null;
    if (ro && barRef.current) ro.observe(barRef.current);
    return () => ro?.disconnect();
  }, [bridge, overlayExpanded, activeTab.isLoading]);

  useEffect(() => {
    window.__AEGIS_CLOSE_OVERLAY__ = () => {
      setMenuOpen(false);
      setActiveDrawer(null);
    };
    window.__AEGIS_FOCUS_OMNIBOX__ = () => {
      omniboxInputRef.current?.focus();
      omniboxInputRef.current?.select();
    };
    const unsubWebOS = registerWebOSBackHandler(() => {
      if (menuOpen) setMenuOpen(false);
      else if (activeDrawer !== null) setActiveDrawer(null);
      else bridge.goBack(activeTab.id);
    });
    return () => unsubWebOS();
  }, [activeDrawer, activeTab.id, bridge, menuOpen]);

  const handleBackKey = useCallback(() => {
    if (state.appUpdate.popupVisible) {
      bridge.dismissUpdateModal();
    } else if (menuOpen) {
      setMenuOpen(false);
    } else if (activeDrawer !== null) {
      setActiveDrawer(null);
    } else if (!isInternalPage) {
      bridge.goBack(activeTab.id);
    }
  }, [activeDrawer, activeTab.id, bridge, isInternalPage, menuOpen, state.appUpdate.popupVisible]);

  useDpadNavigation({
    onBack: handleBackKey,
    onExitDownToWebContent: !isInternalPage ? () => bridge.focusContent() : undefined,
  });

  const persistBookmarks = (next: BookmarkItem[]) => {
    setBookmarks(next);
    try {
      localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota issues
    }
  };

  const handleChangeEngine = (engine: SearchEngineId) => {
    setLocalEngine(engine);
    try {
      localStorage.setItem(ENGINE_STORAGE_KEY, engine);
    } catch {
      // Ignore
    }
    bridge.setSearchEngine(engine);
  };

  const currentHost = extractHost(activeTab.url);
  const shieldsEnabledForSite = isHostShieldsEnabled(state.shields, currentHost);
  const isBookmarked = bookmarks.some((b) => b.url === activeTab.url);

  const handleToggleCurrentBookmark = () => {
    if (isInternalPage) return;
    if (isBookmarked) {
      persistBookmarks(bookmarks.filter((b) => b.url !== activeTab.url));
    } else {
      persistBookmarks([
        {
          id: `bm-${Date.now()}`,
          title: activeTab.title || currentHost || activeTab.url,
          url: activeTab.url,
          tag: 'Saved',
        },
        ...bookmarks,
      ]);
    }
  };

  return (
    <div
      className="aegis-shell"
      data-bar-only={!overlayExpanded ? 'true' : 'false'}
    >
      <TopBar
        activeTab={activeTab}
        tabCount={state.tabs.length}
        totalBlocked={state.telemetry.totalBlocked}
        shieldsEnabledForSite={shieldsEnabledForSite}
        isBookmarked={isBookmarked}
        searchEngine={searchEngine}
        activeDrawer={activeDrawer}
        menuOpen={menuOpen}
        omniboxInputRef={omniboxInputRef}
        barRef={barRef}
        onToggleMenu={setMenuOpen}
        onNavigate={(raw) => bridge.navigate(activeTab.id, raw, searchEngine)}
        onBack={() => bridge.goBack(activeTab.id)}
        onForward={() => bridge.goForward(activeTab.id)}
        onReloadOrStop={() =>
          activeTab.isLoading
            ? bridge.stopLoading(activeTab.id)
            : bridge.reload(activeTab.id)
        }
        onGoHome={() => bridge.navigate(activeTab.id, 'aegis://home', searchEngine)}
        onToggleBookmark={handleToggleCurrentBookmark}
        onToggleDesktopMode={() =>
          bridge.setDesktopMode(activeTab.id, !activeTab.desktopMode)
        }
        onCheckUpdates={() => bridge.checkForUpdates(true)}
        onOpenDrawer={(d) => setActiveDrawer((cur) => (cur === d ? null : d))}
      />

      {activeTab.url === 'aegis://home' && (
        <HomeStartPage
          state={state}
          bookmarks={bookmarks}
          searchEngine={searchEngine}
          onChangeEngine={handleChangeEngine}
          onOpenUrl={(url) => bridge.navigate(activeTab.id, url, searchEngine)}
          onOpenShields={() => setActiveDrawer('shields')}
          onOpenBookmarks={() => setActiveDrawer('bookmarks')}
        />
      )}

      {activeTab.url.startsWith('aegis://player') && (
        <StreamPlayerView
          url={activeTab.url}
          onBackHome={() => bridge.navigate(activeTab.id, 'aegis://home', searchEngine)}
          onOpenStreamUrl={(u) => bridge.navigate(activeTab.id, u, searchEngine)}
        />
      )}

      {!isInternalPage && !bridge.isNativeAndroid && (
        <main className="main-stage" id="main">
          <div className="preview-card">
            <h1 className="section-title">
              Web Viewport — {activeTab.title}
            </h1>
            <p className="row-meta">{activeTab.url}</p>
            <p className="stat-label">
              Renders inside the hardware-accelerated Android WebView with{' '}
              {(
                state.filterStats.domainRuleCount +
                state.filterStats.patternRuleCount
              ).toLocaleString()}{' '}
              active ad-block rules.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="primary-btn"
                onClick={() => setActiveDrawer('shields')}
              >
                Shields ({state.telemetry.totalBlocked} blocked)
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => bridge.navigate(activeTab.id, 'aegis://home')}
              >
                Home
              </button>
            </div>
          </div>
        </main>
      )}

      {activeDrawer === 'tabs' && (
        <TabsDrawer
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          onSelectTab={(id) => bridge.switchTab(id)}
          onCloseTab={(id) => bridge.closeTab(id)}
          onNewTab={() => {
            bridge.createTab('aegis://home');
            setActiveDrawer(null);
          }}
          onToggleDesktopMode={(tab) =>
            bridge.setDesktopMode(tab.id, !tab.desktopMode)
          }
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {activeDrawer === 'bookmarks' && (
        <BookmarksDrawer
          bookmarks={bookmarks}
          currentUrl={activeTab.url}
          currentTitle={activeTab.title}
          onOpenBookmark={(url) => bridge.navigate(activeTab.id, url, searchEngine)}
          onAddBookmark={(title, url) =>
            persistBookmarks([
              { id: `bm-${Date.now()}`, title, url, tag: 'Saved' },
              ...bookmarks,
            ])
          }
          onRemoveBookmark={(id) =>
            persistBookmarks(bookmarks.filter((b) => b.id !== id))
          }
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {activeDrawer === 'shields' && (
        <ShieldsPanel
          state={state}
          currentUrl={activeTab.url}
          syncStatus={syncStatus}
          isSyncing={isSyncing}
          onUpdateConfig={(cfg) => bridge.setShieldsConfig(cfg)}
          onToggleSite={(host, enabled) => bridge.toggleSiteShields(host, enabled)}
          onSyncFilters={() => {
            setIsSyncing(true);
            void bridge.syncFilterLists();
          }}
          onCheckUpdates={() => bridge.checkForUpdates(true)}
          onTestUrl={(u, host) => bridge.testUrl(u, host)}
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {state.appUpdate.popupVisible && (
        <UpdateModal
          update={state.appUpdate}
          onUpdateNow={() => bridge.downloadAndInstallUpdate()}
          onCancelDownload={() => bridge.cancelUpdateDownload()}
          onRetryInstall={() => bridge.retryPendingInstall()}
          onLater={() => bridge.dismissUpdateModal()}
        />
      )}
    </div>
  );
};

export default App;
