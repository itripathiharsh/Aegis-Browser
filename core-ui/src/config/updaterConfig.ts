/**
 * Single configurable GitHub repository slug ("<OWNER>/<REPO>") for standalone web/webOS OTA checks.
 * On Android APK builds, BuildConfig.GITHUB_REPO (configured in android-shell/app/build.gradle.kts
 * or CI -PnivrokGithubRepo) takes precedence automatically at runtime.
 */
export const NIVROK_GITHUB_REPO: string =
  import.meta.env.VITE_NIVROK_GITHUB_REPO ??
  import.meta.env.VITE_AEGIS_GITHUB_REPO ??
  'itripathiharsh/Aegis-Browser';

export const NIVROK_APP_VERSION: string =
  import.meta.env.VITE_NIVROK_APP_VERSION ??
  import.meta.env.VITE_AEGIS_APP_VERSION ??
  '1.0.8';
