# Rule: Strict F-Drive Only Work & Installations

## 1. Mandatory Storage & Execution Scope
- **F: Drive Only**: All project work, source code, assets, builds, logs, data, caches, temporary files, and tool/package installations must reside exclusively on the `F:` drive.
- **Nothing on C: or D:**: Never create, download, extract, cache, log, or install any file, dependency, runtime, or artifact on `C:`, `D:`, or any drive other than `F:`.
- This rule applies permanently to every command, script, package manager, build step, and background process in this workspace.

## 2. Installations & Package Managers (`F:` Only)
- **Node.js / npm / pnpm / yarn**:
  - Keep project dependencies (`node_modules`) inside the workspace on `F:`.
  - Direct global installs and caches strictly to `F:` (e.g., `--prefix F:\npm-global`, `--cache F:\npm-cache`, or `pnpm`/`yarn` store directories on `F:`).
- **Python / pip / uv**:
  - Always create virtual environments inside the project directory on `F:`.
  - Set `PIP_CACHE_DIR=F:\pip-cache` and `PYTHONUSERBASE=F:\pip-user` (never default user/cache paths on `C:` or `D:`).
- **Compilers, SDKs, Browsers & CLI Tools**:
  - Install and store all external binaries, SDKs, runtimes, and portable tools exclusively under `F:\tools` or a dedicated folder on `F:`.
  - Never run installers targeting `C:\Program Files`, `C:\ProgramData`, `C:\Users\...\AppData`, or `D:\`.
- **Temporary & Scratch Directories**:
  - Always set `TEMP` and `TMP` to `F:\temp` before running tools or builds that write temporary files.
