# Architecture

RepoDitor's Electron application is the only production user interface. Python remains authoritative for save-format and game behavior.

```text
React renderer
      |
sandboxed preload with typed channels
      |
Electron main IPC validation
      |
Python desktop API JSON protocol
      |
services
      |
core + storage
      |
R.E.P.O. .es3 files
```

## Boundaries

- `desktop/src/` owns presentation, renderer-local theme/language preferences, and typed in-memory pending edits. It cannot read files, spawn processes, parse raw saves, or derive game mechanics.
- `desktop/electron/` owns narrow IPC validation, the secure preload surface, Python process lifecycle, and the fixed GitHub repository-metadata request. It exposes no arbitrary renderer fetch API and caches successful metadata for the Electron session.
- `python/repo_save_editor/desktop_api/` translates the stable command protocol into Python service calls. Standard output is reserved for one JSON response; diagnostics use standard error.
- `python/repo_save_editor/services/` owns editor behavior for discovery, players, upgrades, run
  data, maps, advanced discovery/refill semantics, MetaSave cosmetic ownership, and save summaries.
- `python/repo_save_editor/core/` owns encryption, schema validation, and shared save types.
- `python/repo_save_editor/storage/` owns repository access, backups, temporary validation, stale-file protection, and atomic replacement.

Electron keeps `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing enabled. Input is validated at both the Electron and Python boundaries. Python verifies the validated R.E.P.O. process is closed before supported writes; startup and focus checks keep the renderer state current, and an unknown process state fails closed.

## Python runtime resolution

Runtime selection is centralized in `desktop/electron/python/client.cts`:

- development launches `.venv/Scripts/python.exe -m repo_save_editor.desktop_api`;
- packaged Windows builds launch `process.resourcesPath/backend/repoditor-backend.exe` directly.

The package command builds the sidecar with Python 3.13. The packaged application does not fall back to a system Python installation.

## Supported production scope

Electron covers the supported production workflow: discovery/select/open, Overview, Players,
Upgrades, Run, Items with exact-instance refill-to-full, Cosmetics bulk ownership and paired
preset clearing, Maps,
pending edits, revert, safe writes, backups, stale-file protection, and failure states. Run saves
and MetaSave retain independent fingerprints and backups while sharing the validated encrypted
repository mechanics.

Other item mutations, arbitrary file browsing, Save As, and drag-and-drop are intentionally unsupported: discovered opaque save IDs keep filesystem access narrow, and backup-first overwrite is the only write path. Arbitrary cosmetic equipment/preset editing and token editing are also unsupported. Change save/reopen handles reloads, and the persistent pending-change bar makes the write boundary explicit.
