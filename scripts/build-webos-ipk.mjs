import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const CORE_UI_DIR = path.join(ROOT, 'core-ui');
const CORE_DIST_DIR = path.join(CORE_UI_DIR, 'dist');
const SHARED_FILTERS_DIR = path.join(ROOT, 'shared-filters');
const WEBOS_SHELL_DIR = path.join(ROOT, 'webos-shell');
const BUILD_ROOT = path.join(WEBOS_SHELL_DIR, 'build');
const BUILD_APP_DIR = path.join(BUILD_ROOT, 'app');
const SERVICE_ID = 'io.github.itripathiharsh.nivrok.service';
const BUILD_SERVICE_DIR = path.join(BUILD_ROOT, 'service', SERVICE_ID);
const DIST_DIR = path.join(WEBOS_SHELL_DIR, 'dist');

const skipUiBuild = process.argv.includes('--skip-ui-build');

function runCommand(cmd, args, cwd) {
  const isWin = process.platform === 'win32';
  if (isWin && /\.(cmd|bat)$/i.test(cmd)) {
    execFileSync('cmd.exe', ['/d', '/s', '/c', cmd, ...args], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    return;
  }
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
}

function resolveAresPackageBin() {
  if (process.env.ARES_PACKAGE_BIN && fs.existsSync(process.env.ARES_PACKAGE_BIN)) {
    return process.env.ARES_PACKAGE_BIN;
  }
  if (process.platform === 'win32') {
    const fGlobal = 'F:\\npm-global\\ares-package.cmd';
    if (fs.existsSync(fGlobal)) return fGlobal;
  }
  return 'ares-package';
}

function main() {
  const appinfoPath = path.join(WEBOS_SHELL_DIR, 'appinfo.json');
  const appinfo = JSON.parse(fs.readFileSync(appinfoPath, 'utf8'));
  const version = String(appinfo.version || '1.0.10').trim();

  console.log(`[nivrok-ipk] Packaging ${appinfo.id} v${version}...`);

  if (!skipUiBuild) {
    console.log('[nivrok-ipk] Syncing filter assets and building core-ui...');
    runCommand(process.execPath, [path.join(ROOT, 'scripts', 'sync-assets.mjs')], ROOT);
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    runCommand(npmBin, ['run', 'build'], CORE_UI_DIR);
    runCommand(process.execPath, [path.join(ROOT, 'scripts', 'sync-assets.mjs')], ROOT);
  }

  if (!fs.existsSync(path.join(CORE_DIST_DIR, 'index.html'))) {
    throw new Error(`Missing core-ui build output at ${CORE_DIST_DIR}`);
  }

  fs.rmSync(BUILD_ROOT, { recursive: true, force: true });
  fs.mkdirSync(BUILD_APP_DIR, { recursive: true });
  fs.mkdirSync(BUILD_SERVICE_DIR, { recursive: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 1. Stage webOS web app directory
  fs.cpSync(CORE_DIST_DIR, BUILD_APP_DIR, { recursive: true });
  for (const file of ['appinfo.json', 'icon.png', 'largeIcon.png']) {
    const src = path.join(WEBOS_SHELL_DIR, file);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing required webOS asset: ${src}`);
    }
    fs.copyFileSync(src, path.join(BUILD_APP_DIR, file));
  }
  const appFiltersDir = path.join(BUILD_APP_DIR, 'filters');
  fs.mkdirSync(appFiltersDir, { recursive: true });
  fs.cpSync(SHARED_FILTERS_DIR, appFiltersDir, { recursive: true });

  // 2. Stage bundled webOS Node.js Luna service
  const svcSrcDir = path.join(WEBOS_SHELL_DIR, 'service');
  for (const file of [
    'package.json',
    'services.json',
    'service.js',
    'proxyServer.js',
    'filterEngineLite.js',
  ]) {
    fs.copyFileSync(path.join(svcSrcDir, file), path.join(BUILD_SERVICE_DIR, file));
  }
  const svcFiltersDir = path.join(BUILD_SERVICE_DIR, 'filters');
  fs.mkdirSync(svcFiltersDir, { recursive: true });
  for (const file of fs.readdirSync(SHARED_FILTERS_DIR)) {
    if (file.endsWith('.txt') || file === 'sources.json') {
      fs.copyFileSync(path.join(SHARED_FILTERS_DIR, file), path.join(svcFiltersDir, file));
    }
  }

  // 3. Clean stale .ipk outputs for clean release artifact collection
  for (const entry of fs.readdirSync(DIST_DIR)) {
    if (entry.endsWith('.ipk')) {
      fs.unlinkSync(path.join(DIST_DIR, entry));
    }
  }

  const aresBin = resolveAresPackageBin();
  runCommand(aresBin, ['-o', DIST_DIR, BUILD_APP_DIR, BUILD_SERVICE_DIR], ROOT);

  const canonicalIpk = path.join(DIST_DIR, `${appinfo.id}_${version}_all.ipk`);
  if (!fs.existsSync(canonicalIpk)) {
    const produced = fs.readdirSync(DIST_DIR).filter((f) => f.endsWith('.ipk'));
    throw new Error(`Expected IPK at ${canonicalIpk}; found: ${produced.join(', ') || 'none'}`);
  }

  const friendlyIpk = path.join(DIST_DIR, `Nivrok-v${version}.ipk`);
  fs.copyFileSync(canonicalIpk, friendlyIpk);

  console.log('[nivrok-ipk] Package inspection:');
  runCommand(aresBin, ['-i', canonicalIpk], ROOT);

  const sizeMb = (fs.statSync(canonicalIpk).size / (1024 * 1024)).toFixed(2);
  console.log(`[nivrok-ipk] Built ${canonicalIpk} (${sizeMb} MB)`);
  console.log(`[nivrok-ipk] Mirror ${friendlyIpk}`);
}

main();
