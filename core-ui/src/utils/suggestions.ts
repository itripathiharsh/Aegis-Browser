import type { BookmarkItem, HistoryEntry } from '../adblock/types';

export type SuggestionKind = 'search' | 'bookmark' | 'history';

export interface OmniboxSuggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  subtitle: string;
  navigateTarget: string;
  fillText: string;
}

const SEARCH_HOSTS = [
  'duckduckgo.com',
  'search.brave.com',
  'startpage.com',
  'google.',
  'bing.com',
];

export function extractSearchQueryFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const isSearchHost = SEARCH_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`) || (h.endsWith('.') && host.includes(h))
    );
    if (!isSearchHost) return null;
    const q = parsed.searchParams.get('q') ?? parsed.searchParams.get('query');
    const clean = q?.trim();
    return clean && clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}

export function buildOmniboxSuggestions(
  rawQuery: string,
  history: HistoryEntry[],
  bookmarks: BookmarkItem[],
  limit = 6
): OmniboxSuggestion[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const seen = new Set<string>();
  const prefixMatches: OmniboxSuggestion[] = [];
  const subMatches: OmniboxSuggestion[] = [];

  const pushUnique = (item: OmniboxSuggestion, starts: boolean) => {
    const dedupeKey = `${item.kind}:${item.navigateTarget.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    if (starts) prefixMatches.push(item);
    else subMatches.push(item);
  };

  // 1. Previous search queries extracted from history SERPs (autotype from past searches)
  for (const h of history) {
    const pastSearch = extractSearchQueryFromUrl(h.url);
    if (!pastSearch) continue;
    const lower = pastSearch.toLowerCase();
    if (!lower.includes(q)) continue;
    pushUnique(
      {
        id: `sq-${lower}`,
        kind: 'search',
        title: pastSearch,
        subtitle: 'Previous search',
        navigateTarget: pastSearch,
        fillText: pastSearch,
      },
      lower.startsWith(q)
    );
  }

  // 2. Saved bookmarks
  for (const bm of bookmarks) {
    if (bm.url.startsWith('aegis://')) continue;
    const titleLower = bm.title.toLowerCase();
    const urlLower = bm.url.toLowerCase();
    if (!titleLower.includes(q) && !urlLower.includes(q)) continue;
    let hostLabel = bm.url;
    try {
      hostLabel = new URL(bm.url).hostname.replace(/^www\./, '');
    } catch {
      // Keep raw URL
    }
    pushUnique(
      {
        id: `bm-${bm.id}`,
        kind: 'bookmark',
        title: bm.title,
        subtitle: hostLabel,
        navigateTarget: bm.url,
        fillText: bm.url,
      },
      titleLower.startsWith(q) || hostLabel.toLowerCase().startsWith(q)
    );
  }

  // 3. Visited sites from history (excluding SERP duplicates)
  for (const h of history) {
    if (extractSearchQueryFromUrl(h.url)) continue;
    const titleLower = h.title.toLowerCase();
    const hostLower = h.host.toLowerCase();
    const urlLower = h.url.toLowerCase();
    if (!titleLower.includes(q) && !hostLower.includes(q) && !urlLower.includes(q)) {
      continue;
    }
    const cleanHost = h.host.replace(/^www\./, '');
    pushUnique(
      {
        id: `hi-${h.url}`,
        kind: 'history',
        title: h.title || cleanHost,
        subtitle: cleanHost,
        navigateTarget: h.url,
        fillText: h.url,
      },
      titleLower.startsWith(q) || cleanHost.startsWith(q)
    );
  }

  return [...prefixMatches, ...subMatches].slice(0, limit);
}
