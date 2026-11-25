<p align="center">
  <img src="https://img.shields.io/badge/Aegis_Browser-🛡️-ff6b2b?style=for-the-badge&labelColor=090c10" alt="Aegis Browser" />
</p>

<h1 align="center">Aegis Browser</h1>

<p align="center">
  <strong>Zero-cost · Privacy-first · Ultra-fast · No ads, ever.</strong>
</p>

<p align="center">
  <a href="https://github.com/itripathiharsh/Aegis-Browser/releases/latest">
    <img src="https://img.shields.io/github/v/release/itripathiharsh/Aegis-Browser?style=for-the-badge&color=22c55e&label=Latest%20Release" alt="Latest Release" />
  </a>
  <a href="https://github.com/itripathiharsh/Aegis-Browser/releases/latest">
    <img src="https://img.shields.io/github/downloads/itripathiharsh/Aegis-Browser/total?style=for-the-badge&color=38bdf8&label=Downloads" alt="Downloads" />
  </a>
  <a href="https://github.com/itripathiharsh/Aegis-Browser/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/itripathiharsh/Aegis-Browser/build-android-apk.yml?style=for-the-badge&label=Build" alt="Build Status" />
  </a>
</p>

---

## 📥 Download APK

> **[⬇️ Download Latest APK](https://github.com/itripathiharsh/Aegis-Browser/releases/latest)**
>
> Go to **Releases → Assets → `AegisBrowser-vX.X.X.apk`** and install on your Android device.

---

## 🔥 What is Aegis Browser?

A **zero-cost, ultra-fast, privacy-first** web browser inspired by Brave — engineered to block **ALL** types of ads (video ads, popups, banners, trackers, redirects) while delivering smooth web surfing and hardware-accelerated video playback.

### ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🛡️ **Aggressive Ad Blocking** | Network-level `shouldInterceptRequest` blocking powered by EasyList + EasyPrivacy + uBlock Origin filter lists |
| 🚫 **Popup & Redirect Killer** | Blocks pop-unders, new-tab hijacks, and click-redirect chains at the WebView level |
| 🎭 **Cosmetic Filtering** | Hides empty ad slots and video overlays via injected CSS/JS |
| 📊 **Live Shields Counter** | Real-time "Ads & Trackers Blocked" counter in the top bar |
| 🎬 **Hardware-Accelerated Video** | Smooth HTML5 / HLS (`.m3u8`) / MP4 fullscreen playback |
| 🌙 **Dark Mode UI** | Clean obsidian-shield dark theme with design system tokens |
| 📱 **Touch + D-Pad Support** | Hybrid controls for Android phone + future LG TV Magic Remote |
| 🔄 **Auto-Update** | In-app self-update system via GitHub Releases (zero cost) |
| 🔖 **Bookmarks & Tabs** | Speed-dial bookmarks, multi-tab browsing, desktop mode toggle |
| 🔍 **Privacy Search** | DuckDuckGo, Brave Search, Startpage, or Google — your choice |

### 🚀 Zero-Rupee Stack

- **100% free & open-source** — no paid APIs, no cloud services, no subscriptions
- **GitHub Actions CI/CD** — automated APK builds on every push
- **GitHub Releases OTA** — in-app update checks with one-tap install

---

## 🏗️ Architecture

```
Aegis-Browser/
├── core-ui/                  # Shared React + TypeScript + Vite browser UI & filter engine
│   ├── src/
│   │   ├── adblock/          # ABP/Hosts parser + O(1) domain matcher + GitHub mirror updater
│   │   ├── bridge/           # Cross-platform bridge (Android native, webOS, standalone preview)
│   │   ├── components/       # TopBar, TabsDrawer, ShieldsPanel, BookmarksDrawer, UpdateModal
│   │   ├── config/           # Updater config (GitHub repo slug)
│   │   ├── hooks/            # D-Pad spatial navigation, viewport reporter
│   │   ├── utils/            # URL resolver, semver comparator
│   │   └── styles/           # Design tokens (tokens.css) + responsive TV/Mobile CSS (app.css)
│
├── android-shell/            # Native Kotlin Android WebView wrapper & network interceptor
│   └── app/src/main/java/com/aegis/browser/
│       ├── adblock/          # DomainTrie + filter parser + background filter list updater
│       ├── browser/          # WebViewClient (ad blocking), WebChromeClient (popups + fullscreen)
│       ├── bridge/           # @JavascriptInterface bridge (isolated to local UI WebView)
│       ├── updater/          # In-app APK updater (GitHub Releases API + FileProvider installer)
│       └── ui/               # MainActivity (dual WebView, WindowInsets, D-Pad routing)
│
├── shared-filters/           # Bundled EasyList, EasyPrivacy, uBlock & cosmetic filter lists
├── webos-shell/              # Phase 2: LG webOS IPK scaffold
├── scripts/                  # Asset sync (shared-filters + core-ui/dist → android-shell)
└── .github/workflows/        # CI: build APK + publish GitHub Release on v* tag
```

### Two-Phase Strategy

1. **Phase 1 (Android APK)** — ✅ Complete
   - Dual WebView architecture: Chrome UI WebView (local React app) + Content WebView (external sites with ad blocking)
   - `shouldInterceptRequest` network-level blocking + `onCreateWindow` popup blocking + cosmetic CSS/JS injection

2. **Phase 2 (LG webOS `.ipk`)** — Scaffolded
   - Same `core-ui` components + TypeScript FilterEngine via `webosAdapter.ts`

---

## 🔧 Build Locally

```powershell
# 1. Build the UI
cd core-ui
npm install
npm test        # 9 tests across 4 files
npm run build   # ~60 kB gzipped

# 2. Sync assets into Android shell
cd ..
node scripts/sync-assets.mjs

# 3. Build Android APK
cd android-shell
gradle assembleDebug assembleRelease --no-daemon
# Output: app/build/outputs/apk/release/app-release.apk (~793 KB)
```

### CI/CD (GitHub Actions)

Every push builds both Debug & Release APKs. Pushing a `v*` tag (e.g., `v1.0.0`) automatically creates a **GitHub Release** with the signed APK attached.

```bash
git tag v1.0.0
git push --tags
```

---

## 📊 Build Stats

| Metric | Value |
|--------|-------|
| Core UI bundle | 193 kB (60 kB gzip) |
| Debug APK | ~3.4 MB |
| Release APK | **~793 KB** |
| Vitest tests | 9/9 passed |
| Kotlin tests | 8/8 passed |
| Filter rules | EasyList + EasyPrivacy + uBlock Origin |

---

## 🛡️ How Ad Blocking Works

```
                    ┌─────────────────────────────┐
   User browses  →  │  Content WebView loads URL   │
                    └────────────┬────────────────┘
                                 │
                    ┌────────────▼────────────────┐
                    │  shouldInterceptRequest()    │
                    │  ┌────────────────────────┐  │
                    │  │ DomainTrie O(1) lookup  │  │
                    │  │ Pattern regex matching  │  │
                    │  │ Exception allowlisting  │  │
                    │  └────────────────────────┘  │
                    └────────────┬────────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   │                           │
              BLOCKED ✋                  ALLOWED ✅
         (empty response)            (normal loading)
                   │
        Counter incremented
        Event logged to Shields
```

---

## 📄 License

This project is open-source. Built with ❤️ for a zero-ad, zero-cost browsing experience.
