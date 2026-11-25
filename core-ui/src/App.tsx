import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractHost, isHostShieldsEnabled } from './adblock/filterEngine';
import type {
  BookmarkItem,
  BrowserSettings,
  BrowserState,
  DownloadRecord,
  FilterSyncResult,
  HistoryEntry,
  SearchEngineId,
} from './adblock/types';
import { DEFAULT_SETTINGS, getBrowserBridge } from './bridge/nativeBridge';
import { registerWebOSBackHandler } from './bridge/webosAdapter';
import { BookmarksDrawer } from './components/BookmarksDrawer';
import { DownloadsDrawer } from './components/DownloadsDrawer';
import { HistoryDrawer } from './components/HistoryDrawer';
import { HomeStartPage } from './components/HomeStartPage';
import { LinkContextMenuSheet } from './components/LinkContextMenuSheet';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ShieldsPanel } from './components/ShieldsPanel';
import { TabsDrawer } from './components/TabsDrawer';
import { TopBar, type DrawerKind } from './components/TopBar';
import { UpdateModal } from './components/UpdateModal';
import { useDpadNavigation } from './hooks/useDpadNavigation';

const LEGACY_BOOKMARKS_KEY = 'aegis_bookmarks_v2';
const ENGINE_STORAGE_KEY = 'aegis_search_engine_v1';
const THEME_STORAGE_KEY = 'aegis_theme_v1';

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
  const [localEngine, setLocalEngine] = useState<SearchEngineId>(
    () => bridge.getState().searchEngine ?? loadFallbackSearchEngine()
  );
  const [activeDrawer, setActiveDrawer] = useState<DrawerKind | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [omniboxSuggestionsOpen, setOmniboxSuggestionsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<FilterSyncResult | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() =>
    bridge.getHistory()
  );
  const [downloadRecords, setDownloadRecords] = useState<DownloadRecord[]>(() =>
    bridge.getDownloads()
  );

  const barRef = useRef<HTMLDivElement>(null);
  const omniboxInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  // One-time migration from legacy localStorage bookmarks into native BrowserDataStore
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEGACY_BOOKMARKS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BookmarkItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter((b) => !b.url?.startsWith('aegis://player'));
          if (filtered.length > 0) {
            bridge.importLegacyBookmarks(filtered);
          }
        }
        localStorage.removeItem(LEGACY_BOOKMARKS_KEY);
      }
    } catch {
      // Ignore malformed legacy storage
    }
  }, [bridge]);

  const bookmarks = state.bookmarks ?? [];

  const settings: BrowserSettings = useMemo(
    () => ({
      ...DEFAULT_SETTINGS,
      ...(state.settings ?? {}),
      searchEngine: state.settings?.searchEngine ?? state.searchEngine ?? localEngine,
    }),
    [localEngine, state.searchEngine, state.settings]
  );
  const searchEngine: SearchEngineId = settings.searchEngine;

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, settings.theme);
    } catch {
      // Ignore storage quota issues
    }
  }, [settings.theme]);

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

  useEffect(() => {
    const prevVer = state.diagnostics?.updatedFromVersion;
    if (prevVer) {
      showToast(`Updated cleanly to v${state.appUpdate.installedVersion}`);
      bridge.acknowledgeUpdateToast();
    }
  }, [
    bridge,
    showToast,
    state.appUpdate.installedVersion,
    state.diagnostics?.updatedFromVersion,
  ]);

  useEffect(() => {
    const reported = new Set<string>();
    const onError = (ev: ErrorEvent) => {
      const msg = ev.message || 'Unhandled UI error';
      if (reported.has(msg)) return;
      reported.add(msg);
      bridge.reportUiError('CoreUI', msg);
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const msg =
        ev.reason instanceof Error
          ? ev.reason.message
          : String(ev.reason ?? 'Unhandled rejection');
      if (reported.has(msg)) return;
      reported.add(msg);
      bridge.reportUiError('CoreUI-Promise', msg);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [bridge]);

  const activeTab =
    state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];

  const isInternalPage = activeTab.url.startsWith('aegis://');
  const overlayExpanded =
    activeDrawer !== null ||
    menuOpen ||
    omniboxSuggestionsOpen ||
    Boolean(state.pendingContextMenu) ||
    isInternalPage ||
    state.appUpdate.popupVisible;

  useEffect(() => {
    const reportSize = () => {
      const barEl = barRef.current;
      const cssHeight = barEl ? barEl.getBoundingClientRect().height : 52;
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
  }, [
    bridge,
    overlayExpanded,
    activeTab.isLoading,
    activeTab.groupId,
    state.tabs.length,
    findBarOpen,
    state.pendingPermission,
    state.diagnostics?.hasUnacknowledgedCrash,
  ]);

  useEffect(() => {
    if (isInternalPage && findBarOpen) {
      setFindBarOpen(false);
    }
  }, [findBarOpen, isInternalPage]);

  useEffect(() => {
    window.__AEGIS_CLOSE_OVERLAY__ = () => {
      setMenuOpen(false);
      setActiveDrawer(null);
      setOmniboxSuggestionsOpen(false);
      bridge.dismissContextMenu();
      omniboxInputRef.current?.blur();
    };
    window.__AEGIS_FOCUS_OMNIBOX__ = () => {
      omniboxInputRef.current?.focus();
      omniboxInputRef.current?.select();
    };
    const unsubWebOS = registerWebOSBackHandler(() => {
      if (state.pendingContextMenu) bridge.dismissContextMenu();
      else if (menuOpen) setMenuOpen(false);
      else if (activeDrawer !== null) setActiveDrawer(null);
      else if (findBarOpen) {
        setFindBarOpen(false);
        bridge.clearFindInPage(activeTab.id);
      } else if (omniboxSuggestionsOpen) omniboxInputRef.current?.blur();
      else bridge.goBack(activeTab.id);
    });
    return () => unsubWebOS();
  }, [
    activeDrawer,
    activeTab.id,
    bridge,
    findBarOpen,
    menuOpen,
    omniboxSuggestionsOpen,
    state.pendingContextMenu,
  ]);

  const handleBackKey = useCallback(() => {
    if (state.appUpdate.popupVisible) {
      bridge.dismissUpdateModal();
    } else if (state.pendingContextMenu) {
      bridge.dismissContextMenu();
    } else if (menuOpen) {
      setMenuOpen(false);
    } else if (activeDrawer !== null) {
      setActiveDrawer(null);
    } else if (findBarOpen) {
      setFindBarOpen(false);
      bridge.clearFindInPage(activeTab.id);
    } else if (omniboxSuggestionsOpen) {
      omniboxInputRef.current?.blur();
    } else if (!isInternalPage) {
      bridge.goBack(activeTab.id);
    }
  }, [
    activeDrawer,
    activeTab.id,
    bridge,
    findBarOpen,
    isInternalPage,
    menuOpen,
    omniboxSuggestionsOpen,
    state.appUpdate.popupVisible,
    state.pendingContextMenu,
  ]);

  useDpadNavigation({
    onBack: handleBackKey,
    onExitDownToWebContent: !isInternalPage ? () => bridge.focusContent() : undefined,
  });

  // Sync History & Downloads so omnibox autocomplete and drawers stay fresh
  useEffect(() => {
    setHistoryEntries(bridge.getHistory());
    if (activeDrawer === 'downloads') {
      setDownloadRecords(bridge.getDownloads());
    }
  }, [
    activeDrawer,
    bridge,
    state.downloadsSummary?.activeCount,
    state.downloadsSummary?.totalCount,
    activeTab.url,
    activeTab.isLoading,
  ]);

  const handleUpdateSettings = (next: BrowserSettings) => {
    setLocalEngine(next.searchEngine);
    try {
      localStorage.setItem(ENGINE_STORAGE_KEY, next.searchEngine);
      localStorage.setItem(THEME_STORAGE_KEY, next.theme);
    } catch {
      // Ignore
    }
    bridge.updateSettings(next);
  };

  const handleChangeEngine = (engine: SearchEngineId) => {
    handleUpdateSettings({ ...settings, searchEngine: engine });
  };

  const currentHost = extractHost(activeTab.url);
  const shieldsEnabledForSite = isHostShieldsEnabled(state.shields, currentHost);
  const existingBookmark = bookmarks.find((b) => b.url === activeTab.url);
  const isBookmarked = Boolean(existingBookmark);

  const handleToggleCurrentBookmark = () => {
    if (isInternalPage) return;
    if (existingBookmark) {
      bridge.removeBookmark(existingBookmark.id);
      showToast('Bookmark removed');
    } else {
      bridge.addBookmark(activeTab.title || currentHost || activeTab.url, activeTab.url);
      showToast('Saved to bookmarks');
    }
  };

  return (
    <div
      className="aegis-shell"
      data-bar-only={!overlayExpanded ? 'true' : 'false'}
    >
      <TopBar
        activeTab={activeTab}
        allTabs={state.tabs}
        totalBlocked={state.telemetry.totalBlocked}
        downloadsActiveCount={state.downloadsSummary?.activeCount ?? 0}
        shieldsEnabledForSite={shieldsEnabledForSite}
        isBookmarked={isBookmarked}
        searchEngine={searchEngine}
        historyEntries={historyEntries}
        bookmarks={bookmarks}
        activeDrawer={activeDrawer}
        menuOpen={menuOpen}
        findBarOpen={findBarOpen}
        findState={state.findState ?? null}
        pendingPermission={state.pendingPermission ?? null}
        omniboxInputRef={omniboxInputRef}
        barRef={barRef}
        onToggleMenu={setMenuOpen}
        onSuggestionsVisibleChange={setOmniboxSuggestionsOpen}
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
        onToggleReaderMode={() => bridge.toggleReaderMode(activeTab.id)}
        onNewTab={() => bridge.createTab('aegis://home')}
        onNewIncognitoTab={() => bridge.createIncognitoTab('aegis://home')}
        onSwitchTab={(id) => bridge.switchTab(id)}
        onCloseTab={(id) => bridge.closeTab(id)}
        onAddTabToGroup={(sourceId) => bridge.openInTabGroup(sourceId, 'aegis://home', true)}
        onCopyCurrentUrl={() => {
          bridge.copyText(activeTab.url);
          showToast('Link copied');
        }}
        onShareCurrentUrl={() => bridge.shareUrl(activeTab.url, activeTab.title)}
        onOpenFindBar={() => setFindBarOpen(true)}
        onCloseFindBar={() => {
          setFindBarOpen(false);
          bridge.clearFindInPage(activeTab.id);
        }}
        onFindQueryChange={(q) => bridge.findInPage(activeTab.id, q)}
        onFindNext={(forward) => bridge.findNextMatch(activeTab.id, forward)}
        onRespondPermission={(id, allow) => bridge.respondPermissionPrompt(id, allow)}
        hasUnacknowledgedCrash={Boolean(state.diagnostics?.hasUnacknowledgedCrash)}
        onInspectCrashReport={() => {
          bridge.dismissCrashAlert();
          setActiveDrawer('settings');
        }}
        onDismissCrashAlert={() => bridge.dismissCrashAlert()}
        onOpenDrawer={(d) => setActiveDrawer((cur) => (cur === d ? null : d))}
      />

      {isInternalPage && (
        <HomeStartPage
          state={state}
          bookmarks={bookmarks}
          historyEntries={historyEntries}
          searchEngine={searchEngine}
          incognito={Boolean(activeTab.incognito)}
          onChangeEngine={handleChangeEngine}
          onOpenUrl={(url) => bridge.navigate(activeTab.id, url, searchEngine)}
          onAddFavorite={(title, url) => bridge.addBookmark(title, url)}
          onRemoveFavorite={(id) => bridge.removeBookmark(id)}
          onDismissRecommendation={(host) => bridge.dismissRecommendation(host)}
          onOpenIncognitoTab={() => bridge.createIncognitoTab('aegis://home')}
          onOpenShields={() => setActiveDrawer('shields')}
          onOpenBookmarks={() => setActiveDrawer('bookmarks')}
          onOpenHistory={() => setActiveDrawer('history')}
          onOpenDownloads={() => setActiveDrawer('downloads')}
          onOpenSettings={() => setActiveDrawer('settings')}
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
          canReopenClosedTab={Boolean(state.canReopenClosedTab)}
          onSelectTab={(id) => bridge.switchTab(id)}
          onCloseTab={(id) => bridge.closeTab(id)}
          onNewTab={() => {
            bridge.createTab('aegis://home');
            setActiveDrawer(null);
          }}
          onNewIncognitoTab={() => {
            bridge.createIncognitoTab('aegis://home');
            setActiveDrawer(null);
          }}
          onReopenClosedTab={() => bridge.reopenClosedTab()}
          onAddTabToGroup={(sourceId) => bridge.openInTabGroup(sourceId, 'aegis://home', true)}
          onUngroupTab={(tabId) => bridge.ungroupTab(tabId)}
          onCloseGroup={(groupId) => bridge.closeTabGroup(groupId)}
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
          searchEngine={searchEngine}
          onOpenBookmark={(url) => bridge.navigate(activeTab.id, url, searchEngine)}
          onAddBookmark={(title, url) => bridge.addBookmark(title, url)}
          onRemoveBookmark={(id) => bridge.removeBookmark(id)}
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {activeDrawer === 'history' && (
        <HistoryDrawer
          entries={historyEntries}
          saveHistoryEnabled={settings.saveHistory}
          onNavigate={(url) => bridge.navigate(activeTab.id, url, searchEngine)}
          onDeleteItem={(id) => {
            bridge.deleteHistoryItem(id);
            setHistoryEntries(bridge.getHistory());
          }}
          onClearAll={() => {
            bridge.clearHistory();
            setHistoryEntries([]);
          }}
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {activeDrawer === 'downloads' && (
        <DownloadsDrawer
          records={downloadRecords}
          onOpenFile={(id) => bridge.openDownloadedFile(id)}
          onOpenSystemDownloads={() => bridge.openSystemDownloads()}
          onRemoveRecord={(id) => {
            bridge.removeDownload(id);
            setDownloadRecords(bridge.getDownloads());
          }}
          onClearCompleted={() => {
            bridge.clearCompletedDownloads();
            setDownloadRecords(bridge.getDownloads());
          }}
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {activeDrawer === 'settings' && (
        <SettingsDrawer
          settings={settings}
          appVersion={state.appUpdate.installedVersion}
          githubRepo={state.appUpdate.githubRepo}
          checkingUpdate={state.appUpdate.status === 'checking'}
          diagnostics={state.diagnostics}
          onUpdateSettings={handleUpdateSettings}
          onClearHistory={() => {
            bridge.clearHistory();
            setHistoryEntries([]);
          }}
          onClearCacheAndCookies={() => bridge.clearCacheAndCookies()}
          onCheckForUpdates={() => bridge.checkForUpdates(true)}
          onOpenShields={() => setActiveDrawer('shields')}
          onCopyDiagnostics={() => {
            if (state.diagnostics?.reportText) {
              bridge.copyText(state.diagnostics.reportText);
            }
          }}
          onEmailDiagnostics={() => bridge.sendCrashEmail()}
          onOpenIssue={() => bridge.openCrashIssueTab()}
          onClearDiagnostics={() => bridge.clearDiagnostics()}
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

      {state.pendingContextMenu && (
        <LinkContextMenuSheet
          menu={state.pendingContextMenu}
          onOpenNewTab={(url) => bridge.createTab(url)}
          onOpenInGroup={(sourceId, url) => bridge.openInTabGroup(sourceId, url, false)}
          onOpenIncognito={(url) => bridge.createIncognitoTab(url)}
          onCopyLink={(url) => {
            bridge.copyText(url);
            showToast('Link copied');
          }}
          onShareLink={(url, title) => bridge.shareUrl(url, title)}
          onDownload={(url) => {
            bridge.downloadUrl(url);
            showToast('Download started');
          }}
          onDismiss={() => bridge.dismissContextMenu()}
        />
      )}

      {toastMsg && (
        <div className="aegis-toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
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
