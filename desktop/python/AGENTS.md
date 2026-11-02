# Python Save and Asset Domain

Python owns Desktop save semantics through desktop adapter → services →
core/storage. Keep adapter protocol translation, domain behavior, encryption/schema,
and repository/write responsibilities separate. Reuse existing services and shared
neutral Unity parsing rather than duplicating known semantics or decoders.

## Saves, evidence, and installed assets

- Preserve the proven ES3 format and supported mutation boundaries. Do not infer
  write rules from field names, artwork availability, third-party editors, or a
  new game build. Use controlled evidence and the
  [capability workflow](../../docs/maintenance/game-update-capabilities.md).
- Before replacing a real save, verify the validated game is closed (unknown
  process state fails closed), reject stale fingerprints, validate typed changes,
  create an exact-byte backup, write temporary encrypted output, reopen/verify it,
  then replace atomically. On failure the original must remain recoverable.
- Installed-game parsing is read-only and bounded. Preserve validated source/build
  identity, file/object/pointer bounds, and independent mutation authorization.
  Unsupported or ambiguous metadata must not silently authorize writes. Preserve
  source integrity and failure isolation when reusing parsers or artwork pipelines.
- Keep optional presentation extraction separate from mutation capability and
  preserve the parent artwork/fallback restrictions. Real saves, installed assets,
  and R.E.P.O. LocalLow data are not destructive test fixtures.

## Packages

Meaningful production Python packages normally need a concise 1-4 sentence
`__init__.py` docstring describing their identity/boundary. Packaging-only
initializers may stay minimal; reconsider folders without a meaningful identity.
Keep business logic, filesystem work, hidden initialization, wildcard/whole-tree
imports out of initializers. Re-exports and `__all__` need a concrete stable API
reason. Test packages need no ceremonial documentation. Preserve zero import cycles
and synchronize package docstrings after ownership changes.

## Validation

Run from the repository root:

```powershell
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run --locked --group test pytest
```

Use pytest with synthetic fixtures and temporary copies. Cover rejection,
stale-source races, backup/staging/reopen failures, and recovery for affected writes;
test malformed/unsupported asset input and source invalidation when affected.
For adapter/contract or real Desktop journey changes, also run the parent Electron
E2E gate. Packaging changes require packaged smoke; a passing Python suite alone
does not validate the sidecar artifact.
