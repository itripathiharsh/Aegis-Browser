import type { BlockCategory, BlockDecision, FilterStats, ShieldsConfig } from './types';

interface DomainRuleMeta {
  thirdPartyOnly: boolean | null;
  category: BlockCategory;
  raw: string;
}

interface PatternRule {
  raw: string;
  anchorLower: string;
  regex: RegExp | null;
  thirdPartyOnly: boolean | null;
  allowedDomains: Set<string>;
  excludedDomains: Set<string>;
  scriptOnly: boolean;
  category: BlockCategory;
  hostScope: string | null;
}

const UNSUPPORTED_MODIFIERS = new Set([
  'badfilter',
  'removeparam',
  'urlskip',
  'csp',
  'redirect',
  'redirect-rule',
  'permissions',
  'header',
  'replace',
  'hls',
  'jsonprune',
  'xmlprune',
  'generichide',
  'ghide',
  'elemhide',
  'ehide',
  'specifichide',
  'shide',
  'to',
  'method',
  'ipaddress',
]);

const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'co.in',
  'net.in',
  'org.in',
  'com.au',
  'net.au',
  'co.jp',
  'co.kr',
  'com.br',
  'com.mx',
  'co.za',
]);

export function extractHost(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    const withoutScheme = trimmed.includes('://') ? trimmed.split('://')[1] : trimmed;
    const host = withoutScheme.split('/')[0].split('?')[0].split(':')[0].toLowerCase();
    return host.includes('.') ? host : null;
  }
}

export function registrableDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${lastTwo}`;
  }
  return lastTwo;
}

export function isThirdPartyRequest(requestHost: string, pageHost: string | null): boolean {
  if (!pageHost) return false;
  return registrableDomain(requestHost) !== registrableDomain(pageHost);
}

export function isHostShieldsEnabled(config: ShieldsConfig, host: string | null): boolean {
  if (!config.enabled) return false;
  if (!host) return true;
  const norm = host.toLowerCase().replace(/^\.+/, '');
  return !config.disabledHosts.some(
    (disabled) => norm === disabled || norm.endsWith(`.${disabled}`)
  );
}

/**
 * Lightweight Adblock Plus / uBlock / Hosts filter engine for core-ui
 * (used directly in Phase 2 webOS, desktop preview, and the Shields rule tester).
 */
export class FilterEngine {
  private blockedDomains = new Map<string, DomainRuleMeta>();
  private exceptionDomains = new Set<string>();
  private hostPatternRules = new Map<string, PatternRule[]>();
  private patternRules: PatternRule[] = [];
  private exceptionPatterns: PatternRule[] = [];
  private globalCosmetics = new Set<string>();
  private domainCosmetics = new Map<string, string[]>();
  private lastUpdatedIso: string | null = null;

  compile(
    sources: Array<{ category: BlockCategory; content: string }>,
    lastUpdatedIso: string | null = null
  ): FilterStats {
    const blockedDomains = new Map<string, DomainRuleMeta>();
    const exceptionDomains = new Set<string>();
    const hostPatternRules = new Map<string, PatternRule[]>();
    const patternRules: PatternRule[] = [];
    const exceptionPatterns: PatternRule[] = [];
    const globalCosmetics = new Set<string>();
    const domainCosmetics = new Map<string, string[]>();

    for (const { category, content } of sources) {
      const lines = content.split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('!') || line.startsWith('[Adblock')) continue;

        if (line.startsWith('0.0.0.0 ') || line.startsWith('127.0.0.1 ')) {
          const clean = line.split('#')[0].trim();
          const parts = clean.split(/\s+/);
          const domain = parts[1]?.toLowerCase();
          if (
            domain &&
            domain.includes('.') &&
            domain !== 'localhost' &&
            domain !== 'localhost.localdomain' &&
            domain !== '0.0.0.0' &&
            domain !== '255.255.255.255'
          ) {
            if (!blockedDomains.has(domain)) {
              blockedDomains.set(domain, {
                thirdPartyOnly: null,
                category,
                raw: line,
              });
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

        if (line.includes('#@#') || line.includes('#?#')) continue;

        const cosmeticIdx = line.indexOf('##');
        if (cosmeticIdx > 0 && !line.startsWith('||') && !line.startsWith('@@')) {
          const doms = line.slice(0, cosmeticIdx).split(',');
          const selector = line.slice(cosmeticIdx + 2).trim();
          if (isSafeCosmeticSelector(selector)) {
            for (const d of doms) {
              const cleanDom = d.trim().toLowerCase();
              if (cleanDom && !cleanDom.startsWith('~')) {
                const list = domainCosmetics.get(cleanDom) ?? [];
                list.push(selector);
                domainCosmetics.set(cleanDom, list);
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
          if (domain && !domain.includes('*')) {
            if (isException) {
              exceptionDomains.add(domain);
              continue;
            }
            if (
              opts.allowedDomains.size === 0 &&
              opts.excludedDomains.size === 0 &&
              !opts.scriptOnly
            ) {
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
            const list = hostPatternRules.get(compiled.hostScope) ?? [];
            list.push(compiled);
            hostPatternRules.set(compiled.hostScope, list);
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
    if (lastUpdatedIso) {
      this.lastUpdatedIso = lastUpdatedIso;
    }

    return this.getStats();
  }

  getStats(): FilterStats {
    let domainCosmeticCount = 0;
    for (const list of this.domainCosmetics.values()) {
      domainCosmeticCount += list.length;
    }
    let hostPatternCount = 0;
    for (const list of this.hostPatternRules.values()) {
      hostPatternCount += list.length;
    }
    return {
      domainRuleCount: this.blockedDomains.size,
      patternRuleCount: this.patternRules.length + hostPatternCount,
      exceptionRuleCount: this.exceptionDomains.size + this.exceptionPatterns.length,
      cosmeticSelectorCount: this.globalCosmetics.size + domainCosmeticCount,
      lastUpdatedIso: this.lastUpdatedIso,
    };
  }

  evaluate(
    requestUrl: string,
    pageUrl: string | null,
    config: ShieldsConfig,
    isScript = false
  ): BlockDecision {
    const pageHost = extractHost(pageUrl);
    if (!config.enabled || !config.blockAdsAndTrackers || !isHostShieldsEnabled(config, pageHost)) {
      return { blocked: false, matchedRule: null, category: 'ads' };
    }

    const lowerUrl = requestUrl.toLowerCase();
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
    for (const ex of this.exceptionPatterns) {
      if (matchesPatternRule(ex, lowerUrl, pageHost, thirdParty, isScript)) {
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

    let curHost: string | null = requestHost;
    while (curHost) {
      const scoped = this.hostPatternRules.get(curHost);
      if (scoped) {
        for (const rule of scoped) {
          if (matchesPatternRule(rule, lowerUrl, pageHost, thirdParty, isScript)) {
            return { blocked: true, matchedRule: rule.raw, category: rule.category };
          }
        }
      }
      const dot = curHost.indexOf('.');
      curHost = dot >= 0 && dot + 1 < curHost.length ? curHost.slice(dot + 1) : null;
    }

    for (const rule of this.patternRules) {
      if (matchesPatternRule(rule, lowerUrl, pageHost, thirdParty, isScript)) {
        return {
          blocked: true,
          matchedRule: rule.raw,
          category: rule.category,
        };
      }
    }

    return { blocked: false, matchedRule: null, category: 'ads' };
  }

  getCosmeticSelectors(pageHost: string | null, config: ShieldsConfig): string[] {
    if (!config.enabled || !config.cosmeticFiltering || !isHostShieldsEnabled(config, pageHost)) {
      return [];
    }
    const selectors = new Set<string>(this.globalCosmetics);
    if (pageHost) {
      let cur: string | null = pageHost.toLowerCase();
      while (cur) {
        const list = this.domainCosmetics.get(cur);
        if (list) {
          for (const s of list) selectors.add(s);
        }
        const dot = cur.indexOf('.');
        cur = dot >= 0 && dot + 1 < cur.length ? cur.slice(dot + 1) : null;
      }
    }
    return Array.from(selectors);
  }
}

function parseOptions(optionsPart: string) {
  let thirdPartyOnly: boolean | null = null;
  let scriptOnly = false;
  let unsupported = false;
  const allowedDomains = new Set<string>();
  const excludedDomains = new Set<string>();

  if (!optionsPart) {
    return { thirdPartyOnly, scriptOnly, unsupported, allowedDomains, excludedDomains };
  }

  for (const rawOpt of optionsPart.split(',')) {
    const opt = rawOpt.trim().toLowerCase();
    if (!opt) continue;
    const key = opt.split('=')[0];
    if (UNSUPPORTED_MODIFIERS.has(key)) {
      return { thirdPartyOnly, scriptOnly, unsupported: true, allowedDomains, excludedDomains };
    }
    if (opt === 'third-party' || opt === '3p') thirdPartyOnly = true;
    else if (opt === '~third-party' || opt === '1p' || opt === 'first-party') thirdPartyOnly = false;
    else if (opt === 'script') scriptOnly = true;
    else if (opt.startsWith('domain=') || opt.startsWith('from=')) {
      for (const dom of opt.slice(opt.indexOf('=') + 1).split('|')) {
        const d = dom.trim();
        if (d.startsWith('~') && d.length > 1) excludedDomains.add(d.slice(1));
        else if (d) allowedDomains.add(d);
      }
    }
  }
  return { thirdPartyOnly, scriptOnly, unsupported, allowedDomains, excludedDomains };
}

function isPureDomainBody(body: string): boolean {
  const stripped = body.replace(/^\|\|/, '').replace(/\^$/, '');
  return (
    Boolean(stripped) &&
    stripped.includes('.') &&
    !stripped.includes('/') &&
    !stripped.includes('*') &&
    !stripped.includes('?') &&
    !stripped.includes('^')
  );
}

function compilePatternRule(
  raw: string,
  body: string,
  opts: ReturnType<typeof parseOptions>,
  category: BlockCategory,
  isException = false
): PatternRule | null {
  if (!body || body === '*' || (body.startsWith('/') && body.endsWith('/') && body.length > 2)) {
    return null;
  }
  const clean = body.toLowerCase();
  const anchor = clean
    .replace(/^\|\|?/, '')
    .split(/[*^]/)
    .reduce((best, seg) => (seg.length > best.length ? seg : best), '');

  if (anchor.length < 3) return null;

  let regex: RegExp | null = null;
  if (clean.includes('*') || clean.includes('^') || clean.startsWith('||')) {
    try {
      regex = abpToRegex(clean);
    } catch {
      regex = null;
    }
  }

  let hostScope: string | null = null;
  if (!isException && clean.startsWith('||')) {
    const h = clean.slice(2).split(/[/*^?]/)[0];
    if (h.includes('.') && h.length >= 4) hostScope = h;
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

function abpToRegex(pattern: string): RegExp {
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

  for (const ch of p) {
    if (ch === '*') out += '.*';
    else if (ch === '^') out += '([^a-zA-Z0-9_.%-]|$)';
    else if ('.?+()[]{}\\$|'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  if (endsPipe) out += '$';
  return new RegExp(out);
}

function matchesPatternRule(
  rule: PatternRule,
  lowerUrl: string,
  pageHost: string | null,
  thirdParty: boolean,
  isScript: boolean
): boolean {
  if (!lowerUrl.includes(rule.anchorLower)) return false;
  if (rule.thirdPartyOnly !== null && rule.thirdPartyOnly !== thirdParty) return false;
  if (rule.scriptOnly && !isScript) return false;
  if (rule.allowedDomains.size > 0) {
    if (!pageHost || !matchesDomainSet(pageHost, rule.allowedDomains)) return false;
  }
  if (rule.excludedDomains.size > 0 && pageHost) {
    if (matchesDomainSet(pageHost, rule.excludedDomains)) return false;
  }
  return rule.regex ? rule.regex.test(lowerUrl) : lowerUrl.includes(rule.anchorLower);
}

function findDomainRule(host: string, map: Map<string, DomainRuleMeta>): DomainRuleMeta | null {
  let cur: string | null = host;
  while (cur) {
    const hit = map.get(cur);
    if (hit) return hit;
    const dot = cur.indexOf('.');
    cur = dot >= 0 && dot + 1 < cur.length ? cur.slice(dot + 1) : null;
  }
  return null;
}

function matchesDomainSet(host: string, set: Set<string>): boolean {
  if (set.size === 0) return false;
  let cur: string | null = host;
  while (cur) {
    if (set.has(cur)) return true;
    const dot = cur.indexOf('.');
    cur = dot >= 0 && dot + 1 < cur.length ? cur.slice(dot + 1) : null;
  }
  return false;
}

function inferCategory(body: string, fallback: BlockCategory): BlockCategory {
  const l = body.toLowerCase();
  if (
    l.includes('popad') ||
    l.includes('popcash') ||
    l.includes('popunder') ||
    l.includes('clickadu') ||
    l.includes('onclick') ||
    l.includes('redirect')
  ) {
    return 'popups';
  }
  if (
    l.includes('analytics') ||
    l.includes('track') ||
    l.includes('pixel') ||
    l.includes('beacon') ||
    l.includes('telemetry')
  ) {
    return 'trackers';
  }
  return fallback;
}

function isSafeCosmeticSelector(selector: string): boolean {
  if (!selector || selector.length > 180) return false;
  if (
    selector.includes(':has(') ||
    selector.includes(':xpath(') ||
    selector.includes('+js(') ||
    selector.includes('{') ||
    selector.includes('}')
  ) {
    return false;
  }
  return true;
}
