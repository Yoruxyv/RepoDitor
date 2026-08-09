# v0.1.0 release checklist

RepoDitor's first public release is v0.1.0. Releases are Windows x64 ZIP archives built from semantic tags that
match the version in both `pyproject.toml` and `desktop/package.json`.

## Required automated gates

- Python 3.11 and 3.14: locked sync, Ruff lint/format, and pytest.
- Desktop quality: clean npm install, import normalization, ESLint, release
  version alignment, production build, bundle budget, component tests, and
  Electron contract tests.
- Windows Electron E2E: isolated discovery, all editor tabs including read-only Advanced Items, pending edits,
  revert, safe write, backup, reopen, stale-file rejection, keyboard navigation,
  reduced motion, and 1600x900, 1200x800, and 960x640 layouts.
- Windows package smoke: Python 3.13 sidecar build, Electron package, required
  file/license verification, and the same E2E journey against the unpacked production executable.
- Failed E2E jobs retain Playwright screenshots and traces for seven days.

The quality gate must pass every job. The tag-driven release workflow reruns
Python and desktop quality plus the packaged smoke test before publishing.

## Release procedure

1. Set matching versions in `pyproject.toml` and `desktop/package.json`.
2. Run `npm run release:check` from `desktop/`.
3. Confirm the original RepoDitor icon, product name, v0.1.0 About information,
   unsigned-build notice, and production-only menu removal are current.
4. Run the complete local quality and package gates from the root README.
5. Push a tag matching the version, for example `v0.1.0`.
6. Download the workflow artifact and verify its SHA-256 checksum.
7. Extract to a clean Windows directory and launch without Python, Node.js,
   `uv`, or network access.
8. Open only a disposable/generated save and confirm Advanced Items remains
   read-only and normal edits use backup-first writing.

## v0.1.0 release-candidate baseline — 2026-08-09

| Check | Result |
| --- | --- |
| Python 3.11 | 92 passed |
| Python 3.14 | 92 passed |
| Renderer and Electron contracts | 41 passed |
| Development Electron E2E | 1 passed |
| Unpacked and clean-extracted Electron E2E | 1 passed each |
| Responsive visual review | 1600x900, 1200x800, and 960x640 passed |
| Renderer coverage | 72.97% statements / 74.18% lines; measured, no arbitrary threshold |
| Bundle budget | 269.89 KiB raw / 77.25 KiB gzip; within budget |
| Dependency audit | 0 vulnerabilities; four deprecated transitive packaging dependencies noted |
| Windows archive | 145.11 MiB; sidecar, app ASAR, RepoDitor MIT, and Teko OFL licenses present |
| Archive extraction | 5 required files present; no source/test/dev entries in ASAR |
| Code signing | Not signed; Windows SmartScreen notice documented |

Measured on the v0.1.0 release-candidate Windows workstation:

| Operation | Time |
| --- | ---: |
| Development launch to discovery ready | 2.93 s |
| Development save open | 385 ms |
| Development backup + write + verification | 379 ms |
| Unpacked packaged launch to discovery ready | 8.53 s |
| Clean-extracted packaged launch to discovery ready | 3.55 s |
| Clean-extracted packaged save open | 1.37 s |
| Clean-extracted backup + write + verification | 1.42 s |

These measurements are an observational baseline, not hard pass/fail budgets.
The short-lived JSON sidecar remains adequate at this scale; revisit its process
model only if measured user-facing latency materially regresses.

The bundle check remains warning-only for v0.1.0 because the measured output is
well below its existing headroom and one workstation measurement is not enough
to set a durable blocking threshold. Coverage is reported without a percentage
gate; correctness-critical save and desktop-boundary paths retain focused tests.

## Manual security and safety review

- `contextIsolation` remains enabled; Node integration remains disabled; the
  renderer remains sandboxed.
- Preload exposes only the typed RepoDitor API and approved literal channels.
- Main-process navigation and new windows remain denied outside the renderer.
- Python is spawned directly without a shell or arbitrary renderer command.
- CSP permits only local assets plus the two Steam avatar image hosts.
- The only external link is the exact RepoDitor project URL, opened by Electron;
  the renderer has no generic URL-opening API.
- Save tests cover validation, stale-file detection, exact backup bytes,
  temporary encrypted output, verification, atomic replacement, and recovery.
- Automated E2E uses a generated encrypted save under a temporary fake profile;
  no real R.E.P.O. save is read or modified.
