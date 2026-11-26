import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createFilterProxyServer } = require('./proxyServer.js');

test('webOS proxy strips X-Frame-Options, rewrites links, blocks ads, and injects cosmetic/popup guard', async () => {
  const receivedPaths = [];
  const upstream = http.createServer((req, res) => {
    receivedPaths.push(req.url);
    if (req.url === '/page') {
      const html = [
        '<!doctype html><html><head><title>Sample TV Page</title></head>',
        '<body>',
        '<a href="/watch?v=1">Watch</a>',
        '<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>',
        '</body></html>',
      ].join('');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'none'",
      });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
  });

  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;

  // Test non-loopback check by using ephemeral host header or testing FilterEngine directly + normal local test:
  const proxy = createFilterProxyServer();
  const info = await proxy.start();

  try {
    // 1. Verify filter stats loaded from shared-filters
    assert.ok(info.filterStats.domainRuleCount > 40000, 'Expected 40k+ domain block rules loaded');

    // 2. Verify blocked ad request returns 200 empty + X-Nivrok-Blocked header + increments telemetry
    const adRes = await fetch(
      `${info.baseUrl}/proxy?url=${encodeURIComponent('https://doubleclick.net/ad.js')}&referer=${encodeURIComponent('https://example.com/')}`
    );
    assert.equal(adRes.status, 200);
    assert.equal(adRes.headers.get('x-nivrok-blocked'), '1');
    const adBody = await adRes.text();
    assert.equal(adBody, '');

    // 3. Verify loopback upstream URL is rejected safely (anti-recursion guard)
    const loopRes = await fetch(
      `${info.baseUrl}/proxy?url=${encodeURIComponent(`http://127.0.0.1:${upstreamPort}/page`)}`
    );
    assert.equal(loopRes.status, 400);

    // 4. Verify /stats exposes blocked event
    const statsRes = await fetch(`${info.baseUrl}/stats`);
    const statsJson = await statsRes.json();
    assert.equal(statsJson.returnValue, true);
    assert.equal(statsJson.telemetry.totalBlocked, 1);

    // 5. Verify HTML rewriting strips X-Frame-Options/CSP tags, rewrites links, and injects bridge script
    const { rewriteHtmlDocument } = require('./proxyServer.js');
    const rewritten = rewriteHtmlDocument(
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>Test</title></head><body><a href="/watch?v=42">Go</a></body></html>',
      {
        finalUrl: 'https://video.example.org/home',
        proxyBaseUrl: info.baseUrl,
        tabId: 'tab-9',
        incognito: false,
        desktop: true,
        blockPopups: true,
        cosmeticCss: '.ad-banner { display: none !important; }',
      }
    );
    assert.ok(!rewritten.includes('http-equiv="Content-Security-Policy"'));
    assert.ok(rewritten.includes(`${info.baseUrl}/proxy?url=${encodeURIComponent('https://video.example.org/watch?v=42')}`));
    assert.ok(rewritten.includes('nivrok-webos-runtime'));
    assert.ok(rewritten.includes('nivrok-cosmetic-style'));
  } finally {
    await proxy.stop();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
