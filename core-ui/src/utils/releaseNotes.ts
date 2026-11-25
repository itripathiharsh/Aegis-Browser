export interface ReleaseSection {
  title: string;
  items: string[];
}

const DEFAULT_FALLBACK_ITEMS = [
  'Updated offline ad-blocking rules, crash resilience, and browser stability improvements.',
];

/**
 * Strips common Markdown emphasis, links, inline code, and heading tokens so
 * GitHub Release bodies render cleanly in the compact in-app update dialog.
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*]+)\*(?=$|\s|[.,:;!?])/g, '$1$2')
    .replace(/(^|\s)_([^_]+)_(?=$|\s|[.,:;!?])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBoilerplateLine(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  if (!lower) return true;
  if (/^aegis browser\s+v?\d+\.\d+/.test(lower)) return true;
  if (/^install:\s*download\b/i.test(lower) && lower.includes('.apk')) return true;
  if (/^full changelog:/i.test(lower)) return true;
  return false;
}

/**
 * Parses a GitHub Release markdown changelog into readable UI sections & bullet points.
 */
export function parseReleaseNotes(rawChangelog: string | null | undefined): ReleaseSection[] {
  const raw = (rawChangelog ?? '').replace(/\r\n/g, '\n').trim();
  if (!raw) {
    return [{ title: "What's New", items: DEFAULT_FALLBACK_ITEMS }];
  }

  const sections: ReleaseSection[] = [];
  let current: ReleaseSection = { title: "What's New", items: [] };

  const pushCurrentIfNonEmpty = () => {
    if (current.items.length > 0) {
      sections.push(current);
    }
  };

  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Markdown heading (## Title, ### What's New)
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const heading = stripInlineMarkdown(headingMatch[1]).replace(/:+$/, '');
      if (!isBoilerplateLine(heading)) {
        pushCurrentIfNonEmpty();
        current = { title: heading, items: [] };
      }
      continue;
    }

    // Standalone label line such as **What's new:** or Fixes:
    if (/^(\*\*|__)?[A-Za-z][A-Za-z0-9\s'&/-]{1,36}:(\*\*|__)?$/.test(trimmed)) {
      const label = stripInlineMarkdown(trimmed).replace(/:+$/, '');
      if (!isBoilerplateLine(label)) {
        pushCurrentIfNonEmpty();
        current = { title: label, items: [] };
      }
      continue;
    }

    // Bullet / numbered list item
    const bulletMatch = trimmed.match(/^(?:[-*+•]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
      const item = stripInlineMarkdown(bulletMatch[1]);
      if (item && !isBoilerplateLine(item)) {
        current.items.push(item);
      }
      continue;
    }

    const plain = stripInlineMarkdown(trimmed);
    if (!isBoilerplateLine(plain)) {
      current.items.push(plain);
    }
  }

  pushCurrentIfNonEmpty();

  if (sections.length === 0) {
    return [{ title: "What's New", items: DEFAULT_FALLBACK_ITEMS }];
  }
  return sections;
}
