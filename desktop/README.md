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
