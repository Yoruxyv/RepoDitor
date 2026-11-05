# RepoDitor desktop

The renderer uses `@/` for `src` imports and `@electron/` for shared Electron contracts. Parent-directory renderer imports are not allowed; same-directory relatives remain valid.

## Development

Run these commands from the repository root:

```powershell
uv sync --locked
Set-Location desktop
npm ci
npm run dev
```

Development launches the Python desktop API from the repository-root `.venv`.

## Quality gate

Ordinary Desktop development changes should keep the fast application gates green:

```powershell
npm run imports:check
npm run format:check
npm run lint
npm run build
npm run bundle:check
npm test
npm run test:e2e
```

Run build and tests sequentially: build cleanup removes compiled Electron modules,
and overlapping validation can cause missing-module failures or process timeouts.

Packaging and installer changes additionally use the native/package gates:

```powershell
npm run release:check
npm run test:installer:host
npm run test:installer:extraction
npm run test:installer:layout
npm run package
npm run test:installer:lifecycle
```

`npm run package` already runs the packaged Electron smoke test. The lifecycle command uses the
repository's disposable-account isolation; do not run destructive lifecycle acceptance against a
normal user profile.

## Windows package

### Optional native discovery preview

Electron remains the default application and release package. A Windows-only
Tauri host supports discovery, save opening, read-only Overview/Players/Upgrades/Run/Items/Maps/Cosmetics and Python-backed
game-status checks using the existing React components and desktop contracts.
Editing/saving, other workspace features, artwork/Steam avatars and production installation
are not implemented in this host.
The existing C# WebView2 installer and React UI remain the required installer;
native payload integration has not been implemented or lifecycle-validated.

From `desktop/`, with Rust/MSVC and WebView2 installed:

```powershell
npm run build:sidecar
npm run dev:tauri
```

For a portable release-mode preview without developer tools at runtime:

```powershell
npm run package:tauri
npm run build
npm run package:dir
npm run test:e2e:tauri
```

`build/tauri-preview/` contains the native executable, complete frozen Python
directory and project/font licenses. The comparison gate also needs the local
Electron reference in `release/win-unpacked/`, built with the unchanged commands
above. The native package command writes only its preview output; production
NSIS configuration, signing and default Electron build remain unchanged. Rust process
tests use a compiled synthetic helper; packaged tests use only synthetic game/save
fixtures and isolated browser data. The Windows Tauri safety CI job runs the critical
Python, Rust, artifact and native regressions; the broader Electron/native comparison
journeys remain separate local checks.
The preview E2E command first runs the Rust contract/process tests.
It compares both hosts against the same synthetic save, verifies fresh reads
after external fixture changes, and exercises malformed responses, failed
operations, unknown/running game states and close during an active read.
Players shares Electron's list, selection, health display, responsive layout and
translated loading/error/empty states. Health is read-only, edit actions are absent,
and avatars use the existing fallback. Packaged checks compare both hosts, verify
unchanged save bytes and exercise player-read timeout, retry and descendant cleanup.
Upgrades reuses Python's dynamic membership and presentation metadata, including
valid stored values above gameplay caps. Its text fields are read-only and support
keyboard selection/copying; editing/revert/save actions are unavailable. Players
and Upgrades share selection. Icons use the existing fallback until native artwork
transport is implemented.
Run uses the unchanged Python `run-get` projection, including optional stats,
signed safe integers and an observed resume location outside the predefined
choices. The shared view retains Electron's editors; the preview shows focusable,
copyable read-only text fields without mutation controls. The injected hook
coalesces overlapping reads and ignores late results after workspace unmount.
Items uses Python's unchanged `advanced-get` projection. All six evidence domains,
capabilities, counts and exact item identities are retained without exposing private
recharge evidence. Search, filters, sorting, grouping and charge presentation reuse
Electron's view; native refill/revert/pending/save controls are absent. Optional icon
metadata is validated and discarded, so item and upgrade fallbacks need no native
artwork URL. Missing item containers remain distinct from supported empty ones.
Maps uses Python's unchanged `maps-list` discovery and the existing read-only cards,
responsive grid, skeletons, retry and retained-data refresh. Rust validates catalog
availability, up to 128 unique map identities, labels and optional artwork revisions.
Every native map icon token is null; decoding, streaming and caching artwork remain
unavailable. The injected hook retains Electron's default API and ignores superseded
or unmounted results. Packaged checks compare Maps with Electron at all three Desktop
sizes, preserve fixture save/catalog bytes and exercise Maps deadlines, cancellation,
domain queueing and independent status checks during a controlled slow read.
Cosmetics is an independent top-level workspace and does not require a Run save.
Its fixed `cosmetics-get` projection retains fingerprints, catalog/ownership counts,
unknown-owned IDs, capabilities and removal restrictions. Rust validates the public
contract against the existing frozen capability evidence; it neither parses MetaSave
nor discovers catalogs. A read-only composition reuses the existing summary and
search/filter/sort catalog without mounting artwork or pending-write workflows.
Mutation handlers are null, so bulk/individual ownership, presets, pending, revert
and save controls are omitted. Electron retains its default editable composition.
Native icons remain fallbacks. Packaged tests cover data/layout parity, metadata
absence, MetaSave failures, recovery, bounds, cancellation and independent status.
An opt-in `synthetic-health-recovery` Cargo feature provides internal health-write
and recovery commands for isolated fixtures. The normal host does not compile or
grant these commands and has no editing UI. The test host additionally requires
E2E mode and a canonical LocalLow root beneath `build/recovery-checkpoint`.
Python records operation-owned fingerprints and files before replacement; explicit
recovery classifies disk state without replaying edits. Unresolved operations block
further writes, including the legacy Python write path. See the
[recovery contract](../docs/architecture/architecture.md#experimental-health-recovery).
The native boundary requires Python's durable reservation acknowledgement before
launching a writer, including when the writer dies before executing Python code.
Reservation and writing share the existing 30-second request deadline.

The additional `synthetic-health-ui` feature enables health editing and durable
upgrade-batch Save only with that test permission configuration and runtime root
restriction. It reuses Players/Upgrades, numeric validation, pending review and the
Save/Revert bar. Upgrade drafts across players form one atomic operation. Mixed
health/upgrade pending sets block Save; save the groups separately. The bounded
upgrade intent fits 2 KiB inside the existing 4 KiB receipt; excessive batches are
rejected intact. Drafts survive section/player changes. Unsubmitted drafts are
discarded on workspace close, while reserved intent survives restart. Other
domains and ordinary artifacts stay read-only.
Python persists the operation ID and exact previous/requested values in the reservation,
so reload/restart discovers unresolved intent before another save is admitted.
Uncertain outcomes require explicit reconciliation. An applied result refreshes
the canonical session, players and upgrade values before acknowledgement; an unchanged result
retains the edit until an explicit new Save or Revert. Conflicting evidence blocks
writes. No production write authority is provided.

To validate this internal boundary, build the host with
`tauri build --features synthetic-health-recovery --config src-tauri/recovery.test.conf.json --no-bundle -- --locked`.
Build `e2e/support/recovery-sidecar.py` with the same PyInstaller options as
`build:sidecar`, plus `--hidden-import repo_save_editor.desktop_api.__main__`, using
`build/recovery-checkpoint/fault-backend` as its dist path.
Set `REPODITOR_RECOVERY_EXECUTABLE` and `REPODITOR_RECOVERY_DEFAULT_EXECUTABLE` to
separate feature-enabled and normal test-host executables, then run
`npm run test:e2e:recovery`. Keep this host and fault-injection sidecar separate from
the normal portable preview. The portable stager rejects hosts with synthetic
features, development-mode hosts, unmarked older hosts and unexpected frozen startup
entries. It verifies executable snapshots before replacing its output, rechecks the
published executables and records their hashes in
`artifact-check.json`. This detects accidental contamination; it is not package
signing or production write authorization.

For the required Windows safety gate, use Python 3.13, Rust 1.99.0/MSVC,
PowerShell 7 and WebView2, then run:

```powershell
uv sync --locked --project .. --group test --group package
npm run test:tauri-safety
```

The gate runs `build:sidecar` before the first Rust compilation: Tauri validates
`build/backend/repoditor-backend` even during `cargo test`. That freshly built
ordinary backend is also the default artifact fixture, so it is frozen only once.
The fault-injection backend is built separately for recovery tests. Development,
ordinary, protocol, no-test-permissions and synthetic UI hosts retain their distinct
authority. Python suites, Rust default/all-feature tests,
artifact rejection and native recovery/permission checks must pass without skips.
The quality workflow requires this job and retains its diagnostics. CI provisions
WebView2 if absent; no installed game or personal saves are required.
Before the synthetic matrix, an ordinary packaged-host control must expose the
Tauri bridge and reject write authority. Startup failures retain bounded, redacted
process output, the final CDP error, runtime/version and desktop-session diagnostics.
Startup and matrix outputs are separate so Playwright preserves both captures.
The opt-in packaged startup workflow tests one read-only host with the
`native-ui-test` feature and `startup.test.conf.json`. It passes the configuration's
`additionalBrowserArgs` directly to Tauri/Wry with a validated loopback test port,
preserving the default browser flags. Both WebView2 debugging environment variables
are empty during this control. The feature adds no save commands and marks its
artifact as test-only, so production staging rejects it. It cannot satisfy the
required Quality safety gate. The full gate uses this private configuration for
interactive hosts and builds a separate production host without test features for
artifact admission, including rejection of the read-only debugging test host. The normal
gate runs its ordinary startup control before the Python/Rust suites and synthetic
host builds, retaining every mandatory check after startup succeeds.

Outputs use fresh `build/tauri-safety` and `build/recovery-checkpoint/tauri-safety`
directories. For another local run, pass a new `-OutputDirectory` to
`scripts/test-tauri-safety.ps1`. Its optional `-NormalBackend` and `-FaultBackend`
arguments reuse already validated immutable test fixtures matching current Python source.
The configured ordinary resource backend is still rebuilt before Rust when these
overrides are supplied; stale `build/backend` contents never satisfy that prerequisite.
Native fixtures share those bundles through test-only directory junctions while
save/profile roots stay isolated. Do not mutate a shared bundle. Existing source
and backend hashes must be checked before reuse; CI always builds from source.

For packaged UI validation, build a separate host with
`tauri build --features synthetic-health-ui --config src-tauri/recovery.test.conf.json --no-bundle -- --locked`.
Keep normal, protocol-only and UI-without-test-permissions builds for the negative
permission checks. Set `REPODITOR_HEALTH_UI_EXECUTABLE`,
`REPODITOR_HEALTH_DEFAULT_EXECUTABLE`, `REPODITOR_HEALTH_PROTOCOL_EXECUTABLE` and
`REPODITOR_HEALTH_NO_PERMISSION_EXECUTABLE` to those executables, and
`REPODITOR_E2E_EXECUTABLE` to the UI executable. The UI spec expects a fault backend
under `build/recovery-checkpoint/health-ui/fault-backend/repoditor-backend`.
Run `npx playwright test e2e/tauri-health-ui.spec.ts` with a fresh `--output` directory
beneath `build/recovery-checkpoint/health-ui`. It exercises encrypted synthetic saves,
process interruption, timeout/restart, durable intent, canonical refresh, exact-byte
backups, permission isolation, keyboard access and three viewport sizes. Preserve
previous artifacts by choosing a new output directory for each validation run.

The packaged checks include five-read timings and controlled probes separating
backend time from pre-execution wait. Domain reads remain serialized; game status
has one independent admission-bounded lane, allowing at most two backend process
trees at once. Normal close cancels both. For an optional controlled before/after
comparison, set `REPODITOR_E2E_BASELINE_EXECUTABLE` to an earlier compatible preview
executable before running the native test gate. The current independence,
serialization, failure and cleanup regressions run without that historical binary.

The preview uses a separate application identifier and data directory. It does
not import the Electron profile or migrate user caches/preferences. External
window opening is denied, including the shared footer link. Its current authority
and lifecycle bounds are described in the [architecture guide](../docs/architecture/architecture.md#experimental-native-host).

### Electron package

```powershell
npm run package
```

The package command builds the locked PyInstaller sidecar, builds Electron, packages an unpacked application, runs the E2E flow without Vite against that application, and emits an assisted NSIS installer under `release/`.

`npm run package` remains the unsigned local developer path. Official GitHub releases use the
fail-closed `package:dir:signed` and `package:installer:signed` commands with Microsoft Artifact
Signing values supplied through the protected `release-signing` environment. See the
[release checklist](../docs/release-checklist.md#windows-code-signing-preparation) for the exact
variables, secrets, role scope, and verification flow.

Packaging first removes only the disposable `release/` directory. If a packaged RepoDitor process still holds the output open, packaging stops with an instruction to close it; the build never kills processes. The unpacked application is then checked for the executable, ASAR, bundled Python sidecar, RepoDitor MIT license, and Teko OFL license.

Items exposes only the evidence-backed **Refill to Full** action. It remains a typed pending edit and uses the existing safe-write path; all other item mutation controls remain unavailable.

Cosmetics is a global workspace backed by `MetaSave.es3`; it does not require a selected Run
save. It uses separate `cosmetics:get` and `cosmetics:write` IPC calls, its own pending/save
lifecycle, fingerprint, and exact-byte backup. Entering Cosmetics reads the current persisted
MetaSave when there are no pending edits; window focus rechecks game safety instead of pretending
to synchronize in-memory game state. Bulk ownership actions and
**Clear All Presets** are supported for the observed catalog while token editing, equipping,
and arbitrary preset editing remain unavailable.

RepoDitor must be used while R.E.P.O. is closed. Startup and window-focus checks query only a
narrow game-running status derived from the validated installation, and Python verifies that
status again immediately before both Run-save and MetaSave writes. If status cannot be verified,
the editor fails closed. Existing fingerprints, backups, staged verification, and atomic
replacement remain independent safety layers.

The renderer supports Dark, Light, and System themes plus English, Japanese, Korean, Chinese,
and Indonesian RepoDitor-owned UI text. Game-derived strings remain unchanged. The top utility
cluster obtains the repository star count through a single fixed, typed Electron metadata call;
the renderer has no generic network API.
