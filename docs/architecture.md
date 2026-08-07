# Architecture

RepoDitor keeps save-format logic independent from desktop UI code so the same Python core can support the current Tkinter development interface and a later Electron frontend.

```text
UI / IPC adapters
      ↓
services
      ↓
core + storage
      ↓
R.E.P.O. .es3 files
```

## Layers

- `core/` owns encryption, schema validation, and shared types. It does not import UI code.
- `services/` owns editor behavior such as players, upgrades, run stats, and save metadata.
- `storage/` owns save discovery, backup creation, and atomic writes.
- `ui/tkinter/` is the current development interface. It delegates persistence and game-specific rules to the layers above.

A future Electron application should call an IPC/API adapter backed by these same services rather than duplicating encryption or save mutation logic in JavaScript.
