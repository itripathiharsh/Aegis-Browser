export type BlockCategory = 'ads' | 'trackers' | 'popups' | 'cosmetic';

export type SearchEngineId = 'duckduckgo' | 'brave' | 'google' | 'startpage';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'awaiting_permission'
  | 'ready_to_install'
  | 'error'
  | 'unconfigured';

export interface AppUpdateState {
  status: AppUpdateStatus;
  popupVisible: boolean;
  installedVersion: string;
  installedVersionCode: number;
  githubRepo: string;
  latestVersion: string | null;
  releaseTitle: string | null;
  changelog: string | null;
  downloadUrl: string | null;
  assetName: string | null;
  assetSizeBytes: number;
  downloadedBytes: number;
  progressPercent: number;
  message: string | null;
  checkedAtIso: string | null;
}

export interface ShieldsConfig {
  enabled: boolean;
  blockAdsAndTrackers: boolean;
  blockPopups: boolean;
  cosmeticFiltering: boolean;
  disabledHosts: string[];
}

export interface BlockedEvent {
  url: string;
  host: string;
  pageHost: string;
  rule: string;
  category: BlockCategory;
  timestampMs: number;
}

export interface FilterStats {
  domainRuleCount: number;
  patternRuleCount: number;
  exceptionRuleCount: number;
  cosmeticSelectorCount: number;
  lastUpdatedIso: string | null;
}

export interface FilterSource {
  id: string;
  name: string;
  category: BlockCategory;
  url: string;
  enabled: boolean;
  lastSyncedIso: string | null;
  cachedRuleCount: number;
}

export interface FilterSyncResult {
  syncedSources: number;
  failedSources: number;
  totalRules: number;
  lastUpdatedIso: string;
  message: string;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  desktopMode: boolean;
  blockedCount: number;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  tag: string;
  pinned?: boolean;
}

export interface TelemetrySnapshot {
  totalBlocked: number;
  adsBlocked: number;
  trackersBlocked: number;
  popupsBlocked: number;
  recentEvents: BlockedEvent[];
}

export interface BrowserState {
  platform: 'android' | 'webos' | 'web';
  activeTabId: string;
  tabs: TabInfo[];
  shields: ShieldsConfig;
  filterStats: FilterStats;
  filterSources: FilterSource[];
  telemetry: TelemetrySnapshot;
  appUpdate: AppUpdateState;
}

export interface BlockDecision {
  blocked: boolean;
  matchedRule: string | null;
  category: BlockCategory;
}
