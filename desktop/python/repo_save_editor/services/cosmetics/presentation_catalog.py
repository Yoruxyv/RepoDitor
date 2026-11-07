"""Installed cosmetic display metadata, isolated from historical capability evidence."""

from __future__ import annotations

import struct
from pathlib import Path

from repo_save_editor.services.baked_artwork import discover_baked_artwork
from repo_save_editor.services.cosmetics.installed_catalog import (
    MAX_OPEN_FILES,
    _parse_cached_catalog,
    discover_installed_cosmetic_catalog,
)
from repo_save_editor.services.cosmetics.installed_reader import read_installed_catalog
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.policy import PROVEN_MUTATION_BUILD_IDS
from repo_save_editor.services.game.installed_build import (
    VALIDATED_BUILD_ID,
    artwork_installation,
    installed_build_identity,
    owned_file,
)


def discover_cosmetic_presentation_catalog(
    game_dir: Path | None = None, *, cache_dir: Path | None = None
) -> tuple[InstalledCosmeticMetadata, ...] | None:
    """Display verified installed metadata without admitting another build for mutation."""
    artwork = discover_baked_artwork(game_dir, cache_dir=cache_dir)
    if artwork is not None:
        return _parse_cached_catalog(artwork["cosmeticCatalog"])
    try:
        installation = artwork_installation(game_dir)
        build = installed_build_identity(installation) if installation is not None else None
        if installation is None or build is None or build.build_id == VALIDATED_BUILD_ID:
            return discover_installed_cosmetic_catalog(game_dir, cache_dir=cache_dir)
        root = installation.root
        library = installation.steam_library_root
        if library is None:
            return None

        def snapshot() -> list[tuple[str, int, int, int, int]]:
            # External references resolve to top-level basenames; cover every possible source.
            paths = {root / "REPO_Data/level0", build.manifest_path}
            for count, path in enumerate((root / "REPO_Data").iterdir(), 1):
                if count > MAX_OPEN_FILES:
                    raise ValueError("Too many cosmetic presentation sources.")
                if path.is_file():
                    paths.add(path)
            result = []
            for path in sorted(paths):
                info = owned_file(library, path).stat()
                result.append((str(path), info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns))
            return result

        before = snapshot()
        catalog, _targets = read_installed_catalog(root)
        if snapshot() != before or installed_build_identity(installation) != build:
            return None
        # Deliberately uncached: neither old cache entries nor readable headers establish trust.
        return catalog
    except (OSError, ValueError, OverflowError, struct.error):
        return None


def discover_cosmetic_mutation_catalog(
    game_dir: Path | None = None, *, cache_dir: Path | None = None
) -> tuple[InstalledCosmeticMetadata, ...] | None:
    """Keep legacy writes within the two evidence-backed builds, independently of display."""
    installation = artwork_installation(game_dir)
    build = installed_build_identity(installation) if installation is not None else None
    if build is None or build.build_id not in PROVEN_MUTATION_BUILD_IDS:
        raise ValueError("Installed game build is not approved for cosmetic mutations.")
    if build.build_id == VALIDATED_BUILD_ID:
        return discover_installed_cosmetic_catalog(game_dir, cache_dir=cache_dir)
    artwork = discover_baked_artwork(game_dir, cache_dir=cache_dir)
    return _parse_cached_catalog(artwork["cosmeticCatalog"]) if artwork is not None else None
