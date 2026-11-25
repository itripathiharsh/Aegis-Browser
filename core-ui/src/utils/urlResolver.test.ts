import { describe, expect, it } from 'vitest';
import { formatDisplayUrl, resolveOmniboxInput } from './urlResolver';

describe('urlResolver', () => {
  it('routes direct domains, full URLs, media links, and search queries cleanly', () => {
    expect(resolveOmniboxInput('')).toBe('aegis://home');
    expect(resolveOmniboxInput('wikipedia.org')).toBe('https://wikipedia.org');
    expect(resolveOmniboxInput('http://localhost:8080')).toBe('http://localhost:8080');
    expect(resolveOmniboxInput('privacy browsers for android', 'brave')).toBe(
      'https://search.brave.com/search?q=privacy%20browsers%20for%20android'
    );
    expect(
      resolveOmniboxInput('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
    ).toBe('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
  });

  it('extracts security and internal flags cleanly', () => {
    expect(formatDisplayUrl('aegis://home')).toEqual({
      hostLabel: 'Aegis Start',
      isSecure: true,
      isInternal: true,
    });
    expect(formatDisplayUrl('https://www.eff.org/pages/privacy')).toEqual({
      hostLabel: 'eff.org/pages/privacy',
      isSecure: true,
      isInternal: false,
    });
  });
});
