# Real installer extraction progress

Implemented on 2026-09-13 as the authorized follow-up to Phase 16. The earlier
investigation stopped at electron-builder's supported-hook boundary. This follow-up
explicitly permits a narrow, owned, version-guarded extraction macro override.

## Integration and maintenance boundary

RepoDitor retains electron-builder/app-builder-lib **26.15.3**, its standard x64
embedded 7z payload, cached NSIS **3.04**, and the bundled x86 Unicode Nsis7z plug-in.
There is no replacement installer script, additional bootstrapper, modified plug-in,
node_modules mutation, or generated-script text patch.

The existing `customHeader` hook changes the compiler working directory to
`desktop/installer/nsis` for the install build only. NSIS resolves includes from
that directory before include search paths. The owned `installSection.nsh` includes
the original upstream section explicitly and restores the upstream compiler directory.
While upstream `include/installer.nsh` loads, owned `extractAppPackage.nsh` includes
the original extraction definitions, undefines only `extractUsing7za`, and supplies
its protected replacement. Header/includes use documented NSIS mechanisms; this
extraction override itself is a RepoDitor maintenance responsibility, not a public
electron-builder extraction callback setting.

The replacement preserves upstream temporary extraction, `CopyFiles /SILENT`, copy
retries, existing retry delay, cancellation, and direct-extraction fallback. Only
callback invocation, extraction-attempt markers, and pipe lifetime are added. Old
version removal, `--updated`, exact destination selection, payload architecture,
registration, shortcuts, installed uninstaller, and cleanup remain upstream-owned.
Normal extraction and last-resort direct extraction both invoke `ExtractWithCallback`.
Reinstall/update normally extracts one payload after old-version removal. Fallback
extracts that same archive again, explicitly starting attempt 2 at its measured zero.
It is not an aggregate installation percentage and is not weighted across stages.

Build-time `check-extraction-override.mjs` fails closed on:

- app-builder-lib version drift from 26.15.3;
- normalized extraction-template SHA-256 drift from
  `e4174388a0f7a1df0b85a0742aa1ea7a4b2b18f9f29dccd6ef10a66212f68148`;
- bundled plug-in SHA-256 drift from
  `b393f05e8ff919ef071181050e1873c9a776e1a0ae8329aefff7007d0cadf592`;
- a local shadow of the Nsis7z plug-in;
- an actual archive unpacked-byte total outside 1 through 4,294,967,295.

Unsupported ZIP, web-download, directory-payload, x86, and ARM64 configurations are
rejected by the header. Upgrading electron-builder requires reviewing upstream
extraction/copy/fallback behavior, updating the guard intentionally, and rerunning
the native fixtures and production lifecycle matrix. Do not merely replace hashes.
The callback is embedded in the ordinary NSIS executable and follows the existing
installer signing flow. The archive is unchanged. Version/hash guards improve
repeatability; they do not claim byte-identical Windows binaries or validate signing
credentials unavailable to local unsigned development builds.

## Actual telemetry and display

The matching Nsis7z source formats decoder `SetTotal` and `SetCompleted` values as
UInt32 decimal strings. It pushes **total first, completed second**, then executes
the supplied NSIS function address. The callback pops completed first and total
second, preserving stack, working registers, and the NSIS error flag.

A bounded ASCII record is:

```text
1|<32-character run nonce>|<attempt 1 or 2>|<completedBytes>|<totalBytes>\n
```

`ExtractionMeasurements` accepts only nonnegative UInt32 integers, positive total,
completed <= total, one stable total, and non-decreasing completed within each
attempt. Attempt 2 must follow attempt 1 and start at a real zero. Invalid records,
wrong sessions, stale attempts, inconsistent totals, and overflow are rejected.
The 32-bit ceiling is required because the installed plug-in formats wider decoder
counters using Windows `%lu`. Build-time archive sizes protect that ceiling; those
sizes never generate runtime percentages.

The integer display is `floor(completedBytes * 100.0 / totalBytes)`. No interpolation,
clamping of malformed input, elapsed-time estimate, stage weight, file-count estimate,
destination-size polling, timer, or CSS-position measurement supplies samples.
Decoder measurements can be sparse. A solid archive may jump substantially; the UI
shows the actual samples. These bytes measure **payload extraction**, excluding
copying, registration, shortcuts, old-version removal, and postcondition verification.

## Local IPC and privilege threat model

The existing unelevated host owns a fresh, unpredictable GUID-named inbound pipe
for each operation: `RepoDitor.Extraction.<nonce>`. A protected DACL grants only the
host user's SID, elevated Administrators, and LocalSystem the client rights
FILE_WRITE_DATA, FILE_READ_ATTRIBUTES, and SYNCHRONIZE (0x00100082). Read-attributes
is required by Windows client opening and is covered by a real connection fixture.
There is no Everyone/anonymous access, read-data grant to clients, pipe-instance
creation grant, network listener, persistent service, or privileged helper.

`CreateNamedPipe` specifies inbound, overlapped, first-instance, one instance, and
remote-client rejection. The host binds the channel to the actual `Process.Start`
engine PID. `GetNamedPipeClientProcessId` authenticates the OS-reported sender before
reading records. The engine process handle remains open until telemetry is drained,
preventing its PID from being recycled during sender authentication. Other local processes, including another process of the same user,
can be rejected even if they learn the nonce. The NSIS client independently checks
`GetNamedPipeServerProcessId` against the host PID. It opens with anonymous security
quality of service so the unelevated server cannot impersonate the elevated client.
The progress channel carries data in one direction and exposes no commands.

A malicious process can still cause denial of service if it compromises the host
user or administrator context; this channel is not a sandbox for already-compromised
processes. It cannot authorize installation success or filesystem actions. Records
are printable ASCII, newline-delimited, and capped at 128 bytes. Invalid framing
faults the reader; incorrect numeric records are discarded. Successful engine exit
also requires complete extraction measurements to have drained from the pipe.
Missing/incomplete telemetry causes failure, not invented progress or optimistic
success. Success/failure/disposal closes the pipe and observes reader faults.

Current-user engine launch stays unelevated. All-users engine launch retains `runas`;
the WebView host remains unelevated. Administrator write access permits an elevated
engine, including over-the-shoulder administrator credentials. Windows permits
higher-integrity writes to the medium-integrity host's pipe; low-integrity writes
remain restricted by the normal mandatory-integrity policy. The production UAC/
secure-desktop boundary remains a separate manual acceptance case.

## Native and UI authority

Only `InstallerEngine` owns measurements and native lifecycle. It forwards a typed
progress event containing session, attempt, and validated integer percentage.
`InstallerWindow` forwards it only while installing the matching active operation.
The existing `WebViewBridge` remains the sole raw bridge owner. React receives no
byte totals, raw process API, filesystem API, or new command channel.

The typed parser rejects nonnumeric, NaN/infinite, negative, >100, wrong-session,
wrong-attempt, and unexpected-field progress messages. React accepts them only
after initialization, during install/update, and for the active session. It rejects
decreases within an attempt, stale runs, and progress before extraction or after
finalizing/success/failure. Retry creates a fresh native nonce and clears measurements,
percentage, and attempt. Fallback is explicitly labeled as another extraction attempt.

Install/update keeps the same stationary bar visible throughout Preparing, Running,
and Verifying. Before the first genuine extraction sample it displays 0%, meaning
payload extraction has not started; no numeric work is estimated for those stages.
Genuine measurements then supply the native HTML progress element and visible percentage. Its value and
ARIA bounds/current value match measured progress, its text states payload extraction,
and its determinate CSS has no loop or transition smoothing. Reduced motion and
approved centered/card-capped composition are preserved.

Measured 100% leaves the native state installing. Only actual engine exit advances
to finalizing/verifying; only exact registered InstallLocation plus `RepoDitor.exe`,
`Uninstall RepoDitor.exe`, `resources/app.asar`, and the Python backend executable
allow completion. A real 100% with missing registration fails the native fixture.
The upstream plug-in does not return its decoder result on the NSIS stack; complete
telemetry is therefore an additional check, never a substitute for those authoritative
checks. A callback error, engine nonzero exit, or failed postcondition cannot produce
success. Failure removes progress and retains Retry/Close; only a fresh operation
may proceed. Existing cancellation/window-close semantics remain unchanged.

Uninstall uses truthful stage text without a bar: NSIS removal hooks and script position do not supply
a trustworthy processed/total removal-byte measurement. Removal stages and existing
registration/filesystem checks remain authoritative.

## Regression checks and manual QA

For visible local production lifecycle automation, run `npm run test:installer:lifecycle`
from `desktop` in an unelevated Windows terminal. It finds PowerShell 7 on PATH,
in its standard installation locations, or in an existing local Codex runtime. It uses
the existing built installer, creates a fresh standard disposable account through
UAC, enables visible UI automation and unelevated/SID/profile checks automatically,
and removes that account/profile/credential only after authoritative postflight.
The current Windows login must permit UAC under the same identity for private DPAPI
credentials. Watch the windows without clicking them. Results are retained under
`desktop/build/installer-lifecycle-<nonce>/stage`. Failed postflight leaves the
isolated account for diagnosis instead of bypassing cleanup safety checks.

CI already stages the same worker into its own disposable account and passes
`ObserveSetupUi`, `RequireUnelevated`, and the expected SID/profile explicitly.
Its production lifecycle job remains independent of the local interactive launcher.

Run `npm run test:installer:extraction` for the installed compiler/plug-in, owned
macro, real normal/fallback callbacks, copied payload bytes, stack/register contract,
byte bounds/rounding, malformed framing, PID rejection, missing-registration failure
at measured 100%, fresh native Retry, template drift, and security source guards.
The fixture uses synthetic archives under ignored build output and no product
registration or game data. Solid-block callback sparsity is expected; the fixture
uses separate archive blocks to exercise real intermediate measurements.

Component tests protect install/update percentages, ARIA, no premature success,
terminal behavior, stale Retry/attempts, invalid percentages, unexpected fields,
and stage-only uninstall. Production layout checks cover 50 mode/stage/viewport
combinations including the measured label and non-looping bar. Existing host, desktop,
release, packaged, AppData, custom-path, and synthetic LocalLow checks remain required.
The Windows lifecycle CI also runs the extraction fixture before packaging.

Use the installer built at `desktop/release/RepoDitor-Setup-0.2.1-x64.exe` for manual QA
**only in a disposable Windows account or VM** with synthetic game data:

1. Select current user and install. Before a genuine sample there is stage text and a stationary 0% bar. During
   extraction, confirm a visible percentage, proportional filling bar, and
   “Installing application files…”. Jumps are truthful; do not expect every integer.
2. At measured 100%, confirm the screen still says installing or verifying, with
   no Launch button. “RepoDitor is ready” must follow native registration/payload
   verification; progress then disappears. Fast stages need not remain artificially visible.
3. Reopen the installer and Update at the same registered path. Confirm the same
   measured behavior and retention of synthetic RepoDitor AppData/game fingerprints.
4. Run the installed real WebView uninstaller. Confirm Preparing/Running/Verifying
   removal where observable, no removal percentage, and completion only after removal.
5. On a fresh clean target, create only a synthetic refusal sentinel, trigger the
   existing nonempty-path refusal, resolve that sentinel, and click Retry. Failure
   must remove progress and never show Ready; Retry starts a fresh operation.
6. Check minimum, normal, maximized, high DPI and reduced motion. The capped card
   stays centered horizontally/vertically; the percentage must not crush its bar.
7. In a disposable VM, exercise all-users UAC acceptance/cancellation and
   over-the-shoulder credentials. Confirm the host stays unelevated, the real engine
   is elevated, genuine percentages arrive, and cancellation never implies success.

No production-only test hooks or stage-duration sleeps are used. Local production
lifecycle results and full validation are recorded separately in ignored build QA
receipts. This integration is reasonable to maintain with the fail-closed guard and
mandatory upgrade review; the owned upstream extraction macro remains its explicit
maintenance risk.

Sources: [electron-builder NSIS customization](https://www.electron.build/v26/docs/nsis/),
[NSIS preprocessor include rules](https://nsis.sourceforge.io/Docs/Chapter5.html),
[Nsis7z API/source distribution](https://nsis.sourceforge.io/Nsis7z_plug-in),
[Windows pipe access rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights),
[Windows client PID authentication](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid),
[Windows process ID lifetime](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information).

Confirmed follow-up: all left/right looping bars are removed for both installation and
removal. Install/update initializes extraction at 0% and advances only on real native
measurements. Removal uses stage text without numeric progress or a looping bar.
