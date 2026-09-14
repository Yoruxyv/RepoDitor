"""Cross-pipeline proofs for installed dynamic capability approval."""

from __future__ import annotations

import json
import struct
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

import pytest

from repo_save_editor.services.cosmetics.installed_catalog import (
    discover_installed_cosmetic_catalog,
)
from repo_save_editor.services.items.installed_metadata import discover_installed_item_catalog
from repo_save_editor.services.items.models import ItemRechargeCapability
from tools.capabilities import oracles, workflow
from tools.capabilities.schema import cosmetics_contract_fingerprint, sha256_file
from tools.capabilities.tests.unity_serialized_fixture import (
    UNITY_VERSION,
    aligned_string,
    mono_script,
    pptr,
    write_serialized_file,
)

BUILD_ID: Final = "900001"
ITEM_SCRIPT_ID: Final = 1001
BATTERY_SCRIPT_ID: Final = 1002
META_MANAGER_SCRIPT_ID: Final = 1003
COSMETIC_SCRIPT_ID: Final = 1004
FUTURE_RECHARGE: Final = "Item Future Recharge Fixture"
FUTURE_AMBIGUOUS: Final = "Item Future Ambiguous Fixture"
BATTERY_LOOKING_NON_RECHARGEABLE: Final = "Item Future Battery Looking Fixture"
FUTURE_COSMETIC: Final = "Future Cosmetic Fixture"


@dataclass(frozen=True, slots=True)
class ItemFixture:
    name: str
    battery_bars: int | None
    exceptional: bool = False


@dataclass(frozen=True, slots=True)
class ProofWorkspace:
    root: Path
    game_root: Path
    recharge_evidence: Path
    cosmetics_evidence: Path
    web_recharge: Path
    web_cosmetics: Path
    desktop_cosmetics: Path
    electron_cosmetics: Path

    @property
    def managed_paths(self) -> tuple[Path, ...]:
        return (
            self.recharge_evidence,
            self.cosmetics_evidence,
            self.web_recharge,
            self.web_cosmetics,
            self.desktop_cosmetics,
            self.electron_cosmetics,
        )


BASE_ITEMS: Final = (
    ItemFixture("Item Baseline Recharge", 5),
    ItemFixture("Item Baseline Unknown", 8, exceptional=True),
    ItemFixture(BATTERY_LOOKING_NON_RECHARGEABLE, None),
)
BASE_COSMETICS: Final = ("Baseline Hat", "Baseline Glasses")


def _game_object(name: str, components: Iterable[int]) -> bytes:
    component_ids = tuple(components)
    return (
        struct.pack("<i", len(component_ids))
        + b"".join(pptr(0, path_id) for path_id in component_ids)
        + struct.pack("<i", 0)
        + aligned_string(name)
    )


def _mono_behaviour(
    name: str,
    game_object_id: int,
    script_id: int,
    *,
    battery_bars: int | None = None,
    exceptional: bool = False,
) -> bytes:
    data = pptr(0, game_object_id) + b"\x01\0\0\0" + pptr(1, script_id)
    data += aligned_string(name)
    if battery_bars is not None:
        data += struct.pack("<iB", battery_bars, exceptional)
    return data


def _cosmetic_asset(name: str) -> bytes:
    return (
        _mono_behaviour("", 0, COSMETIC_SCRIPT_ID)
        + struct.pack("<i", 2)
        + aligned_string(name)
        + struct.pack("<ii", 3, 4)
    )


def _build_install(
    root: Path,
    *,
    items: tuple[ItemFixture, ...] = BASE_ITEMS,
    cosmetics: tuple[str, ...] = BASE_COSMETICS,
) -> Path:
    steamapps = root / "steamapps"
    game_root = steamapps / "common" / "REPO"
    data_dir = game_root / "REPO_Data"
    catalog = data_dir / "StreamingAssets" / "aa" / "catalog.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text("{}", encoding="utf-8")
    (steamapps / "appmanifest_3241660.acf").write_text(
        (f'"AppState"\n{{\n"appid" "3241660"\n"installdir" "REPO"\n"buildid" "{BUILD_ID}"\n}}\n'),
        encoding="utf-8",
    )

    write_serialized_file(
        data_dir / "globalgamemanagers.assets",
        [
            (ITEM_SCRIPT_ID, 115, mono_script("Item", "Item")),
            (BATTERY_SCRIPT_ID, 115, mono_script("ItemBattery", "ItemBattery")),
            (META_MANAGER_SCRIPT_ID, 115, mono_script("MetaManager", "MetaManager")),
            (COSMETIC_SCRIPT_ID, 115, mono_script("CosmeticAsset", "CosmeticAsset")),
        ],
    )

    item_objects: list[tuple[int, int, bytes]] = []
    for position, item in enumerate(items, start=1):
        game_object_id = position * 100
        item_component_id = game_object_id + 1
        battery_component_id = game_object_id + 2
        component_ids = (
            (item_component_id,)
            if item.battery_bars is None
            else (item_component_id, battery_component_id)
        )
        item_objects.extend(
            (
                (game_object_id, 1, _game_object(item.name, component_ids)),
                (
                    item_component_id,
                    114,
                    _mono_behaviour(item.name, game_object_id, ITEM_SCRIPT_ID),
                ),
            )
        )
        if item.battery_bars is not None:
            item_objects.append(
                (
                    battery_component_id,
                    114,
                    _mono_behaviour(
                        "",
                        game_object_id,
                        BATTERY_SCRIPT_ID,
                        battery_bars=item.battery_bars,
                        exceptional=item.exceptional,
                    ),
                )
            )
    write_serialized_file(
        data_dir / "resources.assets",
        item_objects,
        externals=(("", "globalgamemanagers.assets"),),
    )

    cosmetic_ids = tuple(7000 + position * 17 for position in range(len(cosmetics)))
    write_serialized_file(
        data_dir / "sharedassets9.assets",
        [
            (path_id, 114, _cosmetic_asset(name))
            for path_id, name in zip(cosmetic_ids, cosmetics, strict=True)
        ],
        externals=(("archive:/CAB/globalgamemanagers.assets", "globalgamemanagers.assets"),),
    )
    vector = struct.pack("<i", len(cosmetic_ids)) + b"".join(
        pptr(2, path_id) for path_id in cosmetic_ids
    )
    write_serialized_file(
        data_dir / "level0",
        [
            (
                4001,
                114,
                _mono_behaviour("MetaManager", 0, META_MANAGER_SCRIPT_ID)
                + struct.pack("<i", -77)
                + vector,
            )
        ],
        externals=(
            ("", "globalgamemanagers.assets"),
            ("", "sharedassets9.assets"),
        ),
    )
    assembly = data_dir / "Managed" / "Assembly-CSharp.dll"
    assembly.parent.mkdir(parents=True, exist_ok=True)
    assembly.write_bytes(b"synthetic stable managed assembly")
    return game_root


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8", newline="\n")


def _recharge_candidates(items: tuple[ItemFixture, ...]) -> tuple[str, ...]:
    return tuple(
        sorted((item.name for item in items if item.battery_bars is not None), key=str.casefold)
    )


def _recharge_evidence(items: tuple[ItemFixture, ...]) -> dict[str, object]:
    candidates = _recharge_candidates(items)
    by_name = {item.name: item for item in items}
    return {
        "schemaVersion": 1,
        "compatibility": {
            "steamAppId": "3241660",
            "steamBuildId": BUILD_ID,
            "unityVersion": UNITY_VERSION,
        },
        "provenance": "Synthetic cross-pipeline proof fixture",
        "fullChargeRepresentation": "absent exact-instance entry in itemStatBattery",
        "parserSourceDigests": dict(
            workflow._parser_source_digests(workflow.RECHARGE_PARSER_SOURCE_PATHS)
        ),
        "desktopItemBatteryCapabilities": [
            {
                "itemIdentity": name,
                "capability": (
                    ItemRechargeCapability.UNKNOWN.value
                    if by_name[name].exceptional
                    else ItemRechargeCapability.RECHARGEABLE.value
                ),
            }
            for name in candidates
        ],
        "independentOracle": {
            "schemaVersion": 1,
            "tool": "UnityPy",
            "itemBatteryIdentities": list(candidates),
        },
    }


def _cosmetics_evidence(game_root: Path, cosmetic_count: int) -> dict[str, object]:
    source_object = "MetaManager.cosmeticAssets"
    consumer_method = "MenuElementCosmeticButton.Start"
    index_operation = "List<CosmeticAsset>.IndexOf"
    return {
        "schemaVersion": 1,
        "compatibility": {
            "steamAppId": "3241660",
            "steamBuildId": BUILD_ID,
            "unityVersion": UNITY_VERSION,
        },
        "gameCompatibility": "Synthetic installed MetaManager vector proof",
        "provenance": "Synthetic cross-pipeline proof fixture",
        "parserSourceDigests": dict(
            workflow._parser_source_digests(workflow.COSMETICS_PARSER_SOURCE_PATHS)
        ),
        "sourceSaveSha256": "1" * 64,
        "installedCatalog": {
            "serializedFile": "REPO_Data/level0",
            "object": source_object,
            "identity": "zero-based vector index",
            "independentOracle": {
                "tool": "UnityPy",
                "captureSha256": "sha256:" + ("2" * 64),
            },
            "exactIds": list(range(cosmetic_count)),
        },
        "ownershipOracle": {
            "fields": ["cosmeticHistory", "cosmeticUnlocks"],
            "steamBuildId": None,
            "exactSetParity": True,
            "managedAssemblySha256": sha256_file(
                game_root / workflow.MANAGED_ASSEMBLY_RELATIVE_PATH
            ),
            "semanticContract": {
                "sourceObject": source_object,
                "consumerMethod": consumer_method,
                "indexOperation": index_operation,
                "fingerprint": cosmetics_contract_fingerprint(
                    source_object,
                    consumer_method,
                    index_operation,
                    ("cosmeticHistory", "cosmeticUnlocks"),
                ),
            },
        },
    }


def _write_recharge_oracle(path: Path, items: tuple[ItemFixture, ...]) -> None:
    _write_json(
        path,
        {
            "schemaVersion": 1,
            "tool": "UnityPy",
            "compatibility": {
                "steamAppId": "3241660",
                "steamBuildId": BUILD_ID,
                "unityVersion": UNITY_VERSION,
            },
            "itemBatteryIdentities": list(_recharge_candidates(items)),
        },
    )


def _write_cosmetics_oracle(path: Path, names: tuple[str, ...]) -> None:
    catalog = [
        {
            "id": cosmetic_id,
            "serializedFile": "sharedassets9.assets",
            "pathId": 7000 + cosmetic_id * 17,
            "sourceFileId": 2,
            "assetName": name,
            "type": 3,
            "rarity": 4,
            "status": 2,
        }
        for cosmetic_id, name in enumerate(names)
    ]
    _write_json(
        path,
        {
            "schema": oracles.COSMETICS_ORACLE_SCHEMA,
            "researchOnly": True,
            "independentOracle": True,
            "steam": {
                "appId": "3241660",
                "buildId": BUILD_ID,
                "manifest": "appmanifest_3241660.acf",
            },
            "unity": {
                "unityPyVersion": "synthetic-test",
                "unityVersion": UNITY_VERSION,
                "serializedFileVersion": 22,
            },
            "metaManager": {
                "serializedFile": "level0",
                "pathId": 4001,
                "cosmeticAssetsCount": len(names),
                "rawCosmeticVector": [entry["pathId"] for entry in catalog],
            },
            "catalog": catalog,
            "validation": {
                "count": len(names),
                "indexesContiguous": True,
                "duplicateTargetCount": 0,
                "nullPointerCount": 0,
            },
            "fileHashes": {},
        },
    )


@pytest.fixture
def proof_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ProofWorkspace:
    root = tmp_path / "capability-workspace"
    game_root = _build_install(root)
    workspace = ProofWorkspace(
        root,
        game_root,
        root / "evidence" / "recharge.v1.json",
        root / "evidence" / "cosmetics.v1.json",
        root / "web" / "recharge-capabilities.v1.json",
        root / "web" / "known-cosmetics.v1.json",
        root / "desktop" / "known_cosmetics.py",
        root / "electron" / "known-cosmetics.cts",
    )
    for name, value in (
        ("RECHARGE_EVIDENCE_PATH", workspace.recharge_evidence),
        ("COSMETICS_EVIDENCE_PATH", workspace.cosmetics_evidence),
        ("WEB_RECHARGE_PATH", workspace.web_recharge),
        ("WEB_COSMETICS_PATH", workspace.web_cosmetics),
        ("DESKTOP_COSMETICS_PATH", workspace.desktop_cosmetics),
        ("ELECTRON_COSMETICS_PATH", workspace.electron_cosmetics),
    ):
        monkeypatch.setattr(workflow, name, value)
    _write_json(workspace.recharge_evidence, _recharge_evidence(BASE_ITEMS))
    _write_json(workspace.cosmetics_evidence, _cosmetics_evidence(game_root, len(BASE_COSMETICS)))
    assert workflow.update() == 0
    assert workflow.check_installed(game_root) == 0
    return workspace


def _bytes(paths: tuple[Path, ...]) -> dict[Path, bytes]:
    return {path: path.read_bytes() for path in paths}


def _mtimes(paths: tuple[Path, ...]) -> dict[Path, int]:
    return {path: path.stat().st_mtime_ns for path in paths}


def test_recharge_addition_flows_from_real_install_to_generated_snapshot(
    proof_workspace: ProofWorkspace,
    capsys: pytest.CaptureFixture[str],
) -> None:
    items = (*BASE_ITEMS, ItemFixture(FUTURE_RECHARGE, 12))
    _build_install(proof_workspace.root, items=items)

    catalog = discover_installed_item_catalog(
        proof_workspace.game_root / "REPO_Data" / "resources.assets",
        proof_workspace.game_root / "REPO_Data" / "globalgamemanagers.assets",
    )
    assert catalog[FUTURE_RECHARGE].recharge_capability is ItemRechargeCapability.RECHARGEABLE
    assert (
        catalog[BATTERY_LOOKING_NON_RECHARGEABLE].recharge_capability
        is ItemRechargeCapability.NOT_RECHARGEABLE
    )
    assert workflow.check_installed(proof_workspace.game_root) == 1
    assert f"+ {FUTURE_RECHARGE}" in capsys.readouterr().out

    oracle = proof_workspace.root / "recharge-oracle.json"
    _write_recharge_oracle(oracle, items)
    assert workflow.approve_installed_recharge(proof_workspace.game_root, oracle) == 0

    snapshot = cast(
        dict[str, object],
        json.loads(proof_workspace.web_recharge.read_text(encoding="utf-8")),
    )
    identities = cast(list[str], snapshot["rechargeableItemIdentities"])
    assert FUTURE_RECHARGE in identities
    assert BATTERY_LOOKING_NON_RECHARGEABLE not in identities
    assert workflow.check() == 0

    before = _bytes(proof_workspace.managed_paths)
    mtimes = _mtimes(proof_workspace.managed_paths)
    assert workflow.update() == 0
    assert "already current" in capsys.readouterr().out
    assert _bytes(proof_workspace.managed_paths) == before
    assert _mtimes(proof_workspace.managed_paths) == mtimes


def test_cosmetic_append_flows_from_real_vector_to_every_generated_artifact(
    proof_workspace: ProofWorkspace,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    names = (*BASE_COSMETICS, FUTURE_COSMETIC)
    _build_install(proof_workspace.root, cosmetics=names)

    catalog = discover_installed_cosmetic_catalog(
        proof_workspace.game_root,
        cache_dir=tmp_path / "cosmetics-cache",
    )
    assert catalog is not None
    assert tuple(entry.cosmetic_id for entry in catalog) == (0, 1, 2)
    assert catalog[-1].asset_name == FUTURE_COSMETIC
    assert workflow.check_installed(proof_workspace.game_root) == 1
    assert "+ 2" in capsys.readouterr().out

    oracle = proof_workspace.root / "cosmetics-oracle.json"
    _write_cosmetics_oracle(oracle, names)
    generated = (
        proof_workspace.web_cosmetics,
        proof_workspace.desktop_cosmetics,
        proof_workspace.electron_cosmetics,
    )
    before = _bytes(generated)
    assert workflow.approve_installed_cosmetics(proof_workspace.game_root, oracle, None) == 0
    assert all(path.read_bytes() != before[path] for path in generated)

    snapshot = cast(
        dict[str, object],
        json.loads(proof_workspace.web_cosmetics.read_text(encoding="utf-8")),
    )
    assert snapshot["cosmeticIds"] == [0, 1, 2]
    assert "    2," in proof_workspace.desktop_cosmetics.read_text(encoding="utf-8")
    assert "  2," in proof_workspace.electron_cosmetics.read_text(encoding="utf-8")
    assert workflow.check() == 0

    approved = _bytes(proof_workspace.managed_paths)
    mtimes = _mtimes(proof_workspace.managed_paths)
    assert workflow.update() == 0
    assert "already current" in capsys.readouterr().out
    assert _bytes(proof_workspace.managed_paths) == approved
    assert _mtimes(proof_workspace.managed_paths) == mtimes


@pytest.mark.parametrize("rejection", ["oracle-disagreement", "new-ambiguous"])
def test_recharge_rejection_before_write_is_byte_identical(
    proof_workspace: ProofWorkspace,
    rejection: str,
) -> None:
    future = (
        ItemFixture(FUTURE_RECHARGE, 12)
        if rejection == "oracle-disagreement"
        else ItemFixture(FUTURE_AMBIGUOUS, 12, exceptional=True)
    )
    items = (*BASE_ITEMS, future)
    _build_install(proof_workspace.root, items=items)
    oracle = proof_workspace.root / "recharge-rejection-oracle.json"
    _write_recharge_oracle(oracle, BASE_ITEMS if rejection == "oracle-disagreement" else items)
    before = _bytes(proof_workspace.managed_paths)

    assert workflow.approve_installed_recharge(proof_workspace.game_root, oracle) == 1
    assert _bytes(proof_workspace.managed_paths) == before


def test_cosmetics_oracle_rejection_before_write_is_byte_identical(
    proof_workspace: ProofWorkspace,
) -> None:
    _build_install(proof_workspace.root, cosmetics=(*BASE_COSMETICS, FUTURE_COSMETIC))
    oracle = proof_workspace.root / "cosmetics-rejection-oracle.json"
    _write_cosmetics_oracle(oracle, BASE_COSMETICS)
    before = _bytes(proof_workspace.managed_paths)

    assert workflow.approve_installed_cosmetics(proof_workspace.game_root, oracle, None) == 1
    assert _bytes(proof_workspace.managed_paths) == before


def test_downstream_failure_after_validation_restores_all_approval_outputs(
    proof_workspace: ProofWorkspace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    items = (*BASE_ITEMS, ItemFixture(FUTURE_RECHARGE, 12))
    _build_install(proof_workspace.root, items=items)
    oracle = proof_workspace.root / "recharge-downstream-oracle.json"
    _write_recharge_oracle(oracle, items)
    before = _bytes(proof_workspace.managed_paths)
    original_write = workflow._write_if_changed
    failed = False

    def fail_first_generated_write(path: Path, content: str) -> bool:
        nonlocal failed
        if path == proof_workspace.web_recharge and not failed:
            failed = True
            raise OSError("synthetic downstream generation failure")
        return original_write(path, content)

    monkeypatch.setattr(workflow, "_write_if_changed", fail_first_generated_write)

    assert workflow.approve_installed_recharge(proof_workspace.game_root, oracle) == 1
    assert failed
    assert _bytes(proof_workspace.managed_paths) == before
