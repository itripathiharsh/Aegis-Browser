# LG webOS TV Shell (`io.github.itripathiharsh.nivrok`)

Nivrok packages both the built React/TypeScript browser shell (`core-ui/dist`) and a bundled Node.js Luna loopback proxy service (`webos-shell/service/` -> `io.github.itripathiharsh.nivrok.service`) into an installable LG webOS `.ipk`.

## Architecture on LG webOS TV

1. **Web App (`webos-shell/appinfo.json` + `core-ui/dist/`)**:
   - Launches on LG TV with D-Pad / Magic Remote navigation, Dark & Light themes, Search Engine switcher, Bookmarks, History, Tabs, Tab Groups, Incognito Tabs, and persisted settings (`localStorage`).
   - Detects `PalmSystem` / `PalmServiceBridge` / `webOS` automatically and starts the bundled background proxy service over Luna (`luna://io.github.itripathiharsh.nivrok.service/startProxy`).
2. **Bundled Ad-Block Loopback Proxy Service (`webos-shell/service/`)**:
   - Pure Node.js HTTP/HTTPS loopback server on `127.0.0.1` (`dependencies: {}`) compatible with webOS TV's built-in Node runtime.
   - Evaluates outbound URLs against the bundled EasyList, EasyPrivacy, uBlock Ads, and Cosmetic rule lists (`shared-filters/*.txt`).
   - Strips `X-Frame-Options` and `Content-Security-Policy` frame-ancestors so sites render cleanly inside Nivrok's TV viewport, injects cosmetic ad-hiding CSS + `window.open` popup guards, and streams media with `Range` support.

## Building `.ipk` Locally (Strict `F:` drive on Windows)

```powershell
$env:TEMP='F:\temp'; $env:TMP='F:\temp'
node .\scripts\build-webos-ipk.mjs
```

Outputs:
- `webos-shell/dist/io.github.itripathiharsh.nivrok_<version>_all.ipk`
- `webos-shell/dist/Nivrok-v<version>.ipk`

## Installing on Your LG TV (Developer Mode)

1. Open **Developer Mode** on your LG TV (installed from LG Content Store), enable **Dev Mode Status**, **Key Server**, and note your TV's IP address + Passphrase.
2. Register your TV once from PC using `@webos-tools/cli`:
   - `F:\npm-global\ares-setup-device.cmd` (or add device via CLI)
   - `F:\npm-global\ares-novacom.cmd --device lgtv --getkey` (enter the 6-char passphrase shown on TV)
3. Install and launch Nivrok:
   - `F:\npm-global\ares-install.cmd --device lgtv .\webos-shell\dist\io.github.itripathiharsh.nivrok_1.0.10_all.ipk`
   - `F:\npm-global\ares-launch.cmd --device lgtv io.github.itripathiharsh.nivrok`
