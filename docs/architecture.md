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

- `desktop/src/` owns presentation and typed in-memory pending edits. It cannot read files, spawn processes, parse raw saves, or derive game mechanics.
- `desktop/electron/` owns narrow IPC validation, the secure preload surface, and Python process lifecycle.
- `desktop_api/` translates the stable command protocol into Python service calls. Standard output is reserved for one JSON response; diagnostics use standard error.
- `services/` owns editor behavior for discovery, players, upgrades, run data, maps, and save summaries.
- `core/` owns encryption, schema validation, and shared save types.
- `storage/` owns repository access, backups, temporary validation, stale-file protection, and atomic replacement.

Electron keeps `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing enabled. Input is validated at both the Electron and Python boundaries.

## Python runtime resolution

Runtime selection is centralized in `desktop/electron/python/client.cts`:

- development launches `.venv/Scripts/python.exe -m repo_save_editor.desktop_api`;
- packaged Windows builds launch `process.resourcesPath/backend/repoditor-backend.exe` directly.

The packaged application does not fall back to a system Python installation.

## Phase 9 parity decisions

Electron covers the supported production workflow: discovery/select/open, Overview, Players, Upgrades, Run, Maps, pending edits, revert, safe writes, backups, stale-file protection, and failure states.

The removed Tkinter interface also exposed arbitrary file browsing, Save As, explicit reload, and a separate Apply Changes step. These are intentionally retired: discovered opaque save IDs keep filesystem access narrow, backup-first overwrite is the supported write path, Change save/reopen replaces reload, and the pending-change bar replaces the extra apply step. Drag-and-drop and arbitrary file selection require a future typed boundary and are not hidden launch paths in the packaged application.
