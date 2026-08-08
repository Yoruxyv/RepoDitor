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
