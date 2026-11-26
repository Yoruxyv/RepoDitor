"""Native presentation cosmetic catalog reader, isolated from pinned capability evidence."""

from __future__ import annotations

import os
from pathlib import Path
from typing import cast

from repo_save_editor.services.cosmetics.installed_catalog import (
    MAX_OPEN_FILES,
    MAX_VECTOR_COUNT,
    _find_cosmetic_vector,
    _find_unique_meta_manager,
    _parse_cosmetic_metadata,
)
from repo_save_editor.services.cosmetics.installed_reader import CosmeticCatalogResolver
from repo_save_editor.services.cosmetics.installed_reader import (
    read_installed_catalog as _read_pinned_catalog,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.installed_build import owned_file
from repo_save_editor.services.game.write_evidence import RECHARGE_UNITY
from repo_save_editor.services.unity_presentation import PresentationFileIndex
from repo_save_editor.services.unity_serialized import (
    ObjectRecord,
    PPtr,
    SerializedFileIndex,
    UnityMetadataError,
    parse_mono_behaviour_prefix,
    parse_mono_script,
)


class NativeCosmeticCatalogResolver(CosmeticCatalogResolver):
    """Resolve installed cosmetic metadata through reviewed presentation headers."""

    def __init__(self, data_dir: Path) -> None:
        super().__init__(data_dir)
        self.targets: dict[tuple[Path, int], SerializedFileIndex] = {}

    def open(self, path: Path) -> SerializedFileIndex:
        key = os.path.normcase(os.fspath(path))
        if key not in self._indexes:
            if len(self._indexes) >= MAX_OPEN_FILES:
                raise UnityMetadataError("Too many serialized files were required.")
            self._indexes[key] = PresentationFileIndex(owned_file(self.data_dir, path))
        return self._indexes[key]

    def target_index(self, source: SerializedFileIndex, file_id: int) -> SerializedFileIndex:
        if file_id <= 0:
            return super().target_index(source, file_id)
        key = (source.path, file_id)
        target = self.targets.get(key)
        if target is None:
            target = super().target_index(source, file_id)
            # The native catalog verifies the installed identities around this scan.
            if len(self.targets) < MAX_OPEN_FILES:
                self.targets[key] = target
        return target


def read_installed_catalog(
    game_root: Path, *, native: bool = False, ownership: bool = False
) -> tuple[tuple[InstalledCosmeticMetadata, ...], tuple[tuple[str, int, int], ...]]:
    """Scan exact ordered metadata and targets without caches or artwork decoding."""
    if not native and not ownership:
        return _read_pinned_catalog(game_root)
    catalog: list[InstalledCosmeticMetadata] = []
    targets: list[tuple[str, int, int]] = []
    resolver = NativeCosmeticCatalogResolver(game_root / "REPO_Data")
    with resolver:
        level0 = resolver.open(game_root / "REPO_Data" / "level0")
        record, prefix, _ = _find_unique_meta_manager(resolver, level0)
        if ownership:
            pointers = _ownership_vector(resolver, level0, record)
        else:
            pointers = _find_cosmetic_vector(resolver, level0, record, prefix)
        for cosmetic_id, pointer in enumerate(pointers):
            index, target = resolver.resolve(level0, pointer)
            if ownership:
                _require_script(resolver, index, target, "CosmeticAsset")
            metadata, _ = _parse_cosmetic_metadata(resolver, index, target, cosmetic_id)
            catalog.append(metadata)
            targets.append((index.path.name, target.path_id, pointer.file_id))
        if ownership and any(
            cast(PresentationFileIndex, index).unity_version != RECHARGE_UNITY
            or index.path.name
            not in {"level0", "globalgamemanagers.assets", "sharedassets0.assets"}
            for index in resolver._indexes.values()
        ):
            raise UnityMetadataError("Unsupported ownership source layout.")
    return tuple(catalog), tuple(targets)


def _require_script(
    resolver: NativeCosmeticCatalogResolver,
    index: SerializedFileIndex,
    record: ObjectRecord,
    expected: str,
) -> None:
    prefix = parse_mono_behaviour_prefix(index, record)
    source, script_record = resolver.resolve(index, prefix.script)
    script = parse_mono_script(source, script_record)
    if (script.class_name, script.namespace, script.assembly_name) != (
        expected,
        "",
        "Assembly-CSharp",
    ) or source.path != resolver.data_dir / "globalgamemanagers.assets":
        raise UnityMetadataError("Unsupported ownership script identity.")


def _ownership_vector(
    resolver: NativeCosmeticCatalogResolver, level: SerializedFileIndex, record: ObjectRecord
) -> tuple[PPtr, ...]:
    _require_script(resolver, level, record, "MetaManager")
    prefix = parse_mono_behaviour_prefix(level, record)
    reader = level.object_reader(record)
    reader.skip(prefix.field_offset)
    # In the reviewed managed assembly, the ownership vector is the third
    # PPtr array, following cosmeticTypeAssets and CosmeticCategoryAssets.
    for _ in range(2):
        count = reader.i32()
        if not 0 < count <= MAX_VECTOR_COUNT:
            raise UnityMetadataError("Invalid ownership field layout.")
        reader.skip(count * 12)
    pointers = level.read_pptr_vector(record, reader.pos, maximum=MAX_VECTOR_COUNT)
    if pointers is None:
        raise UnityMetadataError("Invalid cosmetic ownership vector.")
    return pointers
