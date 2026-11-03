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
Tauri host supports discovery, save opening, read-only Overview/Players/Upgrades and Python-backed
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
fixtures and isolated browser data. Rust and preview E2E are Windows-only local
checks while this host is experimental; existing production CI gates are unchanged.
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
transport is implemented. The packaged checks include three-read timings and a
controlled sidecar probe separating backend time from pre-execution wait; the
serialized coordinator remains unchanged.

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
