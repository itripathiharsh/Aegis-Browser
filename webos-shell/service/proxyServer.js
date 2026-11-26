'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');
const { FilterEngineLite, extractHost, isHostShieldsEnabled } = require('./filterEngineLite');

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_CSS_BYTES = 2 * 1024 * 1024;

const STRIP_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-security-policy',
  'x-webkit-csp',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'strict-transport-security',
  'transfer-encoding',
  'connection',
]);

function isLoopbackHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]' || h === '::1';
}

function isAllowedUpstreamUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const lower = rawUrl.trim().toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false;
  const parsed = url.parse(rawUrl);
  if (!parsed || !parsed.hostname) return false;
  if (isLoopbackHost(parsed.hostname)) return false;
  return true;
}

function buildProxyHref(proxyBaseUrl, rawTarget, baseUrl, tabId, incognito, desktop) {
  if (!rawTarget) return rawTarget;
  const trimmed = rawTarget.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    /^(javascript:|data:|blob:|mailto:|tel:|sms:|about:|nivrok:\/\/)/i.test(trimmed)
  ) {
    return rawTarget;
  }
  if (trimmed.indexOf(proxyBaseUrl + '/proxy?') === 0) {
    return rawTarget;
  }
  let resolved;
  try {
    resolved = url.resolve(baseUrl, trimmed);
  } catch (err) {
    return rawTarget;
  }
  if (!resolved.startsWith('http://') && !resolved.startsWith('https://')) {
    return rawTarget;
  }
  const params = ['url=' + encodeURIComponent(resolved)];
  if (tabId) params.push('tabId=' + encodeURIComponent(tabId));
  if (incognito) params.push('incognito=1');
  if (desktop) params.push('desktop=1');
  params.push('referer=' + encodeURIComponent(baseUrl));
  return proxyBaseUrl + '/proxy?' + params.join('&');
}

function rewriteCssUrls(css, baseUrl, proxyBaseUrl, tabId, incognito, desktop) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (match, quote, inner) {
    const trimmed = String(inner || '').trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) {
      return match;
    }
    const rewritten = buildProxyHref(proxyBaseUrl, trimmed, baseUrl, tabId, incognito, desktop);
    const q = quote || '"';
    return 'url(' + q + rewritten + q + ')';
  });
}

function rewriteSrcset(srcset, baseUrl, proxyBaseUrl, tabId, incognito, desktop) {
  return srcset
    .split(',')
    .map(function (item) {
      const trimmed = item.trim();
      if (!trimmed) return item;
      const parts = trimmed.split(/\s+/);
      parts[0] = buildProxyHref(proxyBaseUrl, parts[0], baseUrl, tabId, incognito, desktop);
      return parts.join(' ');
    })
    .join(', ');
}

function buildInjectedBridgeScript(opts) {
  const safeBase = JSON.stringify(opts.finalUrl);
  const safeProxy = JSON.stringify(opts.proxyBaseUrl);
  const safeTabId = JSON.stringify(opts.tabId || '');
  const safeIncognito = opts.incognito ? 'true' : 'false';
  const safeDesktop = opts.desktop ? 'true' : 'false';
  const blockPopups = opts.blockPopups ? 'true' : 'false';
  const cosmeticCss = opts.cosmeticCss ? JSON.stringify(opts.cosmeticCss) : '""';

  return (
    '<script id="nivrok-webos-runtime">(function(){' +
    'var __ORIGIN_URL=' + safeBase + ';' +
    'var __PROXY_BASE=' + safeProxy + ';' +
    'var __TAB_ID=' + safeTabId + ';' +
    'var __INCOG=' + safeIncognito + ';' +
    'var __DESKTOP=' + safeDesktop + ';' +
    'var __BLOCK_POPUPS=' + blockPopups + ';' +
    'var __COSMETIC_CSS=' + cosmeticCss + ';' +
    'function toProxy(u){' +
      'if(!u)return u;' +
      'var s=String(u).trim();' +
      'if(!s||s[0]==="#"||/^(javascript:|data:|blob:|mailto:|tel:|sms:|about:|nivrok:\\/\\/)/i.test(s))return u;' +
      'if(s.indexOf(__PROXY_BASE+"/proxy?")===0)return s;' +
      'try{var abs=new URL(s,__ORIGIN_URL).href;' +
        'if(!/^https?:\\/\\//i.test(abs))return u;' +
        'var p="url="+encodeURIComponent(abs);' +
        'if(__TAB_ID)p+="&tabId="+encodeURIComponent(__TAB_ID);' +
        'if(__INCOG)p+="&incognito=1";' +
        'if(__DESKTOP)p+="&desktop=1";' +
        'p+="&referer="+encodeURIComponent(__ORIGIN_URL);' +
        'return __PROXY_BASE+"/proxy?"+p;' +
      '}catch(e){return u;}' +
    '}' +
    'function postMeta(){' +
      'try{if(window.parent&&window.parent!==window){' +
        'window.parent.postMessage({type:"nivrok:page-meta",tabId:__TAB_ID,url:__ORIGIN_URL,title:document.title||__ORIGIN_URL},"*");' +
      '}}catch(e){}' +
    '}' +
    'if(__COSMETIC_CSS){' +
      'try{var st=document.createElement("style");st.id="nivrok-cosmetic-style";st.textContent=__COSMETIC_CSS;' +
        '(document.head||document.documentElement).appendChild(st);' +
      '}catch(e){}' +
    '}' +
    'var origOpen=window.open;' +
    'window.open=function(u){' +
      'if(__BLOCK_POPUPS){' +
        'try{if(window.parent&&window.parent!==window){' +
          'window.parent.postMessage({type:"nivrok:blocked",category:"popups",url:String(u||""),pageUrl:__ORIGIN_URL},"*");' +
        '}}catch(e){}' +
        'return null;' +
      '}' +
      'return origOpen.apply(window,arguments);' +
    '};' +
    'if(window.fetch){' +
      'var origFetch=window.fetch;' +
      'window.fetch=function(input,init){' +
        'try{' +
          'var reqUrl=typeof input==="string"?input:(input&&input.url?input.url:"");' +
          'if(reqUrl&&!/^data:|^blob:/i.test(reqUrl)&&reqUrl.indexOf(__PROXY_BASE)!==0){' +
            'var proxied=toProxy(reqUrl);' +
            'if(typeof input==="string")input=proxied;' +
            'else if(input&&typeof Request!=="undefined")input=new Request(proxied,input);' +
          '}' +
        '}catch(e){}' +
        'return origFetch.call(this,input,init);' +
      '};' +
    '}' +
    'if(window.XMLHttpRequest&&XMLHttpRequest.prototype){' +
      'var origXhrOpen=XMLHttpRequest.prototype.open;' +
      'XMLHttpRequest.prototype.open=function(method,u){' +
        'try{' +
          'if(u&&!/^data:|^blob:/i.test(String(u))&&String(u).indexOf(__PROXY_BASE)!==0){' +
            'arguments[1]=toProxy(String(u));' +
          '}' +
        '}catch(e){}' +
        'return origXhrOpen.apply(this,arguments);' +
      '};' +
    '}' +
    'document.addEventListener("click",function(ev){' +
      'var el=ev.target;' +
      'while(el&&el.tagName!=="A")el=el.parentElement;' +
      'if(!el)return;' +
      'var raw=el.getAttribute("href");' +
      'if(!raw||raw[0]==="#"||/^(javascript:|mailto:|tel:)/i.test(raw))return;' +
      'if(raw.indexOf(__PROXY_BASE+"/proxy?")!==0){' +
        'ev.preventDefault();' +
        'location.assign(toProxy(raw));' +
      '}else if(el.getAttribute("target")==="_blank"){' +
        'ev.preventDefault();' +
        'location.assign(raw);' +
      '}' +
    '},true);' +
    'document.addEventListener("submit",function(ev){' +
      'var form=ev.target;' +
      'if(!form||form.tagName!=="FORM")return;' +
      'var method=(form.getAttribute("method")||"GET").toUpperCase();' +
      'var rawAction=form.getAttribute("action")||__ORIGIN_URL;' +
      'var targetHref=rawAction;' +
      'if(rawAction.indexOf(__PROXY_BASE+"/proxy?")===0){' +
        'try{var sp=new URL(rawAction).searchParams;if(sp.get("url"))targetHref=sp.get("url");}catch(e){}' +
      '}' +
      'if(method==="GET"){' +
        'ev.preventDefault();' +
        'try{' +
          'var dest=new URL(targetHref,__ORIGIN_URL);' +
          'var fd=new FormData(form);' +
          'fd.forEach(function(v,k){dest.searchParams.set(k,String(v));});' +
          'location.assign(toProxy(dest.href));' +
        '}catch(e){}' +
      '}else{' +
        'form.setAttribute("action",toProxy(targetHref));' +
      '}' +
    '},true);' +
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",postMeta);' +
    'else postMeta();' +
    'window.addEventListener("load",postMeta);' +
    '})();</script>'
  );
}

function rewriteHtmlDocument(html, opts) {
  const baseUrl = opts.finalUrl;
  const proxyBaseUrl = opts.proxyBaseUrl;
  const tabId = opts.tabId;
  const incognito = opts.incognito;
  const desktop = opts.desktop;

  // Strip strict frame busting / CSP meta tags in HTML
  let out = html.replace(
    /<meta[^>]+http-equiv\s*=\s*(['"]?)(?:content-security-policy|x-frame-options)\1[^>]*>/gi,
    ''
  );

  // Rewrite meta refresh
  out = out.replace(
    /(<meta[^>]+http-equiv\s*=\s*(['"]?)refresh\2[^>]*content\s*=\s*(['"]))([^'"]*)(\3[^>]*>)/gi,
    function (match, pre, q1, q2, contentVal, post) {
      const rewritten = contentVal.replace(/(url\s*=\s*)([^\s;]+)/i, function (m, p, target) {
        return p + buildProxyHref(proxyBaseUrl, target, baseUrl, tabId, incognito, desktop);
      });
      return pre + rewritten + post;
    }
  );

  // Rewrite href / src / action / poster / data-src attributes
  out = out.replace(
    /\b(href|src|action|poster|data-src)\s*=\s*(['"])([^'"]*)\2/gi,
    function (match, attr, quote, val) {
      if (attr.toLowerCase() === 'href' && val.trim().startsWith('#')) {
        return match;
      }
      const nextVal = buildProxyHref(proxyBaseUrl, val, baseUrl, tabId, incognito, desktop);
      return attr + '=' + quote + nextVal + quote;
    }
  );

  // Rewrite srcset
  out = out.replace(/\bsrcset\s*=\s*(['"])([^'"]*)\1/gi, function (match, quote, val) {
    return 'srcset=' + quote + rewriteSrcset(val, baseUrl, proxyBaseUrl, tabId, incognito, desktop) + quote;
  });

  // Remove integrity attributes since proxied response rewrites or strips headers
  out = out.replace(/\s+integrity\s*=\s*(['"])[^'"]*\1/gi, '');

  const bridgeScript = buildInjectedBridgeScript(opts);
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, function (tag) {
      return tag + '\n' + bridgeScript;
    });
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html[^>]*>/i, function (tag) {
      return tag + '\n<head>' + bridgeScript + '</head>';
    });
  } else {
    out = bridgeScript + '\n' + out;
  }

  return out;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function decompressBody(buffer, encoding, callback) {
  const enc = String(encoding || '').toLowerCase();
  if (enc.indexOf('gzip') >= 0) {
    zlib.gunzip(buffer, function (err, out) {
      callback(null, err ? buffer : out);
    });
    return;
  }
  if (enc.indexOf('deflate') >= 0) {
    zlib.inflate(buffer, function (err, out) {
      callback(null, err ? buffer : out);
    });
    return;
  }
  if (enc.indexOf('br') >= 0 && typeof zlib.brotliDecompress === 'function') {
    zlib.brotliDecompress(buffer, function (err, out) {
      callback(null, err ? buffer : out);
    });
    return;
  }
  callback(null, buffer);
}

function createFilterProxyServer(options) {
  const opts = options || {};
  const filterEngine = opts.filterEngine || new FilterEngineLite();
  const filterStats = opts.initialStats || filterEngine.compileFromDir(opts.filtersDir);

  let shields = {
    enabled: true,
    blockAdsAndTrackers: true,
    blockPopups: true,
    cosmeticFiltering: true,
    disabledHosts: [],
  };

  const telemetry = {
    totalBlocked: 0,
    adsBlocked: 0,
    trackersBlocked: 0,
    popupsBlocked: 0,
    recentEvents: [],
  };

  function recordBlocked(targetUrl, pageUrl, decision) {
    const category = decision && decision.category ? decision.category : 'ads';
    telemetry.totalBlocked += 1;
    if (category === 'trackers') telemetry.trackersBlocked += 1;
    else if (category === 'popups') telemetry.popupsBlocked += 1;
    else telemetry.adsBlocked += 1;

    telemetry.recentEvents.unshift({
      url: targetUrl,
      host: extractHost(targetUrl) || targetUrl,
      pageHost: extractHost(pageUrl) || '',
      rule: (decision && decision.matchedRule) || 'blocked',
      category,
      timestampMs: Date.now(),
    });
    if (telemetry.recentEvents.length > 30) {
      telemetry.recentEvents.length = 30;
    }
  }

  let server = null;
  let boundPort = 0;

  function getBaseUrl() {
    return boundPort ? 'http://127.0.0.1:' + boundPort : null;
  }

  function fetchUpstream(req, res, targetUrl, reqOpts, redirectsLeft) {
    if (!isAllowedUpstreamUrl(targetUrl)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end('Blocked or invalid upstream URL.');
      return;
    }

    const decision = filterEngine.evaluate(
      targetUrl,
      reqOpts.referer || targetUrl,
      shields,
      /\.(m?js)(\?|$)/i.test(targetUrl)
    );
    if (decision.blocked) {
      recordBlocked(targetUrl, reqOpts.referer || targetUrl, decision);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Nivrok-Blocked': '1',
        'Cache-Control': 'no-store',
      });
      res.end('');
      return;
    }

    const parsed = url.parse(targetUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    const isDesktop = Boolean(reqOpts.desktop);
    const ua = isDesktop
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      : 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.211 Safari/537.36';

    const headers = {
      'User-Agent': ua,
      Accept: req.headers.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }
    if (reqOpts.referer && isAllowedUpstreamUrl(reqOpts.referer)) {
      headers.Referer = reqOpts.referer;
    }
    if (!reqOpts.incognito && req.headers.cookie) {
      headers.Cookie = req.headers.cookie;
    }
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }
    if (req.headers['content-length']) {
      headers['Content-Length'] = req.headers['content-length'];
    }

    const upstreamReq = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.path || '/',
        method: req.method === 'HEAD' || req.method === 'POST' ? req.method : 'GET',
        headers,
        timeout: 20000,
      },
      function (upstreamRes) {
        const status = upstreamRes.statusCode || 200;
        if (status >= 300 && status < 400 && upstreamRes.headers.location && redirectsLeft > 0) {
          upstreamRes.resume();
          const nextUrl = url.resolve(targetUrl, upstreamRes.headers.location);
          fetchUpstream(
            req,
            res,
            nextUrl,
            {
              referer: reqOpts.referer || targetUrl,
              tabId: reqOpts.tabId,
              incognito: reqOpts.incognito,
              desktop: reqOpts.desktop,
            },
            redirectsLeft - 1
          );
          return;
        }

        const outHeaders = { 'Access-Control-Allow-Origin': '*' };
        const headerKeys = Object.keys(upstreamRes.headers);
        for (let i = 0; i < headerKeys.length; i += 1) {
          const k = headerKeys[i].toLowerCase();
          if (STRIP_RESPONSE_HEADERS.has(k)) continue;
          if (k === 'set-cookie' && reqOpts.incognito) continue;
          outHeaders[k] = upstreamRes.headers[headerKeys[i]];
        }

        const contentType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
        const isHtml = contentType.indexOf('text/html') >= 0 || contentType.indexOf('application/xhtml+xml') >= 0;
        const isCss = contentType.indexOf('text/css') >= 0;

        if (!isHtml && !isCss) {
          res.writeHead(status, outHeaders);
          upstreamRes.pipe(res);
          return;
        }

        const maxBytes = isHtml ? MAX_HTML_BYTES : MAX_CSS_BYTES;
        const chunks = [];
        let total = 0;
        let overflowed = false;

        upstreamRes.on('data', function (chunk) {
          if (overflowed) return;
          total += chunk.length;
          if (total > maxBytes) {
            overflowed = true;
            res.writeHead(status, outHeaders);
            for (let i = 0; i < chunks.length; i += 1) res.write(chunks[i]);
            res.write(chunk);
            return;
          }
          chunks.push(chunk);
        });

        upstreamRes.on('end', function () {
          if (overflowed) {
            res.end();
            return;
          }
          const rawBuf = Buffer.concat(chunks);
          decompressBody(rawBuf, upstreamRes.headers['content-encoding'], function (_err, decodedBuf) {
            const text = decodedBuf.toString('utf8');
            const proxyBaseUrl = getBaseUrl() || 'http://127.0.0.1:' + boundPort;
            const pageHost = extractHost(targetUrl);

            let rewrittenText = text;
            if (isHtml) {
              const selectors = filterEngine.getCosmeticSelectors(pageHost, shields);
              const cosmeticCss =
                selectors.length > 0
                  ? selectors.slice(0, 600).join(',\n') + ' {\n  display: none !important;\n}\n'
                  : '';
              rewrittenText = rewriteHtmlDocument(text, {
                finalUrl: targetUrl,
                proxyBaseUrl,
                tabId: reqOpts.tabId,
                incognito: reqOpts.incognito,
                desktop: reqOpts.desktop,
                blockPopups: shields.enabled && shields.blockPopups && isHostShieldsEnabled(shields, pageHost),
                cosmeticCss,
              });
            } else if (isCss) {
              rewrittenText = rewriteCssUrls(
                text,
                targetUrl,
                proxyBaseUrl,
                reqOpts.tabId,
                reqOpts.incognito,
                reqOpts.desktop
              );
            }

            const finalBuf = Buffer.from(rewrittenText, 'utf8');
            delete outHeaders['content-encoding'];
            outHeaders['content-length'] = finalBuf.length;
            res.writeHead(status, outHeaders);
            res.end(finalBuf);
          });
        });

        upstreamRes.on('error', function (err) {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          }
          res.end('Upstream error: ' + err.message);
        });
      }
    );

    upstreamReq.on('timeout', function () {
      upstreamReq.abort();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end('Gateway Timeout loading ' + targetUrl);
      }
    });

    upstreamReq.on('error', function (err) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end('Network error loading ' + targetUrl + ': ' + err.message);
      }
    });

    if (req.method === 'POST') {
      req.pipe(upstreamReq);
    } else {
      upstreamReq.end();
    }
  }

  function handleRequest(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
      });
      res.end();
      return;
    }

    const parsedReq = url.parse(req.url || '/', true);
    const pathname = parsedReq.pathname || '/';

    if (pathname === '/health') {
      sendJson(res, 200, {
        returnValue: true,
        status: 'ok',
        baseUrl: getBaseUrl(),
        filterStats,
      });
      return;
    }

    if (pathname === '/stats') {
      sendJson(res, 200, {
        returnValue: true,
        baseUrl: getBaseUrl(),
        filterStats: filterEngine.getStats(),
        telemetry,
        shields,
      });
      return;
    }

    if (pathname === '/shields' && req.method === 'POST') {
      let body = '';
      req.on('data', function (chunk) {
        body += chunk;
      });
      req.on('end', function () {
        try {
          const parsed = JSON.parse(body || '{}');
          shields = {
            enabled: parsed.enabled !== undefined ? Boolean(parsed.enabled) : shields.enabled,
            blockAdsAndTrackers:
              parsed.blockAdsAndTrackers !== undefined
                ? Boolean(parsed.blockAdsAndTrackers)
                : shields.blockAdsAndTrackers,
            blockPopups: parsed.blockPopups !== undefined ? Boolean(parsed.blockPopups) : shields.blockPopups,
            cosmeticFiltering:
              parsed.cosmeticFiltering !== undefined ? Boolean(parsed.cosmeticFiltering) : shields.cosmeticFiltering,
            disabledHosts: Array.isArray(parsed.disabledHosts) ? parsed.disabledHosts : shields.disabledHosts,
          };
          sendJson(res, 200, { returnValue: true, shields });
        } catch (err) {
          sendJson(res, 400, { returnValue: false, errorText: 'Invalid shields payload' });
        }
      });
      return;
    }

    if (pathname === '/proxy') {
      const q = parsedReq.query || {};
      const targetUrl = Array.isArray(q.url) ? q.url[0] : q.url;
      const referer = Array.isArray(q.referer) ? q.referer[0] : q.referer;
      const tabId = Array.isArray(q.tabId) ? q.tabId[0] : q.tabId;
      const incognito = q.incognito === '1' || q.incognito === 'true';
      const desktop = q.desktop === '1' || q.desktop === 'true';
      fetchUpstream(req, res, targetUrl, { referer, tabId, incognito, desktop }, MAX_REDIRECTS);
      return;
    }

    sendJson(res, 404, { returnValue: false, errorText: 'Unknown route' });
  }

  return {
    start: function () {
      return new Promise(function (resolve, reject) {
        if (server && boundPort) {
          resolve({ baseUrl: getBaseUrl(), port: boundPort, filterStats: filterEngine.getStats() });
          return;
        }
        server = http.createServer(handleRequest);
        server.on('error', reject);
        server.listen(opts.port || 0, '127.0.0.1', function () {
          const addr = server.address();
          boundPort = addr && typeof addr === 'object' ? addr.port : opts.port || 0;
          resolve({
            baseUrl: getBaseUrl(),
            port: boundPort,
            filterStats: filterEngine.getStats(),
          });
        });
      });
    },
    stop: function () {
      return new Promise(function (resolve) {
        if (!server) {
          resolve();
          return;
        }
        server.close(function () {
          server = null;
          boundPort = 0;
          resolve();
        });
      });
    },
    getStats: function () {
      return {
        returnValue: true,
        baseUrl: getBaseUrl(),
        filterStats: filterEngine.getStats(),
        telemetry,
        shields,
      };
    },
    updateShields: function (next) {
      if (!next) return shields;
      shields = {
        enabled: next.enabled !== undefined ? Boolean(next.enabled) : shields.enabled,
        blockAdsAndTrackers:
          next.blockAdsAndTrackers !== undefined ? Boolean(next.blockAdsAndTrackers) : shields.blockAdsAndTrackers,
        blockPopups: next.blockPopups !== undefined ? Boolean(next.blockPopups) : shields.blockPopups,
        cosmeticFiltering:
          next.cosmeticFiltering !== undefined ? Boolean(next.cosmeticFiltering) : shields.cosmeticFiltering,
        disabledHosts: Array.isArray(next.disabledHosts) ? next.disabledHosts : shields.disabledHosts,
      };
      return shields;
    },
    recordClientBlocked: function (urlStr, pageUrl, category) {
      recordBlocked(urlStr || 'popup://blocked', pageUrl || '', {
        category: category || 'popups',
        matchedRule: 'scriptlet-popup-guard',
      });
    },
  };
}

module.exports = {
  createFilterProxyServer,
  rewriteHtmlDocument,
  rewriteCssUrls,
};
