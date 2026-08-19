"""Installed item prefab metadata and evidence-backed recharge classification."""

from __future__ import annotations

import struct
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from repo_save_editor.prb_profile import emit as prb_emit
from repo_save_editor.services.icon_cache import normalize_icon_cache_key
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.unity_serialized import (
    GAME_OBJECT_CLASS_ID,
    MONO_BEHAVIOUR_CLASS_ID,
    MonoBehaviourPrefix,
    MonoScriptData,
    ObjectRecord,
    PPtr,
    SerializedFileIndex,
    UnityMetadataError,
    parse_mono_behaviour_prefix,
    parse_mono_script,
    read_pptr,
)

GLOBAL_MANAGERS_NAME: Final = "globalgamemanagers.assets"
ITEM_CLASS: Final = "Item"
ITEM_BATTERY_CLASS: Final = "ItemBattery"
MAX_COMPONENTS: Final = 4_096
KNOWN_BATTERY_BARS: Final = frozenset({5, 6, 8, 10, 12, 15, 18, 20})


@dataclass(frozen=True, slots=True)
class GameObjectData:
    name: str
    components: tuple[PPtr, ...]


@dataclass(frozen=True, slots=True)
class VariantResult:
    has_battery: bool | None
    battery_metadata: tuple[int, int] | None


@dataclass(frozen=True, slots=True)
class ItemPresentation:
    canonical_name: str
    display_name: str | None
    gameplay_cap: int | None


def _read_game_object_name(index: SerializedFileIndex, record: ObjectRecord) -> str:
    """Read only a GameObject name for broad candidate discovery.

    Empty names are valid for unrelated installed GameObjects. Structural corruption
    still raises so variant completeness never depends on silently skipping unreadable
    records. Component PPtrs are consumed but not semantically validated until a
    requested prefab identity is matched.
    """
    if record.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("Expected a GameObject record during name discovery.")
    reader = index.object_reader(record)
    component_count = reader.i32()
    if not 0 <= component_count <= MAX_COMPONENTS:
        raise UnityMetadataError("GameObject component count is outside the supported bound.")
    for _ in range(component_count):
        read_pptr(reader)
    reader.i32()  # m_Layer
    return reader.aligned_string()


def _parse_game_object(index: SerializedFileIndex, record: ObjectRecord) -> GameObjectData:
    if record.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("Matched prefab path ID is not a GameObject.")
    reader = index.object_reader(record)
    component_count = reader.i32()
    if not 0 <= component_count <= MAX_COMPONENTS:
        raise UnityMetadataError("GameObject component count is outside the supported bound.")
    components = tuple(read_pptr(reader) for _ in range(component_count))
    if any(pointer.file_id != 0 or pointer.path_id == 0 for pointer in components):
        raise UnityMetadataError("GameObject contains an unsupported or null component pointer.")
    reader.i32()  # m_Layer
    name = reader.aligned_string()
    if not name:
        raise UnityMetadataError("Matched prefab GameObject has no name.")
    return GameObjectData(name, components)


def _item_battery_metadata(
    index: SerializedFileIndex,
    record: ObjectRecord,
    field_offset: int,
) -> tuple[int, int]:
    absolute = record.byte_start + field_offset
    if field_offset < 0 or absolute + 5 > record.byte_start + record.byte_size:
        raise UnityMetadataError("ItemBattery prefix is truncated.")
    battery_bars = struct.unpack_from("<i", index._data, absolute)[0]
    exceptional_flag = index._data[absolute + 4]
    if battery_bars not in KNOWN_BATTERY_BARS:
        raise UnityMetadataError("ItemBattery batteryBars is outside the known-build guard set.")
    if exceptional_flag not in (0, 1):
        raise UnityMetadataError("ItemBattery exceptional flag is malformed.")
    return battery_bars, exceptional_flag


def _item_presentation(
    index: SerializedFileIndex,
    record: ObjectRecord,
    prefix: MonoBehaviourPrefix,
) -> ItemPresentation:
    """Read the narrow Item fields proven for the validated installed build."""
    reader = index.object_reader(record)
    reader.skip(prefix.field_offset)
    disabled = reader.i32()
    display_name = reader.aligned_string()
    reader.aligned_string()  # description
    read_pptr(reader)  # localized display name
    for _ in range(4):
        reader.i32()
    read_pptr(reader)
    prefab_name = reader.aligned_string()
    resource_path = reader.aligned_string()
    for _ in range(3):
        reader.i32()
    read_pptr(reader)
    gameplay_cap = reader.i32()
    max_amount_in_shop = reader.i32()
    if (
        disabled not in (0, 1)
        or not display_name
        or prefab_name != prefix.name
        or resource_path != f"Items/{prefix.name}"
        or gameplay_cap < 0
        or max_amount_in_shop < 0
    ):
        raise UnityMetadataError("Installed Item presentation fields are malformed.")
    return ItemPresentation(prefix.name, display_name, gameplay_cap)


def _normalize_item_names(item_names: Iterable[str]) -> tuple[tuple[str, ...], dict[str, str]]:
    names: list[str] = []
    by_identity: dict[str, str] = {}
    for value in item_names:
        if not isinstance(value, str) or not value.strip():
            raise UnityMetadataError("Item definition names must be non-empty text.")
        name = value.strip()
        identity = name.casefold()
        owner = by_identity.setdefault(identity, name)
        if owner != name:
            raise UnityMetadataError("Requested item definition names collide case-insensitively.")
        if owner == name and name not in names:
            names.append(name)
    return tuple(names), by_identity


def _resolve_mono_scripts(
    resources: SerializedFileIndex,
    globals_: SerializedFileIndex,
    prefixes: Iterable[MonoBehaviourPrefix],
) -> dict[int, MonoScriptData]:
    script_ids: set[int] = set()
    for prefix in prefixes:
        if prefix.script.path_id == 0:
            raise UnityMetadataError("MonoBehaviour contains a null script pointer.")
        if resources.external_name(prefix.script.file_id).casefold() != GLOBAL_MANAGERS_NAME:
            raise UnityMetadataError(
                "MonoBehaviour script pointer targets an unsupported external file."
            )
        script_ids.add(prefix.script.path_id)
    script_records = globals_.find_records(script_ids)
    return {
        path_id: parse_mono_script(globals_, record) for path_id, record in script_records.items()
    }


def _classify_variants(
    resources: SerializedFileIndex,
    globals_: SerializedFileIndex,
    variants_by_item: dict[str, tuple[ObjectRecord, ...]],
    presentations: dict[str, ItemPresentation],
) -> dict[str, InstalledItemMetadata]:
    game_objects: dict[int, GameObjectData] = {}
    item_variant_ids: dict[str, tuple[int, ...]] = {}
    for item_name, records in variants_by_item.items():
        ids: list[int] = []
        for record in records:
            game_object = _parse_game_object(resources, record)
            if game_object.name.casefold() != item_name.casefold():
                raise UnityMetadataError(
                    "Matched prefab GameObject identity changed during inspection."
                )
            game_objects[record.path_id] = game_object
            ids.append(record.path_id)
        item_variant_ids[item_name] = tuple(ids)

    component_ids = {
        pointer.path_id
        for game_object in game_objects.values()
        for pointer in game_object.components
    }
    component_records = resources.find_records(component_ids)
    mono_prefixes: dict[int, MonoBehaviourPrefix] = {}
    for component_id, record in component_records.items():
        if record.class_id == MONO_BEHAVIOUR_CLASS_ID:
            mono_prefixes[component_id] = parse_mono_behaviour_prefix(resources, record)
    scripts = _resolve_mono_scripts(resources, globals_, mono_prefixes.values())

    variant_results: dict[int, VariantResult] = {}
    for game_object_id, game_object in game_objects.items():
        battery_metadata: list[tuple[int, int]] = []
        incomplete = False
        for pointer in game_object.components:
            record = component_records[pointer.path_id]
            if record.class_id != MONO_BEHAVIOUR_CLASS_ID:
                continue
            prefix = mono_prefixes[pointer.path_id]
            if prefix.game_object != PPtr(0, game_object_id):
                raise UnityMetadataError(
                    "MonoBehaviour does not point back to its matched GameObject."
                )
            script = scripts[prefix.script.path_id]
            if script.class_name != ITEM_BATTERY_CLASS:
                continue
            try:
                battery_metadata.append(
                    _item_battery_metadata(resources, record, prefix.field_offset)
                )
            except UnityMetadataError:
                incomplete = True
                break
        if incomplete:
            variant_results[game_object_id] = VariantResult(None, None)
        elif not battery_metadata:
            variant_results[game_object_id] = VariantResult(False, None)
        elif len(set(battery_metadata)) != 1:
            variant_results[game_object_id] = VariantResult(None, None)
        else:
            variant_results[game_object_id] = VariantResult(True, battery_metadata[0])

    results: dict[str, InstalledItemMetadata] = {}
    for item_name, variant_ids in item_variant_ids.items():
        presentation = presentations[item_name]
        item_variants = [variant_results[path_id] for path_id in variant_ids]
        icon_keys = {
            normalize_icon_cache_key(game_objects[path_id].name) for path_id in variant_ids
        }
        icon_key = next(iter(icon_keys)) if len(icon_keys) == 1 else None
        presence = {result.has_battery for result in item_variants}
        if None in presence or len(presence) != 1:
            capability = ItemRechargeCapability.UNKNOWN
            results[item_name] = InstalledItemMetadata(
                capability,
                icon_key,
                presentation.canonical_name,
                presentation.display_name,
                presentation.gameplay_cap,
            )
            continue
        if not item_variants[0].has_battery:
            capability = ItemRechargeCapability.NOT_RECHARGEABLE
            results[item_name] = InstalledItemMetadata(
                capability,
                icon_key,
                presentation.canonical_name,
                presentation.display_name,
                presentation.gameplay_cap,
            )
            continue
        variant_battery_metadata = {result.battery_metadata for result in item_variants}
        exceptional = any(
            result.battery_metadata is None or result.battery_metadata[1] != 0
            for result in item_variants
        )
        capability = (
            ItemRechargeCapability.RECHARGEABLE
            if len(variant_battery_metadata) == 1 and not exceptional
            else ItemRechargeCapability.UNKNOWN
        )
        results[item_name] = InstalledItemMetadata(
            capability,
            icon_key,
            presentation.canonical_name,
            presentation.display_name,
            presentation.gameplay_cap,
        )
    key_counts: dict[str, int] = {}
    for metadata in results.values():
        if metadata.icon_cache_key is not None:
            key_counts[metadata.icon_cache_key] = key_counts.get(metadata.icon_cache_key, 0) + 1
    return {
        name: InstalledItemMetadata(
            metadata.recharge_capability,
            metadata.icon_cache_key
            if metadata.icon_cache_key is not None and key_counts[metadata.icon_cache_key] == 1
            else None,
            metadata.canonical_name,
            metadata.display_name,
            metadata.gameplay_cap,
        )
        for name, metadata in results.items()
    }


def discover_installed_item_metadata(
    resources_path: Path,
    global_managers_path: Path,
    item_names: Iterable[str],
) -> dict[str, InstalledItemMetadata]:
    """Read optional icon and recharge metadata from installed item prefabs."""
    prb_emit("unity_metadata_scan")
    try:
        names, by_identity = _normalize_item_names(item_names)
    except UnityMetadataError:
        return {}
    if not names:
        return {}
    unknown = {name: InstalledItemMetadata(ItemRechargeCapability.UNKNOWN, None) for name in names}

    try:
        with (
            SerializedFileIndex(resources_path) as resources,
            SerializedFileIndex(global_managers_path) as globals_,
        ):
            candidate_definitions: dict[str, list[tuple[ObjectRecord, MonoBehaviourPrefix]]] = {
                identity: [] for identity in by_identity
            }
            for record in resources.iter_records(frozenset({MONO_BEHAVIOUR_CLASS_ID})):
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
                        presentation = _item_presentation(resources, record, prefix)
                    except UnityMetadataError:
                        presentation = ItemPresentation(definition_name, None, None)
                    verified_definitions[identity] = presentation

            variants: dict[str, list[ObjectRecord]] = {name: [] for name in names}
            for record in resources.iter_records(frozenset({GAME_OBJECT_CLASS_ID})):
                name = _read_game_object_name(resources, record)
                if not name:
                    continue
                identity = name.casefold()
                if identity not in verified_definitions:
                    continue
                game_object = _parse_game_object(resources, record)
                if game_object.name.casefold() != identity:
                    raise UnityMetadataError(
                        "Matched prefab GameObject identity changed during discovery."
                    )
                variants[by_identity[identity]].append(record)

            ready = {
                name: tuple(records)
                for name, records in variants.items()
                if name.casefold() in verified_definitions and records
            }
            presentations = {name: verified_definitions[name.casefold()] for name in ready}
            classified = (
                _classify_variants(resources, globals_, ready, presentations) if ready else {}
            )
            return {name: classified.get(name, unknown[name]) for name in names}
    except (OSError, UnityMetadataError, struct.error, OverflowError, ValueError):
        return unknown


def discover_item_recharge_capabilities(
    resources_path: Path,
    global_managers_path: Path,
    item_names: Iterable[str],
) -> dict[str, ItemRechargeCapability]:
    """Classify requested installed item types from read-only Unity metadata."""
    return {
        name: metadata.recharge_capability
        for name, metadata in discover_installed_item_metadata(
            resources_path, global_managers_path, item_names
        ).items()
    }


__all__ = ["discover_installed_item_metadata", "discover_item_recharge_capabilities"]
