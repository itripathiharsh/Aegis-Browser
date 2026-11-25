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

export function resolveOmniboxInput(
  rawInput: string,
  engine: SearchEngineId = 'duckduckgo'
): string {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.startsWith('nivrok://') || trimmed.startsWith('aegis://')) return 'nivrok://home';

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return trimmed;
  }

  const looksLikeHost =
    !trimmed.includes(' ') &&
    (trimmed.includes('.') || lower === 'localhost' || lower.startsWith('localhost:'));
  if (looksLikeHost) {
    return lower.startsWith('localhost')
      ? `http://${trimmed}`
      : `https://${trimmed}`;
  }

  const base = SEARCH_ENGINES[engine]?.template ?? SEARCH_ENGINES.duckduckgo.template;
  return `${base}${encodeURIComponent(trimmed)}`;
}

export function formatDisplayUrl(url: string): {
  hostLabel: string;
  isSecure: boolean;
  isInternal: boolean;
} {
  if (url.startsWith('nivrok://') || url.startsWith('aegis://')) {
    return {
      hostLabel: 'Nivrok Start',
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
