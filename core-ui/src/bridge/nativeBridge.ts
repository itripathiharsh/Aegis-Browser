import { FilterEngine, extractHost } from '../adblock/filterEngine';
import type {
  AppUpdateState,
  BlockDecision,
  BlockedEvent,
  BrowserSettings,
  BrowserState,
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
import { AEGIS_APP_VERSION, AEGIS_GITHUB_REPO } from '../config/updaterConfig';
import { isNewerVersion, pickApkAsset, type GithubReleaseAsset } from '../utils/semver';
import { resolveOmniboxInput } from '../utils/urlResolver';
import { isWebOSRuntime, type WebOSNativeHost } from './webosAdapter';

interface AndroidNativeHost extends WebOSNativeHost {
  setOverlayExpanded(expanded: boolean, barHeightPx: number): void;
  focusContent(): void;
  setSearchEngine?(engineId: string): void;
  updateSettings?(settingsJson: string): void;
  getHistory?(): string;
  deleteHistoryItem?(id: string): void;
  clearHistory?(): void;
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
}

declare global {
  interface Window {
    AegisNative?: AndroidNativeHost;
    __AEGIS_ON_STATE__?: (state: BrowserState) => void;
    __AEGIS_ON_SYNC__?: (result: FilterSyncResult) => void;
    __AEGIS_CLOSE_OVERLAY__?: () => void;
    __AEGIS_FOCUS_OMNIBOX__?: () => void;
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
  switchTab(tabId: string): void;
  closeTab(tabId: string): void;
  setDesktopMode(tabId: string, desktop: boolean): void;
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
  getDownloads(): DownloadRecord[];
  openSystemDownloads(): void;
  removeDownload(id: string): void;
  clearCompletedDownloads(): void;
  clearCacheAndCookies(): void;
  checkForUpdates(manual: boolean): void;
  downloadAndInstallUpdate(): void;
  cancelUpdateDownload(): void;
  dismissUpdateModal(): void;
  retryPendingInstall(): void;
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
  installedVersion: AEGIS_APP_VERSION,
  installedVersionCode: 1,
  githubRepo: AEGIS_GITHUB_REPO,
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

export const DEFAULT_SETTINGS = {
  searchEngine: 'duckduckgo' as const,
  blockThirdPartyCookies: true,
  defaultDesktopMode: false,
  showRecommendations: true,
  autoSyncFilters: true,
  saveHistory: true,
};

function normalizeBrowserState(raw: BrowserState): BrowserState {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(raw.settings ?? {}),
    searchEngine: raw.settings?.searchEngine ?? raw.searchEngine ?? DEFAULT_SETTINGS.searchEngine,
  };
  return {
    ...raw,
    searchEngine: settings.searchEngine,
    settings,
    recommendations: raw.recommendations ?? [],
    downloadsSummary: raw.downloadsSummary ?? { activeCount: 0, totalCount: 0 },
    appUpdate: raw.appUpdate ?? { ...DEFAULT_UPDATE_STATE },
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

    window.__AEGIS_ON_STATE__ = (nextState: BrowserState) => {
      this.cachedState = normalizeBrowserState(nextState);
      this.listeners.forEach((fn) => fn(this.cachedState));
    };
    window.__AEGIS_ON_SYNC__ = (result: FilterSyncResult) => {
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
    const resolved = rawInput.startsWith('aegis://')
      ? rawInput
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
    this.host.createTab(url ?? 'aegis://home');
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
}

/**
 * Pure web / Phase-2 preview bridge running the TypeScript FilterEngine directly.
 */
class StandalonePreviewBridge implements BrowserBridge {
  readonly isNativeAndroid = false;
  private filterEngine = new FilterEngine();
  private listeners = new Set<(state: BrowserState) => void>();
  private syncListeners = new Set<(res: FilterSyncResult) => void>();
  private sources: FilterSource[] = [];
  private history: HistoryEntry[] = [];
  private recMap = new Map<string, RecommendedSite>();
  private downloads: DownloadRecord[] = [];
  private state: BrowserState;

  constructor() {
    const initialTab: TabInfo = {
      id: 'tab-1',
      title: 'Aegis Start',
      url: 'aegis://home',
      isLoading: false,
      progress: 100,
      canGoBack: false,
      canGoForward: false,
      desktopMode: false,
      blockedCount: 0,
    };

    this.state = {
      platform: isWebOSRuntime() ? 'webos' : 'web',
      searchEngine: DEFAULT_SETTINGS.searchEngine,
      settings: { ...DEFAULT_SETTINGS },
      activeTabId: initialTab.id,
      tabs: [initialTab],
      recommendations: [],
      downloadsSummary: { activeCount: 0, totalCount: 0 },
      shields: { ...DEFAULT_SHIELDS },
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
    };

    void this.initFilters();
  }

  private buildPreviewRecommendations(): RecommendedSite[] {
    if (this.state.settings && !this.state.settings.showRecommendations) return [];
    return Array.from(this.recMap.values())
      .sort((a, b) => b.visits - a.visits || b.lastVisitedMs - a.lastVisitedMs)
      .slice(0, 8);
  }

  private async initFilters() {
    const { sources } = await loadBundledAndCachedFilters(this.filterEngine);
    this.sources = sources;
    this.state = {
      ...this.state,
      filterSources: sources,
      filterStats: this.filterEngine.getStats(),
    };
    this.emit();
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
    const tabs = this.state.tabs.map((t) => {
      if (t.id !== tabId) return t;
      const host = extractHost(resolved);
      return {
        ...t,
        url: resolved,
        title:
          resolved === 'aegis://home'
            ? 'Aegis Start'
            : resolved.startsWith('aegis://player')
              ? 'Aegis Stream Player'
              : host ?? resolved,
        canGoBack: resolved !== 'aegis://home',
        isLoading: false,
        progress: 100,
      };
    });

    const nextTelemetry = { ...this.state.telemetry };
    if (!resolved.startsWith('aegis://')) {
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

    if (!resolved.startsWith('aegis://')) {
      const host = extractHost(resolved) ?? resolved;
      const now = Date.now();
      const saveHistory = this.state.settings?.saveHistory ?? true;
      if (saveHistory) {
        this.history = [
          {
            id: `h-${now}-${Math.random().toString(36).slice(2, 6)}`,
            url: resolved,
            title: host.replace(/^www\./, ''),
            host,
            visitedAtMs: now,
          },
          ...this.history,
        ].slice(0, 200);
      }
      const isSerp =
        (host.includes('duckduckgo.com') && resolved.includes('?q=')) ||
        (host.includes('search.brave.com') && resolved.includes('?q=')) ||
        (host.includes('google.') && resolved.includes('/search')) ||
        (host.includes('startpage.com') && resolved.includes('/search'));
      if (!isSerp) {
        const prev = this.recMap.get(host);
        this.recMap.set(host, {
          url: resolved.length <= 90 ? resolved : `https://${host}/`,
          title: host.replace(/^www\./, ''),
          host,
          visits: (prev?.visits ?? 0) + 1,
          lastVisitedMs: now,
        });
      }
    }

    this.state = {
      ...this.state,
      tabs: tabs.map((t) =>
        t.id === tabId && !resolved.startsWith('aegis://')
          ? { ...t, blockedCount: nextTelemetry.totalBlocked }
          : t
      ),
      recommendations: this.buildPreviewRecommendations(),
      telemetry: nextTelemetry,
    };
    this.emit();
  }

  goBack(tabId: string): void {
    this.navigate(tabId, 'aegis://home');
  }

  goForward(_tabId: string): void {}
  reload(_tabId: string): void {}
  stopLoading(_tabId: string): void {}

  createTab(url?: string): void {
    const id = `tab-${Date.now().toString(36)}`;
    const targetUrl = url ?? 'aegis://home';
    const newTab: TabInfo = {
      id,
      title: targetUrl === 'aegis://home' ? 'New Tab' : extractHost(targetUrl) ?? targetUrl,
      url: targetUrl,
      isLoading: false,
      progress: 100,
      canGoBack: false,
      canGoForward: false,
      desktopMode: false,
      blockedCount: 0,
    };
    this.state = {
      ...this.state,
      activeTabId: id,
      tabs: [...this.state.tabs, newTab],
    };
    this.emit();
  }

  switchTab(tabId: string): void {
    if (!this.state.tabs.some((t) => t.id === tabId)) return;
    this.state = { ...this.state, activeTabId: tabId };
    this.emit();
  }

  closeTab(tabId: string): void {
    const remaining = this.state.tabs.filter((t) => t.id !== tabId);
    if (remaining.length === 0) {
      this.createTab('aegis://home');
      remaining.push(...this.state.tabs.slice(-1));
    }
    const nextActive =
      this.state.activeTabId === tabId ? remaining[remaining.length - 1].id : this.state.activeTabId;
    this.state = {
      ...this.state,
      tabs: remaining,
      activeTabId: nextActive,
    };
    this.emit();
  }

  setDesktopMode(tabId: string, desktop: boolean): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === tabId ? { ...t, desktopMode: desktop } : t
      ),
    };
    this.emit();
  }

  setShieldsConfig(config: ShieldsConfig): void {
    this.state = { ...this.state, shields: config };
    this.emit();
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
    this.emit();
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  deleteHistoryItem(id: string): void {
    this.history = this.history.filter((h) => h.id !== id);
  }

  clearHistory(): void {
    this.history = [];
    this.recMap.clear();
    this.state = { ...this.state, recommendations: [] };
    this.emit();
  }

  getDownloads(): DownloadRecord[] {
    return this.downloads;
  }

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
              'Set AEGIS_GITHUB_REPO in updaterConfig.ts / build.gradle.kts to check GitHub Releases.',
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
}

let singletonBridge: BrowserBridge | null = null;

export function getBrowserBridge(): BrowserBridge {
  if (singletonBridge) return singletonBridge;
  if (typeof window !== 'undefined' && window.AegisNative) {
    singletonBridge = new NativeAndroidOrWebOSBridge(window.AegisNative, true);
  } else if (typeof window !== 'undefined' && window.AegisWebOS) {
    singletonBridge = new NativeAndroidOrWebOSBridge(window.AegisWebOS, false);
  } else {
    singletonBridge = new StandalonePreviewBridge();
  }
  return singletonBridge;
}
