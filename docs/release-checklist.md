# Release checklist

RepoDitor releases are Windows x64 ZIP archives built from semantic tags that
match the version in both `pyproject.toml` and `desktop/package.json`.

## Required automated gates

- Python 3.11 and 3.14: locked sync, Ruff lint/format, and pytest.
- Desktop quality: clean npm install, import normalization, ESLint, release
  version alignment, production build, bundle budget, component tests, and
  Electron contract tests.
- Windows Electron E2E: isolated discovery, all editor tabs, pending edits,
  revert, safe write, backup, reopen, stale-file rejection, keyboard navigation,
  reduced motion, and 1600x900, 1200x800, and 960x640 layouts.
- Windows package smoke: Python 3.13 sidecar build, Electron package, and the
  same E2E journey against the unpacked production executable.
- Failed E2E jobs retain Playwright screenshots and traces for seven days.

The quality gate must pass every job. The tag-driven release workflow reruns
Python and desktop quality plus the packaged smoke test before publishing.

## Release procedure

1. Set matching versions in `pyproject.toml` and `desktop/package.json`.
2. Run `npm run release:check` from `desktop/`.
3. Confirm the product icon, name, and unsigned-build notice are current.
4. Run the complete local quality and package gates from the root README.
5. Push a tag matching the version, for example `v0.1.0`.
6. Download the workflow artifact and verify its SHA-256 checksum.
7. Extract to a clean Windows directory and launch without Python, Node.js,
   `uv`, or network access.
8. Open only a disposable/generated save and confirm backup-first writing.

## Phase 10 baseline — 2026-08-09

| Check | Result |
| --- | --- |
| Python 3.11 | 76 passed |
| Python 3.14 | 76 passed |
| Renderer and Electron contracts | 35 passed |
| Development Electron E2E | 1 passed |
| Packaged Electron E2E | 1 passed |
| Responsive visual review | 1600x900, 1200x800, and 960x640 passed |
| Bundle budget | 262.87 KiB raw / 76.01 KiB gzip; within budget |
| Windows archive | 145.04 MiB; sidecar, app ASAR, and Teko license present |

Measured on the Phase 10 Windows workstation:

| Operation | Time |
| --- | ---: |
| Development launch to discovery ready | 2.96 s |
| Packaged launch to discovery ready | 6.71 s |
| Packaged sidecar discovery median | 743 ms |
| Packaged sidecar save open median | 755 ms |
| Packaged backup + write + verification | 709 ms |

These measurements are an observational baseline, not hard pass/fail budgets.
The short-lived JSON sidecar remains adequate at this scale; revisit its process
model only if measured user-facing latency materially regresses.

## Manual security and safety review

- `contextIsolation` remains enabled; Node integration remains disabled; the
  renderer remains sandboxed.
- Preload exposes only the typed RepoDitor API and approved literal channels.
- Main-process navigation and new windows remain denied outside the renderer.
- Python is spawned directly without a shell or arbitrary renderer command.
- CSP permits only local assets plus the two Steam avatar image hosts.
- Save tests cover validation, stale-file detection, exact backup bytes,
  temporary encrypted output, verification, atomic replacement, and recovery.
- Automated E2E uses a generated encrypted save under a temporary fake profile;
  no real R.E.P.O. save is read or modified.
