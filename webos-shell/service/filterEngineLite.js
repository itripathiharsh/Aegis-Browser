'use strict';

const fs = require('fs');
const path = require('path');

const UNSUPPORTED_MODIFIERS = new Set([
  'csp',
  'redirect',
  'redirect-rule',
  'removeparam',
  'replace',
  'header',
  'permissions',
]);

const DEFAULT_SOURCES = [
  { file: 'easylist-core.txt', category: 'ads' },
  { file: 'easyprivacy-core.txt', category: 'trackers' },
  { file: 'ublock-ads-core.txt', category: 'ads' },
  { file: 'cosmetic-rules.txt', category: 'ads' },
];

function extractHost(urlString) {
  if (!urlString) return null;
  try {
    let raw = String(urlString).trim();
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      if (raw.includes('://')) return null;
      raw = 'https://' + raw;
    }
    const idxScheme = raw.indexOf('://');
    const rest = idxScheme >= 0 ? raw.slice(idxScheme + 3) : raw;
    const authority = rest.split(/[/?#]/)[0];
    if (!authority) return null;
    const hostPort = authority.includes('@') ? authority.split('@').pop() : authority;
    if (!hostPort) return null;
    const host = hostPort.split(':')[0].toLowerCase().replace(/\.$/, '');
    return host || null;
  } catch (err) {
    return null;
  }
}

function getRegistrableDomain(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  const multiPartTlds = new Set([
    'co.uk',
    'org.uk',
    'gov.uk',
    'ac.uk',
    'co.in',
    'net.in',
    'org.in',
    'com.au',
    'net.au',
    'org.au',
    'co.jp',
    'ne.jp',
    'com.br',
    'com.mx',
    'co.nz',
    'co.za',
  ]);
  if (multiPartTlds.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

function isThirdPartyRequest(requestHost, pageHost) {
  if (!pageHost) return false;
  return getRegistrableDomain(requestHost) !== getRegistrableDomain(pageHost);
}

function isHostShieldsEnabled(config, pageHost) {
  if (!config || !config.enabled) return false;
  if (!pageHost) return true;
  const hostLower = pageHost.toLowerCase();
  const disabled = Array.isArray(config.disabledHosts) ? config.disabledHosts : [];
  for (let i = 0; i < disabled.length; i += 1) {
    const raw = String(disabled[i] || '').toLowerCase().trim();
    if (!raw) continue;
    if (hostLower === raw || hostLower.endsWith('.' + raw)) {
      return false;
    }
  }
  return true;
}

function parseOptions(optionsPart) {
  let thirdPartyOnly = null;
  let scriptOnly = false;
  const allowedDomains = new Set();
  const excludedDomains = new Set();

  if (!optionsPart) {
    return { thirdPartyOnly, scriptOnly, unsupported: false, allowedDomains, excludedDomains };
  }

  const parts = optionsPart.split(',');
  for (let i = 0; i < parts.length; i += 1) {
    const opt = parts[i].trim().toLowerCase();
    if (!opt) continue;
    const eqIdx = opt.indexOf('=');
    const key = eqIdx >= 0 ? opt.slice(0, eqIdx) : opt;
    if (UNSUPPORTED_MODIFIERS.has(key)) {
      return { thirdPartyOnly, scriptOnly, unsupported: true, allowedDomains, excludedDomains };
    }
    if (opt === 'third-party' || opt === '3p') thirdPartyOnly = true;
    else if (opt === '~third-party' || opt === '1p' || opt === 'first-party') thirdPartyOnly = false;
    else if (opt === 'script') scriptOnly = true;
    else if (opt.startsWith('domain=') || opt.startsWith('from=')) {
      const doms = opt.slice(eqIdx + 1).split('|');
      for (let j = 0; j < doms.length; j += 1) {
        const d = doms[j].trim();
        if (d.startsWith('~') && d.length > 1) excludedDomains.add(d.slice(1));
        else if (d) allowedDomains.add(d);
      }
    }
  }
  return { thirdPartyOnly, scriptOnly, unsupported: false, allowedDomains, excludedDomains };
}

function isPureDomainBody(body) {
  const stripped = body.replace(/^\|\|/, '').replace(/\^$/, '');
  return (
    Boolean(stripped) &&
    stripped.indexOf('.') >= 0 &&
    stripped.indexOf('/') < 0 &&
    stripped.indexOf('*') < 0 &&
    stripped.indexOf('?') < 0 &&
    stripped.indexOf('^') < 0
  );
}

function abpToRegex(pattern) {
  let out = '';
  let p = pattern;
  if (p.startsWith('||')) {
    out += '^https?://([^/]+\\.)?';
    p = p.slice(2);
  } else if (p.startsWith('|')) {
    out += '^';
    p = p.slice(1);
  }
  const endsPipe = p.endsWith('|');
  if (endsPipe) p = p.slice(0, -1);

  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i];
    if (ch === '*') out += '.*';
    else if (ch === '^') out += '([^a-zA-Z0-9_.%-]|$)';
    else if ('.?+()[]{}\\|'.indexOf(ch) >= 0) out += '\\' + ch;
    else out += ch;
  }
  if (endsPipe) out += '$';
  return new RegExp(out);
}

function compilePatternRule(raw, body, opts, category, isException) {
  if (!body || body === '*' || (body.startsWith('/') && body.endsWith('/') && body.length > 2)) {
    return null;
  }
  const clean = body.toLowerCase();
  const segments = clean.replace(/^\|\|?/, '').split(/[*^]/);
  let anchor = '';
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].length > anchor.length) anchor = segments[i];
  }
  if (anchor.length < 3) return null;

  let regex = null;
  if (clean.indexOf('*') >= 0 || clean.indexOf('^') >= 0 || clean.startsWith('||')) {
    try {
      regex = abpToRegex(clean);
    } catch (err) {
      regex = null;
    }
  }

  let hostScope = null;
  if (!isException && clean.startsWith('||')) {
    const h = clean.slice(2).split(/[/*^?]/)[0];
    if (h.indexOf('.') >= 0 && h.length >= 4) hostScope = h;
  }

  return {
    raw,
    anchorLower: anchor,
    regex,
    thirdPartyOnly: opts.thirdPartyOnly,
    allowedDomains: opts.allowedDomains,
    excludedDomains: opts.excludedDomains,
    scriptOnly: opts.scriptOnly,
    category,
    hostScope,
  };
}

function inferCategory(body, fallback) {
  const l = body.toLowerCase();
  if (
    l.indexOf('popad') >= 0 ||
    l.indexOf('popcash') >= 0 ||
    l.indexOf('popunder') >= 0 ||
    l.indexOf('clickadu') >= 0 ||
    l.indexOf('onclick') >= 0 ||
    l.indexOf('redirect') >= 0
  ) {
    return 'popups';
  }
  if (
    l.indexOf('analytics') >= 0 ||
    l.indexOf('track') >= 0 ||
    l.indexOf('pixel') >= 0 ||
    l.indexOf('beacon') >= 0 ||
    l.indexOf('telemetry') >= 0
  ) {
    return 'trackers';
  }
  return fallback;
}

function isSafeCosmeticSelector(selector) {
  if (!selector || selector.length > 180) return false;
  if (
    selector.indexOf(':has(') >= 0 ||
    selector.indexOf(':xpath(') >= 0 ||
    selector.indexOf('+js(') >= 0 ||
    selector.indexOf('{') >= 0 ||
    selector.indexOf('}') >= 0
  ) {
    return false;
  }
  return true;
}

function findDomainRule(host, map) {
  let cur = host;
  while (cur) {
    const hit = map.get(cur);
    if (hit) return hit;
    const dot = cur.indexOf('.');
    cur = dot >= 0 && dot + 1 < cur.length ? cur.slice(dot + 1) : null;
  }
  return null;
}

function matchesDomainSet(host, set) {
  if (!set || set.size === 0) return false;
  let cur = host;
  while (cur) {
    if (set.has(cur)) return true;
    const dot = cur.indexOf('.');
    cur = dot >= 0 && dot + 1 < cur.length ? cur.slice(dot + 1) : null;
  }
  return false;
}

function matchesPatternRule(rule, lowerUrl, pageHost, thirdParty, isScript) {
  if (lowerUrl.indexOf(rule.anchorLower) < 0) return false;
  if (rule.thirdPartyOnly !== null && rule.thirdPartyOnly !== thirdParty) return false;
  if (rule.scriptOnly && !isScript) return false;
  if (rule.allowedDomains.size > 0) {
    if (!pageHost || !matchesDomainSet(pageHost, rule.allowedDomains)) return false;
  }
  if (rule.excludedDomains.size > 0 && pageHost) {
    if (matchesDomainSet(pageHost, rule.excludedDomains)) return false;
  }
  return rule.regex ? rule.regex.test(lowerUrl) : lowerUrl.indexOf(rule.anchorLower) >= 0;
}

class FilterEngineLite {
  constructor() {
    this.blockedDomains = new Map();
    this.exceptionDomains = new Set();
    this.hostPatternRules = new Map();
    this.patternRules = [];
    this.exceptionPatterns = [];
    this.globalCosmetics = new Set();
    this.domainCosmetics = new Map();
    this.lastUpdatedIso = new Date().toISOString();
  }

  compile(sources) {
    const blockedDomains = new Map();
    const exceptionDomains = new Set();
    const hostPatternRules = new Map();
    const patternRules = [];
    const exceptionPatterns = [];
    const globalCosmetics = new Set();
    const domainCosmetics = new Map();

    for (let sIdx = 0; sIdx < sources.length; sIdx += 1) {
      const src = sources[sIdx];
      const category = src.category || 'ads';
      const lines = String(src.content || '').split(/\r?\n/);

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line || line.startsWith('!') || line.startsWith('[Adblock')) continue;

        if (line.startsWith('0.0.0.0 ') || line.startsWith('127.0.0.1 ')) {
          const clean = line.split('#')[0].trim();
          const parts = clean.split(/\s+/);
          const domain = parts[1] ? parts[1].toLowerCase() : '';
          if (
            domain &&
            domain.indexOf('.') >= 0 &&
            domain !== 'localhost' &&
            domain !== 'localhost.localdomain' &&
            domain !== '0.0.0.0' &&
            domain !== '255.255.255.255'
          ) {
            if (!blockedDomains.has(domain)) {
              blockedDomains.set(domain, { thirdPartyOnly: null, category, raw: line });
            }
          }
          continue;
        }

        if (line.startsWith('#')) {
          if (line.startsWith('##')) {
            const selector = line.slice(2).trim();
            if (isSafeCosmeticSelector(selector)) {
              globalCosmetics.add(selector);
            }
          }
          continue;
        }

        if (line.indexOf('#@#') >= 0 || line.indexOf('#?#') >= 0) continue;

        const cosmeticIdx = line.indexOf('##');
        if (cosmeticIdx > 0 && !line.startsWith('||') && !line.startsWith('@@')) {
          const doms = line.slice(0, cosmeticIdx).split(',');
          const selector = line.slice(cosmeticIdx + 2).trim();
          if (isSafeCosmeticSelector(selector)) {
            for (let dIdx = 0; dIdx < doms.length; dIdx += 1) {
              const cleanDom = doms[dIdx].trim().toLowerCase();
              if (cleanDom && !cleanDom.startsWith('~')) {
                let list = domainCosmetics.get(cleanDom);
                if (!list) {
                  list = [];
                  domainCosmetics.set(cleanDom, list);
                }
                list.push(selector);
              }
            }
          }
          continue;
        }

        const isException = line.startsWith('@@');
        const bodyAndOpts = isException ? line.slice(2) : line;
        const dollarIdx = bodyAndOpts.lastIndexOf('$');
        const hasOpts = dollarIdx > 0 && !bodyAndOpts.endsWith('/');
        const ruleBody = hasOpts ? bodyAndOpts.slice(0, dollarIdx) : bodyAndOpts;
        const optsPart = hasOpts ? bodyAndOpts.slice(dollarIdx + 1) : '';
        const opts = parseOptions(optsPart);
        if (opts.unsupported) continue;
        const inferredCat = inferCategory(ruleBody, category);

        if (ruleBody.startsWith('||') && isPureDomainBody(ruleBody)) {
          const domain = ruleBody.slice(2).replace(/\^$/, '').toLowerCase();
          if (domain && domain.indexOf('*') < 0) {
            if (isException) {
              exceptionDomains.add(domain);
              continue;
            }
            if (opts.allowedDomains.size === 0 && opts.excludedDomains.size === 0 && !opts.scriptOnly) {
              if (!blockedDomains.has(domain)) {
                blockedDomains.set(domain, {
                  thirdPartyOnly: opts.thirdPartyOnly,
                  category: inferredCat,
                  raw: line,
                });
              }
              continue;
            }
          }
        }

        const compiled = compilePatternRule(line, ruleBody, opts, inferredCat, isException);
        if (compiled) {
          if (isException) {
            exceptionPatterns.push(compiled);
          } else if (compiled.hostScope) {
            let list = hostPatternRules.get(compiled.hostScope);
            if (!list) {
              list = [];
              hostPatternRules.set(compiled.hostScope, list);
            }
            list.push(compiled);
          } else {
            patternRules.push(compiled);
          }
        }
      }
    }

    this.blockedDomains = blockedDomains;
    this.exceptionDomains = exceptionDomains;
    this.hostPatternRules = hostPatternRules;
    this.patternRules = patternRules;
    this.exceptionPatterns = exceptionPatterns;
    this.globalCosmetics = globalCosmetics;
    this.domainCosmetics = domainCosmetics;
    this.lastUpdatedIso = new Date().toISOString();

    return this.getStats();
  }

  compileFromDir(filtersDir) {
    const candidates = [
      filtersDir,
      path.join(__dirname, 'filters'),
      path.resolve(__dirname, '..', '..', 'shared-filters'),
    ].filter(Boolean);

    let resolvedDir = null;
    for (let i = 0; i < candidates.length; i += 1) {
      if (fs.existsSync(candidates[i])) {
        resolvedDir = candidates[i];
        break;
      }
    }

    if (!resolvedDir) {
      return this.compile([]);
    }

    const sources = [];
    for (let i = 0; i < DEFAULT_SOURCES.length; i += 1) {
      const meta = DEFAULT_SOURCES[i];
      const fullPath = path.join(resolvedDir, meta.file);
      if (fs.existsSync(fullPath)) {
        sources.push({
          category: meta.category,
          content: fs.readFileSync(fullPath, 'utf8'),
        });
      }
    }
    return this.compile(sources);
  }

  getStats() {
    let domainCosmeticCount = 0;
    this.domainCosmetics.forEach((list) => {
      domainCosmeticCount += list.length;
    });
    let hostPatternCount = 0;
    this.hostPatternRules.forEach((list) => {
      hostPatternCount += list.length;
    });
    return {
      domainRuleCount: this.blockedDomains.size,
      patternRuleCount: this.patternRules.length + hostPatternCount,
      exceptionRuleCount: this.exceptionDomains.size + this.exceptionPatterns.length,
      cosmeticSelectorCount: this.globalCosmetics.size + domainCosmeticCount,
      lastUpdatedIso: this.lastUpdatedIso,
    };
  }

  evaluate(requestUrl, pageUrl, config, isScript) {
    const pageHost = extractHost(pageUrl);
    if (!config || !config.enabled || !config.blockAdsAndTrackers || !isHostShieldsEnabled(config, pageHost)) {
      return { blocked: false, matchedRule: null, category: 'ads' };
    }

    const lowerUrl = String(requestUrl || '').toLowerCase();
    if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://')) {
      return { blocked: false, matchedRule: null, category: 'ads' };
    }

    const requestHost = extractHost(lowerUrl);
    if (!requestHost) {
      return { blocked: false, matchedRule: null, category: 'ads' };
    }

    const thirdParty = isThirdPartyRequest(requestHost, pageHost);

    if (matchesDomainSet(requestHost, this.exceptionDomains)) {
      return { blocked: false, matchedRule: null, category: 'ads' };
    }
    for (let i = 0; i < this.exceptionPatterns.length; i += 1) {
      if (matchesPatternRule(this.exceptionPatterns[i], lowerUrl, pageHost, thirdParty, Boolean(isScript))) {
        return { blocked: false, matchedRule: null, category: 'ads' };
      }
    }

    const domainMeta = findDomainRule(requestHost, this.blockedDomains);
    if (domainMeta) {
      if (domainMeta.thirdPartyOnly === null || domainMeta.thirdPartyOnly === thirdParty) {
        return {
          blocked: true,
          matchedRule: domainMeta.raw,
          category: domainMeta.category,
        };
      }
    }

    let curHost = requestHost;
    while (curHost) {
      const scoped = this.hostPatternRules.get(curHost);
      if (scoped) {
        for (let i = 0; i < scoped.length; i += 1) {
          if (matchesPatternRule(scoped[i], lowerUrl, pageHost, thirdParty, Boolean(isScript))) {
            return { blocked: true, matchedRule: scoped[i].raw, category: scoped[i].category };
          }
        }
      }
      const dot = curHost.indexOf('.');
      curHost = dot >= 0 && dot + 1 < curHost.length ? curHost.slice(dot + 1) : null;
    }

    for (let i = 0; i < this.patternRules.length; i += 1) {
      const rule = this.patternRules[i];
      if (matchesPatternRule(rule, lowerUrl, pageHost, thirdParty, Boolean(isScript))) {
        return { blocked: true, matchedRule: rule.raw, category: rule.category };
      }
    }

    return { blocked: false, matchedRule: null, category: 'ads' };
  }

  getCosmeticSelectors(pageHost, config) {
    if (!config || !config.enabled || !config.cosmeticFiltering || !isHostShieldsEnabled(config, pageHost)) {
      return [];
    }
    const selectors = new Set(this.globalCosmetics);
    if (pageHost) {
      let cur = pageHost.toLowerCase();
      while (cur) {
        const list = this.domainCosmetics.get(cur);
        if (list) {
          for (let i = 0; i < list.length; i += 1) selectors.add(list[i]);
        }
        const dot = cur.indexOf('.');
        cur = dot >= 0 && dot + 1 < cur.length ? cur.slice(dot + 1) : null;
      }
    }
    return Array.from(selectors);
  }
}

module.exports = {
  FilterEngineLite,
  extractHost,
  isHostShieldsEnabled,
};
