"""Installed R.E.P.O. map discovery from the game's Addressables catalog."""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

CATALOG_RELATIVE_PATH: Final = Path("REPO_Data/StreamingAssets/aa/catalog.json")
MAP_LOADING_GRAPHICS_PATTERN: Final = re.compile(
    r"Level[\\/](?P<family>[^\\/\x00]+)[\\/]Loading Graphics[\\/]",
    re.IGNORECASE,
)

# These are presentation aliases only. The installed game's catalog remains the
# source of truth for which maps exist.
KNOWN_MAP_LABELS: Final[dict[str, str]] = {
    "Arctic": "McJannek Station",
    "Manor": "Headman Manor",
    "Museum": "Museum of Human Art",
    "Wizard": "Swiftbroom Academy",
}

# These level families have loading graphics but are not normal extraction maps.
SPECIAL_LEVEL_FAMILIES: Final[frozenset[str]] = frozenset({"Arena", "Shop"})


class MapDiscoveryError(ValueError):
    """Raised when installed game map metadata cannot be parsed safely."""


@dataclass(frozen=True, slots=True)
class GameMap:
    """One map family discovered from the installed game's catalog."""

    internal_name: str
    display_name: str
    known_label: bool


@dataclass(frozen=True, slots=True)
class MapCatalog:
    """Detected map catalog and the game file it came from."""

    path: Path
    maps: tuple[GameMap, ...]


def get_map_display_name(internal_name: str) -> str:
    """Return a curated public name when known, otherwise preserve game metadata."""
    return KNOWN_MAP_LABELS.get(internal_name, internal_name)


def _decode_key_data(catalog: dict[str, object]) -> str:
    encoded = catalog.get("m_KeyDataString")
    if not isinstance(encoded, str) or not encoded:
        raise MapDiscoveryError("Addressables catalog has no m_KeyDataString.")

    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise MapDiscoveryError("Addressables catalog key data is invalid base64.") from exc

    return raw.decode("utf-8", errors="ignore")


def discover_map_families(catalog_path: Path) -> tuple[str, ...]:
    """Return normal map family names found in an Addressables catalog."""
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise MapDiscoveryError(f"Could not read Addressables catalog: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise MapDiscoveryError("Addressables catalog is not valid JSON.") from exc

    if not isinstance(catalog, dict):
        raise MapDiscoveryError("Addressables catalog root is not an object.")

    key_data = _decode_key_data(catalog)
    families = {
        match.group("family").strip()
        for match in MAP_LOADING_GRAPHICS_PATTERN.finditer(key_data)
        if match.group("family").strip()
    }
    normal_families = families - SPECIAL_LEVEL_FAMILIES
    return tuple(sorted(normal_families, key=str.casefold))


def load_map_catalog(catalog_path: Path) -> MapCatalog:
    """Load normal maps from one installed R.E.P.O. Addressables catalog."""
    families = discover_map_families(catalog_path)
    maps = tuple(
        sorted(
            (
                GameMap(
                    internal_name=family,
                    display_name=get_map_display_name(family),
                    known_label=family in KNOWN_MAP_LABELS,
                )
                for family in families
            ),
            key=lambda game_map: (game_map.display_name.casefold(), game_map.internal_name),
        )
    )
    return MapCatalog(path=catalog_path, maps=maps)


def _catalog_from_game_dir(game_dir: Path) -> Path | None:
    catalog = game_dir / CATALOG_RELATIVE_PATH
    return catalog if catalog.is_file() else None


def _parse_steam_library_paths(library_file: Path) -> tuple[Path, ...]:
    """Extract Steam library roots without requiring a VDF dependency."""
    try:
        text = library_file.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ()

    paths: list[Path] = []
    for match in re.finditer(r'"path"\s+"(?P<path>[^"]+)"', text, re.IGNORECASE):
        value = match.group("path").replace("\\\\", "\\")
        path = Path(value)
        if path not in paths:
            paths.append(path)
    return tuple(paths)


def _windows_steam_roots() -> tuple[Path, ...]:
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
            path = Path(value)
            if path not in candidates:
                candidates.append(path)

    for fallback in (Path("C:/Program Files (x86)/Steam"), Path("C:/Program Files/Steam")):
        if fallback not in candidates:
            candidates.append(fallback)

    return tuple(candidates)


def discover_steam_library_roots() -> tuple[Path, ...]:
    """Return Steam library roots, including secondary libraries such as E:\\SteamLibrary."""
    roots: list[Path] = []
    for steam_root in _windows_steam_roots():
        if steam_root not in roots:
            roots.append(steam_root)

        library_file = steam_root / "steamapps/libraryfolders.vdf"
        for library_root in _parse_steam_library_paths(library_file):
            if library_root not in roots:
                roots.append(library_root)

    return tuple(roots)


def find_installed_catalog(game_dir: Path | None = None) -> Path | None:
    """Locate R.E.P.O.'s local Addressables catalog.

    ``game_dir`` is useful for explicit user selection and tests. Without it,
    RepoDitor checks ``REPO_GAME_DIR`` and then installed Steam libraries.
    """
    if game_dir is not None:
        return _catalog_from_game_dir(game_dir)

    override = os.environ.get("REPO_GAME_DIR")
    if override:
        catalog = _catalog_from_game_dir(Path(override).expanduser())
        if catalog is not None:
            return catalog

    for library_root in discover_steam_library_roots():
        game_root = library_root / "steamapps/common/REPO"
        catalog = _catalog_from_game_dir(game_root)
        if catalog is not None:
            return catalog

    return None


def discover_installed_maps(game_dir: Path | None = None) -> MapCatalog | None:
    """Locate the installed game and return its dynamically discovered normal maps."""
    catalog_path = find_installed_catalog(game_dir)
    if catalog_path is None:
        return None
    return load_map_catalog(catalog_path)
