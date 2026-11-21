# Release checklist

The current Windows Desktop source builds a portable package and NSIS installer
with `npm run package:installer` from `desktop/`. Run the desktop quality,
packaged journey, Tauri safety, and capability alignment gates. Automated CI
and interactive installer acceptance are described below. See the
[native installer gate](#w9-b-installer-migration-acceptance).
The signing requirements and installer evidence below record the historical
release process and the obligations for its successor. Reproduce historical
commands on the corresponding published source tag.

## Windows CI coverage

| Original workflow | Tauri coverage | Remaining release-candidate coverage |
| --- | --- | --- |
| `quality.yml` | React and TypeScript build, imports, formatting, ESLint, bundle budget, renderer tests and the Python version matrix remain. **Windows package smoke** builds and verifies the portable host and PyInstaller sidecar, then exercises packaged WebView2 journeys. **Windows Tauri save safety** checks Rust formatting, Clippy, default/all-feature Rust tests, fixture-only writes, exact encrypted backups, compatibility, stale sessions, transactions and recovery. | Run Quality against the exact release source and check its packaged runtime. |
| `tauri-startup.yml` | Manual startup diagnostic still launches an ordinary packaged native host and frozen sidecar. The required Quality safety job also exercises normal startup, cancellation, failure and retry. | Verify installation and startup on a standard Windows account with the intended WebView2 prerequisites. |
| `installer-lifecycle.yml` | Hosted Windows builds the same NSIS package as a local candidate. The test exercises clean installation, launch, reinstall, coexistence with the pinned v0.2.1 installer, rollback, registry and shortcut cleanup, and exact synthetic Run, MetaSave and backup hashes. | Verify the interactive installer, custom path, preferences, WebView2 bootstrapper, branded setup progress and errors, Windows scaling and UAC on disposable Windows. |
| `release.yml` | Manual validation from `main` with `confirm=VALIDATE` invokes the hosted installer gate. The build checks the host, sidecar and bundle and generates an installer SHA-256. Only diagnostics and checksum records are retained in Actions. | Authorize the exact version and release commit, sign and verify each executable and final installer, and calculate the post-signing SHA-256 before separately authorizing distribution. |
| `release-unsigned.yml` | Retired. The same manual build-validation lane covers unsigned CI artifacts. | The old unsigned publish path is absent. |
| `compatibility-alignment.yml` | Retained. The source-pinned Python/Web fixtures and current/future build policy checks stay in effect. | Review and authorize public writes separately from private gameplay evidence. |

The automated test uses the production **RepoDitor Desktop** registration in
a disposable GitHub-hosted Windows profile. It refuses to run on a local or
self-hosted machine. See the [Tauri 2 Windows installer guide](https://v2.tauri.app/distribute/windows-installer/)
and [GitHub pipeline guide](https://v2.tauri.app/distribute/pipelines/github/).

Keep the required **Quality gate**, **Windows package smoke**, and **Windows
Tauri save safety** contexts where configured. Remove the retired **Windows
Electron E2E** context from the ruleset and replace **Current-user production
installer lifecycle** with **Current-user Tauri installer lifecycle** if required.
Publishing, tagging, and executable artifact uploads are disabled in these
workflows. Before introducing publication, restrict the job to the reviewed
default-branch commit and a protected maintainer-approved environment.

## Historical Windows code signing preparation

RepoDitor v0.1.0 remains the historical unsigned release. Future official tagged releases are
prepared to use Microsoft Artifact Signing through electron-builder's Azure signing integration.
This preparation does not create a certificate or signing identity and contains no credential
values.

The former official release path required the Microsoft Artifact Signing values
below. Verify the maintainer-owned Azure identity, publisher and protected
environment before wiring signing into the production Tauri installer.

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

Signing requires:

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

## Historical Electron release gates

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

## Historical signed release procedure

1. Update every managed version source and verify alignment from `desktop/`:

   ```powershell
   npm run update:version -- <version>
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

## Historical temporary unsigned v0.1.1 procedure

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

## Historical installer acceptance gate

This section records the legacy installer procedure at `752325a`. The current release uses
the [W9-B installer gate](#w9-b-installer-migration-acceptance).
Do not treat the unpacked E2E as proof of
install, upgrade, explicit-uninstall cleanup, save preservation, or reinstall behavior. Use an
older installer and the candidate installer for the upgrade leg:

The former `Installer lifecycle` workflow complemented this gate with fresh-package,
current-user default/custom-path, registered reinstall, explicit-cleanup, and synthetic LocalLow
fingerprint coverage through real WebView2 **Install/Update**, **Uninstall**, and a safe native
refusal followed by one real **Retry**. Custom-path installation passes the selected path to the
production silent engine. It ran the lifecycle under an
isolated standard Windows user because GitHub-hosted Windows jobs otherwise run as administrators
with UAC disabled. Exit code 0 is never sufficient: both HKCU registration keys and installed
payload entry points must be gone.

Run `npm run test:installer:host` on Windows for native stage, argument, failure,
and completion checks against temporary files and a unique HKCU fixture key. The
current installer lifecycle workflow still runs this check before packaging.

Install/update uses determinate percentage only while the production Nsis7z extraction callback
provides genuine completed/total byte measurements. Verify preparation/running, measured extraction
progress reaching 100%, native verification, and then the ready state. A displayed 100% means
extraction completed; it does not replace authoritative install verification. Retry must start a
fresh authenticated progress session and reject stale measurements. Explicit uninstall remains
truthful stage text only — preparing removal, running removal, verifying removal, then finished —
because the native removal path has no reliable completed/total metric. Do not add fake timers,
smoothing, looping percentages, or artificial delays.

Failure must remove the progress indicator, show Retry/Close, and never turn into success before a
native retry completes. Run `npm run test:installer:extraction` for normal/fallback callback and
authenticated-transport coverage, `npm run test:installer:layout` for the production UI geometry
regression, and `npm run test:installer:lifecycle` only through the repository's disposable-account
isolation. Also check the 960×640 minimum window and reduced motion. At normal and maximized sizes
the approved card must stay centered on both axes and retain its 1160px width cap. See
[installer progress](installer-progress.md) for the current telemetry and trust-boundary contract.

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

### Final engineering disposable-account acceptance — 2026-09-14

The unsigned developer setup produced after the approved S1/S2 refactors was **103,967,946 bytes**
(SHA-256 `BBCA16B5E5359AE6696DDD3E60EB2D12144E382709DDA15E80B2B6CE93587964`). The full lifecycle ran
under a newly created unelevated disposable Windows account/profile rather than the maintainer's
normal profile.

- Default install, registered update, explicit uninstall, custom-path install/uninstall, and a
  deliberate native refusal followed by real **Retry** all passed authoritative postflight checks.
- All verified installed states measured **398,998,627 bytes across 152 files**.
- RepoDitor-owned AppData sentinels were retained across update and removed on explicit uninstall.
- The synthetic R.E.P.O. LocalLow fingerprint remained unchanged throughout.
- Install/update produced **40 observed extraction-percentage records** reaching 100%; separate native
  extraction tests observed **34 normal callback samples** and **68 fallback samples**, with
  authenticated transport, monotonicity, Retry-session isolation, and authoritative verification
  after extraction reached 100%.

All-users secure-desktop UAC approval/cancellation and visual/scaling acceptance remain manual.

### Historical Phase 16 pre-numeric local current-user acceptance — 2026-09-13

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

## Tauri save recovery and cutover

Production Tauri writes and production manual restore remain disabled. The
procedure below is validated against disposable synthetic saves; it is not
permission to apply these steps to a player profile. Use the required Windows
`npm run test:tauri-safety` gate to reproduce the Python and packaged Tauri drills.
Its native fixtures live under `desktop/build/recovery-checkpoint/tauri-safety`.
Use a fresh output name for repeated runs. For an acceptance run that needs the
exact executable copies, use `-KeepExecutables` as described in the
[Desktop safety gate instructions](../desktop/README.md#validation-and-portable-windows-package).

Before any future production authorization, an operator must have a tested offline
maintenance window and exclusive access to the save profile. Close the game, all
RepoDitor windows and their workers; a running, unknown or failed authoritative
game-status query is a stop condition. Suspend cloud synchronization and other
writers for the entire maintenance operation. A Python transaction lock excludes
updated cooperating writers only. It does not stop an old Electron binary or the
game from starting after a status check.

1. **Preserve first.** Reject reparse ancestry, linked files and non-NTFS/remote
   storage before copying; do not follow links during intake. With all writers
   quiescent, record the exact source path,
   encrypted source SHA-256, file identity, and every slot filename. Copy the entire
   slot, including hidden pending/archive/temporary receipts and exact backups, to
   a separate intake directory outside save discovery. Verify every copied file's
   size and SHA-256 against its source. Keep the original slot intact. If a file
   changes during the copy or a writer cannot be excluded, stop. Do not edit receipt
   fields, rename backups to make them appear valid, or delete a lock file to bypass
   an active owner.
2. **Inspect without reconciling.** In the synthetic environment, run the explicit
   validated sidecar as `repoditor-backend.exe health-state <save-id>`. E2E roots
   must point only to the disposable fixture. This command may create/open the
   coordination lock; it preserves save, backup, receipt and staging bytes. Pending
   intent is evidence, never an instruction to replay. `blocked` or `busy` requires
   investigation, not a retry loop. Inspect receipt bytes only within their 4,096-byte
   limit, using the fixed operation-derived namespace; treat invalid data as conflict.
3. **Reconcile only a supported operation.** After preserving intake, an exited-owner
   schema-3 operation in its original admitted Windows namespace can be reconciled
   with `health-recover <save-id> <operation-id> --canonical`. This is a maintenance
   operation: even without `--acknowledge`, it can write the archive and clean staged
   files. It does not replay the edit. An exact `applied` or `unchanged` result must
   agree with the reopened canonical state and expected encrypted fingerprint.
   Only then explicitly repeat with `--canonical --acknowledge` to clear the pending
   marker. Keep intake, backups and the operation archive. A conflict must remain
   unresolved; do not infer success from a visible health value.
4. **Handle conflicts offline.** Identify the chosen backup explicitly. For a
   transaction backup, its encrypted SHA-256 must equal the independently recorded
   original snapshot and the receipt's `before` hash. Validate a copy through
   Python decryption/schema checks before selecting it. A missing, damaged, ambiguous
   or schema-invalid backup is a stop condition. Do not pick the newest file by
   timestamp or re-encrypt parsed data as a substitute for exact restoration.
5. **Restore as a new slot, preserving the old one.** In the synthetic drill, move
   the whole conflicting slot to quarantine outside discovery, verify its complete
   intake manifest again, create a fresh slot at the admitted save location and
   copy only the selected encrypted backup bytes to its canonical save filename.
   Preserve receipts, backups and conflict bytes in quarantine/intake; do not copy
   old receipts into the new namespace. Confirm restored SHA-256 and bytes exactly,
   then reopen through the ordinary read-only Tauri host and verify canonical data.
   This is an offline restore, not settlement or success of the old transaction.
   If validation fails, preserve both trees and stop. A new slot's successful open
   does not authorize writing or establish game-build compatibility.

Windows schema-1/2 receipts lack the namespace proof required for automatic
settlement. Their identities/intents may remain inspectable, but reconciliation
must fail closed and preserve the receipt. Do not add a fabricated namespace field,
upgrade their version, or acknowledge them with a different OS implementation.
The offline intake/quarantine procedure can salvage an independently verified backup;
without that evidence, manual recovery remains unsupported. Reparse ancestry,
non-NTFS/remote storage, unknown owner state, conflicting backups and unreadable
receipts remain stop conditions. No normal production UI restore command exists.

Production activation requires exclusive access to the writable profile during
the maintenance operation. The per-slot Python lock serializes updated,
cooperating Electron, Tauri and sidecar writers and their recovery. A pending
receipt blocks another cooperating write after a worker exits. Windows namespace
validation pins ordinary local NTFS ancestry and uses handle-relative
operations. Source identity and encrypted fingerprint checks reject drift
observed before replacement. These checks preserve the transaction's target and
its backup.

Old or standalone writers can ignore the coordination lock. The source
comparison and protected replacement are separate operations. An external
writer with effective access can change the target after the last comparison
or overwrite a completed edit afterward. Closing known windows, prompting the
operator, enumerating processes and rechecking fingerprints cannot guarantee
exclusion. The final game-status check also leaves a game-launch race.

Enterprise-wide application control is one possible enforcement mechanism. A
separately secured profile or principal could meet the same requirement if it
denies effective write access to unapproved writers and retains approved game,
editor and recovery access. Same-user ACLs alone cannot separate binaries
running with the same token. Windows share modes constrain access to particular
open objects for the lifetime of their handles. Any app-level design relying on
them would have to prove that the ordinary atomic replacement still succeeds,
that external opens and renames cannot win across the boundary, and that the
game or sync client cannot write from stale state. The current application has
established none of those guarantees for noncooperating writers. Do not activate
production writes on a shared writable profile while this gap remains. Validate
any proposed boundary on disposable data with old, renamed and portable
binaries and standalone sidecars, plus approved positive write and recovery
controls. Do not change production system policy during that drill.
See [Windows access control](https://learn.microsoft.com/windows/security/identity-protection/access-control/access-control)
and [file handle sharing](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).

Production release additionally requires domain-specific game-build approval,
compatibility measurements for the provisional encrypted-save resource ceilings,
supported Windows/filesystem validation, remote CI confirmation and ordinary
release/installer acceptance. These prerequisites
cannot be replaced by the synthetic recovery drill or a successful read-only open.

### Private Health qualification

The private frozen sidecar embeds the reviewed build hashes, a fixed local
disposable profile, and an Ed25519 verification key. The host grants only the
production Health commands. Keep the offline signing key outside the application
bundle. A signed proposal authorizes one Health edit on one file and binds its
Steam build, save slot, player, before and after values, encrypted SHA-256, file
identity, and Windows directory identity. The original bytes and identity must
match under the transaction lock. Existing independent reconciliation verifies
the signed intent and its original identity against the receipt after replacement.
Build 26407089 stays outside the production write policy.

1. Export a fresh Run from a separately isolated profile after the game has
   exited and Steam Cloud for that test is inactive. Place the unchanged encrypted
   export under `desktop/build/w6-d1b-authentic/saves/<slot>/<slot>.es3` and its
   record at `desktop/build/w6-d1b-authentic/provenance.json`. Use the fields
   checked by [the intake validator](../desktop/scripts/tauri/validate_run_fixture.py).
2. Set `PYTHONPATH` to `desktop/python`. Run
   `private_health_approval.py propose <export> <provenance> <player-id> <new-health>`
   from [the Tauri tools](../desktop/scripts/tauri/private_health_approval.py)
   with the project Python interpreter. The tool verifies the export and creates
   one working copy under the private bundle's profile. Review the proposal under
   `desktop/build/w6-private-health/operator/proposal.json`, then explicitly run
   `private_health_approval.py sign <reviewed-sha256>` against the exact approved
   proposal. Both commands refuse to overwrite an existing target or approval.
3. Open that slot in the private preview, select the approved player in Players,
   enter the approved value, use Review, then Save Changes. After the preview reports
   success, verify that the exact encrypted backup matches the intake SHA-256 and
   that the settled receipt links that hash to the edited file's hash.
4. A gameplay test requires separate approval for the exact game-readable slot
   and an isolated profile. Use the original slot identity of the freshly exported
   Run. With the game closed, preserve the original and stage the verified edited
   copy only in the approved slot. Observe Health, let the game save normally,
   exit and capture its encrypted output, then reload and confirm the value.
   Stop and retain the evidence if the game rejects the save or legitimate game
   activity changes the value. After exiting, restore the exact encrypted backup
   to the approved slot and compare its SHA-256 with the intake. Preserve the
   before, edited, resaved, reloaded and restored evidence separately.

### Private existing-save editing

The `private-editing` host uses the same validated Run and MetaSave transaction
commands. Its local frozen sidecar pins the reviewed Steam executable, engine,
managed assembly and game-manager digests for build 26407089. The live package
uses the Windows Known Folder save root. The disposable verification sidecar
has its profile path baked into the bundle. Ordinary hosts omit private
capabilities and the public build policy is independent.

1. Close R.E.P.O. and let Steam finish any prior synchronization. Launch
   `desktop/build/w6-private-editing/candidate/repoditor-preview.exe`.
   Open the intended Run. The host enables supported editing after verifying the
   save and installed build, and binds authority to the current save generation.
   **Change save** revokes that authority. Cosmetics independently verifies
   MetaSave and revokes its authority when leaving that workspace.
2. Edit the desired fields and select **Review**. Verify the full source path
   and pending values. **Save Changes** writes and independently checks an
   exact encrypted backup before replacing the save. A mixed Run request uses
   one backup and replacement. MetaSave uses its own transaction.
3. After success, retain the `<save>.bak-health-<operation>` and
   `.<save>.health-<operation>.json` next to the save. Compare the backup's
   SHA-256 with the receipt's `before` and the edited file's SHA-256 with
   `after`. Then close the preview, load the same slot in R.E.P.O., and verify
   the value before and after a normal resave and reload.
4. If restoring, close the game and preview, let synchronization finish,
   and preserve the edited/resaved bytes. Verify the operation backup against
   `before`; restore it to the reviewed path and recheck that hash. Preserve
   the receipt and use the [recovery instructions](#tauri-save-recovery-and-cutover)
   if a transaction is unresolved. A file modified by the game after the edit
   will normally differ from the receipt's `after` hash.

The private package uses the existing Item eligibility classifier with the
pinned installed Unity version. Item creation, deletion and duplication are
outside Electron's supported operations. Cosmetics still uses the intersection
of installed IDs and Electron's reviewed mutation IDs.

### v0.3.0 Tauri release acceptance

The private Windows candidate supports direct Health, Upgrades, Run and resume
location editing, eligible Item refills, and a single mixed Run transaction.
Cosmetics uses a separate MetaSave transaction. Packaged tests on disposable data
cover review, revert, reopen, exact backups, atomic replacement, session revocation,
and independent recovery. The maintainer accepted all five editing domains in-game on Steam build
`26732417`. Public enablement requires a separate release authorization.

Run entry validates the save, prepares one projection batch, and checks artwork
before making the workspace available. The preparation bar reports checked
artwork once the roster is known. Fresh sessions reuse decoded artwork when the
installed revision and artwork roster match. The editor admits writes after its
native safety checks succeed. A save that changes during preparation must be
reopened. Cosmetics keeps its completed catalog visible during revalidation and
replaces it when the verified sources change.
Run writes reuse preflight work and still wait for independent verification and
canonical refresh. The W8 Windows benchmark used five runs per host and a matched
disposable fixture. Values are medians in seconds from those packaged builds.

| Workflow            | Electron v0.2.1 | Earlier Tauri | Optimized Tauri |
| ------------------- | --------------: | ------------: | --------------: |
| Launch to discovery |            1.32 |          0.95 |            0.76 |
| Cold editing ready  |            8.12 |         13.84 |           12.70 |
| Warm editing ready  |            0.92 |          2.94 |            1.96 |
| Health Save Changes |            0.88 |          2.40 |            1.92 |

Tauri classified all eight fixture Item types. Electron reported all eight as
unknown. The benchmark predates the reliability and parser-pin fixes.

The measured portable candidate is **88.53 MiB**, including the full **77.97 MiB**
Python backend, in `desktop/build/desktop-reliability/closeout/candidate`. The unpacked
Electron v0.2.1 folder was **377.92 MiB**, a reduction of **289.39 MiB (76.57%)**.
The **99.15 MiB** Electron installer is a separate download measurement. The
measured Tauri candidate had no installer or portable archive. These are sums
of file lengths, and the portable Tauri folder uses the system WebView2 runtime.

Remaining release gates:

- Review the accepted `26732417` domain evidence and explicitly approve the
  intended public write policy. The development portable package is read-only.
- Run the full [capability alignment gate](maintenance/game-update-capabilities.md#review-and-ci)
  on the release candidate. Recharge snapshot generation uses the reviewed
  build `23363152` reader. Desktop save workspaces share its classifier and use
  a separate runtime scan for the private candidate's reviewed Unity version.
- Verify package, native executable, and visible app versions against the
  intended release version. Run the Quality and
  [installer acceptance gates](#w9-b-installer-migration-acceptance) on the
  exact candidate.
- Record the disposition of the earlier unexplained preview-window disappearance.
  Focused packaged cancellation and retry checks did not reproduce it. Retain
  startup and process-exit diagnostics if it recurs.

#### W9-B installer migration acceptance

Run `npm run package:installer` from `desktop/`. Staging uses 7-Zip to compare
the archived Tauri host, frozen backend, and branded installer host with the
verified release inputs. Use `REPODITOR_7ZIP_EXE` if 7-Zip is outside PATH and
the standard installation directory. The outputs are
`build/installer/RepoDitor-Setup-0.3.0-x64.exe`, its `.sha256` file, and
`build/tauri-release/RepoDitor.exe` with the sidecar and licenses beside it.
Interactive setup opens the established branded installer after the Evergreen
WebView2 prerequisite check and shows preparation, installation, and verification
stages. The current-user NSIS engine owns file installation, shortcuts, registration,
and removal. Fresh installations require an empty destination. Reinstalls reuse
the registered location. Python 3.13 ships inside the sidecar directory.

Interactive removal through **RepoDitor Desktop** opens the branded uninstaller.
Cancel at confirmation leaves the installation intact. The window reports the NSIS
result after checking that the application files and registration are gone. Branded
removal retains RepoDitor settings, game saves, and backups. If the branded window
cannot start, NSIS presents its own confirmation. Silent and updater removals use
NSIS directly.

| Property | v0.2.1 Electron | v0.3.0 Tauri |
| --- | --- | --- |
| Installed Apps and Start Menu | RepoDitor | RepoDitor Desktop |
| Default install | `%LOCALAPPDATA%\Programs\RepoDitor` | `%LOCALAPPDATA%\RepoDitor Desktop` |
| Host executable | `RepoDitor.exe` | `RepoDitor.exe` |
| Preferences | `%APPDATA%\repoditor-desktop` | WebView2 storage under `%LOCALAPPDATA%\io.github.yoruxyv.repoditor.preview` |

Tauri keeps its established storage identifier so it can reuse compatible caches
after source validation. Electron theme and language preferences are stored
separately and must be selected again in Tauri. RepoDitor continues to discover
the game's existing LocalLow save directory. Keep game data and backups outside
either installation directory. Removal of either version is an explicit action.

At startup, RepoDitor checks the pinned v0.2.1 Windows uninstall registration
and opens a dismissible migration dialog when it matches. **Open Installed Apps**
opens Windows Settings. **Remind Me Later** and Escape defer the dialog for
seven days. **Don't Show Again** dismisses it for that Tauri profile. Returning
to RepoDitor after uninstalling Electron clears the dialog.

The build command produces an unsigned candidate and verifies its Authenticode
status. Windows may display **Unknown publisher** or a SmartScreen reputation
prompt. Verify the SHA-256 against the approved release record before running the
installer. Keep SmartScreen enabled. With an approved signing identity, verify the
publisher and regenerate the checksum after signing. See
[Microsoft Defender SmartScreen](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/).

Run the clean install, coexistence, uninstall, rollback, and reinstall checks
below on a disposable standard Windows account or VM. Verify installation on a
machine without global Python. Use a WebView2-free VM snapshot to test the
bootstrapper and its failure path. Test the current-user wizard's UAC behavior,
100%, 125%, 150%, and 200% Windows scaling, progress, cancel, and a denied
destination or unavailable bootstrapper. Hosted silent checks supplement this
interactive pass.

1. Verify the published [v0.2.1 installer](https://github.com/Yoruxyv/RepoDitor/releases/tag/v0.2.1)
   SHA-256 `d013a02d7136943c1f19ddcd946b0d9511865afae62028ac43cb73377b2253ea`
   and install it normally. Record its
   Installed Apps registration, install path, executable, Start Menu and any
   desktop shortcut targets. Set a recognizable theme and language.
2. Seed synthetic Run and MetaSave files, RepoDitor backups beside them, and
   one separately stored backup. Record relative paths and SHA-256 hashes.
   Close RepoDitor and R.E.P.O.
3. Install v0.3.0 while v0.2.1 is registered. Verify the launched version,
   registrations, shortcut targets, ownership of shared directories, and the
   resulting theme and language. Record whether preferences carry forward or
   need to be set again. Test removal of either registration that remains and
   ensure it cannot remove the other install's files or shortcuts.
4. Uninstall v0.3.0 through its **RepoDitor Desktop** entry. Launch the existing
   v0.2.1 shortcut and verify it still discovers the fixture. Reinstall v0.3.0,
   remove v0.2.1 explicitly, and verify v0.3.0 still launches. To roll back after
   removing v0.2.1, remove v0.3.0 and reinstall the same digest-verified v0.2.1
   artifact. Compare the synthetic save and backup manifests after every step.
   Treat an install conflict, broken shortcut, or data change as a release blocker.

#### v0.3.0 release notes

Use the [v0.3.0 release notes](changelog/v0.3.0.md) for the GitHub Release.
If the approved installer changes, update its SHA-256 there after validation.

#### v0.3.0 distribution

- Publish the verified Windows installer, SHA-256 and migration instructions on
  the [canonical GitHub Releases page](https://github.com/Yoruxyv/RepoDitor/releases)
  under the stable tag `v0.3.0`. Verify the latest-release endpoint returns that
  tag and confirm version and artifact hashes on download.
- Update the existing [Nexus Mods listing](https://www.nexusmods.com/repo/mods/319)
  and [Thunderstore listing](https://thunderstore.io/c/repo/p/RepoDitor/RepoDitor/)
  with the reviewed v0.3.0 package where permitted. Follow each platform's
  review and file rules. Identify the edition as the standalone Windows Tauri
  app and link to the canonical release notes and checksum.
- Use these upgrade instructions on both listings after migration acceptance.
  1. Close RepoDitor and R.E.P.O. Keep your existing saves and backups.
  2. Download the v0.3.0 Windows installer and compare its SHA-256 with the
     canonical GitHub release.
  3. If in-place installation passed, use “Run the v0.3.0 installer with
     v0.2.1 still installed.” If uninstall-first passed and is required, use
     “Remove RepoDitor v0.2.1 in Windows Settings → Apps → Installed apps.
     Then run the v0.3.0 installer.” Publish only the validated instruction.
  4. Launch RepoDitor from its installed shortcut and confirm v0.3.0. Reapply
     theme and language if the migration test showed they reset. The
     standalone app belongs outside the R.E.P.O. game directory.
- v0.2.1 users need to see the listing or release announcement and update
  manually. From v0.3.0 onward, the optional toast checks the canonical GitHub
  release on startup at most once per session, with a six-hour local cooldown.
  **Later** remembers the dismissed version. **View release** opens the release
  page in the system browser for a manual download.

### Proposed consumer live-editing exception

A consumer release may use the following bounded policy only after separate
production approval explicitly replaces strict exclusion for the approved scope.
The private editing candidate is compiled with `production-health` and explicitly
grants its production Run-save and MetaSave commands. Ordinary builds omit the
commands. The production sidecar rejects synthetic profiles. Health, Upgrades,
Run, Item refills and Cosmetics require independent build approval. The approval
tables are empty, including Health for build 26407089. Installed Steam provenance
and pinned executable, engine, managed assembly and game-manager digests are
required. Item refills also require the existing installed recharge evidence.
Cosmetics additionally uses Electron's mutation catalog and a separate MetaSave
session. A mixed Run-save request requires approval for every included domain
and uses one backup, replacement and recovery receipt.

1. Verify that R.E.P.O. is closed at admission and again before publication.
   Unknown status or failed inspection blocks the write.
2. Require reviewed evidence for the installed build and editing domain. Bind
   the authorized intent to the opened save, its identity and encrypted SHA-256.
   Recheck the source under the per-slot writer lock. Reject ambiguous namespaces,
   unsupported storage and unresolved or conflicting recovery evidence.
3. Keep an exact encrypted backup and read it back independently. Validate the
   staged ciphertext and intended fields before handle-relative atomic replacement.
   Preserve durable evidence when publication cannot be confirmed. Require an
   independent reconciliation of save identity, fingerprint and backup before
   acknowledging success in the editor. Retry only after uncertainty is resolved.

A compatible read is admitted normally. A filesystem sharing violation establishes
an access conflict for the attempted operation. Access denied, unavailable
identity and failed inspection do not identify a competing writer. Ask the user
to close the game only on confirmed running status. On source drift, ask the user
to reopen and review the source. On uncertainty, keep the evidence and require
reconciliation before another write.

Tell users to close the game and other editors and let Steam Cloud finish before
editing. An older editor, a newly launched game or a synchronization client can
still write after the last check or overwrite the result later. Atomic replacement
avoids publishing a partial file. The backup preserves the version RepoDitor
admitted, so it may not contain an external edit made after the last check.
The disposable late-writer regression deliberately demonstrates this gap.
Approval requires build-specific compatibility evidence from game-generated
disposable saves and validation of the proposed release behavior.

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
