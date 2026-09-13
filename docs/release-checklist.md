# Release checklist

Official releases are WebView2-hosted Windows x64 NSIS installers built from semantic tags that match
the version in both `pyproject.toml` and `desktop/package.json`. The current procedure is generic;
the measured v0.1.0 release-candidate data remains preserved as a historical baseline below.

## Windows code signing preparation

RepoDitor v0.1.0 remains the historical unsigned release. Future official tagged releases are
prepared to use Microsoft Artifact Signing through electron-builder's Azure signing integration.
This preparation does not create a certificate or signing identity and contains no credential
values.

The checked-in official release path expects the Microsoft Artifact Signing values documented
below and fails closed without them. Repository contents cannot prove whether the maintainer-owned
Azure identity and protected GitHub environment values are currently configured. The maintainer
is separately awaiting SignPath Foundation approval; SignPath is not integrated into the current
workflow.

Local packaging remains intentionally usable without cloud access:

```powershell
Set-Location desktop
npm run package
```

That command produces an unsigned developer package and retains the existing package, installer,
and smoke checks. The GitHub release job instead calls `package:dir:signed` and
`package:installer:signed`. Those commands load `electron-builder.release.cjs`, set
`forceCodeSigning: true`, and fail before producing an official artifact when any required signing
input is absent. They are not local development defaults.

### Signed release path

`.github/workflows/release.yml` is the preferred official path once signing is available. It
retains fail-closed Microsoft Artifact Signing configuration, verifies the packaged application,
sidecar, and installer signatures, and generates the checksum only after signature validation.
The temporary unsigned workflow does not change or provide a fallback inside this signed path.

### Explicit unsigned release path

`.github/workflows/release-unsigned.yml` is a temporary manual-only bridge while signing approval
or credentials are unavailable. From **Actions → Unsigned Release → Run workflow**, select `main`,
enter the aligned strict version, and type `RELEASE UNSIGNED` exactly.

This path:

- never runs for tags, pushes, pull requests, or releases;
- verifies the selected commit is still the current `origin/main` commit and refuses existing tags;
- requires exact unsigned-release confirmation and an aligned package version;
- retains Python quality, renderer quality, component/contract tests, packaged Electron E2E,
  package-content checks, installer verification, and lowercase SHA-256 generation;
- omits only cloud code signing and Authenticode signature verification;
- uploads the installer/checksum as a workflow artifact and labels the GitHub Release prominently
  as an unsigned Windows build;
- creates the annotated `v<version>` tag and stable release only after validation succeeds.

The workflow pushes its tag with the repository `GITHUB_TOKEN`, not a PAT. GitHub suppresses new
workflow runs for most events created by that token, so the tag push is not expected to recursively
start the tag-triggered signed workflow. Retire or disable this unsigned path once the chosen
signing provider is integrated and validated.

The GitHub repository must have a protected environment named `release-signing`. Configure these
environment variables after the Microsoft resources exist:

| GitHub environment variable                       | Microsoft value                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `AZURE_ARTIFACT_SIGNING_ENDPOINT`                 | Region endpoint for the Artifact Signing account, such as an official `https://<region>.codesigning.azure.net` endpoint |
| `AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME`             | Artifact Signing account name                                                                                           |
| `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME` | Public Trust certificate profile name                                                                                   |
| `AZURE_ARTIFACT_SIGNING_PUBLISHER_NAME`           | Exact certificate Common Name (CN) shown by the completed profile                                                       |

Configure these as environment secrets, not repository files or plain workflow values:

| GitHub environment secret | Microsoft value                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| `AZURE_TENANT_ID`         | Microsoft Entra tenant ID                                         |
| `AZURE_CLIENT_ID`         | Application (client) ID of the dedicated signing app registration |
| `AZURE_CLIENT_SECRET`     | Client-secret value for that app registration, not the secret ID  |

The dedicated service principal needs only the **Artifact Signing Certificate Profile Signer**
role, scoped to the selected certificate profile. It does not need Owner or Contributor access.
The existing workflow permissions remain unchanged; this direct electron-builder integration does
not enable GitHub OIDC or add `id-token: write`.

Before final wiring, the maintainer must obtain or complete:

1. an eligible Azure subscription and Microsoft Entra tenant;
2. an Artifact Signing account in a supported region;
3. completed Public Trust identity validation;
4. a Public Trust certificate profile and its exact certificate subject Common Name;
5. a dedicated Entra app registration, its tenant/client IDs, and a client-secret value;
6. the Certificate Profile Signer role assignment scoped to that profile;
7. the protected GitHub `release-signing` environment and the variables/secrets above.

The release job verifies Authenticode on `RepoDitor.exe`, the bundled
`repoditor-backend.exe`, the WebView2 installer host, and the NSIS installer. Verification requires a signer certificate,
`Status = Valid`, and an exact publisher Common Name match. Installer structure verification still
runs. SHA-256 generation occurs only after all signature checks pass.

Maintainers can verify a downloaded installer locally without exposing credentials:

```powershell
$signature = Get-AuthenticodeSignature .\RepoDitor-Setup-<version>-x64.exe
$signature | Select-Object Status, StatusMessage
$signature.SignerCertificate |
  Select-Object Subject, Thumbprint, NotBefore, NotAfter
```

`Status` must be `Valid`, and the certificate subject's `CN` must match the configured
`AZURE_ARTIFACT_SIGNING_PUBLISHER_NAME`. Perform the checksum comparison against the published
`.sha256` file after signature validation.

## Required automated gates

- Python 3.11 and 3.14: locked sync, Ruff lint/format, and pytest.
- Desktop quality: clean npm install, import normalization, ESLint, release
  version alignment, production build, bundle budget, component tests, and
  Electron contract tests.
- Windows Electron E2E: isolated discovery, all editor tabs including Items refill-to-full, pending edits,
  revert, safe write, backup, reopen, stale-file rejection, keyboard navigation,
  reduced motion, and 1600x900, 1200x800, and 960x640 layouts.
- Windows package smoke: Python 3.13 sidecar build, Electron package, required
  file/license verification, and the same E2E journey against the unpacked production executable.
- Windows installer: WebView2-hosted single-window UI, current-user-first NSIS lifecycle, deterministic
  `RepoDitor-Setup-<version>-x64.exe` verification, valid expected Authenticode signatures, and
  post-signing SHA-256 generation.
- Failed E2E jobs retain Playwright screenshots and traces for seven days.

The quality gate must pass every job. The tag-driven release workflow reruns
Python and desktop quality, the packaged smoke test, installer verification,
and installer checksum generation before publishing.

## Signed release procedure

1. Update every managed version source and verify alignment from `desktop/`:

   ```powershell
   npm run update:version -- 0.1.2
   npm run release:check
   ```

   `desktop/package.json` is the primary release version. The updater synchronizes
   `package-lock.json`, `pyproject.toml`, Python `__version__`, and
   `uv.lock`. Renderer and E2E
   tests derive their expected version from package metadata and do not need release-specific edits.

2. Confirm the RepoDitor icon, product name, current-version About information,
   signing-status notice, and native-menu removal are current.
3. Run the complete local quality and package gates from the root README.
4. Run the installer acceptance gate below on a clean current-user installation.
5. Push a semantic tag matching the version, for example `v0.2.0`.
6. Download the workflow installer, verify its Authenticode publisher/status, and then verify its
   SHA-256 checksum.
7. Confirm the downloaded installer repeats the accepted install, launch,
   uninstall, save-preservation, and reinstall behavior.

## Temporary unsigned v0.1.1 procedure

After the unsigned-workflow change is merged, update and verify local `main` without creating a
tag:

```powershell
Set-Location E:\GitHub\RepoDitor
git switch main
git pull --ff-only
Set-Location desktop
npm run release:check
Set-Location ..
git status
```

The check must report `Release version 0.1.1 is aligned.`, and the working tree must be clean.
Then open **GitHub → RepoDitor → Actions → Unsigned Release → Run workflow**, select `main`, set
`version` to `0.1.1`, and set `confirm_unsigned` to `RELEASE UNSIGNED`. Do not create or push the
tag manually; the validated workflow creates `v0.1.1` at its exact checked-out commit.

## Installer acceptance gate

This is a blocking manual release-candidate check. Do not treat the unpacked E2E as proof of
install, upgrade, explicit-uninstall cleanup, save preservation, or reinstall behavior. Use an
older installer and the candidate installer for the upgrade leg:

The dedicated `Installer lifecycle` workflow complements this gate with fresh-package,
current-user default/custom-path, registered reinstall, explicit-cleanup, and synthetic LocalLow
fingerprint coverage through real WebView2 **Install/Update**, **Uninstall**, and a safe native
refusal followed by one real **Retry**. Custom-path installation passes the selected path to the
production silent engine. It runs the lifecycle under an
isolated standard Windows user because GitHub-hosted Windows jobs otherwise run as administrators
with UAC disabled. Exit code 0 is never sufficient: both HKCU registration keys and installed
payload entry points must be gone.

Run `npm run test:installer:host` on Windows for native stage, argument, failure,
and completion checks against temporary files and a unique HKCU fixture key. The
installer lifecycle workflow runs this check before packaging.

The embedded installer shows indeterminate progress only. Verify **Preparing
installation… → Running installation… → Verifying installation… → RepoDitor is
ready**, with corresponding removal wording for uninstall. Running means the
NSIS engine has started; verification means its entry process exited and native
completion checks are running. These stages do not measure extraction bytes or
claim that removal finished before NSIS's inner process completes. Stages may be
brief; do not require artificial delays to keep them visible. Failure must remove
the progress bar, show Retry/Close, and never turn into success before a native
retry completes. Also check the 960×640 minimum window and reduced motion.
At normal and maximized sizes the approved card must stay centered on both axes
and retain its 1160px width cap. Run `npm run test:installer:layout` for the
production UI geometry regression (Windows uses installed Edge); the installer
lifecycle workflow enforces it. See [the telemetry investigation](installer-progress.md)
for the numeric progress decision and the native callback evidence.

All-users secure-desktop UAC approval/cancellation, Windows Settings launch, and visual/scaling QA
remain manual. GitHub-hosted Windows runners disable UAC, so automating those paths there would not
exercise the production privilege boundary.

```powershell
$oldInstaller = "C:\path\to\previous\RepoDitor-Setup-<old-version>-x64.exe"
$newInstaller = (Resolve-Path ".\desktop\release\RepoDitor-Setup-<version>-x64.exe").Path
$repoTree = "$env:USERPROFILE\AppData\LocalLow\semiwork\Repo"
$beforeHashes = "$env:TEMP\repoditor-repo-save-hashes-before.csv"
$afterHashes = "$env:TEMP\repoditor-repo-save-hashes-after.csv"
```

1. Confirm RepoDitor is not installed and no stale test installation directory remains. Do not
   delete or move R.E.P.O. saves. Both RepoDitor-owned root checks must initially be `False`, then
   record the complete game-owned tree before installation:

   ```powershell
   Test-Path -LiteralPath "$env:APPDATA\repoditor-desktop"
   Test-Path -LiteralPath "$env:LOCALAPPDATA\RepoDitor"
   Get-ChildItem -LiteralPath $repoTree -Recurse -File |
     Get-FileHash -Algorithm SHA256 |
     Sort-Object Path |
     Export-Csv -LiteralPath $beforeHashes -NoTypeInformation
   ```

2. Run the candidate installer normally:

   ```powershell
   Start-Process -FilePath $newInstaller -Wait
   ```

   Confirm one modern artwork-led window identifies RepoDitor with its real icon, defaults to a
   current-user installation, shows the destination, and exposes **Change** and **Install** without
   classic Next/Back wizard chrome. Use **Change** to select a custom test parent folder and confirm
   the resulting destination ends in `RepoDitor`. Install to that custom path. Confirm the in-place
   progress view and the completion view with **Launch RepoDitor**. Confirm the application files, generated
   uninstaller, Start Menu shortcut, Installed Apps entry, and RepoDitor icon are present.

3. Launch RepoDitor without repository tooling. Confirm the bundled backend, discovery, Overview,
   Players, Upgrades, Run, Items refill-to-full, Cosmetics, Maps, and current-version About
   information. With network access disabled, confirm local features still work; optional Steam
   avatars may fail softly. Using only a disposable/generated save, confirm open → edit → pending
   changes → save → backup → reopen, plus stale-file rejection.
4. Explicitly uninstall this clean candidate installation through **Settings → Apps → Installed
   apps**. Confirm the branded uninstaller and removal of application files, shortcuts,
   registration, and both RepoDitor-owned roots using the `Test-Path` checks from step 7.
5. Install the previous release, seed harmless sentinels inside both RepoDitor-owned roots, then
   install the candidate over the existing installation:

   ```powershell
   Start-Process -FilePath $oldInstaller -Wait
   New-Item -ItemType Directory -Force "$env:APPDATA\repoditor-desktop" | Out-Null
   New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\RepoDitor" | Out-Null
   Set-Content -LiteralPath "$env:APPDATA\repoditor-desktop\upgrade-sentinel.txt" -Value "preserve"
   Set-Content -LiteralPath "$env:LOCALAPPDATA\RepoDitor\upgrade-sentinel.txt" -Value "preserve"
   Start-Process -FilePath $newInstaller -Wait
   Test-Path -LiteralPath "$env:APPDATA\repoditor-desktop\upgrade-sentinel.txt"
   Test-Path -LiteralPath "$env:LOCALAPPDATA\RepoDitor\upgrade-sentinel.txt"
   ```

   Both checks must be `True`. Launch the upgraded app and confirm required behavior/state remains
   usable.

6. Query the actual uninstall registration without assuming a registry hive:

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

   Confirm `DisplayName` is `RepoDitor`, `DisplayVersion` matches the release, and `UninstallString` targets the generated RepoDitor uninstaller.

7. Open **Settings → Apps → Installed apps** and explicitly uninstall RepoDitor. Confirm the branded
   uninstaller presentation, application files, custom installation directory, shortcuts,
   uninstaller, and registration are removed. Then prove both owned roots are gone:

   ```powershell
   Test-Path -LiteralPath "$env:APPDATA\repoditor-desktop"
   Test-Path -LiteralPath "$env:LOCALAPPDATA\RepoDitor"
   ```

   Both checks must be `False`.

8. Recalculate and compare the complete R.E.P.O. tree:

   ```powershell
   Get-ChildItem -LiteralPath $repoTree -Recurse -File |
     Get-FileHash -Algorithm SHA256 |
     Sort-Object Path |
     Export-Csv -LiteralPath $afterHashes -NoTypeInformation
   Compare-Object `
     (Import-Csv -LiteralPath $beforeHashes) `
     (Import-Csv -LiteralPath $afterHashes) `
     -Property Path,Hash
   ```

   `Compare-Object` must produce no output. The R.E.P.O. tree, Run saves, MetaSave, settings, and
   backups outside the two RepoDitor roots must remain byte-identical.

9. Reinstall the candidate to the default location:

   ```powershell
   Start-Process -FilePath $newInstaller -Wait
   ```

   Launch RepoDitor, confirm it starts with clean application state, rebuilds disposable presentation
   caches as needed, and rediscovers the existing saves. Uninstall again through Installed Apps if
   the workstation must return to a clean state.

10. Repeat the landing, progress, completion, and uninstall visual inspection at Windows display
    scaling values of 100%, 125%, 150%, and 200%. At each scale, the approved artwork must keep its
    aspect ratio, the RepoDitor icon and all text must remain sharp, the read-only path must retain
    its full selectable value and scroll horizontally without overlap, every control must remain
    reachable by Tab/Shift+Tab, Enter must activate the
    focused primary action, Escape/cancel must leave the machine unchanged, and no stock NSIS
    header/sidebar or Next/Back page may appear. Do not mark visual acceptance complete until a
    human has inspected the actual release-candidate installer.

### Phase 16 local current-user acceptance — 2026-09-13

The current unsigned `RepoDitor-Setup-0.2.1-x64.exe` (103,968,668 bytes, SHA-256
`D52BB4D61EE63DCD7F14DDD3D004256EA0163CB123FD661BF05670E3C0810896`) passed the
production matrix in a newly created, unelevated disposable Windows profile. No lifecycle action
ran against the normal ASUS profile; LocalLow input consisted only of three synthetic files.

| Case                            | Result | Authoritative evidence                                                                                                                                                                                                                                           |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default-path fresh install      | PASS   | HKCU InstallLocation equals the disposable user's Local Programs/RepoDitor; executable, installed uninstaller, app.asar and Python backend exist.                                                                                                                |
| Same-path reinstall             | PASS   | Exact registered path retained; both owned AppData sentinels retained with unchanged hashes.                                                                                                                                                                     |
| Default-path WebView2 uninstall | PASS   | Both HKCU keys, four payload entry points, installation directory and both owned AppData roots removed.                                                                                                                                                          |
| Custom-path install             | PASS   | Exact selected temporary path registered; all four payload entry points exist there; silent engine exits zero.                                                                                                                                                   |
| Custom-path WebView2 uninstall  | PASS   | Both HKCU keys, exact custom directory, payload and both owned AppData roots removed.                                                                                                                                                                            |
| Native failure and real Retry   | PASS   | Non-empty synthetic target refused without registration or executable; sentinel unchanged; failure removes progress and offers Retry. Resolving only that sentinel and invoking Retry starts fresh preparation/running and completes with valid installed state. |

All three synthetic LocalLow relative paths, sizes and SHA-256 values matched after every operation,
including refusal/retry. Live removal showed preparing, running and verifying before success.
Install/reinstall/retry showed preparing and running; installation verification was too brief for
the existing condition-based observer to sample. Native fixtures verify its position before
authoritative success. No stage was artificially prolonged. Success and failure had no progress
control, no percentage was observed, and completion checks passed immediately at successful UI
results. Numeric integration remains stopped at the documented supported-hook boundary.

The first attempt failed a harness-only assumption that the interactive setup launcher must exit
zero. NSIS `.onInit` executes `Quit` after the WebView handoff and returns 2; this is distinct from
the silent engine's result. The harness now checks the expected handoff status and still requires
the WebView result and authoritative registry/filesystem checks. No production change was made
in response. These measurements validate this artifact only; all-users secure-desktop/UAC,
Settings entry, native path picker and human scaling/keyboard visual acceptance remain manual.

## Historical v0.1.0 baseline

The following results are preserved as historical release-candidate evidence. They are not current
artifact measurements and must not be reused to validate a later version.

### Phase 10E automated installer baseline — 2026-08-09

| Check                            | Result                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installer                        | `RepoDitor-Setup-0.1.0-x64.exe`, 102,691,116 bytes (97.93 MiB)                                                                                                    |
| Local SHA-256                    | `fca6b30afadadb62afb967d68de41ed26dcbd28ac61b0ec6c96f46dd5941e425`                                                                                                |
| Installer mode                   | NSIS assisted, current user selected by default, installation directory change enabled                                                                            |
| Updater artifacts                | No elevation helper, differential blockmap, updater, service, scheduled task, or startup entry                                                                    |
| Custom path                      | Silent current-user install to an isolated non-default path passed; installed executable, backend, uninstaller, registration, and Start Menu shortcut verified    |
| Windows registration             | `DisplayName=RepoDitor`, `DisplayVersion=0.1.0`, generated current-user `UninstallString`                                                                         |
| Installed application E2E        | 1 passed with external networking blocked; launch 2.93 s, open 918 ms, safe write 942 ms                                                                          |
| Custom-path uninstall            | Exit 0; installation directory, registration, and Start Menu shortcut removed                                                                                     |
| Default-path reinstall/uninstall | Both exited 0; default installation directory removed                                                                                                             |
| Save preservation                | 332 existing `.es3`/`.bak-*` files: zero missing, changed, or added after lifecycle tests                                                                         |
| Disposable preservation fixtures | Save and `.bak-*` sentinel SHA-256 values unchanged                                                                                                               |
| Code signing                     | Not signed; SmartScreen notice remains required                                                                                                                   |
| Manual visual acceptance         | Still required: assisted wizard pages/Browse control, icon rendering, Start Menu launch, Installed Apps UI, SmartScreen wording, and human-visible uninstall flow |

### Historical ZIP release-candidate baseline — 2026-08-09

This baseline predates the NSIS installer and proves only the portable archive and unpacked application behavior. It does not satisfy the installer acceptance gate.

| Check                                     | Result                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Python 3.11                               | 92 passed                                                                   |
| Python 3.14                               | 92 passed                                                                   |
| Renderer and Electron contracts           | 41 passed                                                                   |
| Development Electron E2E                  | 1 passed                                                                    |
| Unpacked and clean-extracted Electron E2E | 1 passed each                                                               |
| Responsive visual review                  | 1600x900, 1200x800, and 960x640 passed                                      |
| Renderer coverage                         | 72.97% statements / 74.18% lines; measured, no arbitrary threshold          |
| Bundle budget                             | 269.89 KiB raw / 77.25 KiB gzip; within budget                              |
| Dependency audit                          | 0 vulnerabilities; four deprecated transitive packaging dependencies noted  |
| Windows archive                           | 145.11 MiB; sidecar, app ASAR, RepoDitor MIT, and Teko OFL licenses present |
| Archive extraction                        | 5 required files present; no source/test/dev entries in ASAR                |
| Code signing                              | Not signed; Windows SmartScreen notice documented                           |

Measured on the v0.1.0 release-candidate Windows workstation:

| Operation                                          |   Time |
| -------------------------------------------------- | -----: |
| Development launch to discovery ready              | 2.93 s |
| Development save open                              | 385 ms |
| Development backup + write + verification          | 379 ms |
| Unpacked packaged launch to discovery ready        | 8.53 s |
| Clean-extracted packaged launch to discovery ready | 3.55 s |
| Clean-extracted packaged save open                 | 1.37 s |
| Clean-extracted backup + write + verification      | 1.42 s |

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
- The installer builds `desktop/installer/ui/` with Vite and renders only that local production
  output in a locked-down WebView2 host, then runs electron-builder's standard NSIS engine silently
  for the actual install or uninstall. No classic NSIS page, replacement installer script, or
  third-party skinning plugin is used.
  Explicit uninstall removes only `%APPDATA%\repoditor-desktop` and
  `%LOCALAPPDATA%\RepoDitor`; `${isUpdated}` preserves both roots during upgrades, and the cleanup
  does not follow reparse points.
- Current-user install is the default, the destination can be changed, and the
  updater-only elevation helper and differential package are disabled.
- Static installer checks enforce the exact cleanup targets and upgrade guard. The historical
  lifecycle baseline above remains evidence only for v0.1.0; each release candidate must repeat
  the full install/upgrade/uninstall/reinstall and R.E.P.O. hash matrix.
