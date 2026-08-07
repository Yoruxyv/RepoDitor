# RepoDitor

RepoDitor is an unofficial desktop editor for local **R.E.P.O.** `.es3` run saves.

The current Tkinter interface is intentionally kept separate from save-format and persistence logic so a later Electron frontend can reuse the same Python backend behavior instead of reimplementing it.

## Current features

- scan the default Windows R.E.P.O. save directory;
- open arbitrary run-save `.es3` files;
- show save metadata and players;
- edit current player health;
- edit known player upgrades;
- edit run level, currency, lives, total haul, and raw save level;
- preserve the game's one-based displayed level while storing its zero-based save value;
- create timestamped backups before overwriting;
- write edited saves atomically;
- save edited data to a different `.es3` file for safe experimentation.

> [!IMPORTANT]
> RepoDitor is an unofficial community tool and is not affiliated with semiwork. Back up important saves before editing them. Game updates can change save behavior or schema.

## Development setup

The project uses `uv` for dependency and environment management.

```powershell
cd E:\GitHub\RepoDitor
uv sync --dev
uv run repo-save-editor
```

You can also launch the package directly:

```powershell
uv run python -m repo_save_editor
```

## Quality checks

Run the same local quality gate before committing:

```powershell
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest
```

To apply Ruff's safe formatting/fixes during development:

```powershell
uv run ruff check src tests --fix
uv run ruff format src tests
```

## Default save location

RepoDitor scans recursively under:

```text
%USERPROFILE%\AppData\LocalLow\semiwork\Repo
```

for files matching:

```text
REPO_SAVE_*.es3
```

Files containing `BACKUP` in their filename are excluded from the normal slot list.

## Project architecture

```text
RepoDitor/
├── docs/
│   ├── architecture.md
│   ├── reverse-engineering.md
│   └── save-format.md
├── src/
│   └── repo_save_editor/
│       ├── core/
│       │   ├── crypto.py
│       │   ├── schema.py
│       │   └── types.py
│       ├── services/
│       │   ├── players.py
│       │   ├── run_state.py
│       │   ├── saves.py
│       │   └── upgrades.py
│       ├── storage/
│       │   └── repository.py
│       ├── ui/
│       │   └── tkinter/
│       │       ├── tabs/
│       │       │   ├── player.py
│       │       │   └── run.py
│       │       └── window.py
│       ├── __init__.py
│       ├── __main__.py
│       └── main.py
├── tests/
│   ├── core/
│   ├── services/
│   └── storage/
├── pyproject.toml
└── uv.lock
```

The dependency direction is intentionally simple:

```text
UI / future IPC
      ↓
services
      ↓
core + storage
      ↓
.es3 files
```

See [`docs/architecture.md`](docs/architecture.md) for the boundary rules.

## Verified save behavior

The current implementation is based on controlled save tests. In the tested game version:

- `runStats["level"]` is zero-based internally while the game displays it one-based;
- `runStats["save level"] = 1` resumes in the Shop/Service Station;
- current player HP is stored separately from the Health upgrade progression.

Dynamic upgrade discovery and map-selection research are intentionally left for the next feature phase rather than hardcoding unverified values during this architecture refactor.

## Safety behavior

When **Save / Overwrite** is used, RepoDitor first creates a sibling backup similar to:

```text
REPO_SAVE_2025_11_04_20_53_58.es3.bak-20260807-120000
```

The edited save is written to a temporary file and then atomically replaces the target.

## Compatibility

RepoDitor currently targets the observed AES-encrypted ES3 payload used by R.E.P.O. run saves. Unsupported or malformed saves are rejected before mutation.

## Legal / trademark note

R.E.P.O. and related names are trademarks/property of their respective owners. RepoDitor is an unofficial save-management utility and contains no game assets.
