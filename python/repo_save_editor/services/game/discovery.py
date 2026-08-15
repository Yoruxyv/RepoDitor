"""Steam library and installed R.E.P.O. game discovery."""

from __future__ import annotations

import os
import re
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Final

CATALOG_RELATIVE_PATH: Final = Path("REPO_Data/StreamingAssets/aa/catalog.json")
STEAM_APP_ID: Final = "3241660"
APP_MANIFEST_NAME: Final = f"appmanifest_{STEAM_APP_ID}.acf"
STEAM_LIBRARY_CONFIG_RELATIVE_PATH: Final = Path("steamapps/libraryfolders.vdf")
STEAM_COMMON_RELATIVE_PATH: Final = Path("steamapps/common")
MAX_STEAM_LIBRARY_CONFIG_BYTES: Final = 1024 * 1024
MAX_STEAM_APP_MANIFEST_BYTES: Final = 256 * 1024
MAX_STEAM_LIBRARY_ROOTS: Final = 128
MAX_STEAM_LIBRARY_PATH_CHARS: Final = 32_767
MAX_STEAM_INSTALL_DIR_CHARS: Final = 255
STEAM_LIBRARY_PATH_PATTERN: Final = re.compile(
    r'"path"\s+"(?P<path>[^"]+)"',
    re.IGNORECASE,
)
STEAM_MANIFEST_VALUE_PATTERN: Final = re.compile(
    r'"(?P<key>appid|installdir|buildid)"\s+"(?P<value>[^"\r\n]*)"',
    re.IGNORECASE,
)
WINDOWS_INSTALL_DIR_FORBIDDEN: Final = frozenset('<>:"/\\|?*')
WINDOWS_RESERVED_INSTALL_DIR_BASENAMES: Final = frozenset(
    {"con", "prn", "aux", "nul"}
    | {f"com{index}" for index in range(1, 10)}
    | {f"lpt{index}" for index in range(1, 10)}
)


class SteamLibraryConfigError(ValueError):
    """Raised when Steam library configuration cannot be interpreted."""


class SteamAppManifestError(ValueError):
    """Raised when the fixed R.E.P.O. Steam app manifest is malformed or unsafe."""


class GameDiscoveryStatus(StrEnum):
    """High-level outcomes for installed-game discovery."""

    FOUND = "found"
    STEAM_NOT_FOUND = "steam_not_found"
    GAME_NOT_FOUND = "game_not_found"
    DISCOVERY_ERROR = "discovery_error"


class GameDiscoveryIssueCode(StrEnum):
    """Non-fatal problems encountered while inspecting trusted Steam metadata."""

    LIBRARY_CONFIG_UNREADABLE = "library_config_unreadable"
    LIBRARY_CONFIG_MALFORMED = "library_config_malformed"
    APP_MANIFEST_UNREADABLE = "app_manifest_unreadable"
    APP_MANIFEST_MALFORMED = "app_manifest_malformed"


@dataclass(frozen=True, slots=True)
class GameDiscoveryIssue:
    """A sanitized Steam discovery problem suitable for boundary adaptation."""

    code: GameDiscoveryIssueCode
    path: Path


@dataclass(frozen=True, slots=True)
class SteamAppManifest:
    """Narrow identity fields read from R.E.P.O.'s fixed Steam app manifest."""

    app_id: str
    install_dir: str
    build_id: str | None


@dataclass(frozen=True, slots=True)
class GameInstallation:
    """A structurally validated candidate R.E.P.O. installation root.

    Steam provenance is optional metadata. An explicit root remains a discovered
    installation even when no authoritative Steam manifest is associated with it;
    build validation is a separate concern.
    """

    root: Path
    catalog_path: Path
    steam_library_root: Path | None = None
    manifest_path: Path | None = None
    steam_build_id: str | None = None


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
        """Return whether a structurally validated R.E.P.O. installation was found."""
        return self.installation is not None


def _path_key(path: Path) -> str:
    """Return a Windows-style comparison key without resolving arbitrary paths."""
    return os.path.normpath(os.fspath(path)).replace("\\", "/").casefold()


def _deduplicate_paths(paths: Iterable[Path]) -> tuple[Path, ...]:
    unique: list[Path] = []
    keys: set[str] = set()
    for path in paths:
        key = _path_key(path)
        if key in keys:
            continue
        keys.add(key)
        unique.append(path)
    return tuple(unique)


def _read_bounded_text(path: Path, maximum_bytes: int) -> str:
    """Read one trusted metadata file without allocating past its fixed bound."""
    if path.is_symlink():
        raise OSError("Steam metadata may not be a symbolic link.")
    with path.open("rb") as handle:
        payload = handle.read(maximum_bytes + 1)
    if len(payload) > maximum_bytes:
        raise ValueError("Steam metadata exceeds the supported size bound.")
    return payload.decode("utf-8-sig", errors="strict")


def _is_absolute_library_path(path: Path) -> bool:
    raw = os.fspath(path)
    return path.is_absolute() or PureWindowsPath(raw).is_absolute()


def parse_steam_library_paths(text: str) -> tuple[Path, ...]:
    """Parse configured Steam library roots from bounded VDF text."""
    paths: list[Path] = []
    for match in STEAM_LIBRARY_PATH_PATTERN.finditer(text):
        value = match.group("path").replace("\\\\", "\\")
        path = Path(value)
        if (
            not value
            or len(value) > MAX_STEAM_LIBRARY_PATH_CHARS
            or "\0" in value
            or not _is_absolute_library_path(path)
        ):
            continue
        paths.append(path)
        if len(paths) > MAX_STEAM_LIBRARY_ROOTS:
            raise SteamLibraryConfigError("Steam library configuration has too many path entries.")
    if text.strip() and not paths:
        raise SteamLibraryConfigError("Steam library configuration has no valid path entries.")
    return _deduplicate_paths(paths)


def _safe_install_dir(value: str) -> str:
    reserved_basename = value.partition(".")[0].casefold()
    if (
        not value
        or value != value.strip()
        or value.endswith(".")
        or len(value) > MAX_STEAM_INSTALL_DIR_CHARS
        or value in {".", ".."}
        or "\0" in value
        or any("\x01" <= character <= "\x1f" for character in value)
        or any(character in WINDOWS_INSTALL_DIR_FORBIDDEN for character in value)
        or reserved_basename in WINDOWS_RESERVED_INSTALL_DIR_BASENAMES
    ):
        raise SteamAppManifestError("Steam installdir is outside the supported shape.")
    windows_path = PureWindowsPath(value)
    posix_path = PurePosixPath(value)
    if (
        windows_path.is_absolute()
        or bool(windows_path.drive)
        or posix_path.is_absolute()
        or len(windows_path.parts) != 1
        or len(posix_path.parts) != 1
    ):
        raise SteamAppManifestError("Steam installdir is outside the supported shape.")
    return value


def parse_steam_app_manifest(text: str) -> SteamAppManifest:
    """Parse only the fixed identity fields required from R.E.P.O.'s app manifest."""
    values: dict[str, str] = {}
    for match in STEAM_MANIFEST_VALUE_PATTERN.finditer(text):
        key = match.group("key").casefold()
        if key in values:
            raise SteamAppManifestError(f"Steam app manifest repeats {key}.")
        values[key] = match.group("value")

    app_id = values.get("appid")
    install_dir = values.get("installdir")
    build_id = values.get("buildid")
    if app_id != STEAM_APP_ID or install_dir is None:
        raise SteamAppManifestError("Steam app manifest identity is incomplete.")
    safe_install_dir = _safe_install_dir(install_dir)
    if build_id is not None and (not build_id.isascii() or not build_id.isdigit()):
        raise SteamAppManifestError("Steam buildid is malformed.")
    return SteamAppManifest(app_id, safe_install_dir, build_id)


def read_steam_app_manifest(path: Path) -> SteamAppManifest:
    """Read and parse one fixed R.E.P.O. Steam app manifest within a hard byte bound."""
    try:
        text = _read_bounded_text(path, MAX_STEAM_APP_MANIFEST_BYTES)
    except (UnicodeError, ValueError) as error:
        raise SteamAppManifestError("Steam app manifest is malformed.") from error
    return parse_steam_app_manifest(text)


def find_windows_steam_roots(
    environment: Mapping[str, str] | None = None,
) -> tuple[Path, ...]:
    """Return existing Steam roots detected from bounded Windows state."""
    process_environment = os.environ if environment is None else environment
    if process_environment.get("REPODITOR_E2E") == "1":
        test_root = process_environment.get("REPODITOR_E2E_STEAM_ROOT")
        if test_root:
            candidate = Path(test_root)
            try:
                return (candidate,) if candidate.is_dir() else ()
            except OSError:
                return ()

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
        program_files = process_environment.get(variable)
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
            text = _read_bounded_text(config_path, MAX_STEAM_LIBRARY_CONFIG_BYTES)
        except OSError:
            issues.append(
                GameDiscoveryIssue(
                    GameDiscoveryIssueCode.LIBRARY_CONFIG_UNREADABLE,
                    config_path,
                )
            )
            continue
        except (UnicodeError, ValueError):
            issues.append(
                GameDiscoveryIssue(
                    GameDiscoveryIssueCode.LIBRARY_CONFIG_MALFORMED,
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


def derive_steam_game_root(library_root: Path, install_dir: str) -> Path | None:
    """Derive a contained ``steamapps/common/<installdir>`` candidate."""
    try:
        safe_install_dir = _safe_install_dir(install_dir)
        common_root = library_root / STEAM_COMMON_RELATIVE_PATH
        candidate = common_root / safe_install_dir
        if common_root.is_symlink() or candidate.is_symlink():
            return None
        resolved_common = common_root.resolve(strict=False)
        resolved_candidate = candidate.resolve(strict=False)
    except (OSError, SteamAppManifestError):
        return None
    if resolved_candidate.parent != resolved_common:
        return None
    return resolved_candidate


def validate_game_installation(
    game_root: Path,
    *,
    steam_library_root: Path | None = None,
    manifest_path: Path | None = None,
    steam_build_id: str | None = None,
) -> GameInstallation | None:
    """Return a structurally validated candidate installation root."""
    catalog_path = game_root / CATALOG_RELATIVE_PATH
    try:
        if game_root.is_symlink() or catalog_path.is_symlink():
            return None
        resolved_root = game_root.resolve(strict=True)
        resolved_catalog = catalog_path.resolve(strict=True)
        if not resolved_root.is_dir() or not resolved_catalog.is_file():
            return None
        if not resolved_catalog.is_relative_to(resolved_root):
            return None
    except OSError:
        return None
    return GameInstallation(
        root=resolved_root,
        catalog_path=resolved_catalog,
        steam_library_root=steam_library_root,
        manifest_path=manifest_path,
        steam_build_id=steam_build_id,
    )


def _discover_manifest_installation(
    library_root: Path,
    issues: list[GameDiscoveryIssue],
) -> GameInstallation | None:
    manifest_path = library_root / "steamapps" / APP_MANIFEST_NAME
    try:
        if not manifest_path.is_file():
            return None
        manifest = read_steam_app_manifest(manifest_path)
    except OSError:
        issues.append(
            GameDiscoveryIssue(
                GameDiscoveryIssueCode.APP_MANIFEST_UNREADABLE,
                manifest_path,
            )
        )
        return None
    except SteamAppManifestError:
        issues.append(
            GameDiscoveryIssue(
                GameDiscoveryIssueCode.APP_MANIFEST_MALFORMED,
                manifest_path,
            )
        )
        return None

    game_root = derive_steam_game_root(library_root, manifest.install_dir)
    if game_root is None:
        issues.append(
            GameDiscoveryIssue(
                GameDiscoveryIssueCode.APP_MANIFEST_MALFORMED,
                manifest_path,
            )
        )
        return None
    return validate_game_installation(
        game_root,
        steam_library_root=library_root,
        manifest_path=manifest_path,
        steam_build_id=manifest.build_id,
    )


def discover_game_installation(
    game_dir: Path | None = None,
    *,
    steam_roots: Iterable[Path] | None = None,
    environment: Mapping[str, str] | None = None,
) -> GameDiscoveryResult:
    """Find a candidate R.E.P.O. root without performing build compatibility validation."""
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
        find_windows_steam_roots(process_environment)
        if steam_roots is None
        else _deduplicate_paths(steam_roots)
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

    libraries, library_issues = enumerate_steam_library_roots(roots)
    issues = list(library_issues)
    for library_root in libraries:
        installation = _discover_manifest_installation(library_root, issues)
        if installation is not None:
            return GameDiscoveryResult(
                GameDiscoveryStatus.FOUND,
                installation,
                steam_roots=roots,
                library_roots=libraries,
                issues=tuple(issues),
            )

    status = GameDiscoveryStatus.DISCOVERY_ERROR if issues else GameDiscoveryStatus.GAME_NOT_FOUND
    return GameDiscoveryResult(
        status,
        None,
        steam_roots=roots,
        library_roots=libraries,
        issues=tuple(issues),
    )


__all__ = [
    "APP_MANIFEST_NAME",
    "CATALOG_RELATIVE_PATH",
    "MAX_STEAM_APP_MANIFEST_BYTES",
    "MAX_STEAM_LIBRARY_ROOTS",
    "STEAM_APP_ID",
    "GameDiscoveryIssue",
    "GameDiscoveryIssueCode",
    "GameDiscoveryResult",
    "GameDiscoveryStatus",
    "GameInstallation",
    "SteamAppManifest",
    "SteamAppManifestError",
    "SteamLibraryConfigError",
    "derive_steam_game_root",
    "discover_game_installation",
    "enumerate_steam_library_roots",
    "find_windows_steam_roots",
    "parse_steam_app_manifest",
    "parse_steam_library_paths",
    "read_steam_app_manifest",
    "validate_game_installation",
]
