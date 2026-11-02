# Desktop Contracts

These rules cover the Windows Desktop application and its tooling. Keep detailed
design in [application architecture](../docs/architecture/architecture.md).

## Ownership and safety

- Preserve the dependency direction: React presentation → feature orchestration →
  typed preload API → Electron IPC/Python client → Python desktop adapter →
  services → core/storage → `.es3`. Keep these responsibilities separate;
  `App.tsx`, Electron main/preload, and Python's desktop entry point are composition
  boundaries, not places to accumulate feature logic.
- Python owns Desktop save/game semantics, decryption/encryption, validation,
  backups, and writes. Reuse existing saves, players, upgrades, run-state, maps,
  and discovery services. Do not reimplement these semantics in TypeScript.
- The renderer stages typed edits in memory until explicit save. It must never
  decrypt `.es3`, receive raw decrypted save JSON or the encryption password, perform save
  filesystem operations, parse Steam configuration, spawn Python, or invoke
  arbitrary IPC channels.
- Retain `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxing,
  narrow typed preload methods, and validation at Electron and Python boundaries.
  Never expose raw `ipcRenderer`, generic invocation, arbitrary filesystem/shell/
  Python execution, or unrestricted network-fetch APIs.
- Dynamic upgrades remain dynamic. Maps remain discovery/listing only: no BepInEx,
  C#, Harmony, runtime injection, or unreliable map forcing.

## Local presentation assets

Keep artwork discovery separate from save-edit authorization. Reuse compatible
transport/parsers and source-aware validation/invalidation. Current item/cosmetic
resolution uses installed BakedIcons and the cosmetic Sprite fallback, not the
game's LocalLow artwork cache. Upgrades retain their validated pipeline. Electron
serves bounded validated images through opaque tokens; paths never cross into React.

Use Phosphor for application icons and unavailable content thumbnails. Local game
artwork must never be bundled, committed, uploaded, extracted into fixtures, or
redistributed. Missing/invalid images fail soft without blocking usable data.

## Validation

For renderer/Electron/frontend changes, run from `desktop/`:

```powershell
npm run imports:check
npm run format:check
npm run lint
npm run build
npm test
```

These checks must pass without new lint warnings. Follow the configured
TypeScript, ESLint, React/Hooks, accessibility, SonarJS, Tailwind, and import rules.
Run `npm run test:e2e` for changes crossing Electron/preload/IPC/Python contracts
or changing a real Desktop journey; Python-only internals use their scoped gates.
Run `npm run bundle:check` after production build when renderer size is affected
and during release/performance hardening. Budgets may stay warning-only until
measured release budgets exist, but the script must succeed.

Desktop CI retains clean `npm ci`, imports, formatting, lint, build, and component/
contract tests; Electron E2E stays in the Windows integration job. A required
unavailable check blocks a completion claim; report its exact blocker.

For packaging/release/installation work, also read
[installer instructions](installer/AGENTS.md), including when editing
`package.json`, builder configuration, or scripts outside `installer/`.
Packaged smoke tests are required before release. Detailed gates remain in the
[release checklist](../docs/release-checklist.md).
