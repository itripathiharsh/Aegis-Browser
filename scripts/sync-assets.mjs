#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const sharedFiltersDir = path.join(ROOT, 'shared-filters');
const coreUiPublicFiltersDir = path.join(ROOT, 'core-ui', 'public', 'filters');
const coreUiDistDir = path.join(ROOT, 'core-ui', 'dist');
const androidAssetsDir = path.join(ROOT, 'android-shell', 'app', 'src', 'main', 'assets');
const androidFiltersDir = path.join(androidAssetsDir, 'filters');
const androidUiDir = path.join(androidAssetsDir, 'ui');

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

cleanDir(coreUiPublicFiltersDir);
const coreFilterCount = copyDirRecursive(sharedFiltersDir, coreUiPublicFiltersDir);

cleanDir(androidFiltersDir);
const androidFilterCount = copyDirRecursive(sharedFiltersDir, androidFiltersDir);

let uiFilesCount = 0;
if (fs.existsSync(coreUiDistDir)) {
  cleanDir(androidUiDir);
  uiFilesCount = copyDirRecursive(coreUiDistDir, androidUiDir);
}

console.log(
  `[sync-assets] Synced ${coreFilterCount} filter files to core-ui/public/filters, ` +
    `${androidFilterCount} filter files to android-shell/assets/filters, ` +
    `and ${uiFilesCount} built UI files to android-shell/assets/ui.`
);
