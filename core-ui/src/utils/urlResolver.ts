import type { SearchEngineId } from '../adblock/types';

export const SEARCH_ENGINES: Record<
  SearchEngineId,
  { label: string; template: string }
> = {
  duckduckgo: {
    label: 'DuckDuckGo',
    template: 'https://duckduckgo.com/?q=',
  },
  brave: {
    label: 'Brave Search',
    template: 'https://search.brave.com/search?q=',
  },
  startpage: {
    label: 'Startpage',
    template: 'https://www.startpage.com/do/search?q=',
  },
  google: {
    label: 'Google',
    template: 'https://www.google.com/search?q=',
  },
};

export function isDirectMediaStreamUrl(rawUrl: string): boolean {
  const clean = rawUrl.trim().toLowerCase().split('?')[0].split('#')[0];
  return clean.endsWith('.m3u8') || clean.endsWith('.mp4');
}

export function resolveOmniboxInput(
  rawInput: string,
  engine: SearchEngineId = 'duckduckgo'
): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return 'aegis://home';
  if (trimmed.startsWith('aegis://')) return trimmed;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return isDirectMediaStreamUrl(lower)
      ? `aegis://player?src=${encodeURIComponent(trimmed)}`
      : trimmed;
  }

  const looksLikeHost =
    !trimmed.includes(' ') &&
    (trimmed.includes('.') || lower === 'localhost' || lower.startsWith('localhost:'));
  if (looksLikeHost) {
    const withScheme = lower.startsWith('localhost')
      ? `http://${trimmed}`
      : `https://${trimmed}`;
    return isDirectMediaStreamUrl(withScheme)
      ? `aegis://player?src=${encodeURIComponent(withScheme)}`
      : withScheme;
  }

  const base = SEARCH_ENGINES[engine]?.template ?? SEARCH_ENGINES.duckduckgo.template;
  return `${base}${encodeURIComponent(trimmed)}`;
}

export function formatDisplayUrl(url: string): {
  hostLabel: string;
  isSecure: boolean;
  isInternal: boolean;
} {
  if (url.startsWith('aegis://')) {
    return {
      hostLabel: url === 'aegis://home' ? 'Aegis Private Start' : 'Aegis Stream Player',
      isSecure: true,
      isInternal: true,
    };
  }
  try {
    const parsed = new URL(url);
    return {
      hostLabel: parsed.hostname.replace(/^www\./, '') + (parsed.pathname !== '/' ? parsed.pathname : ''),
      isSecure: parsed.protocol === 'https:',
      isInternal: false,
    };
  } catch {
    return { hostLabel: url, isSecure: false, isInternal: false };
  }
}
