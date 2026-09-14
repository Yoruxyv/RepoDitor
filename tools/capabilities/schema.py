"""Strict data contracts for approved capability evidence and generated snapshots."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

from repo_save_editor.services.cosmetics.schema import get_ownership_lists
from repo_save_editor.services.items.models import ItemRechargeCapability

SCHEMA_VERSION: Final = 1
GENERATOR_VERSION: Final = 1
STEAM_APP_ID: Final = "3241660"
SHA256_PREFIX: Final = "sha256:"
MAX_COSMETIC_ID: Final = 2_147_483_647


class CapabilityDataError(ValueError):
    """Raised when committed evidence or a generated snapshot is unsafe."""


@dataclass(frozen=True, slots=True)
class Compatibility:
    steam_app_id: str
    steam_build_id: str | None
    unity_version: str | None


@dataclass(frozen=True, slots=True)
class RechargeEvidence:
    compatibility: Compatibility
    provenance: str
    full_charge_representation: str
    parser_source_digests: tuple[tuple[str, str], ...]
    desktop_capabilities: tuple[tuple[str, ItemRechargeCapability], ...]
    oracle_tool: str
    oracle_item_battery_identities: tuple[str, ...]

    @property
    def rechargeable_identities(self) -> tuple[str, ...]:
        return tuple(
            identity
            for identity, capability in self.desktop_capabilities
            if capability is ItemRechargeCapability.RECHARGEABLE
        )

    @property
    def unresolved_identities(self) -> tuple[str, ...]:
        return tuple(
            identity
            for identity, capability in self.desktop_capabilities
            if capability is ItemRechargeCapability.UNKNOWN
        )


@dataclass(frozen=True, slots=True)
class CosmeticsEvidence:
    compatibility: Compatibility
    game_compatibility: str
    provenance: str
    parser_source_digests: tuple[tuple[str, str], ...]
    oracle_tool: str
    oracle_capture_sha256: str
    source_save_sha256: str
    ownership_oracle_build_id: str | None
    managed_assembly_sha256: str
    contract_source_object: str
    contract_consumer_method: str
    contract_index_operation: str
    contract_fingerprint: str
    serialized_file: str
    source_object: str
    identity_semantics: str
    cosmetic_ids: tuple[int, ...]


def read_json(path: Path) -> object:
    try:
        value: object = json.loads(path.read_text(encoding="utf-8", errors="strict"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CapabilityDataError(f"{path.as_posix()} is not readable valid JSON.") from error
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise CapabilityDataError(f"Could not fingerprint {path.as_posix()}.") from error
    return f"{SHA256_PREFIX}{digest.hexdigest()}"


def sha256_text_file(path: Path) -> str:
    """Fingerprint UTF-8 text independently of platform line endings."""
    try:
        with path.open("r", encoding="utf-8", errors="strict", newline="") as handle:
            text = handle.read()
    except (OSError, UnicodeError) as error:
        raise CapabilityDataError(f"Could not fingerprint {path.as_posix()}.") from error

    canonical = text.replace("\r\n", "\n").replace("\r", "\n")
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"{SHA256_PREFIX}{digest}"


def cosmetics_contract_fingerprint(
    source_object: str,
    consumer_method: str,
    index_operation: str,
    ownership_fields: tuple[str, ...],
) -> str:
    """Fingerprint the normalized managed-code relationship, not IL offsets."""
    normalized = json.dumps(
        {
            "consumerMethod": consumer_method,
            "indexOperation": index_operation,
            "ownershipFields": list(ownership_fields),
            "sourceObject": source_object,
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return f"{SHA256_PREFIX}{hashlib.sha256(normalized).hexdigest()}"


def exact_object(value: object, keys: set[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != keys:
        raise CapabilityDataError(f"{label} has unsupported or missing fields.")
    return cast(dict[str, object], value)


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\0" in value:
        raise CapabilityDataError(f"{label} must be non-empty text.")
    return value


def _optional_build_id(value: object, label: str) -> str | None:
    if value is None:
        return None
    build_id = _text(value, label)
    if not build_id.isascii() or not build_id.isdigit():
        raise CapabilityDataError(f"{label} must be a decimal Steam build ID or null.")
    return build_id


def _version(value: object, label: str) -> None:
    if type(value) is not int or value != SCHEMA_VERSION:
        raise CapabilityDataError(f"{label} uses an unsupported schema version.")


def _sha256(value: object, label: str, *, prefixed: bool) -> str:
    digest = _text(value, label)
    expected_length = 64 + (len(SHA256_PREFIX) if prefixed else 0)
    hexadecimal = digest.removeprefix(SHA256_PREFIX) if prefixed else digest
    if (
        len(digest) != expected_length
        or (prefixed and not digest.startswith(SHA256_PREFIX))
        or any(character not in "0123456789abcdef" for character in hexadecimal)
    ):
        raise CapabilityDataError(f"{label} is not lowercase SHA-256.")
    return digest


def _compatibility(value: object, *, allow_unknown_build: bool) -> Compatibility:
    row = exact_object(
        value,
        {"steamAppId", "steamBuildId", "unityVersion"},
        "compatibility",
    )
    app_id = _text(row["steamAppId"], "compatibility.steamAppId")
    if app_id != STEAM_APP_ID:
        raise CapabilityDataError("Capability evidence targets the wrong Steam application.")
    build_id = _optional_build_id(row["steamBuildId"], "compatibility.steamBuildId")
    unity_value = row["unityVersion"]
    unity_version = (
        None if unity_value is None else _text(unity_value, "compatibility.unityVersion")
    )
    if not allow_unknown_build and (build_id is None or unity_version is None):
        raise CapabilityDataError("Recharge evidence requires exact build and Unity metadata.")
    return Compatibility(app_id, build_id, unity_version)


def _sorted_unique_strings(value: object, label: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise CapabilityDataError(f"{label} must be an array of exact strings.")
    strings = tuple(_text(item, label) for item in value)
    if len(strings) != len(set(strings)) or len(strings) != len(
        {item.casefold() for item in strings}
    ):
        raise CapabilityDataError(f"{label} contains duplicate identities.")
    if strings != tuple(sorted(strings, key=str.casefold)):
        raise CapabilityDataError(f"{label} is not deterministically ordered.")
    return strings


def _cosmetic_ids(value: object, label: str) -> tuple[int, ...]:
    if not isinstance(value, list):
        raise CapabilityDataError(f"{label} must be an explicit integer array.")
    ids: list[int] = []
    for raw_id in value:
        if type(raw_id) is not int or not 0 <= raw_id <= MAX_COSMETIC_ID:
            raise CapabilityDataError(f"{label} contains an invalid cosmetic ID.")
        ids.append(raw_id)
    result = tuple(ids)
    if len(result) != len(set(result)):
        raise CapabilityDataError(f"{label} contains duplicate cosmetic IDs.")
    if result != tuple(sorted(result)):
        raise CapabilityDataError(f"{label} is not deterministically ordered.")
    return result


def _source_digests(value: object, label: str) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, dict) or not value:
        raise CapabilityDataError(f"{label} are missing.")
    digests: list[tuple[str, str]] = []
    for raw_path, raw_digest in value.items():
        if not isinstance(raw_path, str):
            raise CapabilityDataError(f"{label} paths must be text.")
        source_path = _text(raw_path, f"{label} path")
        digest = _sha256(raw_digest, f"{label} digest", prefixed=True)
        digests.append((source_path, digest))
    if digests != sorted(digests, key=lambda item: item[0]):
        raise CapabilityDataError(f"{label} are not ordered by path.")
    return tuple(digests)


def load_recharge_evidence(path: Path) -> RechargeEvidence:
    root = exact_object(
        read_json(path),
        {
            "schemaVersion",
            "compatibility",
            "provenance",
            "fullChargeRepresentation",
            "parserSourceDigests",
            "desktopItemBatteryCapabilities",
            "independentOracle",
        },
        "Recharge evidence",
    )
    _version(root["schemaVersion"], "Recharge evidence")
    compatibility = _compatibility(root["compatibility"], allow_unknown_build=False)
    provenance = _text(root["provenance"], "Recharge provenance")
    full_charge = _text(root["fullChargeRepresentation"], "fullChargeRepresentation")

    digests = _source_digests(root["parserSourceDigests"], "Recharge parser source digests")

    raw_capabilities = root["desktopItemBatteryCapabilities"]
    if not isinstance(raw_capabilities, list):
        raise CapabilityDataError("Recharge capability rows must be an array.")
    capabilities: list[tuple[str, ItemRechargeCapability]] = []
    for raw in raw_capabilities:
        row = exact_object(raw, {"itemIdentity", "capability"}, "Desktop Recharge capability")
        identity = _text(row["itemIdentity"], "Recharge item identity")
        raw_capability = _text(row["capability"], "Recharge capability")
        try:
            capability = ItemRechargeCapability(raw_capability)
        except ValueError as error:
            raise CapabilityDataError(
                "Recharge evidence contains an unknown capability."
            ) from error
        if capability is ItemRechargeCapability.NOT_RECHARGEABLE:
            raise CapabilityDataError(
                "ItemBattery evidence may contain only rechargeable or explicitly unresolved items."
            )
        capabilities.append((identity, capability))
    names = tuple(identity for identity, _capability in capabilities)
    if names != tuple(sorted(names, key=str.casefold)):
        raise CapabilityDataError("Desktop Recharge capability rows are not ordered.")
    if len(names) != len(set(names)) or len(names) != len({name.casefold() for name in names}):
        raise CapabilityDataError("Desktop Recharge capability rows contain duplicates.")

    oracle = exact_object(
        root["independentOracle"],
        {"schemaVersion", "tool", "itemBatteryIdentities"},
        "Independent Recharge oracle",
    )
    _version(oracle["schemaVersion"], "Independent Recharge oracle")
    oracle_tool = _text(oracle["tool"], "Independent Recharge oracle tool")
    if oracle_tool != "UnityPy":
        raise CapabilityDataError("Recharge evidence must retain the independent UnityPy oracle.")
    oracle_names = _sorted_unique_strings(
        oracle["itemBatteryIdentities"],
        "Independent Recharge oracle identities",
    )
    if names != oracle_names:
        raise CapabilityDataError("Desktop parser and independent Recharge oracle disagree.")
    return RechargeEvidence(
        compatibility,
        provenance,
        full_charge,
        digests,
        tuple(capabilities),
        oracle_tool,
        oracle_names,
    )


def load_cosmetics_evidence(path: Path) -> CosmeticsEvidence:
    root = exact_object(
        read_json(path),
        {
            "schemaVersion",
            "compatibility",
            "gameCompatibility",
            "provenance",
            "parserSourceDigests",
            "sourceSaveSha256",
            "installedCatalog",
            "ownershipOracle",
        },
        "Cosmetics evidence",
    )
    _version(root["schemaVersion"], "Cosmetics evidence")
    compatibility = _compatibility(root["compatibility"], allow_unknown_build=False)
    game_compatibility = _text(root["gameCompatibility"], "Cosmetics game compatibility")
    provenance = _text(root["provenance"], "Cosmetics provenance")
    parser_source_digests = _source_digests(
        root["parserSourceDigests"], "Cosmetics parser source digests"
    )
    source_digest = _sha256(root["sourceSaveSha256"], "Cosmetics source digest", prefixed=False)
    catalog = exact_object(
        root["installedCatalog"],
        {"serializedFile", "object", "identity", "exactIds", "independentOracle"},
        "Installed Cosmetics catalog",
    )
    serialized_file = _text(catalog["serializedFile"], "Installed Cosmetics serialized file")
    source_object = _text(catalog["object"], "Installed Cosmetics object")
    identity_semantics = _text(catalog["identity"], "Installed Cosmetics identity")
    ids = _cosmetic_ids(catalog["exactIds"], "Installed Cosmetics IDs")
    oracle = exact_object(
        catalog["independentOracle"],
        {"tool", "captureSha256"},
        "Installed Cosmetics independent oracle",
    )
    oracle_tool = _text(oracle["tool"], "Installed Cosmetics oracle tool")
    if oracle_tool != "UnityPy":
        raise CapabilityDataError("Installed Cosmetics requires the UnityPy oracle.")
    oracle_capture_sha256 = _sha256(
        oracle["captureSha256"], "Installed Cosmetics oracle capture digest", prefixed=True
    )
    ownership = exact_object(
        root["ownershipOracle"],
        {
            "fields",
            "steamBuildId",
            "exactSetParity",
            "managedAssemblySha256",
            "semanticContract",
        },
        "Cosmetics ownership oracle",
    )
    expected_fields = ("cosmeticHistory", "cosmeticUnlocks")
    if ownership["fields"] != list(expected_fields):
        raise CapabilityDataError("Cosmetics evidence does not prove both ownership fields.")
    if ownership["exactSetParity"] is not True:
        raise CapabilityDataError(
            "Installed Cosmetics IDs lack exact full-unlock ownership parity."
        )
    ownership_build_id = _optional_build_id(
        ownership["steamBuildId"], "Cosmetics ownership oracle Steam build ID"
    )
    managed_assembly_sha256 = _sha256(
        ownership["managedAssemblySha256"],
        "Cosmetics managed assembly digest",
        prefixed=True,
    )
    contract = exact_object(
        ownership["semanticContract"],
        {
            "sourceObject",
            "consumerMethod",
            "indexOperation",
            "fingerprint",
        },
        "Cosmetics semantic contract",
    )
    contract_source_object = _text(contract["sourceObject"], "Cosmetics contract source object")
    contract_consumer_method = _text(
        contract["consumerMethod"], "Cosmetics contract consumer method"
    )
    contract_index_operation = _text(
        contract["indexOperation"], "Cosmetics contract index operation"
    )
    contract_fingerprint = _sha256(
        contract["fingerprint"], "Cosmetics semantic fingerprint", prefixed=True
    )
    if contract_fingerprint != cosmetics_contract_fingerprint(
        contract_source_object,
        contract_consumer_method,
        contract_index_operation,
        expected_fields,
    ):
        raise CapabilityDataError("Cosmetics semantic contract fingerprint is invalid.")

    # Exercise the same Desktop ownership schema used by production without storing a real save.
    projected = {
        "cosmeticHistory": {"value": list(ids)},
        "cosmeticUnlocks": {"value": list(ids)},
        "cosmeticPresets": {"value": []},
    }
    history, unlocks = get_ownership_lists(projected)
    if tuple(history) != ids or tuple(unlocks) != ids:
        raise CapabilityDataError("Desktop cosmetics ownership projection changed unexpectedly.")

    return CosmeticsEvidence(
        compatibility,
        game_compatibility,
        provenance,
        parser_source_digests,
        oracle_tool,
        oracle_capture_sha256,
        source_digest,
        ownership_build_id,
        managed_assembly_sha256,
        contract_source_object,
        contract_consumer_method,
        contract_index_operation,
        contract_fingerprint,
        serialized_file,
        source_object,
        identity_semantics,
        ids,
    )


def recharge_snapshot(evidence: RechargeEvidence, evidence_path: Path) -> dict[str, object]:
    return {
        "snapshotVersion": SCHEMA_VERSION,
        "generatorVersion": GENERATOR_VERSION,
        "compatibility": {
            "steamAppId": evidence.compatibility.steam_app_id,
            "steamBuildId": evidence.compatibility.steam_build_id,
            "unityVersion": evidence.compatibility.unity_version,
        },
        "provenance": evidence.provenance,
        "sourceDigests": {
            "approvedEvidence": sha256_text_file(evidence_path),
            **dict(evidence.parser_source_digests),
        },
        "fullChargeRepresentation": evidence.full_charge_representation,
        "rechargeableItemIdentities": list(evidence.rechargeable_identities),
    }


def cosmetics_snapshot(evidence: CosmeticsEvidence, evidence_path: Path) -> dict[str, object]:
    return {
        "snapshotVersion": SCHEMA_VERSION,
        "generatorVersion": GENERATOR_VERSION,
        "compatibility": {
            "steamAppId": evidence.compatibility.steam_app_id,
            "steamBuildId": evidence.compatibility.steam_build_id,
            "unityVersion": evidence.compatibility.unity_version,
        },
        "gameCompatibility": evidence.game_compatibility,
        "provenance": evidence.provenance,
        "evidenceSha256": evidence.source_save_sha256,
        "sourceDigests": {
            "approvedEvidence": sha256_text_file(evidence_path),
            **dict(evidence.parser_source_digests),
        },
        "cosmeticIds": list(evidence.cosmetic_ids),
    }
