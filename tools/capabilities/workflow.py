"""Capability check, update, installed-game comparison, and semantic reporting."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

from repo_save_editor.core.crypto import decrypt_save
from repo_save_editor.services.cosmetics.installed_catalog import (
    discover_installed_cosmetic_catalog,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.schema import get_ownership_lists
from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    STEAM_APP_ID,
    GameInstallation,
    derive_steam_game_root,
    discover_game_installation,
    read_steam_app_manifest,
)
from repo_save_editor.services.items.installed_metadata import (
    InstalledItemCatalogError,
    discover_installed_item_catalog,
)
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.recharge_evidence import (
    GLOBAL_MANAGERS_RELATIVE_PATH,
    RESOURCES_RELATIVE_PATH,
)
from repo_save_editor.services.unity_serialized import UNITY_VERSION
from tools.capabilities.oracles import load_cosmetics_oracle, load_recharge_oracle
from tools.capabilities.schema import (
    SCHEMA_VERSION,
    CapabilityDataError,
    CosmeticsEvidence,
    cosmetics_contract_fingerprint,
    cosmetics_snapshot,
    exact_object,
    load_cosmetics_evidence,
    load_recharge_evidence,
    read_json,
    recharge_snapshot,
    sha256_file,
    sha256_text_file,
)

REPOSITORY_ROOT: Final = Path(__file__).resolve().parents[2]
EVIDENCE_ROOT: Final = REPOSITORY_ROOT / "tools" / "capabilities" / "evidence"
RECHARGE_EVIDENCE_PATH: Final = EVIDENCE_ROOT / "recharge.v1.json"
COSMETICS_EVIDENCE_PATH: Final = EVIDENCE_ROOT / "cosmetics.v1.json"
WEB_RECHARGE_PATH: Final = (
    REPOSITORY_ROOT / "web" / "src" / "features" / "recharge" / "recharge-capabilities.v1.json"
)
WEB_COSMETICS_PATH: Final = (
    REPOSITORY_ROOT / "web" / "src" / "features" / "cosmetics" / "known-cosmetics.v1.json"
)
DESKTOP_COSMETICS_PATH: Final = (
    REPOSITORY_ROOT
    / "desktop"
    / "python"
    / "repo_save_editor"
    / "services"
    / "cosmetics"
    / "known_cosmetics.py"
)
ELECTRON_COSMETICS_PATH: Final = (
    REPOSITORY_ROOT / "desktop" / "electron" / "ipc" / "known-cosmetics.cts"
)
RECHARGE_PARSER_SOURCE_PATHS: Final = (
    "desktop/python/repo_save_editor/services/items/installed_metadata.py",
    "desktop/python/repo_save_editor/services/items/models.py",
    "desktop/python/repo_save_editor/services/unity_serialized.py",
)
COSMETICS_PARSER_SOURCE_PATHS: Final = (
    "desktop/python/repo_save_editor/services/cosmetics/installed_catalog.py",
    "desktop/python/repo_save_editor/services/game/discovery.py",
    "desktop/python/repo_save_editor/services/unity_serialized.py",
)
MANAGED_ASSEMBLY_RELATIVE_PATH: Final = Path("REPO_Data/Managed/Assembly-CSharp.dll")


@dataclass(frozen=True, slots=True)
class DomainDiff:
    added: tuple[str, ...]
    removed: tuple[str, ...]

    @property
    def changed(self) -> bool:
        return bool(self.added or self.removed)


@dataclass(frozen=True, slots=True)
class ExpectedArtifacts:
    recharge: dict[str, object]
    cosmetics: dict[str, object]
    desktop_cosmetics: str
    electron_cosmetics: str


def _parser_source_digests(paths: tuple[str, ...]) -> tuple[tuple[str, str], ...]:
    return tuple((path, sha256_text_file(REPOSITORY_ROOT / path)) for path in paths)


def _validate_parser_sources(
    approved: tuple[tuple[str, str], ...], paths: tuple[str, ...], domain: str
) -> None:
    current = _parser_source_digests(paths)
    if approved != current:
        expected = dict(approved)
        changed = [path for path, digest in current if expected.get(path) != digest]
        raise CapabilityDataError(
            f"Desktop {domain} parser fingerprint changed: " + ", ".join(changed)
        )


def _desktop_cosmetics_module(evidence: CosmeticsEvidence) -> str:
    lines = [
        '"""Generated exact cosmetic mutation capability. Do not edit by hand."""',
        "",
        "from typing import Final",
        "",
        f"SNAPSHOT_VERSION: Final = {SCHEMA_VERSION}",
        'SOURCE_EVIDENCE: Final = "tools/capabilities/evidence/cosmetics.v1.json"',
        f'SOURCE_SAVE_SHA256: Final = "{evidence.source_save_sha256}"',
        "PROVEN_COSMETIC_IDS: Final = (",
    ]
    lines.extend(f"    {value}," for value in evidence.cosmetic_ids)
    lines.extend((")", ""))
    return "\n".join(lines)


def _electron_cosmetics_module(evidence: CosmeticsEvidence) -> str:
    lines = [
        "/** Generated exact cosmetic mutation capability. Do not edit by hand. */",
        f"export const SNAPSHOT_VERSION = {SCHEMA_VERSION};",
        'export const SOURCE_EVIDENCE = "tools/capabilities/evidence/cosmetics.v1.json";',
        "export const PROVEN_COSMETIC_IDS = new Set<number>([",
    ]
    lines.extend(f"  {value}," for value in evidence.cosmetic_ids)
    lines.extend(("]);", ""))
    return "\n".join(lines)


def expected_artifacts() -> ExpectedArtifacts:
    recharge_evidence = load_recharge_evidence(RECHARGE_EVIDENCE_PATH)
    _validate_parser_sources(
        recharge_evidence.parser_source_digests,
        RECHARGE_PARSER_SOURCE_PATHS,
        "Recharge",
    )
    cosmetics_evidence = load_cosmetics_evidence(COSMETICS_EVIDENCE_PATH)
    _validate_parser_sources(
        cosmetics_evidence.parser_source_digests,
        COSMETICS_PARSER_SOURCE_PATHS,
        "Cosmetics",
    )
    return ExpectedArtifacts(
        recharge_snapshot(recharge_evidence, RECHARGE_EVIDENCE_PATH),
        cosmetics_snapshot(cosmetics_evidence, COSMETICS_EVIDENCE_PATH),
        _desktop_cosmetics_module(cosmetics_evidence),
        _electron_cosmetics_module(cosmetics_evidence),
    )


def _json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeError) as error:
        raise CapabilityDataError(f"Could not read {path.relative_to(REPOSITORY_ROOT)}.") from error


def _set_diff(expected: object, actual: object, key: str) -> DomainDiff:
    expected_values = expected.get(key) if isinstance(expected, dict) else None
    actual_values = actual.get(key) if isinstance(actual, dict) else None
    if not isinstance(expected_values, list) or not isinstance(actual_values, list):
        return DomainDiff(("<valid generated data>",), ("<malformed committed data>",))
    expected_set = {str(value) for value in expected_values}
    actual_set = {str(value) for value in actual_values}
    return DomainDiff(
        tuple(sorted(expected_set - actual_set, key=str.casefold)),
        tuple(sorted(actual_set - expected_set, key=str.casefold)),
    )


def _print_domain_diff(name: str, difference: DomainDiff, *, expected_side: str) -> None:
    print(name)
    if difference.added:
        print(f"  Added in {expected_side}:")
        for value in difference.added:
            print(f"    + {value}")
    if difference.removed:
        print(f"  Removed from {expected_side}:")
        for value in difference.removed:
            print(f"    - {value}")


def check() -> int:
    """Validate evidence and compare temporary expected state without writing files."""
    try:
        expected = expected_artifacts()
        actual_recharge = read_json(WEB_RECHARGE_PATH)
        actual_cosmetics = read_json(WEB_COSMETICS_PATH)
        actual_desktop = _read_text(DESKTOP_COSMETICS_PATH)
        actual_electron = _read_text(ELECTRON_COSMETICS_PATH)
    except CapabilityDataError as error:
        print("Desktop <-> Web capability alignment FAILED")
        print(f"\nEvidence/schema\n  {error}")
        print("\nSnapshots were not modified.")
        return 1

    failures: list[tuple[str, DomainDiff]] = []
    if actual_recharge != expected.recharge:
        failures.append(
            (
                "Recharge",
                _set_diff(expected.recharge, actual_recharge, "rechargeableItemIdentities"),
            )
        )
    if actual_cosmetics != expected.cosmetics:
        failures.append(
            (
                "Cosmetics",
                _set_diff(expected.cosmetics, actual_cosmetics, "cosmeticIds"),
            )
        )
    desktop_changed = actual_desktop != expected.desktop_cosmetics
    electron_changed = actual_electron != expected.electron_cosmetics
    if failures or desktop_changed or electron_changed:
        print("Desktop <-> Web capability alignment FAILED")
        for name, difference in failures:
            print()
            _print_domain_diff(name, difference, expected_side="approved evidence")
            if not difference.changed:
                print("  Snapshot metadata or schema differs from approved evidence.")
        if desktop_changed:
            print("\nDesktop Cosmetics\n  Generated exact-ID module is stale or invalid.")
        if electron_changed:
            print("\nElectron Cosmetics\n  Generated exact-ID module is stale or invalid.")
        print("\nSnapshots were not modified.")
        print("After evidence review, run `npm run capabilities:update`.")
        return 1

    recharge_count = len(cast(list[object], expected.recharge["rechargeableItemIdentities"]))
    cosmetic_count = len(cast(list[object], expected.cosmetics["cosmeticIds"]))
    print("Desktop <-> Web capability alignment VERIFIED")
    print(f"  Recharge: {recharge_count} exact identities")
    print(f"  Cosmetics: {cosmetic_count} explicit IDs")
    print("  Snapshots were not modified.")
    return 0


def _write_if_changed(path: Path, content: str) -> bool:
    try:
        if path.is_file() and path.read_text(encoding="utf-8", errors="strict") == content:
            return False
    except (OSError, UnicodeError) as error:
        raise CapabilityDataError(f"Could not inspect {_display_path(path)}.") from error
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def _display_path(path: Path) -> str:
    try:
        return path.relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _write_json_if_changed(path: Path, value: object) -> bool:
    return _write_if_changed(path, _json_text(value))


def update() -> int:
    """Explicitly regenerate runtime artifacts from already approved evidence."""
    try:
        expected = expected_artifacts()
        changed = [
            _display_path(path)
            for path, content in (
                (WEB_RECHARGE_PATH, _json_text(expected.recharge)),
                (WEB_COSMETICS_PATH, _json_text(expected.cosmetics)),
                (DESKTOP_COSMETICS_PATH, expected.desktop_cosmetics),
                (ELECTRON_COSMETICS_PATH, expected.electron_cosmetics),
            )
            if _write_if_changed(path, content)
        ]
    except CapabilityDataError as error:
        print(f"Capability update blocked: {error}")
        return 1
    if changed:
        print("Updated capability artifacts:")
        for path in changed:
            print(f"  {path}")
    else:
        print("Capability artifacts are already current; no files changed.")
    return 0


def _write_approved_evidence(evidence_path: Path, evidence_value: object) -> int:
    paths = (
        evidence_path,
        WEB_RECHARGE_PATH,
        WEB_COSMETICS_PATH,
        DESKTOP_COSMETICS_PATH,
        ELECTRON_COSMETICS_PATH,
    )
    previous = {path: _read_text(path) if path.is_file() else None for path in paths}

    def restore() -> None:
        for path, content in previous.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                _write_if_changed(path, content)

    try:
        _write_json_if_changed(evidence_path, evidence_value)
        result = update()
    except OSError as error:
        restore()
        raise CapabilityDataError(
            "Capability approval failed while writing evidence or generated artifacts."
        ) from error

    if result == 0:
        return 0
    restore()
    return result


def _installation(game_dir: Path | None) -> tuple[GameInstallation, str | None]:
    result = discover_game_installation(game_dir)
    installation = result.installation
    if installation is None:
        raise CapabilityDataError(f"Installed R.E.P.O. discovery failed: {result.status.value}.")
    build_id = installation.steam_build_id
    if build_id is not None:
        return installation, build_id

    # An explicit override deliberately has no inferred provenance in Desktop runtime.
    # The maintainer tool may recover it only from the exact containing Steam manifest.
    try:
        steamapps = installation.root.parent.parent
        library_root = steamapps.parent
        manifest_path = steamapps / APP_MANIFEST_NAME
        manifest = read_steam_app_manifest(manifest_path)
        expected_root = derive_steam_game_root(library_root, manifest.install_dir)
        if expected_root is not None and expected_root.resolve(strict=True) == installation.root:
            build_id = manifest.build_id
    except OSError:
        build_id = None
    return installation, build_id


def _installed_recharge_capabilities(
    game_dir: Path | None,
) -> tuple[dict[str, ItemRechargeCapability], str | None]:
    installation, build_id = _installation(game_dir)
    try:
        catalog = discover_installed_item_catalog(
            installation.root / RESOURCES_RELATIVE_PATH,
            installation.root / GLOBAL_MANAGERS_RELATIVE_PATH,
        )
    except InstalledItemCatalogError as error:
        raise CapabilityDataError(str(error)) from error
    if not catalog:
        raise CapabilityDataError(
            "Installed Recharge metadata is missing, malformed, or unsupported."
        )
    return (
        {name: metadata.recharge_capability for name, metadata in catalog.items()},
        build_id,
    )


def _installed_cosmetic_ids(
    game_dir: Path | None,
) -> tuple[tuple[int, ...], str | None]:
    catalog, build_id, _game_root = _installed_cosmetics(game_dir)
    return tuple(entry.cosmetic_id for entry in catalog), build_id


def _installed_cosmetics(
    game_dir: Path | None,
) -> tuple[tuple[InstalledCosmeticMetadata, ...], str | None, Path]:
    installation, build_id = _installation(game_dir)
    with tempfile.TemporaryDirectory(prefix="repoditor-capabilities-") as cache_dir:
        catalog = discover_installed_cosmetic_catalog(installation.root, cache_dir=Path(cache_dir))
    if catalog is None:
        raise CapabilityDataError(
            "Installed Cosmetics metadata is missing, malformed, or unsupported."
        )
    ids = tuple(entry.cosmetic_id for entry in catalog)
    if ids != tuple(sorted(set(ids))):
        raise CapabilityDataError("Installed Cosmetics identities are duplicated or unordered.")
    return catalog, build_id, installation.root


def check_installed(game_dir: Path | None = None) -> int:
    """Compare the current local installation with committed approved capabilities."""
    try:
        recharge_evidence = load_recharge_evidence(RECHARGE_EVIDENCE_PATH)
        cosmetics_evidence = load_cosmetics_evidence(COSMETICS_EVIDENCE_PATH)
        installed, build_id = _installed_recharge_capabilities(game_dir)
        installed_cosmetics, cosmetics_build_id = _installed_cosmetic_ids(game_dir)
    except CapabilityDataError as error:
        print(f"Installed capability check FAILED\n  {error}")
        return 1

    expected = set(recharge_evidence.rechargeable_identities)
    actual = {
        name
        for name, capability in installed.items()
        if capability is ItemRechargeCapability.RECHARGEABLE
    }
    difference = DomainDiff(
        tuple(sorted(actual - expected, key=str.casefold)),
        tuple(sorted(expected - actual, key=str.casefold)),
    )
    installed_unknown = {
        name
        for name, capability in installed.items()
        if capability is ItemRechargeCapability.UNKNOWN
    }
    approved_unknown = set(recharge_evidence.unresolved_identities)
    new_unknown = tuple(sorted(installed_unknown - approved_unknown, key=str.casefold))
    missing_unknown = tuple(sorted(approved_unknown - installed_unknown, key=str.casefold))
    recharge_build_drift = build_id != recharge_evidence.compatibility.steam_build_id
    cosmetics_build_drift = cosmetics_build_id != cosmetics_evidence.compatibility.steam_build_id
    cosmetics_difference = DomainDiff(
        tuple(
            str(value)
            for value in sorted(set(installed_cosmetics) - set(cosmetics_evidence.cosmetic_ids))
        ),
        tuple(
            str(value)
            for value in sorted(set(cosmetics_evidence.cosmetic_ids) - set(installed_cosmetics))
        ),
    )

    print("Installed R.E.P.O. capability check")
    print(f"  Steam App ID: {STEAM_APP_ID}")
    print(f"  Installed build: {build_id or 'unknown'}")
    print(f"  Recharge approved build: {recharge_evidence.compatibility.steam_build_id}")
    print(f"  Cosmetics approved build: {cosmetics_evidence.compatibility.steam_build_id}")
    if recharge_build_drift or cosmetics_build_drift:
        print("  Build status: BUILD DRIFT")
    if difference.changed:
        print()
        _print_domain_diff("Recharge", difference, expected_side="installed Desktop extraction")
    if new_unknown or missing_unknown:
        print("\nRecharge unresolved")
        for value in new_unknown:
            print(f"  ? New ambiguous identity: {value}")
        for value in missing_unknown:
            print(f"  ? Approved ambiguous identity no longer matches: {value}")
    if cosmetics_difference.changed:
        print()
        _print_domain_diff(
            "Cosmetics",
            cosmetics_difference,
            expected_side="installed MetaManager extraction",
        )
    print(
        "\nIndependent oracle: not run by this command; committed UnityPy evidence was checked only."
    )
    print(
        "Cosmetics: installed MetaManager indices were compared with the approved ownership-parity evidence."
    )

    if (
        recharge_build_drift
        or cosmetics_build_drift
        or difference.changed
        or cosmetics_difference.changed
        or new_unknown
        or missing_unknown
    ):
        print("\nStatus: REVIEW REQUIRED - no snapshots were modified.")
        return 1
    print("\nStatus: installed Recharge and Cosmetics capabilities match approved evidence.")
    return 0


def _cosmetics_catalog_projection(
    catalog: tuple[InstalledCosmeticMetadata, ...],
) -> tuple[tuple[int, str, int, int, int], ...]:
    return tuple(
        (
            entry.cosmetic_id,
            entry.asset_name,
            entry.cosmetic_type,
            entry.rarity,
            entry.status,
        )
        for entry in catalog
    )


def _validate_cosmetics_oracle(
    installed: tuple[InstalledCosmeticMetadata, ...],
    installed_build_id: str | None,
    oracle_path: Path,
) -> None:
    oracle = load_cosmetics_oracle(oracle_path)
    if installed_build_id != oracle.compatibility.steam_build_id:
        raise CapabilityDataError("Installed build and Cosmetics oracle build disagree.")
    if _cosmetics_catalog_projection(installed) != _cosmetics_catalog_projection(oracle.catalog):
        raise CapabilityDataError(
            "Desktop parser and independent UnityPy Cosmetics oracle disagree."
        )


def approve_installed_recharge(game_dir: Path | None, oracle_path: Path) -> int:
    """Replace Recharge evidence only after Desktop extraction and UnityPy agree."""
    try:
        previous = load_recharge_evidence(RECHARGE_EVIDENCE_PATH)
        installed, build_id = _installed_recharge_capabilities(game_dir)
        compatibility, oracle_names = load_recharge_oracle(oracle_path)
        if build_id != compatibility.steam_build_id:
            raise CapabilityDataError("Installed build and Recharge oracle build disagree.")
        candidates = tuple(
            sorted(
                (
                    name
                    for name, capability in installed.items()
                    if capability is not ItemRechargeCapability.NOT_RECHARGEABLE
                ),
                key=str.casefold,
            )
        )
        if candidates != oracle_names:
            difference = DomainDiff(
                tuple(sorted(set(candidates) - set(oracle_names), key=str.casefold)),
                tuple(sorted(set(oracle_names) - set(candidates), key=str.casefold)),
            )
            _print_domain_diff(
                "Recharge oracle disagreement",
                difference,
                expected_side="Desktop parser",
            )
            raise CapabilityDataError("Desktop parser and independent UnityPy oracle disagree.")
        unknown = {
            name
            for name, capability in installed.items()
            if capability is ItemRechargeCapability.UNKNOWN
        }
        unapproved_unknown = unknown - set(previous.unresolved_identities)
        if unapproved_unknown:
            raise CapabilityDataError(
                "Installed Recharge extraction contains unresolved identities: "
                + ", ".join(sorted(unapproved_unknown, key=str.casefold))
            )
        evidence_value: dict[str, object] = {
            "schemaVersion": SCHEMA_VERSION,
            "compatibility": {
                "steamAppId": compatibility.steam_app_id,
                "steamBuildId": compatibility.steam_build_id,
                "unityVersion": compatibility.unity_version,
            },
            "provenance": previous.provenance,
            "fullChargeRepresentation": previous.full_charge_representation,
            "parserSourceDigests": dict(_parser_source_digests(RECHARGE_PARSER_SOURCE_PATHS)),
            "desktopItemBatteryCapabilities": [
                {"itemIdentity": name, "capability": installed[name].value} for name in candidates
            ],
            "independentOracle": {
                "schemaVersion": SCHEMA_VERSION,
                "tool": "UnityPy",
                "itemBatteryIdentities": list(oracle_names),
            },
        }
        return _write_approved_evidence(RECHARGE_EVIDENCE_PATH, evidence_value)
    except CapabilityDataError as error:
        print(f"Recharge evidence update blocked: {error}")
        return 1


def _validate_cosmetics_contract(
    previous: CosmeticsEvidence,
    game_root: Path,
    build_id: str,
    proof_path: Path | None,
) -> str:
    assembly_digest = sha256_file(game_root / MANAGED_ASSEMBLY_RELATIVE_PATH)
    if assembly_digest == previous.managed_assembly_sha256:
        return assembly_digest
    if proof_path is None:
        raise CapabilityDataError(
            "Managed Cosmetics code changed; supply an independently reviewed "
            "--cosmetics-contract-proof or new full-unlock evidence."
        )

    proof = exact_object(
        read_json(proof_path),
        {
            "schemaVersion",
            "tool",
            "compatibility",
            "managedAssemblySha256",
            "relationshipVerified",
            "semanticContract",
        },
        "Cosmetics managed-code proof",
    )
    if (
        proof["schemaVersion"] != SCHEMA_VERSION
        or proof["tool"] != "dnfile/dncil"
        or proof["relationshipVerified"] is not True
        or proof["managedAssemblySha256"] != assembly_digest
    ):
        raise CapabilityDataError("Cosmetics managed-code proof is invalid or stale.")
    compatibility = exact_object(
        proof["compatibility"],
        {"steamAppId", "steamBuildId", "unityVersion"},
        "Cosmetics managed-code proof compatibility",
    )
    if compatibility != {
        "steamAppId": STEAM_APP_ID,
        "steamBuildId": build_id,
        "unityVersion": UNITY_VERSION,
    }:
        raise CapabilityDataError("Cosmetics managed-code proof targets a different installation.")
    contract = exact_object(
        proof["semanticContract"],
        {"sourceObject", "consumerMethod", "indexOperation", "fingerprint"},
        "Cosmetics managed-code semantic contract",
    )
    expected_contract = {
        "sourceObject": previous.contract_source_object,
        "consumerMethod": previous.contract_consumer_method,
        "indexOperation": previous.contract_index_operation,
        "fingerprint": previous.contract_fingerprint,
    }
    if contract != expected_contract or contract["fingerprint"] != cosmetics_contract_fingerprint(
        previous.contract_source_object,
        previous.contract_consumer_method,
        previous.contract_index_operation,
        ("cosmeticHistory", "cosmeticUnlocks"),
    ):
        raise CapabilityDataError("Cosmetics ownership/index semantics changed or are ambiguous.")
    return assembly_digest


def _cosmetics_evidence_value(
    previous: CosmeticsEvidence,
    installed_ids: tuple[int, ...],
    installed_build_id: str,
    managed_assembly_sha256: str,
    oracle_capture_sha256: str,
    *,
    source_save_sha256: str | None = None,
    source_save_build_id: str | None = None,
) -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "compatibility": {
            "steamAppId": STEAM_APP_ID,
            "steamBuildId": installed_build_id,
            "unityVersion": UNITY_VERSION,
        },
        "gameCompatibility": (
            f"Installed MetaManager cosmeticAssets vector on Steam build {installed_build_id}, "
            "verified against UnityPy and the managed ownership/index contract"
        ),
        "provenance": previous.provenance,
        "parserSourceDigests": dict(_parser_source_digests(COSMETICS_PARSER_SOURCE_PATHS)),
        "sourceSaveSha256": source_save_sha256 or previous.source_save_sha256,
        "installedCatalog": {
            "serializedFile": previous.serialized_file,
            "object": previous.source_object,
            "identity": previous.identity_semantics,
            "independentOracle": {
                "tool": "UnityPy",
                "captureSha256": oracle_capture_sha256,
            },
            "exactIds": list(installed_ids),
        },
        "ownershipOracle": {
            "fields": ["cosmeticHistory", "cosmeticUnlocks"],
            "steamBuildId": (
                source_save_build_id
                if source_save_sha256 is not None
                else previous.ownership_oracle_build_id
            ),
            "exactSetParity": True,
            "managedAssemblySha256": managed_assembly_sha256,
            "semanticContract": {
                "sourceObject": previous.contract_source_object,
                "consumerMethod": previous.contract_consumer_method,
                "indexOperation": previous.contract_index_operation,
                "fingerprint": previous.contract_fingerprint,
            },
        },
    }


def approve_installed_cosmetics(
    game_dir: Path | None,
    oracle_path: Path,
    contract_proof_path: Path | None,
) -> int:
    """Approve installed cosmetic IDs without requiring a fresh MetaSave."""
    try:
        previous = load_cosmetics_evidence(COSMETICS_EVIDENCE_PATH)
        installed, build_id, game_root = _installed_cosmetics(game_dir)
        if build_id is None:
            raise CapabilityDataError(
                "Installed Cosmetics evidence has no authoritative Steam build ID."
            )
        _validate_cosmetics_oracle(installed, build_id, oracle_path)
        assembly_digest = _validate_cosmetics_contract(
            previous, game_root, build_id, contract_proof_path
        )
        evidence_value = _cosmetics_evidence_value(
            previous,
            tuple(entry.cosmetic_id for entry in installed),
            build_id,
            assembly_digest,
            sha256_file(oracle_path),
        )
        return _write_approved_evidence(COSMETICS_EVIDENCE_PATH, evidence_value)
    except CapabilityDataError as error:
        print(f"Cosmetics evidence update blocked: {error}")
        return 1


def approve_cosmetics_save(
    save_path: Path,
    game_dir: Path | None,
    source_save_build_id: str | None,
    oracle_path: Path,
) -> int:
    """Approve installed catalog IDs only when a full-unlock MetaSave agrees exactly."""
    try:
        if source_save_build_id is not None and (
            not source_save_build_id.isascii() or not source_save_build_id.isdigit()
        ):
            raise CapabilityDataError("Cosmetics Steam build ID must be decimal.")
        installed, installed_build_id, game_root = _installed_cosmetics(game_dir)
        if installed_build_id is None:
            raise CapabilityDataError(
                "Installed Cosmetics evidence has no authoritative Steam build ID."
            )
        _validate_cosmetics_oracle(installed, installed_build_id, oracle_path)
        installed_ids = tuple(entry.cosmetic_id for entry in installed)
        try:
            data = decrypt_save(save_path.read_bytes())
            history, unlocks = get_ownership_lists(data)
        except (OSError, ValueError) as error:
            raise CapabilityDataError(
                "Cosmetics evidence is not a valid supported MetaSave."
            ) from error
        if len(history) != len(set(history)) or len(unlocks) != len(set(unlocks)):
            raise CapabilityDataError("Cosmetics evidence ownership lists contain duplicates.")
        if set(history) != set(unlocks) or not unlocks:
            raise CapabilityDataError("Cosmetics full-unlock ownership lists do not match exactly.")
        ownership_ids = tuple(sorted(unlocks))
        if any(type(value) is not int or value < 0 for value in ownership_ids):
            raise CapabilityDataError("Cosmetics evidence contains an invalid ownership ID.")
        if ownership_ids != installed_ids:
            difference = DomainDiff(
                tuple(str(value) for value in sorted(set(installed_ids) - set(ownership_ids))),
                tuple(str(value) for value in sorted(set(ownership_ids) - set(installed_ids))),
            )
            _print_domain_diff(
                "Cosmetics ownership disagreement",
                difference,
                expected_side="installed MetaManager extraction",
            )
            raise CapabilityDataError(
                "Installed Cosmetics and full-unlock ownership evidence disagree."
            )
        previous = load_cosmetics_evidence(COSMETICS_EVIDENCE_PATH)
        evidence_value = _cosmetics_evidence_value(
            previous,
            installed_ids,
            installed_build_id,
            sha256_file(game_root / MANAGED_ASSEMBLY_RELATIVE_PATH),
            sha256_file(oracle_path),
            source_save_sha256=sha256_file(save_path).removeprefix("sha256:"),
            source_save_build_id=source_save_build_id,
        )
        return _write_approved_evidence(COSMETICS_EVIDENCE_PATH, evidence_value)
    except CapabilityDataError as error:
        print(f"Cosmetics evidence update blocked: {error}")
        return 1
