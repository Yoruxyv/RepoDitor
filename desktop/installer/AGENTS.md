# Installer and Packaging Safety

Apply these rules to installer sources and associated builder/signing/lifecycle
scripts or configuration elsewhere under `desktop/`.

- Preserve game saves and backups. Restrict cleanup to verified RepoDitor-owned
  paths; preserve upgrade/removal distinctions and privilege boundaries. Never
  broaden cleanup because a directory name resembles an application-owned root.
- Keep narrow authenticated, session/attempt-scoped telemetry and reject stale,
  malformed, or unauthorized messages. Progress must reflect actual work; never
  invent percentages or prolong a stage for presentation.
- Success needs authoritative filesystem/registration/artifact verification,
  not an exit code or progress value alone. Check cancellation, partial install,
  retry isolation, subprocess ownership, and cleanup on every affected failure path.
- Preserve source fingerprints/version guards, package contents/licenses, signing
  verification, and failure diagnostics. Do not bypass a guard or mutate frozen
  evidence to accept an incompatible upstream tool or artifact.

From `desktop/`, run the affected existing gates: `npm run release:check`,
`npm run test:installer:host`, `npm run test:installer:extraction`,
`npm run test:installer:layout`, package/installer verification, and
`npm run test:installer:lifecycle` as applicable. Release candidates also require
packaged E2E and manual acceptance; unpacked smoke alone is insufficient.

Detailed integration contracts live in
[installer progress](../../docs/installer-progress.md); build preparation, signing,
install/upgrade/uninstall/reinstall, save-preservation, and manual acceptance gates
live in the [release checklist](../../docs/release-checklist.md). Use those current
procedures rather than duplicating them here.
