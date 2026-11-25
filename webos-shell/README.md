# Phase 2: LG webOS `.ipk` Packaging Target

This directory prepares Aegis Browser for LG webOS (`WebOS-Chromium` + `@webosose/ares-cli`) without modifying `core-ui/`.

## Integration Contract

- `core-ui/src/bridge/webosAdapter.ts` already implements `WebOSNativeHost` and LG Magic Remote Back key handling (`keyCode 461` / `GoBack`).
- `core-ui/src/adblock/filterEngine.ts` + `updater.ts` provide full EasyList / EasyPrivacy / uBlock rule parsing and GitHub mirror syncing directly in TypeScript for webOS service/WebView interception.
- `core-ui/src/hooks/useDpadNavigation.ts` provides full 5-way TV remote directional navigation (`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Enter`/`Escape`).

## Phase 2 Packaging Flow (After Phase 1 Android Verification)

1. Build `core-ui`: `npm run build` (with `core-ui/public/filters` synced from `shared-filters/`).
2. Copy `core-ui/dist/*` alongside `webos-shell/appinfo.json` and launcher icons into `webos-shell/dist/`.
3. Package using open-source webOS CLI (`ares-package webos-shell/dist`) inside GitHub Actions `ubuntu-latest` to output `io.github.itripathiharsh.aegis_1.0.2_all.ipk`.
