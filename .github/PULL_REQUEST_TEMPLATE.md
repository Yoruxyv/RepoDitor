## Description

<!-- Explain the problem and the implemented change directly. -->

## Changes

<!-- List the important implementation changes. -->

-
-

## Type of change

- [ ] `feat` — new functionality
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `style` — formatting with no behavior change
- [ ] `refactor` — internal restructuring
- [ ] `perf` — measured performance improvement
- [ ] `test` — test-only change
- [ ] `chore` — maintenance
- [ ] `ci` — CI workflow change
- [ ] `build` — dependency or packaging change

## Areas affected

- [ ] React renderer or accessibility
- [ ] Electron main, preload, or IPC contracts
- [ ] Python desktop API or services
- [ ] Save parsing or game semantics
- [ ] Safe writes, backups, or stale-file protection
- [ ] Steam or game discovery
- [ ] Tests or fixtures
- [ ] Packaging or release workflow
- [ ] Documentation

## Verification

<!-- Include the exact commands you ran and their results. -->

```text
# Example:
# uv run pytest
# cd desktop
# npm run lint
# npm test
```

## Screenshots or evidence

<!-- Required for visible UI changes. Remove this section when it does not apply. -->

## Save safety and compatibility

- [ ] No save-writing behavior changed
- [ ] Changed save semantics are implemented in Python and supported by evidence
- [ ] Existing stale-file, backup, staged-verification, and atomic-write protections remain intact
- [ ] Tests use generated/sanitized fixtures or temporary copies, never real user saves
- [ ] Electron retains `contextIsolation: true`, `nodeIntegration: false`, and narrow typed IPC
- [ ] No raw decrypted save JSON or arbitrary filesystem access is exposed to the renderer

## Checklist

- [ ] My branch contains one focused concern
- [ ] I reviewed and understand every changed line
- [ ] I added or updated relevant tests
- [ ] I updated relevant documentation
- [ ] I ran the affected Python checks
- [ ] I ran the affected desktop checks
- [ ] I ran Electron E2E when the change crosses the desktop boundary or user journey
- [ ] I verified wide, normal, and minimum desktop sizes for visible UI changes
- [ ] I did not commit credentials, real saves, backups, `local-evidence/`, or personal data
- [ ] Network-dependent tests use mocks or fixtures
- [ ] AI-assisted changes were manually reviewed and verified

## Related issue

<!-- Example: Closes #123 -->
