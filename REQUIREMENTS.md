# Aegis Browser — Requirements Contract

| ID | Requirement | Implementation Owner | Verification Check |
|---|---|---|---|
| R1 | Modular split between `core-ui/` and `android-shell/` for Phase 1 APK and Phase 2 webOS `.ipk` | `core-ui/`, `android-shell/`, `webos-shell/`, `src/bridge/` | Directory structure, `webosAdapter.ts`, `appinfo.json` |
| R2 | 100% free open-source stack with zero paid APIs or cloud dependencies | React, Vite, Vitest, Kotlin, AndroidX WebKit, GitHub Actions `ubuntu-latest` | `package.json`, `build.gradle.kts`, `.github/workflows/build-android-apk.yml` |
| R3 | Dark-mode hybrid TV & Mobile UI (Omnibox with search/URL detection, Back/Forward/Reload, Tabs switcher, Bookmarks, Shields toggle) | `core-ui/src/components/*`, `tokens.css` | Rendered UI, component unit tests, responsive `320px`-`1920px` layout |
| R4 | Touch (`44px+`) and D-Pad / Remote navigation (`ArrowKeys`, `Enter`, `Back`, visible focus rings) | `useDpadNavigation.ts`, `MainActivity.dispatchKeyEvent`, `:focus-visible` CSS | Keyboard/D-Pad event unit tests + CSS focus tokens |
| R5 | Smooth HTML5 / HLS (`.m3u8`) / MP4 fullscreen playback with hardware acceleration | `MainActivity` + `BrowserWebChromeClient.onShowCustomView` + `LAYER_TYPE_HARDWARE` + `aegis://player` | `AndroidManifest.xml` `hardwareAccelerated="true"`, fullscreen video view callbacks |
| R6 | Network-level request interception (`shouldInterceptRequest`) backed by EasyList, EasyPrivacy, uBlock local rules | `AdBlockEngine.kt`, `BrowserWebViewClient.kt`, `shared-filters/*.txt` | Kotlin unit tests covering domain, URL pattern, 3rd-party, and exception rules |
| R7 | Popup, pop-under, and ad-redirect blocking (`onCreateWindow`, `shouldOverrideUrlLoading`) | `BrowserWebChromeClient.kt`, `BrowserWebViewClient.kt` | Popup/redirect unit & integration tests |
| R8 | Cosmetic ad-container hiding via injected CSS + anti-adblock/skip scriptlet | `CosmeticInjector.kt` + `cosmetic-rules.txt` | Verified selector injection and unit test |
| R9 | Auto-updater from free GitHub-hosted EasyList/uBlock mirrors cached locally | `FilterListUpdater.kt` + `core-ui/src/adblock/updater.ts` + `sources.json` | Updater parser & persistence tests |
| R10 | Live "Ads & Trackers Blocked" counter in top bar updating in real time | `TopBar.tsx` + `NativeBridge.kt` batched status push | UI state & bridge telemetry tests |
| R11 | GitHub Actions workflow `.github/workflows/build-android-apk.yml` outputting downloadable `.apk` artifacts | `.github/workflows/build-android-apk.yml` | Valid YAML workflow running tests, Vite build, asset sync, Gradle APK build |
