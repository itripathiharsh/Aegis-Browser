import { describe, expect, it } from 'vitest';
import { parseReleaseNotes, stripInlineMarkdown } from './releaseNotes';

describe('releaseNotes parser', () => {
  it('removes raw markdown asterisks, hashes, and backticks from release notes', () => {
    const raw = `## Nivrok v1.0.8

**What's new:**
- Updated **ad-block** filter lists (\`EasyList\` + EasyPrivacy)
- Stability and [playback](https://example.com) improvements

**Install:** Download \`Nivrok-v1.0.8.apk\` below and install on your Android device.`;

    const sections = parseReleaseNotes(raw);
    expect(sections).toEqual([
      {
        title: "What's new",
        items: [
          'Updated ad-block filter lists (EasyList + EasyPrivacy)',
          'Stability and playback improvements',
        ],
      },
    ]);
  });

  it('groups multiple markdown headings into distinct sections', () => {
    const raw = `### What's New
- Formatted release notes dialog
### Fixes
* Fixed desktop layout scaling
1. Improved download filename clarity`;

    const sections = parseReleaseNotes(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("What's New");
    expect(sections[0].items).toEqual(['Formatted release notes dialog']);
    expect(sections[1].title).toBe('Fixes');
    expect(sections[1].items).toEqual([
      'Fixed desktop layout scaling',
      'Improved download filename clarity',
    ]);
  });

  it('falls back cleanly on blank input and strips inline formatting', () => {
    expect(parseReleaseNotes(null)[0].items.length).toBeGreaterThan(0);
    expect(stripInlineMarkdown('**Fast** *private* `browser`')).toBe('Fast private browser');
  });
});
