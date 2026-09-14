"""Independent UnityPy oracle capture parsing, without approval or filesystem mutation.

Typed captures feed the capability workflow; agreement with installed metadata and
transactional evidence approval remain the workflow's responsibility.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.discovery import STEAM_APP_ID
from repo_save_editor.services.unity_serialized import UNITY_VERSION
from tools.capabilities.schema import (
    SCHEMA_VERSION,
    CapabilityDataError,
    Compatibility,
    exact_object,
    read_json,
)

COSMETICS_ORACLE_SCHEMA: Final = "repoditor-cosmetic-gate2-unitypy-oracle-v1"


@dataclass(frozen=True, slots=True)
class CosmeticsOracle:
    compatibility: Compatibility
    catalog: tuple[InstalledCosmeticMetadata, ...]


def load_recharge_oracle(path: Path) -> tuple[Compatibility, tuple[str, ...]]:
    value = read_json(path)
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "tool",
        "compatibility",
        "itemBatteryIdentities",
    }:
        raise CapabilityDataError("Recharge oracle capture has unsupported or missing fields.")
    if value["schemaVersion"] != SCHEMA_VERSION or value["tool"] != "UnityPy":
        raise CapabilityDataError("Recharge oracle is not the supported UnityPy schema.")
    compatibility_value = value["compatibility"]
    if not isinstance(compatibility_value, dict) or set(compatibility_value) != {
        "steamAppId",
        "steamBuildId",
        "unityVersion",
    }:
        raise CapabilityDataError("Recharge oracle compatibility metadata is malformed.")
    app_id = compatibility_value["steamAppId"]
    build_id = compatibility_value["steamBuildId"]
    unity_version = compatibility_value["unityVersion"]
    if app_id != STEAM_APP_ID or not isinstance(build_id, str) or not build_id.isdigit():
        raise CapabilityDataError("Recharge oracle targets an unsupported game build.")
    if unity_version != UNITY_VERSION:
        raise CapabilityDataError("Recharge oracle targets an unsupported Unity version.")
    raw_names = value["itemBatteryIdentities"]
    if not isinstance(raw_names, list) or any(
        not isinstance(name, str) or not name for name in raw_names
    ):
        raise CapabilityDataError("Recharge oracle identities are malformed.")
    names = tuple(cast(list[str], raw_names))
    if names != tuple(sorted(names, key=str.casefold)) or len(names) != len(set(names)):
        raise CapabilityDataError("Recharge oracle identities are duplicated or unordered.")
    return Compatibility(STEAM_APP_ID, build_id, UNITY_VERSION), names


def _oracle_integer(value: object, label: str) -> int:
    if type(value) is not int:
        raise CapabilityDataError(f"{label} must be an integer.")
    return value


def load_cosmetics_oracle(path: Path) -> CosmeticsOracle:
    root = exact_object(
        read_json(path),
        {
            "schema",
            "researchOnly",
            "independentOracle",
            "steam",
            "unity",
            "metaManager",
            "catalog",
            "validation",
            "fileHashes",
        },
        "Cosmetics UnityPy oracle",
    )
    if (
        root["schema"] != COSMETICS_ORACLE_SCHEMA
        or root["researchOnly"] is not True
        or root["independentOracle"] is not True
    ):
        raise CapabilityDataError("Cosmetics oracle is not the supported UnityPy capture.")

    steam = exact_object(root["steam"], {"appId", "buildId", "manifest"}, "Oracle Steam")
    build_id = steam["buildId"]
    if (
        steam["appId"] != STEAM_APP_ID
        or not isinstance(build_id, str)
        or not build_id.isascii()
        or not build_id.isdigit()
    ):
        raise CapabilityDataError("Cosmetics oracle targets an unsupported game build.")
    unity = exact_object(
        root["unity"],
        {"unityPyVersion", "unityVersion", "serializedFileVersion"},
        "Oracle Unity metadata",
    )
    if unity["unityVersion"] != UNITY_VERSION:
        raise CapabilityDataError("Cosmetics oracle targets an unsupported Unity version.")
    if not isinstance(unity["unityPyVersion"], str) or not unity["unityPyVersion"]:
        raise CapabilityDataError("Cosmetics oracle has no UnityPy version.")

    raw_catalog = root["catalog"]
    if not isinstance(raw_catalog, list):
        raise CapabilityDataError("Cosmetics oracle catalog must be an array.")
    catalog: list[InstalledCosmeticMetadata] = []
    for position, raw_entry in enumerate(raw_catalog):
        entry = exact_object(
            raw_entry,
            {
                "id",
                "serializedFile",
                "pathId",
                "sourceFileId",
                "assetName",
                "type",
                "rarity",
                "status",
            },
            "Cosmetics oracle entry",
        )
        cosmetic_id = _oracle_integer(entry["id"], "Cosmetics oracle ID")
        asset_name = entry["assetName"]
        if cosmetic_id != position or not isinstance(asset_name, str) or not asset_name:
            raise CapabilityDataError(
                "Cosmetics oracle entries are unordered or have malformed identities."
            )
        catalog.append(
            InstalledCosmeticMetadata(
                cosmetic_id=cosmetic_id,
                asset_name=asset_name,
                cosmetic_type=_oracle_integer(entry["type"], "Cosmetics oracle type"),
                rarity=_oracle_integer(entry["rarity"], "Cosmetics oracle rarity"),
                status=_oracle_integer(entry["status"], "Cosmetics oracle status"),
            )
        )

    validation = exact_object(
        root["validation"],
        {"count", "indexesContiguous", "duplicateTargetCount", "nullPointerCount"},
        "Cosmetics oracle validation",
    )
    if (
        validation["count"] != len(catalog)
        or validation["indexesContiguous"] is not True
        or validation["duplicateTargetCount"] != 0
        or validation["nullPointerCount"] != 0
    ):
        raise CapabilityDataError("Cosmetics oracle did not complete exact validation.")
    meta_manager = exact_object(
        root["metaManager"],
        {"serializedFile", "pathId", "cosmeticAssetsCount", "rawCosmeticVector"},
        "Cosmetics oracle MetaManager",
    )
    if meta_manager["cosmeticAssetsCount"] != len(catalog):
        raise CapabilityDataError("Cosmetics oracle MetaManager count is inconsistent.")
    return CosmeticsOracle(Compatibility(STEAM_APP_ID, build_id, UNITY_VERSION), tuple(catalog))
