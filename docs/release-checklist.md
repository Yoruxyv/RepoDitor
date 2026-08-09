# v0.1.0 release checklist

RepoDitor's first public release is v0.1.0. Releases are assisted Windows x64 NSIS installers built from semantic tags that match the version in both `pyproject.toml` and `desktop/package.json`.

## Required automated gates

- Python 3.11 and 3.14: locked sync, Ruff lint/format, and pytest.
- Desktop quality: clean npm install, import normalization, ESLint, release
  version alignment, production build, bundle budget, component tests, and
  Electron contract tests.
- Windows Electron E2E: isolated discovery, all editor tabs including Advanced Items refill-to-full, pending edits,
  revert, safe write, backup, reopen, stale-file rejection, keyboard navigation,
  reduced motion, and 1600x900, 1200x800, and 960x640 layouts.
- Windows package smoke: Python 3.13 sidecar build, Electron package, required
  file/license verification, and the same E2E journey against the unpacked production executable.
- Windows installer: assisted current-user-first NSIS build, deterministic
  `RepoDitor-Setup-<version>-x64.exe` verification, and SHA-256 generation.
- Failed E2E jobs retain Playwright screenshots and traces for seven days.

The quality gate must pass every job. The tag-driven release workflow reruns
Python and desktop quality, the packaged smoke test, installer verification,
and installer checksum generation before publishing.

## Release procedure

1. Set matching versions in `pyproject.toml` and `desktop/package.json`.
2. Run `npm run release:check` from `desktop/`.
3. Confirm the RepoDitor icon, product name, v0.1.0 About information,
   unsigned-build notice, and native-menu removal are current.
4. Run the complete local quality and package gates from the root README.
5. Run the installer acceptance gate below on a clean current-user installation.
6. Push a tag matching the version, for example `v0.1.0`.
7. Download the workflow installer and verify its SHA-256 checksum.
8. Confirm the downloaded installer repeats the accepted install, launch,
   uninstall, save-preservation, and reinstall behavior.

## Installer acceptance gate

This is a blocking manual release-candidate check. Do not treat the unpacked E2E as proof of installer behavior.

1. Confirm RepoDitor is not installed and no stale test installation directory remains. Do not delete or move R.E.P.O. saves.
2. Record SHA-256 hashes for a disposable save and any sibling `.bak-*` backup that must survive the lifecycle.
3. Run `RepoDitor-Setup-0.1.0-x64.exe` normally. Confirm the assisted wizard identifies RepoDitor, defaults to current-user installation, shows the destination, and allows Browse to select a custom test path.
4. Install to the custom path. Confirm the application files, generated uninstaller, Start Menu shortcut, Installed Apps entry, and RepoDitor icon are present.
5. Query the actual uninstall registration without assuming a registry hive:

   ```powershell
   $roots = @(
     "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
     "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
     "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
   )
   $registration = Get-ItemProperty $roots -ErrorAction SilentlyContinue |
     Where-Object DisplayName -eq "RepoDitor"
   $registration | Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString
   ```

   Confirm `DisplayName` is `RepoDitor`, `DisplayVersion` is `0.1.0`, and `UninstallString` targets the generated RepoDitor uninstaller.
6. Launch from the installed application or Start Menu without repository tooling. Confirm the bundled backend, discovery, Overview, Players, Upgrades, Run, Maps, Advanced Items refill-to-full, icon, and v0.1.0 About information.
7. With network access disabled, confirm the app still launches and local save features work; optional Steam avatars may fail softly.
8. Using only a disposable/generated save, confirm open → edit → pending changes → save → backup → reopen, plus stale-file rejection.
9. Uninstall through Windows Installed Apps. Confirm the application files, custom installation directory, shortcuts, uninstaller, and uninstall registration are removed.
10. Recalculate the save and backup hashes. They must match the expected pre-uninstall values; `%USERPROFILE%\AppData\LocalLow\semiwork\Repo` and all other discovered save locations must remain untouched.
11. Reinstall to the default location, launch successfully, confirm discovery still works, then uninstall again if the workstation must return to a clean state.

## Phase 10E automated installer baseline — 2026-08-09

| Check | Result |
| --- | --- |
| Installer | `RepoDitor-Setup-0.1.0-x64.exe`, 102,691,116 bytes (97.93 MiB) |
| Local SHA-256 | `fca6b30afadadb62afb967d68de41ed26dcbd28ac61b0ec6c96f46dd5941e425` |
| Installer mode | NSIS assisted, current user selected by default, installation directory change enabled |
| Updater artifacts | No elevation helper, differential blockmap, updater, service, scheduled task, or startup entry |
| Custom path | Silent current-user install to an isolated non-default path passed; installed executable, backend, uninstaller, registration, and Start Menu shortcut verified |
| Windows registration | `DisplayName=RepoDitor`, `DisplayVersion=0.1.0`, generated current-user `UninstallString` |
| Installed application E2E | 1 passed with external networking blocked; launch 2.93 s, open 918 ms, safe write 942 ms |
| Custom-path uninstall | Exit 0; installation directory, registration, and Start Menu shortcut removed |
| Default-path reinstall/uninstall | Both exited 0; default installation directory removed |
| Save preservation | 332 existing `.es3`/`.bak-*` files: zero missing, changed, or added after lifecycle tests |
| Disposable preservation fixtures | Save and `.bak-*` sentinel SHA-256 values unchanged |
| Code signing | Not signed; SmartScreen notice remains required |
| Manual visual acceptance | Still required: assisted wizard pages/Browse control, icon rendering, Start Menu launch, Installed Apps UI, SmartScreen wording, and human-visible uninstall flow |

## Historical ZIP release-candidate baseline — 2026-08-09

This baseline predates the NSIS installer and proves only the portable archive and unpacked application behavior. It does not satisfy the installer acceptance gate.

| Check | Result |
| --- | --- |
| Python 3.11 | 92 passed |
| Python 3.14 | 92 passed |
| Renderer and Electron contracts | 41 passed |
| Development Electron E2E | 1 passed |
| Unpacked and clean-extracted Electron E2E | 1 passed each |
| Responsive visual review | 1600x900, 1200x800, and 960x640 passed |
| Renderer coverage | 72.97% statements / 74.18% lines; measured, no arbitrary threshold |
| Bundle budget | 269.89 KiB raw / 77.25 KiB gzip; within budget |
| Dependency audit | 0 vulnerabilities; four deprecated transitive packaging dependencies noted |
| Windows archive | 145.11 MiB; sidecar, app ASAR, RepoDitor MIT, and Teko OFL licenses present |
| Archive extraction | 5 required files present; no source/test/dev entries in ASAR |
| Code signing | Not signed; Windows SmartScreen notice documented |

Measured on the v0.1.0 release-candidate Windows workstation:

| Operation | Time |
| --- | ---: |
| Development launch to discovery ready | 2.93 s |
| Development save open | 385 ms |
| Development backup + write + verification | 379 ms |
| Unpacked packaged launch to discovery ready | 8.53 s |
| Clean-extracted packaged launch to discovery ready | 3.55 s |
| Clean-extracted packaged save open | 1.37 s |
| Clean-extracted backup + write + verification | 1.42 s |

These measurements are an observational baseline, not hard pass/fail budgets.
The short-lived JSON sidecar remains adequate at this scale; revisit its process
model only if measured user-facing latency materially regresses.

The bundle check remains warning-only for v0.1.0 because the measured output is
well below its existing headroom and one workstation measurement is not enough
to set a durable blocking threshold. Coverage is reported without a percentage
gate; correctness-critical save and desktop-boundary paths retain focused tests.

## Manual security and safety review

- `contextIsolation` remains enabled; Node integration remains disabled; the
  renderer remains sandboxed.
- Preload exposes only the typed RepoDitor API and approved literal channels.
- Main-process navigation and new windows remain denied outside the renderer.
- Python is spawned directly without a shell or arbitrary renderer command.
- CSP permits only local assets plus the two Steam avatar image hosts.
- The only external link is the exact RepoDitor project URL, opened by Electron;
  the renderer has no generic URL-opening API.
- Save tests cover validation, stale-file detection, exact backup bytes,
  temporary encrypted output, verification, atomic replacement, and recovery.
- Automated E2E uses a generated encrypted save under a temporary fake profile;
  no real R.E.P.O. save is read or modified.
- The installer uses electron-builder's standard assisted NSIS implementation;
  there is no custom NSIS script or application-data deletion hook.
- Current-user install is the default, the destination can be changed, and the
  updater-only elevation helper and differential package are disabled.
- Automated lifecycle checks confirmed install/uninstall ownership stays inside
  the selected application directory while 332 existing save/backup hashes remain unchanged.
