import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWebOSProxiedUrl,
  isWebOSRuntime,
  requestLunaService,
} from './webosAdapter';

describe('webosAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects LG webOS runtime via PalmSystem / PalmServiceBridge', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    expect(isWebOSRuntime()).toBe(false);

    vi.stubGlobal('window', { PalmSystem: {} });
    expect(isWebOSRuntime()).toBe(true);
  });

  it('builds loopback proxied URLs preserving incognito and desktop flags', () => {
    const url = buildWebOSProxiedUrl(
      'http://127.0.0.1:41234',
      'https://example.org/watch?v=1',
      { id: 'tab-inc-7', incognito: true, desktopMode: true }
    );
    expect(url).toBe(
      'http://127.0.0.1:41234/proxy?url=https%3A%2F%2Fexample.org%2Fwatch%3Fv%3D1&tabId=tab-inc-7&incognito=1&desktop=1'
    );
  });

  it('calls Luna services cleanly through PalmServiceBridge fallback', async () => {
    const mockCall = vi.fn();
    class MockPalmServiceBridge {
      onservicecallback: ((raw: string) => void) | null = null;
      call(uri: string, params: string) {
        mockCall(uri, params);
        queueMicrotask(() => {
          this.onservicecallback?.(
            JSON.stringify({ returnValue: true, baseUrl: 'http://127.0.0.1:45555' })
          );
        });
      }
      cancel() {}
    }
    vi.stubGlobal('window', {
      PalmServiceBridge: MockPalmServiceBridge,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const res = await requestLunaService<{ returnValue: boolean; baseUrl: string }>(
      'luna://io.github.itripathiharsh.nivrok.service',
      'startProxy',
      {}
    );
    expect(mockCall).toHaveBeenCalledWith(
      'luna://io.github.itripathiharsh.nivrok.service/startProxy',
      '{}'
    );
    expect(res.baseUrl).toBe('http://127.0.0.1:45555');
  });
});
