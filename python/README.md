# RepoDitor Python Backend

This directory contains RepoDitor's Python save-domain implementation and the
desktop API sidecar bundled with the Electron application.

The directory itself is the Python source root. The importable package is
`repo_save_editor`.

## Responsibilities

Python is authoritative for behavior that must not be duplicated in the
renderer:

- `.es3` encryption and decryption
- save schema validation
- save discovery and summaries
- player and health semantics
- player upgrade discovery and mutation
- run-state semantics
- installed-map discovery
- stale-save detection
- backup creation
- staged verification and atomic save replacement
- the narrow JSON desktop API consumed by Electron

The React renderer never receives raw decrypted save data and does not perform
filesystem access, encryption, or save-domain calculations.

## Structure

```text
python/
├── README.md
└── repo_save_editor/
    ├── core/         # crypto, schema validation, and shared save types
    ├── desktop_api/  # JSON command boundary used by Electron
    ├── services/     # players, upgrades, run state, maps, saves, discovery
    └── storage/      # repository access, backups, verification, atomic writes
```

## Development

Run Python commands from the repository root:

```powershell
uv sync --locked --group package

uv run ruff check python tests
uv run ruff format --check python tests
uv run --with "pytest>=8.3,<9" pytest
```

The package remains imported normally:

```python
from repo_save_editor.services.players import get_players
```

Do not import through the directory name:

```python
# Wrong
from python.repo_save_editor.services.players import get_players
```

## Desktop runtime

During development, Electron launches the repository virtual environment and
uses `repo_save_editor.desktop_api`.

For packaged Windows builds, PyInstaller bundles this package into the
`repoditor-backend.exe` sidecar. The released application does not require the
user to install Python, `uv`, Node.js, or npm.
