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
  incognito?: boolean;
  readerMode?: boolean;
  groupId?: string | null;
  groupTitle?: string | null;
  groupColor?: string | null;
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

export type ThemeMode = 'dark' | 'light';

export interface BrowserSettings {
  searchEngine: SearchEngineId;
  theme: ThemeMode;
  blockThirdPartyCookies: boolean;
  defaultDesktopMode: boolean;
  showRecommendations: boolean;
  autoSyncFilters: boolean;
  saveHistory: boolean;
  textZoom: number;
  allowSitePermissionPrompts: boolean;
  restoreTabsOnStart: boolean;
}

export interface PendingContextMenu {
  tabId: string;
  linkUrl: string | null;
  imageUrl: string | null;
  title: string | null;
}

export interface FindState {
  tabId: string;
  query: string;
  activeOrdinal: number;
  totalMatches: number;
}

export interface PendingPermissionPrompt {
  id: string;
  origin: string;
  label: string;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  host: string;
  visitedAtMs: number;
}

export interface RecommendedSite {
  url: string;
  title: string;
  host: string;
  visits: number;
  lastVisitedMs: number;
}

export interface DownloadRecord {
  id: string;
  dmId: number;
  fileName: string;
  url: string;
  mimeType: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'downloading' | 'completed' | 'failed';
  startedAtMs: number;
  contentUri?: string | null;
}

export interface DownloadsSummary {
  activeCount: number;
  totalCount: number;
}

export interface BrowserState {
  platform: 'android' | 'webos' | 'web';
  searchEngine?: SearchEngineId;
  settings?: BrowserSettings;
  activeTabId: string;
  tabs: TabInfo[];
  bookmarks?: BookmarkItem[];
  canReopenClosedTab?: boolean;
  recommendations?: RecommendedSite[];
  downloadsSummary?: DownloadsSummary;
  pendingContextMenu?: PendingContextMenu | null;
  findState?: FindState | null;
  pendingPermission?: PendingPermissionPrompt | null;
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
