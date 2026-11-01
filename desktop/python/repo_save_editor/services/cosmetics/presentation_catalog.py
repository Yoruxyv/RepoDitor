"""Installed cosmetic display metadata, isolated from historical capability evidence."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.services.baked_artwork import discover_baked_artwork
from repo_save_editor.services.cosmetics.installed_catalog import (
    _parse_cached_catalog,
    discover_installed_cosmetic_catalog,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata


def discover_cosmetic_presentation_catalog(
    game_dir: Path | None = None, *, cache_dir: Path | None = None
) -> tuple[InstalledCosmeticMetadata, ...] | None:
    """Reuse the verified artwork index; historical builds retain their frozen reader."""
    artwork = discover_baked_artwork(game_dir, cache_dir=cache_dir)
    if artwork is not None:
        return _parse_cached_catalog(artwork["cosmeticCatalog"])
    return discover_installed_cosmetic_catalog(game_dir, cache_dir=cache_dir)
