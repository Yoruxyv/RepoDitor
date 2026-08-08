"""Steam library and installed R.E.P.O. game discovery."""

from __future__ import annotations

import os
import re
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final

CATALOG_RELATIVE_PATH: Final = Path("REPO_Data/StreamingAssets/aa/catalog.json")
STEAM_LIBRARY_CONFIG_RELATIVE_PATH: Final = Path("steamapps/libraryfolders.vdf")
REPO_INSTALL_RELATIVE_PATH: Final = Path("steamapps/common/REPO")
STEAM_LIBRARY_PATH_PATTERN: Final = re.compile(
    r'"path"\s+"(?P<path>[^"]+)"',
    re.IGNORECASE,
)


class SteamLibraryConfigError(ValueError):
    """Raised when Steam library configuration cannot be interpreted."""


class GameDiscoveryStatus(StrEnum):
    """High-level outcomes for installed-game discovery."""

    FOUND = "found"
    STEAM_NOT_FOUND = "steam_not_found"
    GAME_NOT_FOUND = "game_not_found"
    DISCOVERY_ERROR = "discovery_error"


class GameDiscoveryIssueCode(StrEnum):
    """Non-fatal problems encountered while enumerating Steam libraries."""

    LIBRARY_CONFIG_UNREADABLE = "library_config_unreadable"
    LIBRARY_CONFIG_MALFORMED = "library_config_malformed"


@dataclass(frozen=True, slots=True)
class GameDiscoveryIssue:
    """A sanitized Steam discovery problem suitable for boundary adaptation."""

    code: GameDiscoveryIssueCode
    path: Path


@dataclass(frozen=True, slots=True)
class GameInstallation:
    """A R.E.P.O. installation validated by its Addressables catalog."""

    root: Path
    catalog_path: Path
    steam_library_root: Path | None


@dataclass(frozen=True, slots=True)
class GameDiscoveryResult:
    """Installed-game discovery state and inspected Steam locations."""

    status: GameDiscoveryStatus
    installation: GameInstallation | None
    steam_roots: tuple[Path, ...] = ()
    library_roots: tuple[Path, ...] = ()
    issues: tuple[GameDiscoveryIssue, ...] = ()

    @property
    def game_detected(self) -> bool:
        """Return whether a validated R.E.P.O. installation was found."""
        return self.installation is not None


def _deduplicate_paths(paths: Iterable[Path]) -> tuple[Path, ...]:
    unique: list[Path] = []
    keys: set[str] = set()
    for path in paths:
        key = os.path.normcase(os.fspath(path))
        if key in keys:
            continue
        keys.add(key)
        unique.append(path)
    return tuple(unique)


def parse_steam_library_paths(text: str) -> tuple[Path, ...]:
    """Parse configured Steam library roots from VDF text."""
    paths = tuple(
        Path(match.group("path").replace("\\\\", "\\"))
        for match in STEAM_LIBRARY_PATH_PATTERN.finditer(text)
        if match.group("path")
    )
    if text.strip() and not paths:
        raise SteamLibraryConfigError("Steam library configuration has no path entries.")
    return _deduplicate_paths(paths)


def find_windows_steam_roots() -> tuple[Path, ...]:
    """Return existing Steam roots detected from Windows state."""
    if sys.platform != "win32":
        return ()

    try:
        import winreg
    except ImportError:
        return ()

    candidates: list[Path] = []
    lookups = (
        (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
    )
    for hive, key_name, value_name in lookups:
        try:
            with winreg.OpenKey(hive, key_name) as key:
                value, _kind = winreg.QueryValueEx(key, value_name)
        except OSError:
            continue
        if isinstance(value, str) and value:
            candidates.append(Path(value))

    for variable in ("ProgramFiles(x86)", "ProgramFiles"):
        program_files = os.environ.get(variable)
        if program_files:
            candidates.append(Path(program_files) / "Steam")

    existing: list[Path] = []
    for candidate in _deduplicate_paths(candidates):
        try:
            if candidate.is_dir():
                existing.append(candidate)
        except OSError:
            continue
    return tuple(existing)


def enumerate_steam_library_roots(
    steam_roots: Iterable[Path],
) -> tuple[tuple[Path, ...], tuple[GameDiscoveryIssue, ...]]:
    """Return Steam roots plus configured secondary library roots."""
    libraries: list[Path] = []
    issues: list[GameDiscoveryIssue] = []

    for steam_root in _deduplicate_paths(steam_roots):
        libraries.append(steam_root)
        config_path = steam_root / STEAM_LIBRARY_CONFIG_RELATIVE_PATH
        try:
            if not config_path.is_file():
                continue
            text = config_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            issues.append(
                GameDiscoveryIssue(
                    GameDiscoveryIssueCode.LIBRARY_CONFIG_UNREADABLE,
                    config_path,
                )
            )
            continue

        try:
            libraries.extend(parse_steam_library_paths(text))
        except SteamLibraryConfigError:
            issues.append(
                GameDiscoveryIssue(
                    GameDiscoveryIssueCode.LIBRARY_CONFIG_MALFORMED,
                    config_path,
                )
            )

    return _deduplicate_paths(libraries), tuple(issues)


def validate_game_installation(
    game_root: Path,
    *,
    steam_library_root: Path | None = None,
) -> GameInstallation | None:
    """Return a validated installation when its map catalog exists."""
    catalog_path = game_root / CATALOG_RELATIVE_PATH
    try:
        if not catalog_path.is_file():
            return None
    except OSError:
        return None
    return GameInstallation(game_root, catalog_path, steam_library_root)


def discover_game_installation(
    game_dir: Path | None = None,
    *,
    steam_roots: Iterable[Path] | None = None,
    environment: Mapping[str, str] | None = None,
) -> GameDiscoveryResult:
    """Find and validate R.E.P.O. across configured Steam libraries."""
    if game_dir is not None:
        installation = validate_game_installation(game_dir)
        return GameDiscoveryResult(
            status=(
                GameDiscoveryStatus.FOUND
                if installation is not None
                else GameDiscoveryStatus.GAME_NOT_FOUND
            ),
            installation=installation,
        )

    process_environment = os.environ if environment is None else environment
    override = process_environment.get("REPO_GAME_DIR")
    if override:
        installation = validate_game_installation(Path(override).expanduser())
        if installation is not None:
            return GameDiscoveryResult(GameDiscoveryStatus.FOUND, installation)

    detected_roots = (
        find_windows_steam_roots() if steam_roots is None else _deduplicate_paths(steam_roots)
    )
    existing_roots: list[Path] = []
    for root in detected_roots:
        try:
            if root.is_dir():
                existing_roots.append(root)
        except OSError:
            continue
    roots = tuple(existing_roots)
    if not roots:
        return GameDiscoveryResult(GameDiscoveryStatus.STEAM_NOT_FOUND, None)

    libraries, issues = enumerate_steam_library_roots(roots)
    for library_root in libraries:
        game_root = library_root / REPO_INSTALL_RELATIVE_PATH
        installation = validate_game_installation(
            game_root,
            steam_library_root=library_root,
        )
        if installation is not None:
            return GameDiscoveryResult(
                GameDiscoveryStatus.FOUND,
                installation,
                steam_roots=roots,
                library_roots=libraries,
                issues=issues,
            )

    status = GameDiscoveryStatus.DISCOVERY_ERROR if issues else GameDiscoveryStatus.GAME_NOT_FOUND
    return GameDiscoveryResult(
        status,
        None,
        steam_roots=roots,
        library_roots=libraries,
        issues=issues,
    )
