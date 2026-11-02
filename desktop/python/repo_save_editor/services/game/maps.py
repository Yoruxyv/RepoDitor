"""Read-only normal-map discovery from installed rosters or legacy catalogs."""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.discovery import (
    discover_game_installation,
    validate_game_installation,
)
from repo_save_editor.services.game.installed_build import artwork_installation, owned_file
from repo_save_editor.services.game.installed_maps import read_installed_levels

MAX_MAP_CATALOG_BYTES: Final = 4 * 1024 * 1024
MAX_MAP_FAMILIES: Final = 128

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
    loading_paths: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class MapCatalog:
    """Detected map catalog and the game file it came from."""

    path: Path
    maps: tuple[GameMap, ...]
    source_paths: tuple[Path, ...] = ()


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
        owned_file(catalog_path.parent, catalog_path)
        if catalog_path.stat().st_size > MAX_MAP_CATALOG_BYTES:
            raise MapDiscoveryError("Installed map catalog exceeds its size bound.")
        with catalog_path.open("rb") as handle:
            raw = handle.read(MAX_MAP_CATALOG_BYTES + 1)
        if len(raw) > MAX_MAP_CATALOG_BYTES:
            raise MapDiscoveryError("Installed map catalog exceeds its size bound.")
        catalog = json.loads(raw.decode("utf-8-sig"))
    except OSError as exc:
        raise MapDiscoveryError(f"Could not read Addressables catalog: {exc}") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
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
    if len(normal_families) > MAX_MAP_FAMILIES or any(
        len(family) > 64 or any(ord(char) < 32 for char in family) for family in normal_families
    ):
        raise MapDiscoveryError("Installed map families exceed their bounds.")
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


def find_installed_catalog(game_dir: Path | None = None) -> Path | None:
    """Locate R.E.P.O.'s local Addressables catalog.

    ``game_dir`` is useful for explicit user selection and tests. Without it,
    RepoDitor checks ``REPO_GAME_DIR`` and then installed Steam libraries.
    """
    if game_dir is not None:
        installation = validate_game_installation(game_dir)
    else:
        installation = discover_game_installation().installation
    return None if installation is None else installation.catalog_path


def discover_installed_maps(game_dir: Path | None = None) -> MapCatalog | None:
    """Locate the installed game and return its dynamically discovered normal maps."""
    try:
        installation = artwork_installation(game_dir)
        if installation is None:
            return None
        installed = read_installed_levels(installation)
        if installed is not None:
            levels, sources = installed
            maps = tuple(
                sorted(
                    (GameMap(r.family, r.name, True, r.loading_paths) for r in levels),
                    key=lambda m: (m.display_name.casefold(), m.internal_name),
                )
            )
            return MapCatalog(installation.root / "REPO_Data/level0", maps, sources)
        return load_map_catalog(installation.catalog_path)
    except (OSError, ValueError, KeyError) as error:
        if isinstance(error, MapDiscoveryError):
            raise
        raise MapDiscoveryError("Installed map metadata could not be read safely.") from error
