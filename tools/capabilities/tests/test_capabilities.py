from __future__ import annotations

import json
from pathlib import Path

import pytest

from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.items.models import ItemRechargeCapability
from tools.capabilities import oracles, workflow
from tools.capabilities.schema import (
    CapabilityDataError,
    cosmetics_snapshot,
    load_cosmetics_evidence,
    load_recharge_evidence,
    recharge_snapshot,
    sha256_file,
    sha256_text_file,
)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def test_text_fingerprint_normalizes_line_endings(tmp_path: Path) -> None:
    lf = tmp_path / "lf.py"
    crlf = tmp_path / "crlf.py"
    changed = tmp_path / "changed.py"

    lf.write_bytes(b"value = 1\nprint(value)\n")
    crlf.write_bytes(b"value = 1\r\nprint(value)\r\n")
    changed.write_bytes(b"value = 2\nprint(value)\n")

    assert sha256_text_file(lf) == sha256_text_file(crlf)
    assert sha256_text_file(lf) != sha256_text_file(changed)


def _recharge_value(
    capabilities: tuple[tuple[str, str], ...] = (
        ("Item Alpha", "rechargeable"),
        ("Item Battery", "unknown"),
    ),
    oracle: tuple[str, ...] = ("Item Alpha", "Item Battery"),
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "compatibility": {
            "steamAppId": "3241660",
            "steamBuildId": "23363152",
            "unityVersion": "2022.3.67f2",
        },
        "provenance": "approved recharge proof",
        "fullChargeRepresentation": "absent exact-instance entry",
        "parserSourceDigests": dict(
            workflow._parser_source_digests(workflow.RECHARGE_PARSER_SOURCE_PATHS)
        ),
        "desktopItemBatteryCapabilities": [
            {"itemIdentity": identity, "capability": capability}
            for identity, capability in capabilities
        ],
        "independentOracle": {
            "schemaVersion": 1,
            "tool": "UnityPy",
            "itemBatteryIdentities": list(oracle),
        },
    }


def _cosmetics_value(ids: tuple[int, ...] = (1, 3, 4)) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "compatibility": {
            "steamAppId": "3241660",
            "steamBuildId": "23363152",
            "unityVersion": "2022.3.67f2",
        },
        "gameCompatibility": "approved full-unlock capture; build unknown",
        "provenance": "approved cosmetics proof",
        "parserSourceDigests": dict(
            workflow._parser_source_digests(workflow.COSMETICS_PARSER_SOURCE_PATHS)
        ),
        "sourceSaveSha256": "a" * 64,
        "installedCatalog": {
            "serializedFile": "REPO_Data/level0",
            "object": "MetaManager.cosmeticAssets",
            "identity": "zero-based vector index used by ownership lists",
            "independentOracle": {
                "tool": "UnityPy",
                "captureSha256": "sha256:" + "c" * 64,
            },
            "exactIds": list(ids),
        },
        "ownershipOracle": {
            "fields": ["cosmeticHistory", "cosmeticUnlocks"],
            "steamBuildId": None,
            "exactSetParity": True,
            "managedAssemblySha256": "sha256:" + "b" * 64,
            "semanticContract": {
                "sourceObject": "MetaManager.cosmeticAssets",
                "consumerMethod": "MenuElementCosmeticButton.Start",
                "indexOperation": "List<CosmeticAsset>.IndexOf",
                "fingerprint": (
                    "sha256:84d8de92fdf2cf9931ba8ad7bd181d4488433928718922ee423e7fb57c0981b9"
                ),
            },
        },
    }


def _cosmetic_entry(cosmetic_id: int) -> InstalledCosmeticMetadata:
    return InstalledCosmeticMetadata(
        cosmetic_id=cosmetic_id,
        asset_name=f"Cosmetic {cosmetic_id}",
        cosmetic_type=2,
        rarity=1,
        status=3,
    )


def _cosmetics_oracle_value(ids: tuple[int, ...] = (0, 1)) -> dict[str, object]:
    return {
        "schema": oracles.COSMETICS_ORACLE_SCHEMA,
        "researchOnly": True,
        "independentOracle": True,
        "steam": {
            "appId": "3241660",
            "buildId": "23363152",
            "manifest": "sanitized",
        },
        "unity": {
            "unityPyVersion": "1.25.3",
            "unityVersion": "2022.3.67f2",
            "serializedFileVersion": 22,
        },
        "metaManager": {
            "serializedFile": "level0",
            "pathId": 42,
            "cosmeticAssetsCount": len(ids),
            "rawCosmeticVector": {"offsetFromRecord": 484},
        },
        "catalog": [
            {
                "id": cosmetic_id,
                "serializedFile": "sharedassets0.assets",
                "pathId": 1_000 + cosmetic_id,
                "sourceFileId": 2,
                "assetName": f"Cosmetic {cosmetic_id}",
                "type": 2,
                "rarity": 1,
                "status": 3,
            }
            for cosmetic_id in ids
        ],
        "validation": {
            "count": len(ids),
            "indexesContiguous": True,
            "duplicateTargetCount": 0,
            "nullPointerCount": 0,
        },
        "fileHashes": {"level0": "a" * 64, "sharedassets0.assets": "b" * 64},
    }


def _workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[Path, Path, Path, Path, Path, Path]:
    recharge_evidence = tmp_path / "evidence" / "recharge.json"
    cosmetics_evidence = tmp_path / "evidence" / "cosmetics.json"
    recharge_snapshot_path = tmp_path / "web" / "recharge.json"
    cosmetics_snapshot_path = tmp_path / "web" / "cosmetics.json"
    desktop_snapshot_path = tmp_path / "desktop" / "known_cosmetics.py"
    electron_snapshot_path = tmp_path / "electron" / "known-cosmetics.cts"
    _write_json(recharge_evidence, _recharge_value())
    _write_json(cosmetics_evidence, _cosmetics_value())
    monkeypatch.setattr(workflow, "RECHARGE_EVIDENCE_PATH", recharge_evidence)
    monkeypatch.setattr(workflow, "COSMETICS_EVIDENCE_PATH", cosmetics_evidence)
    monkeypatch.setattr(workflow, "WEB_RECHARGE_PATH", recharge_snapshot_path)
    monkeypatch.setattr(workflow, "WEB_COSMETICS_PATH", cosmetics_snapshot_path)
    monkeypatch.setattr(workflow, "DESKTOP_COSMETICS_PATH", desktop_snapshot_path)
    monkeypatch.setattr(workflow, "ELECTRON_COSMETICS_PATH", electron_snapshot_path)
    return (
        recharge_evidence,
        cosmetics_evidence,
        recharge_snapshot_path,
        cosmetics_snapshot_path,
        desktop_snapshot_path,
        electron_snapshot_path,
    )


def test_recharge_evidence_is_exact_ordered_and_oracle_aligned(tmp_path: Path) -> None:
    path = tmp_path / "recharge.json"
    _write_json(path, _recharge_value())

    evidence = load_recharge_evidence(path)

    assert evidence.rechargeable_identities == ("Item Alpha",)
    assert evidence.unresolved_identities == ("Item Battery",)


def test_empty_capability_sets_are_data_not_extraction_failures(tmp_path: Path) -> None:
    recharge_path = tmp_path / "recharge.json"
    cosmetics_path = tmp_path / "cosmetics.json"
    _write_json(recharge_path, _recharge_value((), ()))
    _write_json(cosmetics_path, _cosmetics_value(()))

    assert load_recharge_evidence(recharge_path).rechargeable_identities == ()
    assert load_cosmetics_evidence(cosmetics_path).cosmetic_ids == ()


@pytest.mark.parametrize(
    "value",
    [
        _recharge_value(
            (("Item Alpha", "rechargeable"), ("Item Alpha", "rechargeable")),
            ("Item Alpha", "Item Alpha"),
        ),
        _recharge_value(oracle=("Item Alpha",)),
        _recharge_value((("Item Alpha", "not_rechargeable"),), ("Item Alpha",)),
        {"schemaVersion": 1},
    ],
)
def test_recharge_evidence_rejects_duplicates_disagreement_and_malformed_rows(
    tmp_path: Path, value: object
) -> None:
    path = tmp_path / "recharge.json"
    _write_json(path, value)

    with pytest.raises(CapabilityDataError):
        load_recharge_evidence(path)


def test_similarly_named_item_is_never_inferred(tmp_path: Path) -> None:
    path = tmp_path / "recharge.json"
    _write_json(path, _recharge_value())

    snapshot = recharge_snapshot(load_recharge_evidence(path), path)

    identities = snapshot["rechargeableItemIdentities"]
    assert isinstance(identities, list)
    assert identities == ["Item Alpha"]
    assert "Item Alpha Battery" not in identities


def test_cosmetics_preserve_non_contiguous_ids_without_range_inference(
    tmp_path: Path,
) -> None:
    path = tmp_path / "cosmetics.json"
    _write_json(path, _cosmetics_value((547, 548, 550)))

    snapshot = cosmetics_snapshot(load_cosmetics_evidence(path), path)

    cosmetic_ids = snapshot["cosmeticIds"]
    assert isinstance(cosmetic_ids, list)
    assert cosmetic_ids == [547, 548, 550]
    assert 549 not in cosmetic_ids


@pytest.mark.parametrize(
    "ids",
    [
        (1, 1),
        (2, 1),
        (-1,),
    ],
)
def test_cosmetics_reject_duplicates_unordered_and_invalid_ids(
    tmp_path: Path, ids: tuple[int, ...]
) -> None:
    path = tmp_path / "cosmetics.json"
    _write_json(path, _cosmetics_value(ids))

    with pytest.raises(CapabilityDataError):
        load_cosmetics_evidence(path)


def test_unknown_cosmetics_build_is_preserved_without_inventing_metadata(
    tmp_path: Path,
) -> None:
    path = tmp_path / "cosmetics.json"
    _write_json(path, _cosmetics_value())

    evidence = load_cosmetics_evidence(path)

    assert evidence.compatibility.steam_build_id == "23363152"
    assert evidence.ownership_oracle_build_id is None


def test_cosmetics_unitypy_oracle_is_independently_typed_and_ordered(
    tmp_path: Path,
) -> None:
    path = tmp_path / "cosmetics-oracle.json"
    _write_json(path, _cosmetics_oracle_value())

    oracle = oracles.load_cosmetics_oracle(path)

    assert oracle.compatibility.steam_build_id == "23363152"
    assert tuple(entry.cosmetic_id for entry in oracle.catalog) == (0, 1)


def test_cosmetics_parser_oracle_disagreement_blocks_update(tmp_path: Path) -> None:
    path = tmp_path / "cosmetics-oracle.json"
    _write_json(path, _cosmetics_oracle_value())
    installed = (
        _cosmetic_entry(0),
        InstalledCosmeticMetadata(1, "Different asset", 2, 1, 3),
    )

    with pytest.raises(CapabilityDataError, match="oracle disagree"):
        workflow._validate_cosmetics_oracle(installed, "23363152", path)


@pytest.mark.parametrize("damage", ["extra-field", "boolean-id", "reordered", "missing-field"])
def test_cosmetics_oracle_rejects_malformed_capture(tmp_path: Path, damage: str) -> None:
    value = _cosmetics_oracle_value()
    catalog = value["catalog"]
    assert isinstance(catalog, list)
    if damage == "extra-field":
        value["unexpected"] = True
    elif damage == "boolean-id":
        catalog[0]["id"] = False
    elif damage == "reordered":
        catalog.reverse()
    else:
        del catalog[0]["status"]
    path = tmp_path / "malformed-oracle.json"
    _write_json(path, value)
    before = path.read_bytes()

    with pytest.raises(CapabilityDataError):
        oracles.load_cosmetics_oracle(path)
    assert path.read_bytes() == before


def test_installed_cosmetics_distinguishes_empty_catalog_from_parser_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installation = GameInstallation(tmp_path, tmp_path / "catalog.json")
    monkeypatch.setattr(workflow, "_installation", lambda _game_dir: (installation, "23363152"))
    monkeypatch.setattr(
        workflow,
        "discover_installed_cosmetic_catalog",
        lambda _game_dir, *, cache_dir: (),  # noqa: ARG005
    )

    assert workflow._installed_cosmetic_ids(None) == ((), "23363152")

    monkeypatch.setattr(
        workflow,
        "discover_installed_cosmetic_catalog",
        lambda _game_dir, *, cache_dir: None,  # noqa: ARG005
    )
    with pytest.raises(CapabilityDataError):
        workflow._installed_cosmetic_ids(None)


def test_cosmetics_update_uses_install_and_unitypy_without_a_fresh_metasave(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = _workspace(tmp_path, monkeypatch)
    game_root = tmp_path / "game"
    assembly = game_root / workflow.MANAGED_ASSEMBLY_RELATIVE_PATH
    assembly.parent.mkdir(parents=True)
    assembly.write_bytes(b"unchanged managed relationship")
    evidence_value = _cosmetics_value((1, 3, 4))
    ownership = evidence_value["ownershipOracle"]
    assert isinstance(ownership, dict)
    ownership["managedAssemblySha256"] = sha256_file(assembly)
    _write_json(paths[1], evidence_value)

    installed = (_cosmetic_entry(0), _cosmetic_entry(1))
    oracle_path = tmp_path / "cosmetics-oracle.json"
    _write_json(oracle_path, _cosmetics_oracle_value())
    monkeypatch.setattr(
        workflow,
        "_installed_cosmetics",
        lambda _game_dir: (installed, "23363152", game_root),
    )

    assert workflow.approve_installed_cosmetics(None, oracle_path, None) == 0
    updated = json.loads(paths[1].read_text(encoding="utf-8"))
    installed_catalog = updated["installedCatalog"]
    assert isinstance(installed_catalog, dict)
    assert installed_catalog["exactIds"] == [0, 1]
    assert updated["sourceSaveSha256"] == "a" * 64


def test_changed_managed_code_blocks_cosmetics_update_without_semantic_proof(
    tmp_path: Path,
) -> None:
    evidence_path = tmp_path / "cosmetics.json"
    game_root = tmp_path / "game"
    assembly = game_root / workflow.MANAGED_ASSEMBLY_RELATIVE_PATH
    assembly.parent.mkdir(parents=True)
    assembly.write_bytes(b"changed managed code")
    _write_json(evidence_path, _cosmetics_value())
    evidence = load_cosmetics_evidence(evidence_path)

    with pytest.raises(CapabilityDataError, match="Managed Cosmetics code changed"):
        workflow._validate_cosmetics_contract(evidence, game_root, "23363152", None)


def test_reviewed_semantic_proof_allows_changed_cosmetics_assembly(
    tmp_path: Path,
) -> None:
    evidence_path = tmp_path / "cosmetics.json"
    proof_path = tmp_path / "managed-proof.json"
    game_root = tmp_path / "game"
    assembly = game_root / workflow.MANAGED_ASSEMBLY_RELATIVE_PATH
    assembly.parent.mkdir(parents=True)
    assembly.write_bytes(b"compatible changed managed code")
    assembly_digest = sha256_file(assembly)
    evidence_value = _cosmetics_value()
    _write_json(evidence_path, evidence_value)
    evidence = load_cosmetics_evidence(evidence_path)
    semantic_contract = evidence_value["ownershipOracle"]
    assert isinstance(semantic_contract, dict)
    semantic_contract = semantic_contract["semanticContract"]
    assert isinstance(semantic_contract, dict)
    _write_json(
        proof_path,
        {
            "schemaVersion": 1,
            "tool": "dnfile/dncil",
            "compatibility": {
                "steamAppId": "3241660",
                "steamBuildId": "23363152",
                "unityVersion": "2022.3.67f2",
            },
            "managedAssemblySha256": assembly_digest,
            "relationshipVerified": True,
            "semanticContract": semantic_contract,
        },
    )

    assert (
        workflow._validate_cosmetics_contract(evidence, game_root, "23363152", proof_path)
        == assembly_digest
    )


def test_update_is_deterministic_and_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = _workspace(tmp_path, monkeypatch)

    assert workflow.update() == 0
    first = tuple(path.read_bytes() for path in paths[2:])
    assert workflow.update() == 0
    second = tuple(path.read_bytes() for path in paths[2:])

    assert second == first
    assert "already current" in capsys.readouterr().out


def test_update_recreates_generated_cosmetic_modules_exactly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = _workspace(tmp_path, monkeypatch)
    assert workflow.update() == 0
    expected_python = paths[4].read_bytes()
    expected_electron = paths[5].read_bytes()

    paths[4].write_text("corrupt\n", encoding="utf-8")
    paths[5].unlink()
    assert workflow.update() == 0

    assert paths[4].read_bytes() == expected_python
    assert paths[5].read_bytes() == expected_electron


def test_check_is_non_mutating_and_detects_evidence_fingerprint_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = _workspace(tmp_path, monkeypatch)
    assert workflow.update() == 0
    before = tuple(path.read_bytes() for path in paths)

    assert workflow.check() == 0
    cosmetics = json.loads(paths[1].read_text(encoding="utf-8"))
    cosmetics["provenance"] = "changed approved proof"
    _write_json(paths[1], cosmetics)
    assert workflow.check() == 1

    assert tuple(path.read_bytes() for path in paths[2:]) == before[2:]


@pytest.mark.parametrize(
    ("domain", "key", "replacement", "expected_output"),
    [
        ("recharge", "rechargeableItemIdentities", ["Item Added"], "Item Added"),
        ("recharge", "rechargeableItemIdentities", [], "Item Alpha"),
        ("cosmetics", "cosmeticIds", [1, 4], "3"),
        ("cosmetics", "cosmeticIds", [1, 3, 4, 8], "8"),
    ],
)
def test_alignment_reports_semantic_additions_and_removals(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    domain: str,
    key: str,
    replacement: list[object],
    expected_output: str,
) -> None:
    paths = _workspace(tmp_path, monkeypatch)
    assert workflow.update() == 0
    target = paths[2] if domain == "recharge" else paths[3]
    snapshot = json.loads(target.read_text(encoding="utf-8"))
    snapshot[key] = replacement
    _write_json(target, snapshot)

    assert workflow.check() == 1

    output = capsys.readouterr().out
    assert domain.capitalize() in output
    assert expected_output in output


def test_update_refuses_ambiguous_evidence_before_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = _workspace(tmp_path, monkeypatch)
    _write_json(paths[0], _recharge_value(oracle=("Item Other",)))

    assert workflow.update() == 1
    assert all(not path.exists() for path in paths[2:])


@pytest.mark.parametrize(
    ("installed", "build_id", "expected_fragment"),
    [
        ({"Item Alpha": ItemRechargeCapability.RECHARGEABLE}, "999", "BUILD DRIFT"),
        (
            {
                "Item Alpha": ItemRechargeCapability.RECHARGEABLE,
                "Item Added": ItemRechargeCapability.RECHARGEABLE,
                "Item Battery": ItemRechargeCapability.UNKNOWN,
            },
            "23363152",
            "Item Added",
        ),
        ({"Item Battery": ItemRechargeCapability.UNKNOWN}, "23363152", "Item Alpha"),
        (
            {
                "Item Alpha": ItemRechargeCapability.RECHARGEABLE,
                "Item Battery": ItemRechargeCapability.UNKNOWN,
                "Item New Unknown": ItemRechargeCapability.UNKNOWN,
            },
            "23363152",
            "Item New Unknown",
        ),
    ],
)
def test_installed_check_reports_build_addition_removal_and_unresolved_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    installed: dict[str, ItemRechargeCapability],
    build_id: str,
    expected_fragment: str,
) -> None:
    _workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(
        workflow,
        "_installed_recharge_capabilities",
        lambda _game_dir: (installed, build_id),
    )
    monkeypatch.setattr(
        workflow, "_installed_cosmetic_ids", lambda _game_dir: ((1, 3, 4), build_id)
    )

    assert workflow.check_installed() == 1
    assert expected_fragment in capsys.readouterr().out


def test_installed_check_passes_only_the_exact_approved_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(
        workflow,
        "_installed_recharge_capabilities",
        lambda _game_dir: (
            {
                "Item Alpha": ItemRechargeCapability.RECHARGEABLE,
                "Item Battery": ItemRechargeCapability.UNKNOWN,
                "Item Other": ItemRechargeCapability.NOT_RECHARGEABLE,
            },
            "23363152",
        ),
    )
    monkeypatch.setattr(
        workflow,
        "_installed_cosmetic_ids",
        lambda _game_dir: ((1, 3, 4), "23363152"),
    )

    assert workflow.check_installed() == 0


def test_installed_check_reports_cosmetic_additions_without_inferring_ranges(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(
        workflow,
        "_installed_recharge_capabilities",
        lambda _game_dir: (
            {
                "Item Alpha": ItemRechargeCapability.RECHARGEABLE,
                "Item Battery": ItemRechargeCapability.UNKNOWN,
            },
            "23363152",
        ),
    )
    monkeypatch.setattr(
        workflow,
        "_installed_cosmetic_ids",
        lambda _game_dir: ((1, 3, 4, 8), "23363152"),
    )

    assert workflow.check_installed() == 1
    output = capsys.readouterr().out
    assert "Cosmetics" in output
    assert "+ 8" in output
    assert "+ 2" not in output


def test_malformed_installed_extraction_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _workspace(tmp_path, monkeypatch)

    def fail(
        _game_dir: Path | None,
    ) -> tuple[dict[str, ItemRechargeCapability], str | None]:
        raise CapabilityDataError("malformed parser output")

    monkeypatch.setattr(workflow, "_installed_recharge_capabilities", fail)

    assert workflow.check_installed() == 1
