# RepoDitor desktop

RepoDitor Desktop uses React in the Tauri WebView2 host on Windows. Rust validates
requests, supervises the bundled sidecar, and returns typed projections. Python
owns save discovery, game semantics, validation, and transactions. Renderer DTOs
live in `renderer/app/tauri/desktopContracts.ts` and use the existing `@/` alias.

## Development

Use Node.js 24, Rust/MSVC, WebView2, and the locked Python environment.

```powershell
uv sync --locked
Set-Location desktop
npm ci
npm run build:sidecar
npm run dev
```

The host launches the frozen `build/backend/repoditor-backend/` payload. Use
`npm run build:sidecar` after Python changes.

## Validation and portable Windows package

```powershell
npm run imports:check
npm run format:check
npm run lint
npm run build
npm run bundle:check
npm test
npm run release:check
npm run package:tauri
npm run test:e2e
npm run test:tauri-safety
```

The read-only development package is staged under `build/tauri-portable/`.
Synthetic E2E uses isolated profiles and fixtures. Keep PowerShell 7 (`pwsh.exe`)
on `PATH` for Windows probes. `npm run test:e2e` runs the Rust tests first to
compile the fault-injection sidecar used by the packaged journeys. Run
`npm run test:tauri` first if invoking those Playwright specs directly.

Run `npm run package:installer` for the branded Windows setup and its SHA-256
file in `build/installer/`. Its verified portable payload is in
`build/tauri-release/`. The release enables Health, Upgrades, Run/Resume,
eligible Item Recharge, and supported Cosmetics operations when the
[reviewed game fingerprints](../docs/maintenance/game-update-capabilities.md#tauri-editing-across-steam-patches)
match. The hosted Windows workflow exercises both installers on disposable data.
See [Windows CI coverage](../docs/release-checklist.md#windows-ci-coverage) for
the scope and the remaining release-candidate checks.

The preparation screen waits for required projections and artwork before opening a
workspace. Valid warm navigation reuses prepared content. For cache locations and
developer controls, see [local presentation assets](../docs/architecture/architecture.md#desktop-local-presentation-assets).

## v0.2.1 upgrade

The published v0.2.1 installer is the migration reference. Its installer packaging
is available in the v0.2.1 source history. The Tauri portable package has a
separate WebView2 profile and source-validated caches. Theme and language may
need to be selected again. Save discovery continues to use the game's existing
LocalLow profile. See the [installer migration gate](../docs/release-checklist.md#w9-b-installer-migration-acceptance)
for installer identity, cleanup, and rollback checks.
