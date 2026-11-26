import { FilterEngine, extractHost } from '../adblock/filterEngine';
import type {
  AppUpdateState,
  BlockCategory,
  BlockDecision,
  BlockedEvent,
  BookmarkItem,
  BrowserSettings,
  BrowserState,
  DiagnosticsState,
  DownloadRecord,
  FilterSource,
  FilterSyncResult,
  HistoryEntry,
  RecommendedSite,
  SearchEngineId,
  ShieldsConfig,
  TabInfo,
} from '../adblock/types';
import {
  loadBundledAndCachedFilters,
  syncRemoteFilterMirrors,
} from '../adblock/updater';
import { NIVROK_APP_VERSION, NIVROK_GITHUB_REPO } from '../config/updaterConfig';
import { isNewerVersion, pickApkAsset, type GithubReleaseAsset } from '../utils/semver';
import { resolveOmniboxInput } from '../utils/urlResolver';
import {
  fetchWebOSProxyStats,
  isWebOSRuntime,
  reportWebOSProxyBlocked,
  startWebOSProxyService,
  syncWebOSProxyShields,
  type WebOSNativeHost,
} from './webosAdapter';

interface AndroidNativeHost extends WebOSNativeHost {
  setOverlayExpanded(expanded: boolean, barHeightPx: number): void;
  focusContent(): void;
  setSearchEngine?(engineId: string): void;
  updateSettings?(settingsJson: string): void;
  getHistory?(): string;
  deleteHistoryItem?(id: string): void;
  clearHistory?(): void;
  dismissRecommendation?(host: string): void;
  getBookmarks?(): string;
  addBookmark?(title: string, url: string, tag?: string): void;
  removeBookmark?(id: string): void;
  importLegacyBookmarks?(jsonStr: string): void;
  createIncognitoTab?(url?: string): void;
  openInTabGroup?(sourceTabId: string, url: string, makeActive: boolean): void;
  renameTabGroup?(groupId: string, title: string): void;
  ungroupTab?(tabId: string): void;
  closeTabGroup?(groupId: string): void;
  reopenClosedTab?(): void;
  shareUrl?(url: string, title?: string): void;
  copyText?(text: string): void;
  findInPage?(tabId: string, query: string): void;
  findNextMatch?(tabId: string, forward: boolean): void;
  clearFindInPage?(tabId: string): void;
  toggleReaderMode?(tabId: string): void;
  dismissContextMenu?(): void;
  downloadUrl?(url: string): void;
  openDownloadedFile?(id: string): void;
  respondPermissionPrompt?(id: string, allow: boolean): void;
  getDownloads?(): string;
  openSystemDownloads?(): void;
  removeDownload?(id: string): void;
  clearCompletedDownloads?(): void;
  clearCacheAndCookies?(): void;
  checkForUpdates(manual: boolean): void;
  downloadAndInstallUpdate(): void;
  cancelUpdateDownload(): void;
  dismissUpdateModal(): void;
  retryPendingInstall(): void;
  dismissCrashAlert?(): void;
  clearDiagnostics?(): void;
  acknowledgeUpdateToast?(): void;
  reportUiError?(source: string, message: string): void;
  sendCrashEmail?(): void;
  openCrashIssueTab?(): void;
}

declare global {
  interface Window {
    NivrokNative?: AndroidNativeHost;
    __NIVROK_ON_STATE__?: (state: BrowserState) => void;
    __NIVROK_ON_SYNC__?: (result: FilterSyncResult) => void;
    __NIVROK_CLOSE_OVERLAY__?: () => void;
    __NIVROK_FOCUS_OMNIBOX__?: () => void;
  }
}

export interface BrowserBridge {
  readonly isNativeAndroid: boolean;
  subscribe(onState: (state: BrowserState) => void): () => void;
  onSyncResult(cb: (res: FilterSyncResult) => void): () => void;
  getState(): BrowserState;
  navigate(tabId: string, rawInput: string, engine?: SearchEngineId): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stopLoading(tabId: string): void;
  createTab(url?: string): void;
  createIncognitoTab(url?: string): void;
  openInTabGroup(sourceTabId: string, url: string, makeActive?: boolean): void;
  renameTabGroup(groupId: string, title: string): void;
  ungroupTab(tabId: string): void;
  closeTabGroup(groupId: string): void;
  reopenClosedTab(): void;
  switchTab(tabId: string): void;
  closeTab(tabId: string): void;
  setDesktopMode(tabId: string, desktop: boolean): void;
  toggleReaderMode(tabId: string): void;
  findInPage(tabId: string, query: string): void;
  findNextMatch(tabId: string, forward: boolean): void;
  clearFindInPage(tabId: string): void;
  dismissContextMenu(): void;
  respondPermissionPrompt(id: string, allow: boolean): void;
  shareUrl(url: string, title?: string): void;
  copyText(text: string): void;
  getBookmarks(): BookmarkItem[];
  addBookmark(title: string, url: string, tag?: string): void;
  removeBookmark(id: string): void;
  importLegacyBookmarks(items: BookmarkItem[]): void;
  setShieldsConfig(config: ShieldsConfig): void;
  toggleSiteShields(host: string, enabled: boolean): void;
  syncFilterLists(): Promise<void>;
  testUrl(url: string, pageHost: string): BlockDecision;
  setOverlayExpanded(expanded: boolean, barHeightPx: number): void;
  focusContent(): void;
  setSearchEngine(engineId: SearchEngineId): void;
  updateSettings(next: BrowserSettings): void;
  getHistory(): HistoryEntry[];
  deleteHistoryItem(id: string): void;
  clearHistory(): void;
  dismissRecommendation(host: string): void;
  getDownloads(): DownloadRecord[];
  downloadUrl(url: string): void;
  openDownloadedFile(id: string): void;
  openSystemDownloads(): void;
  removeDownload(id: string): void;
  clearCompletedDownloads(): void;
  clearCacheAndCookies(): void;
  checkForUpdates(manual: boolean): void;
  downloadAndInstallUpdate(): void;
  cancelUpdateDownload(): void;
  dismissUpdateModal(): void;
  retryPendingInstall(): void;
  dismissCrashAlert(): void;
  clearDiagnostics(): void;
  acknowledgeUpdateToast(): void;
  reportUiError(source: string, message: string): void;
  sendCrashEmail(): void;
  openCrashIssueTab(): void;
  notifyWebOSPageMeta?(tabId: string, url: string, title?: string): void;
  recordWebOSBlocked?(url: string, pageUrl: string, category: BlockCategory): void;
  retryWebOSProxy?(): void;
}

const DEFAULT_SHIELDS: ShieldsConfig = {
  enabled: true,
  blockAdsAndTrackers: true,
  blockPopups: true,
  cosmeticFiltering: true,
  disabledHosts: [],
};

const DEFAULT_UPDATE_STATE: AppUpdateState = {
  status: 'idle',
  popupVisible: false,
  installedVersion: NIVROK_APP_VERSION,
  installedVersionCode: 1,
  githubRepo: NIVROK_GITHUB_REPO,
  latestVersion: null,
  releaseTitle: null,
  changelog: null,
  downloadUrl: null,
  assetName: null,
  assetSizeBytes: 0,
  downloadedBytes: 0,
  progressPercent: 0,
  message: null,
  checkedAtIso: null,
};

const DEFAULT_DIAGNOSTICS: DiagnosticsState = {
  hasUnacknowledgedCrash: false,
  lastCrashSummary: null,
  lastCrashIso: null,
  lastCrashVersion: null,
  updatedFromVersion: null,
  nonFatalCount: 0,
  recentErrors: [],
  reportText: 'Nivrok Diagnostics\nStatus: Clean (no crashes recorded).',
};

export const DEFAULT_SETTINGS: BrowserSettings = {
  searchEngine: 'duckduckgo',
  theme: 'dark',
  blockThirdPartyCookies: true,
  defaultDesktopMode: false,
  showRecommendations: true,
  autoSyncFilters: true,
  saveHistory: true,
  textZoom: 100,
  allowSitePermissionPrompts: true,
  restoreTabsOnStart: true,
};

const DEFAULT_PREVIEW_BOOKMARKS: BookmarkItem[] = [
  { id: 'bm-yt', title: 'YouTube', url: 'https://m.youtube.com', tag: 'Video', pinned: true },
  { id: 'bm-wiki', title: 'Wikipedia', url: 'https://en.wikipedia.org', tag: 'Wiki', pinned: true },
  { id: 'bm-github', title: 'GitHub', url: 'https://github.com', tag: 'Code', pinned: true },
  { id: 'bm-reddit', title: 'Reddit', url: 'https://www.reddit.com', tag: 'Social', pinned: true },
  { id: 'bm-bbc', title: 'BBC News', url: 'https://www.bbc.com', tag: 'News', pinned: true },
];

function normalizeBrowserState(raw: BrowserState): BrowserState {
  const settings: BrowserSettings = {
    ...DEFAULT_SETTINGS,
    ...(raw.settings ?? {}),
    searchEngine: raw.settings?.searchEngine ?? raw.searchEngine ?? DEFAULT_SETTINGS.searchEngine,
    textZoom: raw.settings?.textZoom ?? DEFAULT_SETTINGS.textZoom,
  };
  return {
    ...raw,
    searchEngine: settings.searchEngine,
    settings,
    bookmarks: raw.bookmarks ?? [],
    canReopenClosedTab: raw.canReopenClosedTab ?? false,
    recommendations: raw.recommendations ?? [],
    downloadsSummary: raw.downloadsSummary ?? { activeCount: 0, totalCount: 0 },
    pendingContextMenu: raw.pendingContextMenu ?? null,
    findState: raw.findState ?? null,
    pendingPermission: raw.pendingPermission ?? null,
    appUpdate: raw.appUpdate ?? { ...DEFAULT_UPDATE_STATE },
    diagnostics: raw.diagnostics ?? { ...DEFAULT_DIAGNOSTICS },
  };
}

class NativeAndroidOrWebOSBridge implements BrowserBridge {
  readonly isNativeAndroid: boolean;
  private host: AndroidNativeHost | WebOSNativeHost;
  private listeners = new Set<(state: BrowserState) => void>();
  private syncListeners = new Set<(res: FilterSyncResult) => void>();
  private cachedState: BrowserState;

  constructor(host: AndroidNativeHost | WebOSNativeHost, isAndroid: boolean) {
    this.host = host;
    this.isNativeAndroid = isAndroid;
    this.cachedState = normalizeBrowserState(
      JSON.parse(host.getInitialState()) as BrowserState
    );

    window.__NIVROK_ON_STATE__ = (nextState: BrowserState) => {
      this.cachedState = normalizeBrowserState(nextState);
      this.listeners.forEach((fn) => fn(this.cachedState));
    };
    window.__NIVROK_ON_SYNC__ = (result: FilterSyncResult) => {
      this.syncListeners.forEach((fn) => fn(result));
    };
  }

  subscribe(onState: (state: BrowserState) => void): () => void {
    this.listeners.add(onState);
    onState(this.cachedState);
    return () => this.listeners.delete(onState);
  }

  onSyncResult(cb: (res: FilterSyncResult) => void): () => void {
    this.syncListeners.add(cb);
    return () => this.syncListeners.delete(cb);
  }

  getState(): BrowserState {
    return this.cachedState;
  }

  navigate(tabId: string, rawInput: string, engine: SearchEngineId = 'duckduckgo'): void {
    const resolved =
      rawInput.startsWith('nivrok://') || rawInput.startsWith('aegis://')
        ? 'nivrok://home'
        : resolveOmniboxInput(rawInput, engine);
    this.host.navigate(tabId, resolved);
  }

  goBack(tabId: string): void {
    this.host.goBack(tabId);
  }

  goForward(tabId: string): void {
    this.host.goForward(tabId);
  }

  reload(tabId: string): void {
    this.host.reload(tabId);
  }

  stopLoading(tabId: string): void {
    this.host.stopLoading(tabId);
  }

  createTab(url?: string): void {
    this.host.createTab(url ?? 'nivrok://home');
  }

  createIncognitoTab(url?: string): void {
    if ('createIncognitoTab' in this.host && typeof this.host.createIncognitoTab === 'function') {
      this.host.createIncognitoTab(url ?? 'nivrok://home');
    }
  }

  openInTabGroup(sourceTabId: string, url: string, makeActive = false): void {
    if ('openInTabGroup' in this.host && typeof this.host.openInTabGroup === 'function') {
      this.host.openInTabGroup(sourceTabId, url, makeActive);
    }
  }

  renameTabGroup(groupId: string, title: string): void {
    if ('renameTabGroup' in this.host && typeof this.host.renameTabGroup === 'function') {
      this.host.renameTabGroup(groupId, title);
    }
  }

  ungroupTab(tabId: string): void {
    if ('ungroupTab' in this.host && typeof this.host.ungroupTab === 'function') {
      this.host.ungroupTab(tabId);
    }
  }

  closeTabGroup(groupId: string): void {
    if ('closeTabGroup' in this.host && typeof this.host.closeTabGroup === 'function') {
      this.host.closeTabGroup(groupId);
    }
  }

  reopenClosedTab(): void {
    if ('reopenClosedTab' in this.host && typeof this.host.reopenClosedTab === 'function') {
      this.host.reopenClosedTab();
    }
  }

  switchTab(tabId: string): void {
    this.host.switchTab(tabId);
  }

  closeTab(tabId: string): void {
    this.host.closeTab(tabId);
  }

  setDesktopMode(tabId: string, desktop: boolean): void {
    this.host.setDesktopMode(tabId, desktop);
  }

  toggleReaderMode(tabId: string): void {
    if ('toggleReaderMode' in this.host && typeof this.host.toggleReaderMode === 'function') {
      this.host.toggleReaderMode(tabId);
    }
  }

  findInPage(tabId: string, query: string): void {
    if ('findInPage' in this.host && typeof this.host.findInPage === 'function') {
      this.host.findInPage(tabId, query);
    }
  }

  findNextMatch(tabId: string, forward: boolean): void {
    if ('findNextMatch' in this.host && typeof this.host.findNextMatch === 'function') {
      this.host.findNextMatch(tabId, forward);
    }
  }

  clearFindInPage(tabId: string): void {
    if ('clearFindInPage' in this.host && typeof this.host.clearFindInPage === 'function') {
      this.host.clearFindInPage(tabId);
    }
  }

  dismissContextMenu(): void {
    if ('dismissContextMenu' in this.host && typeof this.host.dismissContextMenu === 'function') {
      this.host.dismissContextMenu();
    }
  }

  respondPermissionPrompt(id: string, allow: boolean): void {
    if (
      'respondPermissionPrompt' in this.host &&
      typeof this.host.respondPermissionPrompt === 'function'
    ) {
      this.host.respondPermissionPrompt(id, allow);
    }
  }

  shareUrl(url: string, title?: string): void {
    if ('shareUrl' in this.host && typeof this.host.shareUrl === 'function') {
      this.host.shareUrl(url, title ?? '');
    }
  }

  copyText(text: string): void {
    if ('copyText' in this.host && typeof this.host.copyText === 'function') {
      this.host.copyText(text);
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }

  getBookmarks(): BookmarkItem[] {
    if ('getBookmarks' in this.host && typeof this.host.getBookmarks === 'function') {
      try {
        const parsed = JSON.parse(this.host.getBookmarks()) as BookmarkItem[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return this.cachedState.bookmarks ?? [];
  }

  addBookmark(title: string, url: string, tag = 'Saved'): void {
    if ('addBookmark' in this.host && typeof this.host.addBookmark === 'function') {
      this.host.addBookmark(title, url, tag);
    }
  }

  removeBookmark(id: string): void {
    if ('removeBookmark' in this.host && typeof this.host.removeBookmark === 'function') {
      this.host.removeBookmark(id);
    }
  }

  importLegacyBookmarks(items: BookmarkItem[]): void {
    if (
      'importLegacyBookmarks' in this.host &&
      typeof this.host.importLegacyBookmarks === 'function'
    ) {
      this.host.importLegacyBookmarks(JSON.stringify(items));
    }
  }

  setShieldsConfig(config: ShieldsConfig): void {
    this.host.setShieldsConfig(JSON.stringify(config));
  }

  toggleSiteShields(host: string, enabled: boolean): void {
    this.host.toggleSiteShields(host, enabled);
  }

  async syncFilterLists(): Promise<void> {
    this.host.syncFilterLists();
  }

  testUrl(url: string, pageHost: string): BlockDecision {
    return JSON.parse(this.host.testUrlAgainstFilters(url, pageHost)) as BlockDecision;
  }

  setOverlayExpanded(expanded: boolean, barHeightPx: number): void {
    if ('setOverlayExpanded' in this.host) {
      this.host.setOverlayExpanded(expanded, barHeightPx);
    }
  }

  focusContent(): void {
    if ('focusContent' in this.host) {
      this.host.focusContent();
    }
  }

  setSearchEngine(engineId: SearchEngineId): void {
    if ('setSearchEngine' in this.host && typeof this.host.setSearchEngine === 'function') {
      this.host.setSearchEngine(engineId);
    }
  }

  updateSettings(next: BrowserSettings): void {
    this.cachedState = normalizeBrowserState({
      ...this.cachedState,
      searchEngine: next.searchEngine,
      settings: next,
    });
    this.listeners.forEach((fn) => fn(this.cachedState));
    if ('updateSettings' in this.host && typeof this.host.updateSettings === 'function') {
      this.host.updateSettings(JSON.stringify(next));
    } else {
      this.setSearchEngine(next.searchEngine);
    }
  }

  getHistory(): HistoryEntry[] {
    if ('getHistory' in this.host && typeof this.host.getHistory === 'function') {
      try {
        const parsed = JSON.parse(this.host.getHistory()) as HistoryEntry[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  deleteHistoryItem(id: string): void {
    if ('deleteHistoryItem' in this.host && typeof this.host.deleteHistoryItem === 'function') {
      this.host.deleteHistoryItem(id);
    }
  }

  clearHistory(): void {
    if ('clearHistory' in this.host && typeof this.host.clearHistory === 'function') {
      this.host.clearHistory();
    }
  }

  dismissRecommendation(host: string): void {
    if (
      'dismissRecommendation' in this.host &&
      typeof this.host.dismissRecommendation === 'function'
    ) {
      this.host.dismissRecommendation(host);
    }
  }

  getDownloads(): DownloadRecord[] {
    if ('getDownloads' in this.host && typeof this.host.getDownloads === 'function') {
      try {
        const parsed = JSON.parse(this.host.getDownloads()) as DownloadRecord[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  downloadUrl(url: string): void {
    if ('downloadUrl' in this.host && typeof this.host.downloadUrl === 'function') {
      this.host.downloadUrl(url);
    }
  }

  openDownloadedFile(id: string): void {
    if ('openDownloadedFile' in this.host && typeof this.host.openDownloadedFile === 'function') {
      this.host.openDownloadedFile(id);
    }
  }

  openSystemDownloads(): void {
    if ('openSystemDownloads' in this.host && typeof this.host.openSystemDownloads === 'function') {
      this.host.openSystemDownloads();
    }
  }

  removeDownload(id: string): void {
    if ('removeDownload' in this.host && typeof this.host.removeDownload === 'function') {
      this.host.removeDownload(id);
    }
  }

  clearCompletedDownloads(): void {
    if (
      'clearCompletedDownloads' in this.host &&
      typeof this.host.clearCompletedDownloads === 'function'
    ) {
      this.host.clearCompletedDownloads();
    }
  }

  clearCacheAndCookies(): void {
    if (
      'clearCacheAndCookies' in this.host &&
      typeof this.host.clearCacheAndCookies === 'function'
    ) {
      this.host.clearCacheAndCookies();
    }
  }

  checkForUpdates(manual: boolean): void {
    this.host.checkForUpdates?.(manual);
  }

  downloadAndInstallUpdate(): void {
    this.host.downloadAndInstallUpdate?.();
  }

  cancelUpdateDownload(): void {
    this.host.cancelUpdateDownload?.();
  }

  dismissUpdateModal(): void {
    this.host.dismissUpdateModal?.();
  }

  retryPendingInstall(): void {
    this.host.retryPendingInstall?.();
  }

  dismissCrashAlert(): void {
    if ('dismissCrashAlert' in this.host && typeof this.host.dismissCrashAlert === 'function') {
      this.host.dismissCrashAlert();
    }
  }

  clearDiagnostics(): void {
    if ('clearDiagnostics' in this.host && typeof this.host.clearDiagnostics === 'function') {
      this.host.clearDiagnostics();
    }
  }

  acknowledgeUpdateToast(): void {
    if (
      'acknowledgeUpdateToast' in this.host &&
      typeof this.host.acknowledgeUpdateToast === 'function'
    ) {
      this.host.acknowledgeUpdateToast();
    }
  }

  reportUiError(source: string, message: string): void {
    if ('reportUiError' in this.host && typeof this.host.reportUiError === 'function') {
      this.host.reportUiError(source, message);
    }
  }

  sendCrashEmail(): void {
    if ('sendCrashEmail' in this.host && typeof this.host.sendCrashEmail === 'function') {
      this.host.sendCrashEmail();
    }
  }

  openCrashIssueTab(): void {
    if ('openCrashIssueTab' in this.host && typeof this.host.openCrashIssueTab === 'function') {
      this.host.openCrashIssueTab();
    }
  }
}

const WEB_STORAGE_KEYS = {
  bookmarks: 'nivrok_web_bookmarks_v1',
  history: 'nivrok_web_history_v1',
  recs: 'nivrok_web_recs_v1',
  settings: 'nivrok_web_settings_v1',
  shields: 'nivrok_web_shields_v1',
  tabs: 'nivrok_web_tabs_v1',
};

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or SSR errors
  }
}

function isExcludedRecommendationHost(cleanHost: string): boolean {
  return (
    cleanHost === 'duckduckgo.com' ||
    cleanHost === 'search.brave.com' ||
    cleanHost === 'brave.com' ||
    cleanHost.startsWith('google.') ||
    cleanHost === 'startpage.com' ||
    cleanHost === 'bing.com' ||
    /^(new\d+|ad\d*|ads\d*|pop\d*|redir\d*|clk\d*|trk\d*)\./.test(cleanHost)
  );
}

class StandalonePreviewBridge implements BrowserBridge {
  readonly isNativeAndroid = false;
  private filterEngine = new FilterEngine();
  private listeners = new Set<(state: BrowserState) => void>();
  private syncListeners = new Set<(res: FilterSyncResult) => void>();
  private sources: FilterSource[] = [];
  private history: HistoryEntry[] = [];
  private recMap = new Map<string, RecommendedSite>();
  private downloads: DownloadRecord[] = [];
  private closedStack: TabInfo[] = [];
  private navStacks = new Map<string, { stack: string[]; index: number }>();
  private webosStatsTimer: number | null = null;
  private state: BrowserState;

  constructor() {
    const webos = isWebOSRuntime();
    const savedSettings = {
      ...DEFAULT_SETTINGS,
      ...safeReadJson<Partial<BrowserSettings>>(WEB_STORAGE_KEYS.settings, {}),
    };
    const savedShields: ShieldsConfig = {
      ...DEFAULT_SHIELDS,
      ...safeReadJson<Partial<ShieldsConfig>>(WEB_STORAGE_KEYS.shields, {}),
    };
    const savedBookmarks = safeReadJson<BookmarkItem[]>(
      WEB_STORAGE_KEYS.bookmarks,
      DEFAULT_PREVIEW_BOOKMARKS
    );
    this.history = safeReadJson<HistoryEntry[]>(WEB_STORAGE_KEYS.history, []).slice(0, 200);
    const savedRecs = safeReadJson<RecommendedSite[]>(WEB_STORAGE_KEYS.recs, []);
    for (const r of savedRecs) {
      if (r && r.host) this.recMap.set(r.host, r);
    }

    const defaultTab: TabInfo = {
      id: 'tab-1',
      title: 'Nivrok Start',
      url: 'nivrok://home',
      isLoading: false,
      progress: 100,
      canGoBack: false,
      canGoForward: false,
      desktopMode: savedSettings.defaultDesktopMode,
      incognito: false,
      readerMode: false,
      groupId: null,
      groupTitle: null,
      groupColor: null,
      blockedCount: 0,
      navNonce: 1,
      commitUrl: 'nivrok://home',
    };

    let restoredTabs: TabInfo[] = [defaultTab];
    let restoredActiveId = defaultTab.id;
    if (savedSettings.restoreTabsOnStart) {
      const savedTabDump = safeReadJson<{ activeTabId?: string; tabs?: TabInfo[] } | null>(
        WEB_STORAGE_KEYS.tabs,
        null
      );
      if (savedTabDump?.tabs && savedTabDump.tabs.length > 0) {
        const cleanTabs = savedTabDump.tabs
          .filter((t) => t && !t.incognito)
          .map((t) => ({
            ...t,
            isLoading: false,
            progress: 100,
            canGoBack: false,
            canGoForward: false,
            navNonce: 1,
            commitUrl: t.url || 'nivrok://home',
          }));
        if (cleanTabs.length > 0) {
          restoredTabs = cleanTabs;
          restoredActiveId = cleanTabs.some((t) => t.id === savedTabDump.activeTabId)
            ? (savedTabDump.activeTabId as string)
            : cleanTabs[0].id;
        }
      }
    }

    for (const t of restoredTabs) {
      this.navStacks.set(t.id, { stack: [t.url || 'nivrok://home'], index: 0 });
    }

    this.state = {
      platform: webos ? 'webos' : 'web',
      searchEngine: savedSettings.searchEngine,
      settings: savedSettings,
      activeTabId: restoredActiveId,
      tabs: restoredTabs,
      bookmarks: savedBookmarks.length > 0 ? savedBookmarks : [...DEFAULT_PREVIEW_BOOKMARKS],
      canReopenClosedTab: false,
      recommendations: [],
      downloadsSummary: { activeCount: 0, totalCount: 0 },
      pendingContextMenu: null,
      findState: null,
      pendingPermission: null,
      shields: savedShields,
      filterStats: this.filterEngine.getStats(),
      filterSources: [],
      telemetry: {
        totalBlocked: 0,
        adsBlocked: 0,
        trackersBlocked: 0,
        popupsBlocked: 0,
        recentEvents: [],
      },
      appUpdate: { ...DEFAULT_UPDATE_STATE },
      diagnostics: { ...DEFAULT_DIAGNOSTICS },
      webosProxyUrl: null,
      webosProxyError: null,
    };
    this.state.recommendations = this.buildPreviewRecommendations();

    void this.initFilters();
    if (webos) {
      void this.initWebOSProxy();
    }
  }

  private persistLocal(): void {
    if (typeof window === 'undefined') return;
    safeWriteJson(WEB_STORAGE_KEYS.bookmarks, this.state.bookmarks ?? []);
    safeWriteJson(WEB_STORAGE_KEYS.history, this.history.slice(0, 200));
    safeWriteJson(WEB_STORAGE_KEYS.recs, Array.from(this.recMap.values()).slice(0, 40));
    safeWriteJson(WEB_STORAGE_KEYS.settings, this.state.settings ?? DEFAULT_SETTINGS);
    safeWriteJson(WEB_STORAGE_KEYS.shields, this.state.shields);
    const nonPrivateTabs = this.state.tabs.filter((t) => !t.incognito);
    safeWriteJson(WEB_STORAGE_KEYS.tabs, {
      activeTabId: this.state.activeTabId,
      tabs: nonPrivateTabs.length > 0 ? nonPrivateTabs : [this.state.tabs[0]],
    });
  }

  private async initWebOSProxy(): Promise<void> {
    try {
      const res = await startWebOSProxyService();
      if (res && res.returnValue && res.baseUrl) {
        this.state = {
          ...this.state,
          webosProxyUrl: res.baseUrl,
          webosProxyError: null,
          filterStats:
            res.filterStats && res.filterStats.domainRuleCount > 0
              ? res.filterStats
              : this.state.filterStats,
        };
        this.emit();
        void syncWebOSProxyShields(this.state.shields, res.baseUrl);
        if (this.webosStatsTimer === null && typeof window !== 'undefined') {
          this.webosStatsTimer = window.setInterval(() => {
            void this.refreshWebOSStats();
          }, 3500);
        }
      } else {
        this.state = {
          ...this.state,
          webosProxyError: 'Loopback proxy service not reachable on Luna bus.',
        };
        this.emit();
      }
    } catch (err) {
      this.state = {
        ...this.state,
        webosProxyError: err instanceof Error ? err.message : String(err),
      };
      this.emit();
    }
  }

  retryWebOSProxy(): void {
    this.state = { ...this.state, webosProxyError: null };
    this.emit();
    void this.initWebOSProxy();
  }

  private async refreshWebOSStats(): Promise<void> {
    const res = await fetchWebOSProxyStats(this.state.webosProxyUrl);
    if (!res || !res.telemetry) return;
    if (
      res.telemetry.totalBlocked === this.state.telemetry.totalBlocked &&
      res.telemetry.popupsBlocked === this.state.telemetry.popupsBlocked
    ) {
      return;
    }
    this.state = {
      ...this.state,
      telemetry: res.telemetry,
      filterStats: res.filterStats ?? this.state.filterStats,
      tabs: this.state.tabs.map((t) =>
        t.id === this.state.activeTabId
          ? { ...t, blockedCount: res.telemetry!.totalBlocked }
          : t
      ),
    };
    this.emit();
  }

  notifyWebOSPageMeta(tabId: string, pageUrl: string, title?: string): void {
    if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return;
    const host = extractHost(pageUrl) ?? pageUrl;
    const target = this.state.tabs.find((t) => t.id === tabId);
    if (!target) return;

    let stackEntry = this.navStacks.get(tabId);
    if (!stackEntry) {
      stackEntry = { stack: [target.url], index: 0 };
      this.navStacks.set(tabId, stackEntry);
    }
    if (stackEntry.stack[stackEntry.index] !== pageUrl) {
      stackEntry.stack = stackEntry.stack.slice(0, stackEntry.index + 1);
      stackEntry.stack.push(pageUrl);
      stackEntry.index = stackEntry.stack.length - 1;
    }

    if (!target.incognito) {
      this.recordVisitHistory(pageUrl, title || host.replace(/^www\./, ''), host);
    }

    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              url: pageUrl,
              title: title?.trim() || host,
              canGoBack: stackEntry!.index > 0,
              canGoForward: stackEntry!.index < stackEntry!.stack.length - 1,
            }
          : t
      ),
      recommendations: this.buildPreviewRecommendations(),
    };
    this.persistLocal();
    this.emit();
  }

  recordWebOSBlocked(url: string, pageUrl: string, category: BlockCategory): void {
    const nextTelemetry = { ...this.state.telemetry };
    nextTelemetry.totalBlocked += 1;
    if (category === 'trackers') nextTelemetry.trackersBlocked += 1;
    else if (category === 'popups') nextTelemetry.popupsBlocked += 1;
    else nextTelemetry.adsBlocked += 1;
    nextTelemetry.recentEvents = [
      {
        url,
        host: extractHost(url) ?? url,
        pageHost: extractHost(pageUrl) ?? '',
        rule: 'webos-scriptlet-guard',
        category,
        timestampMs: Date.now(),
      },
      ...nextTelemetry.recentEvents,
    ].slice(0, 30);

    this.state = { ...this.state, telemetry: nextTelemetry };
    this.emit();
    void reportWebOSProxyBlocked(url, pageUrl, category);
  }

  private recordVisitHistory(resolved: string, title: string, host: string): void {
    const now = Date.now();
    if (this.state.settings?.saveHistory ?? true) {
      this.history = [
        {
          id: `h-${now}-${Math.random().toString(36).slice(2, 6)}`,
          url: resolved,
          title,
          host,
          visitedAtMs: now,
        },
        ...this.history.filter((h, i) => !(i === 0 && h.url === resolved)),
      ].slice(0, 200);
    }
    const cleanHost = host.replace(/^www\./, '').toLowerCase();
    if (!isExcludedRecommendationHost(cleanHost)) {
      const prev = this.recMap.get(host);
      this.recMap.set(host, {
        url: resolved.length <= 90 ? resolved : `https://${host}/`,
        title: cleanHost,
        host,
        visits: (prev?.visits ?? 0) + 1,
        lastVisitedMs: now,
      });
    }
  }

  private async initFilters() {
    const { sources } = await loadBundledAndCachedFilters(this.filterEngine);
    this.sources = sources;
    this.state = {
      ...this.state,
      filterSources: sources,
      filterStats:
        this.state.filterStats.domainRuleCount > 0
          ? this.state.filterStats
          : this.filterEngine.getStats(),
    };
    this.emit();
  }

  private buildPreviewRecommendations(): RecommendedSite[] {
    if (this.state.settings && !this.state.settings.showRecommendations) return [];
    return Array.from(this.recMap.values())
      .sort((a, b) => b.visits - a.visits || b.lastVisitedMs - a.lastVisitedMs)
      .slice(0, 8);
  }

  private emit() {
    this.listeners.forEach((fn) => fn(this.state));
  }

  subscribe(onState: (state: BrowserState) => void): () => void {
    this.listeners.add(onState);
    onState(this.state);
    return () => this.listeners.delete(onState);
  }

  onSyncResult(cb: (res: FilterSyncResult) => void): () => void {
    this.syncListeners.add(cb);
    return () => this.syncListeners.delete(cb);
  }

  getState(): BrowserState {
    return this.state;
  }

  navigate(tabId: string, rawInput: string, engine: SearchEngineId = 'duckduckgo'): void {
    const resolved = resolveOmniboxInput(rawInput, engine);
    const activeTarget = this.state.tabs.find((t) => t.id === tabId);
    let stackEntry = this.navStacks.get(tabId);
    if (!stackEntry) {
      stackEntry = { stack: [activeTarget?.url ?? 'nivrok://home'], index: 0 };
      this.navStacks.set(tabId, stackEntry);
    }
    if (stackEntry.stack[stackEntry.index] !== resolved) {
      stackEntry.stack = stackEntry.stack.slice(0, stackEntry.index + 1);
      stackEntry.stack.push(resolved);
      stackEntry.index = stackEntry.stack.length - 1;
    }

    const tabs = this.state.tabs.map((t) => {
      if (t.id !== tabId) return t;
      const host = extractHost(resolved);
      return {
        ...t,
        url: resolved,
        commitUrl: resolved,
        navNonce: (t.navNonce ?? 0) + 1,
        title:
          resolved === 'nivrok://home'
            ? t.incognito
              ? 'Private Tab'
              : 'Nivrok Start'
            : host ?? resolved,
        canGoBack: stackEntry!.index > 0,
        canGoForward: false,
        isLoading: false,
        progress: 100,
      };
    });

    const nextTelemetry = { ...this.state.telemetry };
    if (this.state.platform === 'web' && !resolved.startsWith('nivrok://')) {
      const sampleProbes = [
        'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
        'https://www.google-analytics.com/g/collect?v=2',
        'https://serve.popads.net/pop.js',
      ];
      const newEvents: BlockedEvent[] = [];
      for (const probe of sampleProbes) {
        const res = this.filterEngine.evaluate(probe, resolved, this.state.shields, true);
        if (res.blocked && res.matchedRule) {
          nextTelemetry.totalBlocked += 1;
          if (res.category === 'trackers') nextTelemetry.trackersBlocked += 1;
          else if (res.category === 'popups') nextTelemetry.popupsBlocked += 1;
          else nextTelemetry.adsBlocked += 1;
          newEvents.push({
            url: probe,
            host: extractHost(probe) ?? probe,
            pageHost: extractHost(resolved) ?? '',
            rule: res.matchedRule,
            category: res.category,
            timestampMs: Date.now(),
          });
        }
      }
      nextTelemetry.recentEvents = [...newEvents, ...nextTelemetry.recentEvents].slice(0, 30);
    }

    if (!resolved.startsWith('nivrok://') && !activeTarget?.incognito) {
      const host = extractHost(resolved) ?? resolved;
      this.recordVisitHistory(resolved, host.replace(/^www\./, ''), host);
    }

    this.state = {
      ...this.state,
      tabs: tabs.map((t) =>
        t.id === tabId && !resolved.startsWith('nivrok://')
          ? { ...t, blockedCount: nextTelemetry.totalBlocked }
          : t
      ),
      recommendations: this.buildPreviewRecommendations(),
      telemetry: nextTelemetry,
    };
    this.persistLocal();
    this.emit();
    if (this.state.platform === 'webos') {
      window.setTimeout(() => void this.refreshWebOSStats(), 1200);
    }
  }

  goBack(tabId: string): void {
    const entry = this.navStacks.get(tabId);
    if (!entry || entry.index <= 0) {
      this.navigate(tabId, 'nivrok://home');
      return;
    }
    entry.index -= 1;
    const prevUrl = entry.stack[entry.index] ?? 'nivrok://home';
    const host = extractHost(prevUrl);
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              url: prevUrl,
              commitUrl: prevUrl,
              navNonce: (t.navNonce ?? 0) + 1,
              title: prevUrl === 'nivrok://home' ? 'Nivrok Start' : host ?? prevUrl,
              canGoBack: entry.index > 0,
              canGoForward: entry.index < entry.stack.length - 1,
            }
          : t
      ),
    };
    this.persistLocal();
    this.emit();
  }

  goForward(tabId: string): void {
    const entry = this.navStacks.get(tabId);
    if (!entry || entry.index >= entry.stack.length - 1) return;
    entry.index += 1;
    const nextUrl = entry.stack[entry.index] ?? 'nivrok://home';
    const host = extractHost(nextUrl);
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              url: nextUrl,
              commitUrl: nextUrl,
              navNonce: (t.navNonce ?? 0) + 1,
              title: nextUrl === 'nivrok://home' ? 'Nivrok Start' : host ?? nextUrl,
              canGoBack: entry.index > 0,
              canGoForward: entry.index < entry.stack.length - 1,
            }
          : t
      ),
    };
    this.persistLocal();
    this.emit();
  }

  reload(tabId: string): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId ? { ...t, commitUrl: t.url, navNonce: (t.navNonce ?? 0) + 1 } : t
      ),
    };
    this.emit();
  }
  stopLoading(_tabId: string): void {}

  createTab(url?: string): void {
    const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const targetUrl = url ?? 'nivrok://home';
    this.navStacks.set(id, { stack: [targetUrl], index: 0 });
    const newTab: TabInfo = {
      id,
      title: targetUrl === 'nivrok://home' ? 'New Tab' : extractHost(targetUrl) ?? targetUrl,
      url: targetUrl,
      commitUrl: targetUrl,
      navNonce: 1,
      isLoading: false,
      progress: 100,
      canGoBack: false,
      canGoForward: false,
      desktopMode: this.state.settings?.defaultDesktopMode ?? false,
      incognito: false,
      readerMode: false,
      groupId: null,
      groupTitle: null,
      groupColor: null,
      blockedCount: 0,
    };
    this.state = {
      ...this.state,
      activeTabId: id,
      tabs: [...this.state.tabs, newTab],
    };
    this.persistLocal();
    this.emit();
  }

  createIncognitoTab(url?: string): void {
    const id = `tab-inc-${Date.now().toString(36)}`;
    const targetUrl = url ?? 'nivrok://home';
    this.navStacks.set(id, { stack: [targetUrl], index: 0 });
    const newTab: TabInfo = {
      id,
      title: targetUrl === 'nivrok://home' ? 'Private Tab' : extractHost(targetUrl) ?? targetUrl,
      url: targetUrl,
      commitUrl: targetUrl,
      navNonce: 1,
      isLoading: false,
      progress: 100,
      canGoBack: false,
      canGoForward: false,
      desktopMode: this.state.settings?.defaultDesktopMode ?? false,
      incognito: true,
      readerMode: false,
      groupId: null,
      groupTitle: null,
      groupColor: null,
      blockedCount: 0,
    };
    this.state = {
      ...this.state,
      activeTabId: id,
      tabs: [...this.state.tabs, newTab],
    };
    this.emit();
  }

  openInTabGroup(sourceTabId: string, url: string, makeActive = false): void {
    const source = this.state.tabs.find((t) => t.id === sourceTabId);
    const gid = source?.groupId ?? `grp-${Date.now().toString(36)}`;
    const gTitle = source?.groupTitle ?? (extractHost(source?.url ?? '')?.replace(/^www\./, '') || 'Tab Group');
    const gColor = source?.groupColor ?? '#3B82F6';
    const newId = `tab-${Date.now().toString(36)}`;
    this.navStacks.set(newId, { stack: [url], index: 0 });
    const child: TabInfo = {
      id: newId,
      title: extractHost(url) ?? url,
      url,
      commitUrl: url,
      navNonce: 1,
      isLoading: false,
      progress: 100,
      canGoBack: false,
      canGoForward: false,
      desktopMode: this.state.settings?.defaultDesktopMode ?? false,
      incognito: false,
      readerMode: false,
      groupId: gid,
      groupTitle: gTitle,
      groupColor: gColor,
      blockedCount: 0,
    };
    const updated = this.state.tabs.map((t) =>
      t.id === sourceTabId ? { ...t, groupId: gid, groupTitle: gTitle, groupColor: gColor } : t
    );
    this.state = {
      ...this.state,
      tabs: [...updated, child],
      activeTabId: makeActive ? newId : this.state.activeTabId,
    };
    this.persistLocal();
    this.emit();
  }

  renameTabGroup(groupId: string, title: string): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) => (t.groupId === groupId ? { ...t, groupTitle: title } : t)),
    };
    this.persistLocal();
    this.emit();
  }

  ungroupTab(tabId: string): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId ? { ...t, groupId: null, groupTitle: null, groupColor: null } : t
      ),
    };
    this.persistLocal();
    this.emit();
  }

  closeTabGroup(groupId: string): void {
    const remaining = this.state.tabs.filter((t) => t.groupId !== groupId);
    if (remaining.length === 0) {
      this.createTab('nivrok://home');
      return;
    }
    this.state = {
      ...this.state,
      tabs: remaining,
      activeTabId: remaining.some((t) => t.id === this.state.activeTabId)
        ? this.state.activeTabId
        : remaining[0].id,
    };
    this.persistLocal();
    this.emit();
  }

  reopenClosedTab(): void {
    const popped = this.closedStack.shift();
    if (!popped) return;
    this.navStacks.set(popped.id, { stack: [popped.url], index: 0 });
    this.state = {
      ...this.state,
      tabs: [...this.state.tabs, { ...popped, commitUrl: popped.url, navNonce: 1 }],
      activeTabId: popped.id,
      canReopenClosedTab: this.closedStack.length > 0,
    };
    this.persistLocal();
    this.emit();
  }

  switchTab(tabId: string): void {
    if (!this.state.tabs.some((t) => t.id === tabId)) return;
    this.state = { ...this.state, activeTabId: tabId, findState: null };
    this.persistLocal();
    this.emit();
  }

  closeTab(tabId: string): void {
    const victim = this.state.tabs.find((t) => t.id === tabId);
    if (victim && !victim.incognito && !victim.url.startsWith('nivrok://') && !victim.url.startsWith('aegis://')) {
      this.closedStack.unshift(victim);
      if (this.closedStack.length > 15) this.closedStack.pop();
    }
    this.navStacks.delete(tabId);
    const remaining = this.state.tabs.filter((t) => t.id !== tabId);
    if (remaining.length === 0) {
      this.createTab('nivrok://home');
      return;
    }
    const nextActive =
      this.state.activeTabId === tabId ? remaining[remaining.length - 1].id : this.state.activeTabId;
    this.state = {
      ...this.state,
      tabs: remaining,
      activeTabId: nextActive,
      canReopenClosedTab: this.closedStack.length > 0,
    };
    this.persistLocal();
    this.emit();
  }

  setDesktopMode(tabId: string, desktop: boolean): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, desktopMode: desktop, commitUrl: t.url, navNonce: (t.navNonce ?? 0) + 1 }
          : t
      ),
    };
    this.persistLocal();
    this.emit();
  }

  toggleReaderMode(tabId: string): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId ? { ...t, readerMode: !t.readerMode } : t
      ),
    };
    this.emit();
  }

  findInPage(tabId: string, query: string): void {
    this.state = {
      ...this.state,
      findState: query ? { tabId, query, activeOrdinal: 1, totalMatches: 1 } : null,
    };
    this.emit();
  }

  findNextMatch(_tabId: string, _forward: boolean): void {}

  clearFindInPage(_tabId: string): void {
    this.state = { ...this.state, findState: null };
    this.emit();
  }

  dismissContextMenu(): void {
    this.state = { ...this.state, pendingContextMenu: null };
    this.emit();
  }

  respondPermissionPrompt(_id: string, _allow: boolean): void {
    this.state = { ...this.state, pendingPermission: null };
    this.emit();
  }

  shareUrl(url: string, title?: string): void {
    if (typeof navigator !== 'undefined' && navigator.share) {
      void navigator.share({ url, title });
    }
  }

  copyText(text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }

  getBookmarks(): BookmarkItem[] {
    return this.state.bookmarks ?? [];
  }

  addBookmark(title: string, url: string, tag = 'Saved'): void {
    const cur = this.state.bookmarks ?? [];
    if (cur.some((b) => b.url === url)) return;
    this.state = {
      ...this.state,
      bookmarks: [{ id: `bm-${Date.now()}`, title, url, tag, pinned: true }, ...cur],
    };
    this.persistLocal();
    this.emit();
  }

  removeBookmark(id: string): void {
    this.state = {
      ...this.state,
      bookmarks: (this.state.bookmarks ?? []).filter((b) => b.id !== id && b.url !== id),
    };
    this.persistLocal();
    this.emit();
  }

  importLegacyBookmarks(items: BookmarkItem[]): void {
    if (items.length === 0) return;
    this.state = { ...this.state, bookmarks: items };
    this.persistLocal();
    this.emit();
  }

  setShieldsConfig(config: ShieldsConfig): void {
    this.state = { ...this.state, shields: config };
    this.persistLocal();
    this.emit();
    if (this.state.platform === 'webos') {
      void syncWebOSProxyShields(config, this.state.webosProxyUrl);
    }
  }

  toggleSiteShields(host: string, enabled: boolean): void {
    const clean = host.trim().toLowerCase();
    const set = new Set(this.state.shields.disabledHosts);
    if (enabled) set.delete(clean);
    else set.add(clean);
    this.setShieldsConfig({ ...this.state.shields, disabledHosts: Array.from(set) });
  }

  async syncFilterLists(): Promise<void> {
    const { result, updatedSources } = await syncRemoteFilterMirrors(
      this.filterEngine,
      this.sources
    );
    this.sources = updatedSources;
    this.state = {
      ...this.state,
      filterSources: updatedSources,
      filterStats: this.filterEngine.getStats(),
    };
    this.emit();
    this.syncListeners.forEach((fn) => fn(result));
  }

  testUrl(url: string, pageHost: string): BlockDecision {
    const pageUrl = pageHost ? `https://${pageHost}/` : null;
    return this.filterEngine.evaluate(url, pageUrl, this.state.shields, true);
  }

  setOverlayExpanded(_expanded: boolean, _barHeightPx: number): void {}
  focusContent(): void {}

  setSearchEngine(engineId: SearchEngineId): void {
    const nextSettings = {
      ...(this.state.settings ?? DEFAULT_SETTINGS),
      searchEngine: engineId,
    };
    this.state = { ...this.state, searchEngine: engineId, settings: nextSettings };
    this.persistLocal();
    this.emit();
  }

  updateSettings(next: BrowserSettings): void {
    this.state = {
      ...this.state,
      searchEngine: next.searchEngine,
      settings: next,
    };
    this.state = {
      ...this.state,
      recommendations: this.buildPreviewRecommendations(),
    };
    this.persistLocal();
    this.emit();
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  deleteHistoryItem(id: string): void {
    this.history = this.history.filter((h) => h.id !== id);
    this.persistLocal();
    this.emit();
  }

  clearHistory(): void {
    this.history = [];
    this.recMap.clear();
    this.state = { ...this.state, recommendations: [] };
    this.persistLocal();
    this.emit();
  }

  dismissRecommendation(host: string): void {
    this.recMap.delete(host);
    this.state = { ...this.state, recommendations: this.buildPreviewRecommendations() };
    this.persistLocal();
    this.emit();
  }

  getDownloads(): DownloadRecord[] {
    return this.downloads;
  }

  downloadUrl(_url: string): void {}
  openDownloadedFile(_id: string): void {}
  openSystemDownloads(): void {}

  removeDownload(id: string): void {
    this.downloads = this.downloads.filter((d) => d.id !== id);
    this.state = {
      ...this.state,
      downloadsSummary: {
        activeCount: this.downloads.filter((d) => d.status === 'downloading').length,
        totalCount: this.downloads.length,
      },
    };
    this.emit();
  }

  clearCompletedDownloads(): void {
    this.downloads = this.downloads.filter((d) => d.status === 'downloading');
    this.state = {
      ...this.state,
      downloadsSummary: {
        activeCount: this.downloads.length,
        totalCount: this.downloads.length,
      },
    };
    this.emit();
  }

  clearCacheAndCookies(): void {}

  checkForUpdates(manual: boolean): void {
    void this.runPreviewUpdateCheck(manual);
  }

  private async runPreviewUpdateCheck(manual: boolean): Promise<void> {
    const repo = this.state.appUpdate.githubRepo;
    if (!repo || repo === 'OWNER/REPO') {
      if (manual) {
        this.state = {
          ...this.state,
          appUpdate: {
            ...this.state.appUpdate,
            status: 'unconfigured',
            message:
              'Set NIVROK_GITHUB_REPO in updaterConfig.ts / build.gradle.kts to check GitHub Releases.',
            checkedAtIso: new Date().toISOString(),
          },
        };
        this.emit();
      }
      return;
    }

    this.state = {
      ...this.state,
      appUpdate: {
        ...this.state.appUpdate,
        status: 'checking',
        message: `Checking GitHub Releases for ${repo}...`,
      },
    };
    this.emit();

    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        tag_name?: string;
        name?: string;
        body?: string;
        assets?: GithubReleaseAsset[];
      };
      const tag = json.tag_name ?? '';
      const apk = pickApkAsset(json.assets ?? []);
      const newer = isNewerVersion(tag, this.state.appUpdate.installedVersion);

      this.state = {
        ...this.state,
        appUpdate: {
          ...this.state.appUpdate,
          status: newer && apk ? 'available' : 'up_to_date',
          popupVisible: Boolean(newer && apk),
          latestVersion: tag || null,
          releaseTitle: json.name || tag || null,
          changelog: json.body || null,
          downloadUrl: apk?.browser_download_url ?? null,
          assetName: apk?.name ?? null,
          assetSizeBytes: apk?.size ?? 0,
          message:
            newer && apk
              ? `Update ${tag} available.`
              : `Running latest version (${this.state.appUpdate.installedVersion}).`,
          checkedAtIso: new Date().toISOString(),
        },
      };
      this.emit();
    } catch (err) {
      this.state = {
        ...this.state,
        appUpdate: {
          ...this.state.appUpdate,
          status: 'error',
          message: `Update check failed: ${(err as Error).message}`,
          checkedAtIso: new Date().toISOString(),
        },
      };
      this.emit();
    }
  }

  downloadAndInstallUpdate(): void {
    const url = this.state.appUpdate.downloadUrl;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  cancelUpdateDownload(): void {}

  dismissUpdateModal(): void {
    this.state = {
      ...this.state,
      appUpdate: { ...this.state.appUpdate, popupVisible: false },
    };
    this.emit();
  }

  retryPendingInstall(): void {}

  dismissCrashAlert(): void {
    const cur = this.state.diagnostics ?? DEFAULT_DIAGNOSTICS;
    this.state = {
      ...this.state,
      diagnostics: { ...cur, hasUnacknowledgedCrash: false },
    };
    this.emit();
  }

  clearDiagnostics(): void {
    this.state = {
      ...this.state,
      diagnostics: { ...DEFAULT_DIAGNOSTICS },
    };
    this.emit();
  }

  acknowledgeUpdateToast(): void {
    const cur = this.state.diagnostics ?? DEFAULT_DIAGNOSTICS;
    this.state = {
      ...this.state,
      diagnostics: { ...cur, updatedFromVersion: null },
    };
    this.emit();
  }

  reportUiError(source: string, message: string): void {
    const cur = this.state.diagnostics ?? DEFAULT_DIAGNOSTICS;
    const recentErrors = [
      { source, message, timestampIso: new Date().toISOString() },
      ...cur.recentErrors,
    ].slice(0, 8);
    this.state = {
      ...this.state,
      diagnostics: {
        ...cur,
        nonFatalCount: recentErrors.length,
        recentErrors,
      },
    };
    this.emit();
  }

  sendCrashEmail(): void {
    const body = encodeURIComponent(
      this.state.diagnostics?.reportText ?? DEFAULT_DIAGNOSTICS.reportText
    );
    window.open(
      `mailto:harsh.tripathi.cs@gmail.com?subject=${encodeURIComponent('Nivrok Diagnostics Report')}&body=${body}`,
      '_blank'
    );
  }

  openCrashIssueTab(): void {
    const repo = this.state.appUpdate.githubRepo || 'itripathiharsh/Aegis-Browser';
    const body = encodeURIComponent(
      this.state.diagnostics?.reportText ?? DEFAULT_DIAGNOSTICS.reportText
    );
    window.open(
      `https://github.com/${repo}/issues/new?title=${encodeURIComponent('[Bug] Issue report')}&body=${body}`,
      '_blank',
      'noopener,noreferrer'
    );
  }
}

let singletonBridge: BrowserBridge | null = null;

export function getBrowserBridge(): BrowserBridge {
  if (singletonBridge) return singletonBridge;
  if (typeof window !== 'undefined' && window.NivrokNative) {
    singletonBridge = new NativeAndroidOrWebOSBridge(window.NivrokNative, true);
  } else if (typeof window !== 'undefined' && window.NivrokWebOS) {
    singletonBridge = new NativeAndroidOrWebOSBridge(window.NivrokWebOS, false);
  } else {
    singletonBridge = new StandalonePreviewBridge();
  }
  return singletonBridge;
}
