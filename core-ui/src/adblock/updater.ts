import { FilterEngine } from './filterEngine';
import type { BlockCategory, FilterSource, FilterSyncResult } from './types';

const CACHE_KEY_PREFIX = 'aegis_filter_cache_v1_';
const META_KEY = 'aegis_filter_meta_v1';

const BUNDLED_ASSETS: Array<{ path: string; category: BlockCategory }> = [
  { path: './filters/easylist-core.txt', category: 'ads' },
  { path: './filters/easyprivacy-core.txt', category: 'trackers' },
  { path: './filters/ublock-ads-core.txt', category: 'popups' },
  { path: './filters/cosmetic-rules.txt', category: 'cosmetic' },
];

export async function loadBundledAndCachedFilters(engine: FilterEngine): Promise<{
  sources: FilterSource[];
}> {
  const bundledContents = await Promise.all(
    BUNDLED_ASSETS.map(async (item) => {
      try {
        const res = await fetch(item.path);
        const content = res.ok ? await res.text() : '';
        return { category: item.category, content };
      } catch {
        return { category: item.category, content: '' };
      }
    })
  );

  let sourceList: FilterSource[] = [];
  try {
    const srcRes = await fetch('./filters/sources.json');
    if (srcRes.ok) {
      const json = (await srcRes.json()) as {
        sources?: Array<{
          id: string;
          name: string;
          category: BlockCategory;
          url: string;
          enabled: boolean;
        }>;
      };
      sourceList = (json.sources ?? []).map((s) => ({
        ...s,
        lastSyncedIso: null,
        cachedRuleCount: 0,
      }));
    }
  } catch {
    sourceList = [];
  }

  const meta = readMeta();
  const compiledInputs = [...bundledContents];

  sourceList = sourceList.map((src) => {
    const cachedText = readCachedText(src.id);
    const savedMeta = meta.sources[src.id];
    if (cachedText) {
      compiledInputs.push({ category: src.category, content: cachedText });
    }
    return {
      ...src,
      lastSyncedIso: savedMeta?.lastSyncedIso ?? null,
      cachedRuleCount: savedMeta?.cachedRuleCount ?? 0,
    };
  });

  engine.compile(compiledInputs, meta.lastUpdatedIso);
  return { sources: sourceList };
}

export async function syncRemoteFilterMirrors(
  engine: FilterEngine,
  sources: FilterSource[]
): Promise<{ result: FilterSyncResult; updatedSources: FilterSource[] }> {
  const nowIso = new Date().toISOString();
  let syncedSources = 0;
  let failedSources = 0;
  const meta = readMeta();
  const nextSources: FilterSource[] = [];

  for (const src of sources) {
    if (!src.enabled) {
      nextSources.push(src);
      continue;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch(src.url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (
        text.trimStart().startsWith('<!DOCTYPE') ||
        text.trimStart().startsWith('<html') ||
        (!text.includes('||') && !text.includes('0.0.0.0 ') && !text.includes('[Adblock'))
      ) {
        throw new Error('Invalid filter list payload');
      }
      const ruleCount = text
        .split(/\r?\n/)
        .filter((l) => {
          const t = l.trim();
          return t && !t.startsWith('!') && !t.startsWith('#');
        }).length;

      writeCachedText(src.id, text);
      meta.sources[src.id] = { lastSyncedIso: nowIso, cachedRuleCount: ruleCount };
      syncedSources++;
      nextSources.push({
        ...src,
        lastSyncedIso: nowIso,
        cachedRuleCount: ruleCount,
      });
    } catch {
      failedSources++;
      nextSources.push(src);
    }
  }

  if (syncedSources > 0) {
    meta.lastUpdatedIso = nowIso;
    writeMeta(meta);
    await loadBundledAndCachedFilters(engine);
  }

  const stats = engine.getStats();
  const totalRules = stats.domainRuleCount + stats.patternRuleCount;
  const message =
    syncedSources > 0
      ? `Updated ${syncedSources} GitHub mirror lists (${totalRules.toLocaleString()} rules)`
      : `Using bundled local filters (${totalRules.toLocaleString()} rules)`;

  return {
    result: {
      syncedSources,
      failedSources,
      totalRules,
      lastUpdatedIso: meta.lastUpdatedIso ?? nowIso,
      message,
    },
    updatedSources: nextSources,
  };
}

interface StoredMeta {
  lastUpdatedIso: string | null;
  sources: Record<string, { lastSyncedIso: string; cachedRuleCount: number }>;
}

function readMeta(): StoredMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { lastUpdatedIso: null, sources: {} };
    return JSON.parse(raw) as StoredMeta;
  } catch {
    return { lastUpdatedIso: null, sources: {} };
  }
}

function writeMeta(meta: StoredMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota errors in restricted WebViews
  }
}

function readCachedText(id: string): string | null {
  try {
    return localStorage.getItem(`${CACHE_KEY_PREFIX}${id}`);
  } catch {
    return null;
  }
}

function writeCachedText(id: string, text: string): void {
  try {
    // Guard localStorage 5MB browser limit on huge host lists
    if (text.length <= 1_800_000) {
      localStorage.setItem(`${CACHE_KEY_PREFIX}${id}`, text);
    }
  } catch {
    // Ignore quota errors gracefully
  }
}
