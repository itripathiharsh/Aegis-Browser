export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  preRelease: string | null;
}

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export function normalizeVersionTag(raw: string): string {
  return raw
    .trim()
    .replace(/^[vV]/, '')
    .split('+')[0]
    .replace(/-debug$/i, '');
}

export function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = normalizeVersionTag(raw);
  if (!cleaned) return null;
  const dashIdx = cleaned.indexOf('-');
  const core = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned;
  const pre = dashIdx >= 0 && dashIdx + 1 < cleaned.length ? cleaned.slice(dashIdx + 1) : null;
  const parts = core.split('.');
  if (parts.length === 0) return null;

  const major = Number.parseInt(parts[0], 10);
  const minor = parts[1] !== undefined ? Number.parseInt(parts[1], 10) : 0;
  const patch = parts[2] !== undefined ? Number.parseInt(parts[2], 10) : 0;
  if ([major, minor, patch].some((n) => Number.isNaN(n) || n < 0)) return null;

  return { major, minor, patch, preRelease: pre };
}

export function isNewerVersion(latestTag: string, currentVersion: string): boolean {
  const latest = parseSemver(latestTag);
  const current = parseSemver(currentVersion);
  if (!latest || !current) return false;

  if (latest.major !== current.major) return latest.major > current.major;
  if (latest.minor !== current.minor) return latest.minor > current.minor;
  if (latest.patch !== current.patch) return latest.patch > current.patch;

  if (latest.preRelease === null && current.preRelease !== null) return true;
  if (latest.preRelease !== null && current.preRelease === null) return false;
  if (latest.preRelease !== null && current.preRelease !== null) {
    return latest.preRelease.localeCompare(current.preRelease) > 0;
  }
  return false;
}

export function pickApkAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | null {
  let fallback: GithubReleaseAsset | null = null;
  for (const asset of assets) {
    if (!asset?.name?.toLowerCase().endsWith('.apk') || !asset.browser_download_url) {
      continue;
    }
    const lower = asset.name.toLowerCase();
    if (!lower.includes('debug') && !lower.includes('unsigned')) {
      return asset;
    }
    if (!fallback) fallback = asset;
  }
  return fallback;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
