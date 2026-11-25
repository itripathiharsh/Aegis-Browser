import { describe, expect, it } from 'vitest';
import type { BookmarkItem, HistoryEntry } from '../adblock/types';
import { buildOmniboxSuggestions, extractSearchQueryFromUrl } from './suggestions';

describe('omnibox suggestions', () => {
  const history: HistoryEntry[] = [
    {
      id: '1',
      url: 'https://search.brave.com/search?q=kotlin+coroutines+guide',
      title: 'kotlin coroutines guide - Brave Search',
      host: 'search.brave.com',
      visitedAtMs: 3000,
    },
    {
      id: '2',
      url: 'https://github.com/itripathiharsh/Aegis-Browser',
      title: 'GitHub - itripathiharsh/Aegis-Browser',
      host: 'github.com',
      visitedAtMs: 2000,
    },
    {
      id: '3',
      url: 'https://duckduckgo.com/?q=kotlin+flow+vs+channel',
      title: 'kotlin flow vs channel at DuckDuckGo',
      host: 'duckduckgo.com',
      visitedAtMs: 1000,
    },
  ];

  const bookmarks: BookmarkItem[] = [
    {
      id: 'bm-1',
      title: 'Kotlin Docs',
      url: 'https://kotlinlang.org/docs/home.html',
      tag: 'Docs',
    },
  ];

  it('extracts search queries from Brave, DuckDuckGo, Google, and Startpage URLs', () => {
    expect(
      extractSearchQueryFromUrl('https://search.brave.com/search?q=android+webview')
    ).toBe('android webview');
    expect(
      extractSearchQueryFromUrl('https://www.google.com/search?q=vite+config')
    ).toBe('vite config');
    expect(extractSearchQueryFromUrl('https://github.com/itripathiharsh')).toBeNull();
  });

  it('suggests matching past searches, bookmarks, and visited history sites', () => {
    const res = buildOmniboxSuggestions('kot', history, bookmarks);
    expect(res.length).toBe(3);
    expect(res[0]).toMatchObject({
      kind: 'search',
      title: 'kotlin coroutines guide',
      subtitle: 'Previous search',
    });
    expect(res[1]).toMatchObject({
      kind: 'search',
      title: 'kotlin flow vs channel',
    });
    expect(res[2]).toMatchObject({
      kind: 'bookmark',
      title: 'Kotlin Docs',
    });

    const gh = buildOmniboxSuggestions('aegis', history, bookmarks);
    expect(gh[0]).toMatchObject({
      kind: 'history',
      subtitle: 'github.com',
      navigateTarget: 'https://github.com/itripathiharsh/Aegis-Browser',
    });
  });
});
