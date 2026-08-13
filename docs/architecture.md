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

Optional item and cosmetic thumbnails use the user's game-generated LocalLow cache. Python derives
canonical cache keys from installed metadata; Electron replaces them with opaque in-memory tokens
and serves only validated PNGs through the read-only `repoditor-icon:` protocol. The renderer never
receives cache roots, filenames, or filesystem access. Missing or invalid images keep the existing
Phosphor fallback and cannot affect save discovery, identity, or mutation eligibility.

## Python runtime resolution

Runtime selection is centralized in `desktop/electron/python/client.cts`:

- development launches `.venv/Scripts/python.exe -m repo_save_editor.desktop_api`;
- packaged Windows builds launch `process.resourcesPath/backend/repoditor-backend.exe` directly.

The package command builds the sidecar with Python 3.13. The packaged application does not fall back to a system Python installation.

## Installed item recharge capability

Item recharge support keeps three independent facts separate:

1. **Item-type capability** comes from read-only installed-game metadata. A narrow standard-library
   serialized-file reader validates the currently supported Steam build, Unity version, file format,
   object bounds, pointers, and component identities. It dynamically verifies an installed
   `MonoBehaviour` whose `MonoScript` class is `Item`, maps that verified item identity to every
   same-name installed prefab `GameObject` variant, and inspects those variants for `ItemBattery`.
2. **Exact-instance charge state** still comes only from the save's `itemStatBattery` evidence. A
   stored entry remains stored charge; absence is interpreted as full/default only when installed
   metadata confirms that item type is rechargeable.
3. **Mutation eligibility** remains the existing exact-instance refill rule. Only a confirmed
   rechargeable item with a stored charge entry may stage or write `Refill to Full`.

No prefab path IDs, proof manifests, extracted game metadata, UnityPy, or TypeTreeGenerator are
bundled. The reader is deliberately fixed to the validated `23363152` / Unity `2022.3.67f2` layout.
Missing assets, a future Steam/Unity/serialized-file version, incomplete pointers, exceptional
`ItemBattery` metadata, or conflicting prefab variants all degrade the affected capability to
`unknown`; ordinary save reading remains available. The authoritative Python save-write boundary
rechecks capability before applying a refill edit.

The measured uncached discovery cost on the validated installation was about 0.8 seconds, so the
initial production path performs discovery on the relevant Python read/write command rather than
adding an Electron-main cache and its invalidation surface.

## Supported production scope

Electron covers the supported production workflow: discovery/select/open, Overview, Players,
Upgrades, Run, Items with exact-instance refill-to-full, Cosmetics bulk ownership and paired
preset clearing, Maps,
pending edits, revert, safe writes, backups, stale-file protection, and failure states. Run saves
and MetaSave retain independent fingerprints and backups while sharing the validated encrypted
repository mechanics.

Other item mutations, arbitrary file browsing, Save As, and drag-and-drop are intentionally unsupported: discovered opaque save IDs keep filesystem access narrow, and backup-first overwrite is the only write path. Arbitrary cosmetic equipment/preset editing and token editing are also unsupported. Change save/reopen handles reloads, and the persistent pending-change bar makes the write boundary explicit.
