import type { BrowserState, FilterSyncResult, ShieldsConfig } from '../adblock/types';

/**
 * Phase 2 Adapter Interface for LG webOS (WebOS-Chromium / Luna Service IPC).
 * When packaged into an LG webOS .ipk, the native webOS shell exposes window.AegisWebOS
 * (or webOS.service.request) implementing this contract so core-ui requires zero rewrite.
 */
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
  setDesktopMode(tabId: string, desktop: boolean): void;
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

declare global {
  interface Window {
    AegisWebOS?: WebOSNativeHost;
    webOS?: {
      platform?: { tv?: boolean };
      service?: {
        request: (
          uri: string,
          params: Record<string, unknown>
        ) => void;
      };
    };
  }
}

export function isWebOSRuntime(): boolean {
  return Boolean(window.AegisWebOS || window.webOS);
}

export function registerWebOSBackHandler(onBack: () => void): () => void {
  const handler = (ev: KeyboardEvent) => {
    // LG webOS Magic Remote Back button fires keyCode 461 or GoBack / BrowserBack
    if (ev.key === 'GoBack' || ev.key === 'BrowserBack' || ev.keyCode === 461) {
      ev.preventDefault();
      onBack();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

export type WebOSStateListener = (state: BrowserState) => void;
export type WebOSSyncListener = (result: FilterSyncResult) => void;
export type WebOSShieldsPayload = ShieldsConfig;
