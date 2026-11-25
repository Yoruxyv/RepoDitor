# Desktop Contracts

These rules cover the Windows Desktop application and its tooling. Keep detailed
design in [application architecture](../docs/architecture/architecture.md).

## Ownership and safety

- Preserve the dependency direction: React presentation → typed adapter →
  credential-free, scoped Tauri commands → fixed Python sidecar operations →
  Python services → core/storage → `.es3`. Keep bootstrap and command registration
  separate from domain behavior.
- Python owns save/game semantics, decryption, validation, backups, and
  transactions. Reuse the existing services. The renderer stages typed edits until
  explicit save, and must never receive raw decrypted saves or passphrases.
- Keep narrow Tauri permissions, the scoped main window, CSP, bounded process
  supervision, validated DTOs, and sanitized errors. The renderer may not read
  arbitrary files, launch executables, forward arbitrary arguments, or fetch
  arbitrary third-party URLs.
- Dynamic upgrades remain dynamic. Maps remain discovery/listing only: no BepInEx,
  C#, Harmony, runtime injection, or unreliable map forcing.
- Verify the target save fingerprint and edited fields. Preserve exact encrypted
  backups and receipt-based recovery.
- For authorized private acceptance using a maintainer's profile, require a
  verified full-profile backup before enabling edits and confirm the game is
  closed before writing. Keep private authorization separate from public write
  approval.

## Local presentation assets

Keep artwork discovery separate from save-edit authorization. Reuse compatible
transport/parsers and source-aware validation/invalidation. Current item/cosmetic
resolution uses installed BakedIcons and the cosmetic Sprite fallback, not the
game's LocalLow artwork cache. Upgrades retain their validated pipeline. Tauri
serves bounded validated images through opaque tokens; paths never cross into React.

Use Phosphor for application icons and unavailable content thumbnails. Local game
artwork must never be bundled, committed, uploaded, extracted into fixtures, or
redistributed. Missing/invalid images fail soft without blocking usable data.

## Validation

For renderer changes, run from `desktop/`:

```powershell
npm run imports:check
npm run format:check
npm run lint
npm run build
npm test
```

These checks must pass without new lint warnings. Follow the configured
TypeScript, ESLint, React/Hooks, accessibility, SonarJS, Tailwind, and import rules.
Run `npm run package:tauri` and `npm run test:e2e` for changes crossing
the native boundary or affecting a real Desktop journey. Run
`npm run test:tauri-safety` for changes to authorization, transactions or process supervision.
Run `npm run bundle:check` after production build when renderer size is affected
and during release/performance hardening. Budgets may stay warning-only until
measured release budgets exist, but the script must succeed.

Desktop CI runs clean `npm ci`, imports, formatting, lint, build and component
tests. Packaged journeys and the safety gate run on Windows. A required
unavailable check blocks a completion claim; report its exact blocker.

For packaging/release/installation work, also read
[installer instructions](installer/AGENTS.md), including when editing
`package.json`, builder configuration, or scripts outside `installer/`.
Packaged smoke tests are required before release. Detailed gates remain in the
[release checklist](../docs/release-checklist.md).
