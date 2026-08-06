# R.E.P.O. Save Editor

A small desktop GUI for inspecting and editing local **R.E.P.O.** `.es3` save files.

The editor can:

- scan the default Windows R.E.P.O. save directory;
- open an arbitrary `.es3` file;
- show save metadata and players;
- edit player upgrades such as health, stamina, jump, speed, strength, range, and crouch rest;
- edit common run values such as level, currency, lives, and total haul;
- create a timestamped backup before overwriting a save;
- save to a different file when you want to experiment safely.

> [!IMPORTANT]
> This is an unofficial community tool and is not affiliated with semiwork.
> Back up your saves. Game updates may change the save format.
> Use modified saves only where doing so is permitted by the game/server rules.

## Screenshot

A screenshot can be added here once the first public build is ready.

## Requirements

- Windows 10/11
- Python 3.11+
- `cryptography`

Tkinter is included with standard Windows Python installations.

## Install

```powershell
git clone https://github.com/YOUR_USERNAME/repo-save-editor.git
cd repo-save-editor

py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
```

Run:

```powershell
repo-save-editor
```

or:

```powershell
python -m repo_save_editor
```

For a quick local run without installation:

```powershell
python -m pip install -r requirements.txt
$env:PYTHONPATH = "$PWD\src"
python -m repo_save_editor
```

## Default save location

The application looks in:

```text
%USERPROFILE%\AppData\LocalLow\semiwork\Repo
```

It recursively searches that directory for files matching:

```text
REPO_SAVE_*.es3
```

Automatic backup files containing `BACKUP` are hidden from the main slot list by default.

## Supported player upgrades

| UI label | Save key |
|---|---|
| Health | `playerUpgradeHealth` |
| Stamina / Energy | `playerUpgradeStamina` |
| Extra Jump | `playerUpgradeExtraJump` |
| Tumble Launch | `playerUpgradeLaunch` |
| Tumble Climb | `playerUpgradeTumbleClimb` |
| Death Head Battery | `playerUpgradeDeathHeadBattery` |
| Map Player Count | `playerUpgradeMapPlayerCount` |
| Speed | `playerUpgradeSpeed` |
| Strength | `playerUpgradeStrength` |
| Range | `playerUpgradeRange` |
| Throw | `playerUpgradeThrow` |
| Crouch Rest | `playerUpgradeCrouchRest` |
| Tumble Wings | `playerUpgradeTumbleWings` |

## Safety behavior

When **Save / Overwrite** is used, the editor first creates a sibling backup similar to:

```text
REPO_SAVE_2025_11_04_20_53_58.es3.bak-20260806-183000
```

The application writes to a temporary file and then atomically replaces the target.

## Development

Install development dependencies:

```powershell
python -m pip install pytest
pytest
```

Project structure:

```text
repo-save-editor/
├── src/
│   └── repo_save_editor/
│       ├── crypto.py
│       ├── model.py
│       ├── gui.py
│       └── main.py
├── tests/
├── pyproject.toml
├── requirements.txt
└── README.md
```

## Compatibility

This project currently targets the save format observed in R.E.P.O. builds using an AES-encrypted ES3 payload containing JSON data.

If a future game update changes encryption or the internal schema, the editor will fail with a descriptive error rather than writing unknown data.

## Legal / trademark note

R.E.P.O. and related names are trademarks/property of their respective owners.
This project is an unofficial save-management utility and contains no game assets.
