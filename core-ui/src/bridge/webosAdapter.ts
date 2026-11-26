import type {
  BlockCategory,
  BrowserState,
  FilterStats,
  ShieldsConfig,
  TabInfo,
  TelemetrySnapshot,
} from '../adblock/types';

export const WEBOS_SERVICE_ID = 'io.github.itripathiharsh.nivrok.service';

export interface WebOSNativeHost {
  getInitialState(): string;
  navigate(tabId: string, url: string): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stopLoading(tabId: string): void;
  createTab(url?: string): void;
  switchTab(tabId: string): void;
  closeTab(tabId: string): void;
  setDesktopMode(tabId: string, enabled: boolean): void;
  setShieldsConfig(configJson: string): void;
  toggleSiteShields(host: string, enabled: boolean): void;
  syncFilterLists(): void;
  testUrlAgainstFilters(url: string, pageHost: string): string;
  checkForUpdates?(manual: boolean): void;
  downloadAndInstallUpdate?(): void;
  cancelUpdateDownload?(): void;
  dismissUpdateModal?(): void;
  retryPendingInstall?(): void;
}

interface PalmServiceBridgeInstance {
  onservicecallback: ((response: string) => void) | null;
  call(uri: string, params: string): void;
  cancel(): void;
}

declare global {
  interface Window {
    NivrokWebOS?: WebOSNativeHost;
    PalmSystem?: unknown;
    PalmServiceBridge?: new () => PalmServiceBridgeInstance;
    webOS?: {
      platformBack?: () => void;
      service?: {
        request: (
          uri: string,
          params: {
            method?: string;
            parameters?: Record<string, unknown>;
            onSuccess?: (res: unknown) => void;
            onFailure?: (err: unknown) => void;
          }
        ) => void;
      };
    };
  }
}

export interface WebOSProxyStartResult {
  returnValue: boolean;
  baseUrl?: string;
  port?: number;
  filterStats?: FilterStats;
  errorText?: string;
}

export interface WebOSProxyStatsResult {
  returnValue: boolean;
  baseUrl?: string;
  filterStats?: FilterStats;
  telemetry?: TelemetrySnapshot;
  shields?: ShieldsConfig;
}

export function isWebOSRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.NivrokWebOS || window.webOS || window.PalmSystem || window.PalmServiceBridge) {
    return true;
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Web0S|webOS|NetCast|SmartTV/i.test(ua);
}

export function hasLunaBridge(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.webOS?.service?.request || window.PalmServiceBridge);
}

export function requestLunaService<T extends { returnValue?: boolean; errorText?: string }>(
  serviceUri: string,
  method: string,
  parameters: Record<string, unknown> = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window is not available'));
      return;
    }

    if (window.webOS?.service?.request) {
      window.webOS.service.request(serviceUri, {
        method,
        parameters,
        onSuccess: (res) => resolve(res as T),
        onFailure: (err) => reject(err),
      });
      return;
    }

    if (window.PalmServiceBridge) {
      try {
        const bridge = new window.PalmServiceBridge();
        const timer = window.setTimeout(() => {
          try {
            bridge.cancel();
          } catch {
            // Ignore cleanup failure
          }
          reject(new Error(`Luna call timed out: ${serviceUri}/${method}`));
        }, 8000);

        bridge.onservicecallback = (raw: string) => {
          window.clearTimeout(timer);
          try {
            const parsed = JSON.parse(raw) as T;
            if (parsed.returnValue === false) {
              reject(new Error(parsed.errorText ?? 'Luna service returned failure'));
            } else {
              resolve(parsed);
            }
          } catch (err) {
            reject(err);
          }
        };

        const fullUri = `${serviceUri.replace(/\/$/, '')}/${method}`;
        bridge.call(fullUri, JSON.stringify(parameters));
      } catch (err) {
        reject(err);
      }
      return;
    }

    reject(new Error('No webOS Luna service bridge present'));
  });
}

export async function startWebOSProxyService(): Promise<WebOSProxyStartResult | null> {
  if (!hasLunaBridge()) return null;
  return requestLunaService<WebOSProxyStartResult>(
    `luna://${WEBOS_SERVICE_ID}`,
    'startProxy',
    {}
  );
}

export async function fetchWebOSProxyStats(
  proxyBaseUrl?: string | null
): Promise<WebOSProxyStatsResult | null> {
  if (proxyBaseUrl) {
    try {
      const res = await fetch(`${proxyBaseUrl}/stats`, { cache: 'no-store' });
      if (res.ok) {
        return (await res.json()) as WebOSProxyStatsResult;
      }
    } catch {
      // Fall back to Luna request below
    }
  }
  if (!hasLunaBridge()) return null;
  try {
    return await requestLunaService<WebOSProxyStatsResult>(
      `luna://${WEBOS_SERVICE_ID}`,
      'getStats',
      {}
    );
  } catch {
    return null;
  }
}

export async function syncWebOSProxyShields(
  shields: ShieldsConfig,
  proxyBaseUrl?: string | null
): Promise<void> {
  if (proxyBaseUrl) {
    try {
      const res = await fetch(`${proxyBaseUrl}/shields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shields),
      });
      if (res.ok) return;
    } catch {
      // Fall through to Luna call
    }
  }
  if (!hasLunaBridge()) return;
  try {
    await requestLunaService(`luna://${WEBOS_SERVICE_ID}`, 'updateShields', { shields });
  } catch {
    // Ignore transient Luna errors
  }
}

export async function reportWebOSProxyBlocked(
  url: string,
  pageUrl: string,
  category: BlockCategory
): Promise<void> {
  if (!hasLunaBridge()) return;
  try {
    await requestLunaService(`luna://${WEBOS_SERVICE_ID}`, 'reportBlocked', {
      url,
      pageUrl,
      category,
    });
  } catch {
    // Ignore transient Luna errors
  }
}

export function buildWebOSProxiedUrl(
  proxyBaseUrl: string,
  targetUrl: string,
  tab: Pick<TabInfo, 'id' | 'incognito' | 'desktopMode'>
): string {
  const params = [`url=${encodeURIComponent(targetUrl)}`, `tabId=${encodeURIComponent(tab.id)}`];
  if (tab.incognito) params.push('incognito=1');
  if (tab.desktopMode) params.push('desktop=1');
  return `${proxyBaseUrl}/proxy?${params.join('&')}`;
}

export function createInitialWebOSFallbackState(): BrowserState {
  return {
    platform: 'webos',
    activeTabId: 'tab-1',
    tabs: [
      {
        id: 'tab-1',
        title: 'Nivrok Start',
        url: 'nivrok://home',
        isLoading: false,
        progress: 100,
        canGoBack: false,
        canGoForward: false,
        desktopMode: false,
        incognito: false,
        readerMode: false,
        blockedCount: 0,
      },
    ],
    shields: {
      enabled: true,
      blockAdsAndTrackers: true,
      blockPopups: true,
      cosmeticFiltering: true,
      disabledHosts: [],
    },
    filterStats: {
      domainRuleCount: 0,
      patternRuleCount: 0,
      exceptionRuleCount: 0,
      cosmeticSelectorCount: 0,
      lastUpdatedIso: null,
    },
    filterSources: [],
    telemetry: {
      totalBlocked: 0,
      adsBlocked: 0,
      trackersBlocked: 0,
      popupsBlocked: 0,
      recentEvents: [],
    },
    appUpdate: {
      status: 'idle',
      popupVisible: false,
      installedVersion: '1.0.10',
      installedVersionCode: 1000010,
      githubRepo: 'itripathiharsh/Aegis-Browser',
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
    },
  };
}

export function registerWebOSBackHandler(onBack: () => void): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 461) {
      e.preventDefault();
      onBack();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
