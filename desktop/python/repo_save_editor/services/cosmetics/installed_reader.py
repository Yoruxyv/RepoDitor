"""Read-only cosmetic catalog traversal for reviewed installed Unity layouts.

This reader shares bounded header/pointer parsing with artwork; only independent
capability evidence can authorize the returned indices for save mutation.
The historical reader and its evidence remain unchanged.
"""

from __future__ import annotations

import os
from pathlib import Path

from repo_save_editor.services.cosmetics.installed_catalog import (
    MAX_OPEN_FILES,
    InstalledCosmeticCatalogError,
    _find_cosmetic_vector,
    _find_unique_meta_manager,
    _parse_cosmetic_metadata,
    _Resolver,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.unity_artwork import ArtworkFileIndex
from repo_save_editor.services.unity_serialized import SerializedFileIndex


class CosmeticCatalogResolver(_Resolver):
    """Reuse bounded catalog traversal with reviewed serialized-file headers."""

    def open(self, path: Path) -> SerializedFileIndex:
        resolved = path.resolve()
        if not resolved.is_relative_to(self.data_dir):
            raise InstalledCosmeticCatalogError(
                "A serialized source is outside the installed data directory."
            )
        key = os.path.normcase(os.fspath(resolved))
        if key not in self._indexes:
            if len(self._indexes) >= MAX_OPEN_FILES:
                raise InstalledCosmeticCatalogError("Too many serialized files were required.")
            if not resolved.is_file():
                raise InstalledCosmeticCatalogError("A required serialized file is missing.")
            self._indexes[key] = ArtworkFileIndex(resolved)
        return self._indexes[key]


def read_installed_catalog(
    game_root: Path,
) -> tuple[tuple[InstalledCosmeticMetadata, ...], tuple[tuple[str, int, int], ...]]:
    """Scan exact ordered metadata and targets without caches or artwork decoding."""
    catalog = []
    targets = []
    with CosmeticCatalogResolver(game_root / "REPO_Data") as resolver:
        level0 = resolver.open(game_root / "REPO_Data" / "level0")
        record, prefix, _ = _find_unique_meta_manager(resolver, level0)
        pointers = _find_cosmetic_vector(resolver, level0, record, prefix)
        for cosmetic_id, pointer in enumerate(pointers):
            index, target = resolver.resolve(level0, pointer)
            metadata, _ = _parse_cosmetic_metadata(resolver, index, target, cosmetic_id)
            catalog.append(metadata)
            targets.append((index.path.name, target.path_id, pointer.file_id))
    return tuple(catalog), tuple(targets)
