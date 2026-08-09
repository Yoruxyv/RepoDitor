<p align="center">
  <img src="https://img.shields.io/badge/Electron-43.3.0-47848F?logo=electron&logoColor=white" alt="Electron 43.3.0">
  <img src="https://img.shields.io/badge/React-19.2.8-61DAFB?logo=react&logoColor=white" alt="React 19.2.8">
  <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white" alt="Python 3.11 or newer">
  <img src="https://img.shields.io/github/v/release/Yoruxyv/RepoDitor?label=release" alt="Latest release">
  <img src="https://img.shields.io/github/actions/workflow/status/Yoruxyv/RepoDitor/quality.yml?branch=main&label=quality" alt="Quality workflow">
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4?logo=windows11&logoColor=white" alt="Windows x64">
  <img src="https://img.shields.io/badge/license-MIT-22C55E" alt="MIT License">
</p>

<div align="center">

# RepoDitor

### Inspect and safely edit local R.E.P.O. saves from a focused Windows desktop app

RepoDitor is an unofficial Electron editor for encrypted R.E.P.O. `.es3` run
saves. It keeps save parsing, validation, backups, and writes inside a bundled
Python backend instead of exposing raw save data to the interface.

<sub>Overview · Players · Upgrades · Run · Maps · Read-only advanced discovery</sub>

[Download the latest release](https://github.com/Yoruxyv/RepoDitor/releases/latest)

</div>

---

> [!IMPORTANT]
> RepoDitor is an unofficial community tool and is not affiliated with semiwork.
> Back up important saves and close R.E.P.O. before editing. Game updates can
> change the save format or behavior.

## What RepoDitor provides

| Workspace | Purpose |
|---|---|
| **Overview** | Review the selected save, run summary, and pending changes |
| **Players** | Edit current health, heal to the Python-calculated maximum, and inspect optional Steam avatars |
| **Upgrades** | Edit dynamically discovered player upgrades without a hardcoded upgrade catalog |
| **Run** | Edit supported run values through validated typed fields |
| **Maps** | Discover locally installed maps without modifying game runtime behavior |
| **Advanced Items** | Inspect evidence-backed item and charge structures in read-only mode |

Core safety behavior:

- edits remain in memory until **Save Changes** is confirmed;
- the source fingerprint is checked before every write;
- a timestamped exact-byte backup is created beside the save;
- output is staged, reopened, and verified before atomic replacement;
- malformed and unsupported saves are rejected before mutation;
- automated tests use generated fixtures and temporary copies, never real saves.

## Preview

![RepoDitor workspace showing a safely opened local save](docs/screenshots/repoditor-workspace.png)

## Quick start

### Requirements

- Windows x64
- a local R.E.P.O. installation and save

### 1. Download

Open the [latest GitHub Release](https://github.com/Yoruxyv/RepoDitor/releases/latest)
and download `RepoDitor-Setup-<version>-x64.exe`.

### 2. Install

Run the assisted installer and choose a destination. RepoDitor appears in the
Start Menu and Windows Installed Apps. Python, Node.js, npm, and `uv` are not
required to use the installed application.

Current builds are unsigned, so Windows SmartScreen may show an unknown-publisher
warning. Each release includes a `.sha256` file for verifying the installer.

### 3. Open a save

RepoDitor discovers `REPO_SAVE_*.es3` files below:

```text
%USERPROFILE%\AppData\LocalLow\semiwork\Repo
```

Files containing `BACKUP` are excluded from automatic discovery. You can also
choose a save manually.

### Updates and uninstall

Updates are manual: download and run a newer installer when published. RepoDitor
does not install an updater or background service.

Uninstall through **Windows Settings → Apps → Installed apps → RepoDitor**.
Uninstalling removes RepoDitor files and shortcuts, but does not delete R.E.P.O.
saves or RepoDitor-created `.bak-*` backups.

## How it works

```text
React renderer
  ↓ typed feature calls
Sandboxed Electron preload
  ↓ narrow IPC contracts
Electron main process
  ↓ structured requests
Bundled Python desktop API
  ↓
Services → core/storage → encrypted .es3 file
```

The renderer cannot access the filesystem, spawn processes, decrypt saves, or
receive raw decrypted save JSON. Electron keeps `contextIsolation: true` and
`nodeIntegration: false`. See [Architecture](docs/architecture.md) for the full
boundary and ownership rules.

## Development

Development requires `uv`, Python 3.11 or newer, and Node.js 24.

```powershell
git clone https://github.com/Yoruxyv/RepoDitor.git
Set-Location RepoDitor
uv sync --locked

Set-Location desktop
npm ci
npm run dev
```

The Python desktop protocol can also be exercised directly from the repository
root:

```powershell
uv run python -m repo_save_editor.desktop_api environment
```

## Quality checks

Python:

```powershell
uv run ruff check python tests
uv run ruff format --check python tests
uv run --with "pytest>=8.3,<9" pytest
```

Desktop:

```powershell
Set-Location desktop
npm run imports:check
npm run lint
npm run release:check
npm run build
npm run bundle:check
npm test
npm run test:e2e
```

## Packaging

From `desktop/`, run:

```powershell
npm run package
```

This builds the locked Python sidecar, production Electron application, packaged
smoke test, assisted NSIS installer, and installer verification. Output is placed
under `desktop/release/`. The complete release gate is documented in the
[release checklist](docs/release-checklist.md).

## Project structure

```text
RepoDitor/
├── desktop/                 Electron, React renderer, packaging, and E2E
├── python/repo_save_editor/ Python desktop API, services, core, and storage
├── tests/                   Python tests and generated/sanitized fixtures
├── docs/                    Architecture, format, research, and release notes
├── .github/                 CI and community templates
└── pyproject.toml           Python project and tool configuration
```

## Important limitations

- RepoDitor targets the observed AES-encrypted ES3 payload used by R.E.P.O. run
  saves; game updates may introduce incompatible structures.
- Advanced Items is read-only in v0.1.0. Item charge, battery-upgrade,
  purchased-item, add/delete/duplicate, and generic numeric-dictionary writes
  remain disabled until controlled evidence proves safe mutation rules.
- Maps are discovery-only; RepoDitor does not inject code or force map selection.
- Steam avatar enrichment is optional, fail-soft, and never written into a save.
- RepoDitor currently targets Windows x64 and is not code-signed.

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/architecture.md) | Desktop boundaries and dependency direction |
| [Save format](docs/save-format.md) | Confirmed encrypted-save structure |
| [Reverse engineering](docs/reverse-engineering.md) | Evidence and unresolved advanced semantics |
| [Release checklist](docs/release-checklist.md) | Automated and manual v0.1.0 release gates |
| [Asset research](docs/asset-research.md) | Local asset-discovery findings and restrictions |

## Contributing and security

Focused bug reports, feature proposals, documentation improvements, and pull
requests are welcome. Use the repository templates and never attach real save
files, backups, personal Steam identifiers, or other private data to a public
issue.

Report suspected vulnerabilities privately through the repository's
[security advisories](https://github.com/Yoruxyv/RepoDitor/security/advisories/new).
See [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Maintainer

<table>
  <tr>
    <td align="center" width="180">
      <a href="https://github.com/Yoruxyv">
        <img src="https://github.com/Yoruxyv.png?size=96" width="96" alt="Hans avatar"><br>
        <b>Hans</b>
      </a>
    </td>
  </tr>
</table>

## License

RepoDitor is released under the [MIT License](LICENSE). R.E.P.O. and related
names are trademarks or property of their respective owners. RepoDitor is an
unofficial save-management utility and does not bundle game assets.
