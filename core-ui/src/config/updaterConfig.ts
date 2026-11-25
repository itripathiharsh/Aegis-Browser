/**
 * Single configurable GitHub repository slug ("<OWNER>/<REPO>") for standalone web/webOS OTA checks.
 * On Android APK builds, BuildConfig.GITHUB_REPO (configured in android-shell/app/build.gradle.kts
 * or CI -PaegisGithubRepo) takes precedence automatically at runtime.
 */
export const AEGIS_GITHUB_REPO: string =
  import.meta.env.VITE_AEGIS_GITHUB_REPO ?? 'itripathiharsh/Aegis-Browser';

export const AEGIS_APP_VERSION: string =
  import.meta.env.VITE_AEGIS_APP_VERSION ?? '1.0.1';
