# RepoDitor documentation

Technical documentation is grouped by responsibility. The project overview,
installation instructions, and user-facing feature summary remain in the
[repository README](../README.md).

## Architecture

- [Application architecture](architecture/architecture.md) — process boundaries,
  ownership, and data flow.
- [Electron UI](architecture/electron-ui.md) — renderer structure,
  responsiveness, appearance, and accessibility.
- [RepoDitor Web](../web/README.md) — browser boundary, hosted deployment,
  privacy/storage behavior, and Web validation.

## Save and game research

- [Save format](research/save-format.md) — confirmed encrypted-save structure.
- [Reverse engineering](research/reverse-engineering.md) — controlled evidence,
  supported behavior, and unresolved semantics.
- [Asset research](research/asset-research.md) — installed-game metadata, local
  presentation assets, and redistribution boundaries.

## Release operations

- [Release checklist](release-checklist.md) — version, package, signing, and
  publication gates.
- [Installer progress](installer-progress.md) — genuine extraction telemetry,
  authenticated transport, Retry isolation, and truthful removal stages.
- [Game-update capabilities](maintenance/game-update-capabilities.md) — evidence-backed installed-game capability and compatibility workflow.

## Media

- [`screenshots/`](screenshots/) — current application and manual compatibility
  screenshots referenced by the repository README.
