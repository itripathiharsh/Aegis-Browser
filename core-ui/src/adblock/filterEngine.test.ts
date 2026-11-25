import { describe, expect, it } from 'vitest';
import { FilterEngine } from './filterEngine';
import type { ShieldsConfig } from './types';

const DEFAULT_SHIELDS: ShieldsConfig = {
  enabled: true,
  blockAdsAndTrackers: true,
  blockPopups: true,
  cosmeticFiltering: true,
  disabledHosts: [],
};

describe('FilterEngine (core-ui TS matcher)', () => {
  const buildEngine = () => {
    const engine = new FilterEngine();
    engine.compile([
      {
        category: 'ads',
        content: `
          ||doubleclick.net^
          ||taboola.com^$third-party
          /pagead/js/adsbygoogle.js$script
          @@||cdn.jsdelivr.net^
          ##.adsbygoogle
          youtube.com###player-ads
        `,
      },
      {
        category: 'trackers',
        content: `
          ||google-analytics.com^
          0.0.0.0 clarity.ms
        `,
      },
    ]);
    return engine;
  };

  it('blocks ad subdomains and hosts-format trackers', () => {
    const engine = buildEngine();
    expect(
      engine.evaluate(
        'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
        'https://news.example.com/',
        DEFAULT_SHIELDS,
        true
      ).blocked
    ).toBe(true);

    const clarity = engine.evaluate(
      'https://www.clarity.ms/tag/xyz',
      'https://shop.example.com/',
      DEFAULT_SHIELDS,
      true
    );
    expect(clarity.blocked).toBe(true);
    expect(clarity.category).toBe('trackers');
  });

  it('respects third-party vs first-party and exception rules', () => {
    const engine = buildEngine();
    expect(
      engine.evaluate(
        'https://cdn.taboola.com/lib.js',
        'https://www.taboola.com/',
        DEFAULT_SHIELDS,
        true
      ).blocked
    ).toBe(false);

    expect(
      engine.evaluate(
        'https://cdn.taboola.com/lib.js',
        'https://article.example.co.in/',
        DEFAULT_SHIELDS,
        true
      ).blocked
    ).toBe(true);

    expect(
      engine.evaluate(
        'https://cdn.jsdelivr.net/npm/hls.js@1.5.0',
        'https://video.example.com/',
        DEFAULT_SHIELDS,
        true
      ).blocked
    ).toBe(false);
  });

  it('honors per-site shields disable and cosmetic selectors', () => {
    const engine = buildEngine();
    const disabled: ShieldsConfig = {
      ...DEFAULT_SHIELDS,
      disabledHosts: ['example.com'],
    };
    expect(
      engine.evaluate(
        'https://doubleclick.net/ad.js',
        'https://sub.example.com/page',
        disabled,
        true
      ).blocked
    ).toBe(false);

    const selectors = engine.getCosmeticSelectors('m.youtube.com', DEFAULT_SHIELDS);
    expect(selectors).toContain('.adsbygoogle');
    expect(selectors).toContain('#player-ads');
  });
});
