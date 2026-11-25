import { describe, expect, it } from 'vitest';
import { formatBytes, isNewerVersion, pickApkAsset } from './semver';

describe('semver updater utilities', () => {
  it('compares semantic tags accurately with v prefix and -debug suffix', () => {
    expect(isNewerVersion('v1.0.2', '1.0.0-debug')).toBe(true);
    expect(isNewerVersion('v1.1.0', '1.0.9')).toBe(true);
    expect(isNewerVersion('v2.0.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('v1.0.2', '1.0.2-beta.1')).toBe(true);

    expect(isNewerVersion('v1.0.0', '1.0.0-debug')).toBe(false);
    expect(isNewerVersion('v1.0.1', '1.0.2')).toBe(false);
    expect(isNewerVersion('v1.0.2-rc.1', '1.0.2')).toBe(false);
  });

  it('picks signed release APK over debug APK and formats size', () => {
    const picked = pickApkAsset([
      {
        name: 'app-debug.apk',
        browser_download_url: 'https://example.com/debug.apk',
        size: 3_500_000,
      },
      {
        name: 'AegisBrowser-v1.0.2.apk',
        browser_download_url: 'https://example.com/release.apk',
        size: 820_000,
      },
    ]);
    expect(picked?.name).toBe('AegisBrowser-v1.0.2.apk');
    expect(formatBytes(1_048_576)).toBe('1.00 MB');
  });
});
