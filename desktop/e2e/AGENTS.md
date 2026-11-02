# Desktop Integration and Packaged E2E

These tests exercise the real renderer → Electron → Python → save boundary;
component or mocked-bridge tests do not replace them.

- Reuse the existing harness and synthetic fixture generators. Isolate profiles,
  save/game roots, caches, and network behavior; never discover or write real user
  saves, installed game files, or R.E.P.O. LocalLow data. Use mocks for external services.
- Assert actual journey behavior and safety: discovery/open, edits/revert, explicit
  save, exact backups, reopen, stale-source rejection, game-process blocking, and
  failure recovery where affected. Verify ownership and cleanup of app/sidecar/
  synthetic processes even after launch failure, cancellation, or timeout.
- Keep keyboard/focus/accessibility and reduced-motion coverage. Visible UI changes
  must work at wide/normal/minimum Desktop sizes; current automated sizes are
  1600×900, 1200×800, and 960×640 CSS pixels. Browser zoom is not Windows DPI evidence.
- Preserve screenshots, traces, and process diagnostics for failures and hangs;
  wait on observable state, not artificial delays or retries that conceal defects.
- Source E2E and packaged smoke prove different contracts. Run `npm run test:e2e`
  from `desktop/` for source journeys and `npm run test:e2e:packaged` against the
  prepared production executable for package changes. Do not reuse historical runs
  as validation of a new build.

Packaged smoke is required before release and does not prove installer lifecycle
or human DPI acceptance. Use [installer instructions](../installer/AGENTS.md) for
install/update/uninstall/retry checks and the
[release checklist](../../docs/release-checklist.md) for artifact preparation/manual gates.
