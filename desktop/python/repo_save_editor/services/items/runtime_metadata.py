"""Installed Item metadata for save workspaces and authoritative refill checks.

Capability snapshot generation uses the evidence-pinned installed_metadata reader.
This runtime scan shares its prefab validation and classification.
"""

from __future__ import annotations

import struct
from collections.abc import Iterable
from pathlib import Path, PurePosixPath
from typing import Final

from repo_save_editor.services.items.installed_metadata import (
    ITEM_CLASS,
    MAX_COMPONENTS,
    ItemPresentation,
    _classify_variants,
    _item_presentation,
    _normalize_item_names,
    _resolve_mono_scripts,
)
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.unity_artwork import ArtworkFileIndex
from repo_save_editor.services.unity_presentation import PresentationFileIndex, is_sunstone_layout
from repo_save_editor.services.unity_serialized import (
    GAME_OBJECT_CLASS_ID,
    MONO_BEHAVIOUR_CLASS_ID,
    MonoBehaviourPrefix,
    ObjectRecord,
    SerializedFileIndex,
    UnityMetadataError,
    _Reader,
    parse_mono_behaviour_prefix,
    read_pptr,
)

_PPTR_SIZE: Final = struct.calcsize("<iq")


def read_sunstone_item_prefab(
    index: SerializedFileIndex, record: ObjectRecord, prefix: MonoBehaviourPrefix
) -> tuple[str, str, _Reader] | None:
    """Resolve the bounded Item label and legacy-resource prefab identity."""
    reader = index.object_reader(record)
    reader.skip(prefix.field_offset)
    status = reader.i32()
    disabled = reader.u8()
    reader.align4()
    name = reader.aligned_string()
    read_pptr(reader)  # itemNameLocalized
    reader.aligned_string()  # description
    reader.skip(16)  # itemType / emojiIcon / itemVolume / itemSecretShopType
    read_pptr(reader)  # colorPreset
    prefab = reader.aligned_string()
    path = reader.aligned_string()
    bundle = read_pptr(reader)
    if (
        status not in (0, 1, 2)
        or disabled not in (0, 1)
        or bundle.file_id != 0
        or bundle.path_id != 0
        or not prefab
        or not path.startswith("Items/")
        or PurePosixPath(path).name != prefab
        or any(part in ("", ".", "..") for part in path.split("/"))
    ):
        return None
    return name, prefab, reader


def _sunstone_item_presentation(
    index: SerializedFileIndex, record: ObjectRecord, prefix: MonoBehaviourPrefix
) -> ItemPresentation:
    result = read_sunstone_item_prefab(index, record, prefix)
    if result is None:
        raise UnityMetadataError("Installed Item prefab identity is invalid.")
    name, _prefab, reader = result
    if reader.u8() not in (0, 1):
        raise UnityMetadataError("Installed Item prefab flag is malformed.")
    reader.align4()
    read_pptr(reader)  # value
    gameplay_cap = reader.i32()  # maxAmount
    if gameplay_cap < 0 or reader.i32() < 0:  # maxAmountInShop
        raise UnityMetadataError("Installed Item limits are malformed.")
    return ItemPresentation(prefix.name, name or None, gameplay_cap)


def _read_game_object_name(index: SerializedFileIndex, record: ObjectRecord) -> str:
    """Read only a GameObject name for broad candidate discovery.

    Empty names are valid for unrelated installed GameObjects. Structural corruption
    still raises so variant completeness never depends on silently skipping unreadable
    records. Component PPtr byte ranges are checked, and links are decoded only once a
    requested prefab identity is matched.
    """
    if record.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("Expected a GameObject record during name discovery.")
    reader = index.object_reader(record)
    component_count = reader.i32()
    if not 0 <= component_count <= MAX_COMPONENTS:
        raise UnityMetadataError("GameObject component count is outside the supported bound.")
    reader.skip(component_count * _PPTR_SIZE + 4)  # m_Component and m_Layer
    return reader.aligned_string()


def _discover_installed_item_metadata(
    resources_path: Path,
    global_managers_path: Path,
    names: tuple[str, ...],
    by_identity: dict[str, str],
    *,
    unity_version: str | None = None,
    presentation_only: bool = False,
) -> dict[str, InstalledItemMetadata]:
    """Read installed item metadata, propagating parser-wide failures."""
    unknown = {name: InstalledItemMetadata(ItemRechargeCapability.UNKNOWN, None) for name in names}

    index: type[SerializedFileIndex] = SerializedFileIndex
    if presentation_only:
        index = PresentationFileIndex
    elif unity_version is not None:
        index = ArtworkFileIndex
    with (
        index(resources_path) as resources,
        index(global_managers_path) as globals_,
    ):
        if (
            isinstance(resources, PresentationFileIndex)
            and isinstance(globals_, PresentationFileIndex)
            and resources.unity_version != globals_.unity_version
        ):
            raise UnityMetadataError("Item presentation sources use different Unity layouts.")
        if unity_version is not None and any(
            not isinstance(source, ArtworkFileIndex) or source.unity_version != unity_version
            for source in (resources, globals_)
        ):
            raise UnityMetadataError(
                "Item metadata sources do not match the reviewed Unity version."
            )
        candidate_definitions: dict[str, list[tuple[ObjectRecord, MonoBehaviourPrefix]]] = {
            identity: [] for identity in by_identity
        }
        variants: dict[str, list[ObjectRecord]] = {name: [] for name in names}
        for record in resources.iter_records(
            frozenset({MONO_BEHAVIOUR_CLASS_ID, GAME_OBJECT_CLASS_ID})
        ):
            if record.class_id == GAME_OBJECT_CLASS_ID:
                identity = _read_game_object_name(resources, record).casefold()
                if identity in by_identity:
                    variants[by_identity[identity]].append(record)
                continue
            prefix = parse_mono_behaviour_prefix(resources, record)
            identity = prefix.name.casefold()
            if identity in candidate_definitions:
                candidate_definitions[identity].append((record, prefix))

        relevant_prefixes = [
            prefix
            for candidates in candidate_definitions.values()
            for _record, prefix in candidates
        ]
        definition_scripts = _resolve_mono_scripts(resources, globals_, relevant_prefixes)

        verified_definitions: dict[str, ItemPresentation] = {}
        read_presentation = (
            _sunstone_item_presentation
            if isinstance(resources, PresentationFileIndex)
            and is_sunstone_layout(resources.unity_version)
            else _item_presentation
        )
        for identity in by_identity:
            item_definitions = [
                (record, prefix)
                for record, prefix in candidate_definitions[identity]
                if definition_scripts[prefix.script.path_id].class_name == ITEM_CLASS
            ]
            if len(item_definitions) != 1:
                continue
            record, prefix = item_definitions[0]
            definition_name = prefix.name
            if definition_name.casefold() == identity:
                try:
                    presentation = read_presentation(resources, record, prefix)
                except UnityMetadataError:
                    presentation = ItemPresentation(definition_name, None, None)
                verified_definitions[identity] = presentation

        ready = {
            name: tuple(records)
            for name, records in variants.items()
            if name.casefold() in verified_definitions and records
        }
        presentations = {name: verified_definitions[name.casefold()] for name in ready}
        classified = _classify_variants(resources, globals_, ready, presentations) if ready else {}
        return {name: classified.get(name, unknown[name]) for name in names}


def discover_installed_item_metadata(
    resources_path: Path,
    global_managers_path: Path,
    item_names: Iterable[str],
    *,
    unity_version: str | None = None,
    presentation_only: bool = False,
) -> dict[str, InstalledItemMetadata]:
    """Read optional icon and recharge metadata from installed item prefabs."""
    try:
        names, by_identity = _normalize_item_names(item_names)
    except UnityMetadataError:
        return {}
    if not names:
        return {}

    unknown = {name: InstalledItemMetadata(ItemRechargeCapability.UNKNOWN, None) for name in names}
    try:
        return _discover_installed_item_metadata(
            resources_path,
            global_managers_path,
            names,
            by_identity,
            unity_version=unity_version,
            presentation_only=presentation_only,
        )
    except (OSError, UnityMetadataError, struct.error, OverflowError, ValueError):
        return unknown
