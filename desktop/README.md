# RepoDitor desktop

The renderer uses `@/` for `src` imports and `@electron/` for shared Electron contracts. Parent-directory renderer imports are not allowed; same-directory relatives remain valid.

## Development

```powershell
npm ci
npm run dev
```

Development launches the Python desktop API from the repository `.venv`.

## Quality gate

```powershell
npm run imports:check
npm run lint
npm run release:check
npm run build
npm run bundle:check
npm test
npm run test:e2e
npm run test:e2e:packaged
```

## Windows package

```powershell
npm run package
```

The package command builds the locked PyInstaller sidecar, builds Electron, packages an unpacked application, runs the E2E flow without Vite against that application, and emits a self-contained Windows archive under `release/`.

`npm run package` remains the unsigned local developer path. Official GitHub releases use the
fail-closed `package:dir:signed` and `package:installer:signed` commands with Microsoft Artifact
Signing values supplied through the protected `release-signing` environment. See the
[release checklist](../docs/release-checklist.md#windows-code-signing-preparation) for the exact
variables, secrets, role scope, and verification flow.

Packaging first removes only the disposable `release/` directory. If a packaged RepoDitor process still holds the output open, packaging stops with an instruction to close it; the build never kills processes. The unpacked application is then checked for the executable, ASAR, bundled Python sidecar, RepoDitor MIT license, and Teko OFL license.

Advanced Items exposes only the evidence-backed **Refill to Full** action. It remains a typed pending edit and uses the existing safe-write path; all other advanced mutation controls remain unavailable.

Cosmetics uses separate `cosmetics:get` and `cosmetics:write` IPC calls backed by
`MetaSave.es3`. Ownership changes join the existing pending bar, but retain an independent
fingerprint and exact-byte backup from the selected Run save.
