"""Current-build approval stays separate from historical Recharge and parser proof."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from repo_save_editor.services.cosmetics.installed_catalog import InstalledCosmeticCatalogError
from repo_save_editor.services.cosmetics.installed_reader import (
    CosmeticCatalogResolver,
    read_installed_catalog,
)
from tools.capabilities import capture_cosmetics, workflow
from tools.capabilities.oracles import load_cosmetics_oracle
from tools.capabilities.schema import (
    CapabilityDataError,
    load_cosmetics_evidence,
    sha256_file,
    sha256_text_file,
)
from tools.capabilities.tests.test_dynamic_capability_proof import _build_install

CAPTURE = workflow.EVIDENCE_ROOT / "captures/cosmetics-26294889-unitypy.json"


def test_historical_evidence_and_reader_remain_independently_pinned() -> None:
    old = load_cosmetics_evidence(workflow.EVIDENCE_ROOT / "cosmetics.v1.json")
    assert old.compatibility.steam_build_id == "23363152"
    assert old.cosmetic_ids == tuple(range(547))
    for relative, digest in old.parser_source_digests:
        assert sha256_text_file(workflow.REPOSITORY_ROOT / relative) == digest
    recharge = json.loads(workflow.RECHARGE_EVIDENCE_PATH.read_text(encoding="utf-8"))
    assert recharge["compatibility"]["steamBuildId"] == "23363152"


def test_current_capture_has_exact_independent_targets_and_tail() -> None:
    oracle = load_cosmetics_oracle(CAPTURE)
    assert oracle.compatibility.unity_version == "6000.3.17f1"
    assert tuple(entry.cosmetic_id for entry in oracle.catalog) == tuple(range(557))
    assert len({row[:2] for row in oracle.targets}) == 557
    assert [entry.asset_name for entry in oracle.catalog[547:]] == [
        "Cowboy Hat",
        "Cowboy boot",
        "Cowboy boot",
        "Sheriff star",
        "Hay",
        "Miner's hat",
        "Rain boot",
        "Rain boot",
        "Holster",
        "Neck Bandana",
    ]
    assert all(entry.status == 0 for entry in oracle.catalog[547:])


@pytest.mark.parametrize("damage", ["version", "format", "null", "duplicate", "order", "vector"])
def test_current_oracle_rejects_invalid_capture(tmp_path: Path, damage: str) -> None:
    value = json.loads(CAPTURE.read_text(encoding="utf-8"))
    if damage == "version":
        value["unity"]["unityVersion"] = "6000.4.0f1"
    elif damage == "format":
        value["unity"]["serializedFileVersion"] = 23
    elif damage == "null":
        value["catalog"][0]["pathId"] = 0
    elif damage == "duplicate":
        value["catalog"][1]["pathId"] = value["catalog"][0]["pathId"]
    elif damage == "vector":
        value["metaManager"]["rawCosmeticVector"][0]["m_PathID"] += 1
    else:
        value["catalog"][0]["id"] = 1
    path = tmp_path / "oracle.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(CapabilityDataError):
        load_cosmetics_oracle(path)


def test_current_reader_reuses_bounded_traversal_and_rejects_unknown_header(tmp_path: Path) -> None:
    game = _build_install(tmp_path, cosmetics=("First", "Second"))
    for path in (game / "REPO_Data").iterdir():
        if path.is_file():
            path.write_bytes(path.read_bytes().replace(b"2022.3.67f2", b"6000.3.17f1"))
    catalog, targets = read_installed_catalog(game)
    assert [entry.asset_name for entry in catalog] == ["First", "Second"]
    assert len(set(targets)) == 2
    level0 = game / "REPO_Data/level0"
    level0.write_bytes(level0.read_bytes().replace(b"6000.3.17f1", b"6000.4.00f1"))
    with pytest.raises(ValueError, match="Unsupported Unity"):
        read_installed_catalog(game)


@pytest.mark.parametrize("damage", ["target", "hash", "assembly", "contract"])
def test_current_approval_rejects_changed_sources_or_semantics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, damage: str
) -> None:
    value = json.loads(CAPTURE.read_text(encoding="utf-8"))
    oracle = load_cosmetics_oracle(CAPTURE)
    monkeypatch.setattr(
        workflow, "read_installed_catalog", lambda _root: (oracle.catalog, oracle.targets)
    )
    if damage == "target":
        value["catalog"][0]["pathId"] += 100000
    elif damage == "hash":
        value["fileHashes"] = {}
    path = tmp_path / "oracle.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    if damage in {"target", "hash"}:
        with pytest.raises(CapabilityDataError):
            workflow._validate_cosmetics_oracle(
                oracle.catalog, "26294889", path, game_root=tmp_path
            )
        return
    assembly = tmp_path / workflow.MANAGED_ASSEMBLY_RELATIVE_PATH
    assembly.parent.mkdir(parents=True)
    assembly.write_bytes(b"changed")
    proof = json.loads(
        (workflow.EVIDENCE_ROOT / "captures/cosmetics-26294889-contract.json").read_text(
            encoding="utf-8"
        )
    )
    if damage == "contract":
        proof["managedAssemblySha256"] = sha256_file(assembly)
        proof["semanticContract"]["indexOperation"] = "different"
    path.write_text(json.dumps(proof), encoding="utf-8")
    previous = load_cosmetics_evidence(workflow.EVIDENCE_ROOT / "cosmetics.v1.json")
    with pytest.raises(CapabilityDataError):
        workflow._validate_cosmetics_contract(previous, tmp_path, "26294889", path)


def test_status_distinguishes_current_cosmetics_from_historical_recharge(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(workflow, "_installation", lambda _game_dir: (None, "26294889"))
    assert workflow.report_status() == 0
    text = capsys.readouterr().out
    assert "Recharge: approved build 23363152; 29 identities; UNAPPROVED installed build" in text
    assert "Cosmetics: approved build 26294889; 557 identities; build matches evidence" in text
    assert "no in-game validation" in text


def test_current_record_does_not_claim_a_fresh_557_id_game_save() -> None:
    evidence = load_cosmetics_evidence(workflow.COSMETICS_EVIDENCE_PATH)
    assert evidence.cosmetic_ids == tuple(range(557))
    assert evidence.ownership_proven_ids == tuple(range(547))
    assert evidence.ownership_oracle_build_id is None
    historical = load_cosmetics_evidence(workflow.EVIDENCE_ROOT / "cosmetics.v1.json")
    assert evidence.source_save_sha256 == historical.source_save_sha256


def test_committed_current_capture_drift_is_detected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    evidence = load_cosmetics_evidence(workflow.COSMETICS_EVIDENCE_PATH)
    capture = tmp_path / "captures/cosmetics-26294889-unitypy.json"
    capture.parent.mkdir()
    capture.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(workflow, "EVIDENCE_ROOT", tmp_path)
    with pytest.raises(CapabilityDataError, match="fingerprint changed"):
        workflow._validate_committed_cosmetic_proof(evidence)


def test_shared_catalog_resolver_rejects_sources_outside_game_data(tmp_path: Path) -> None:
    data = tmp_path / "REPO_Data"
    data.mkdir()
    outside = tmp_path / "outside.assets"
    outside.write_bytes(b"must not be read")
    with (
        CosmeticCatalogResolver(data) as resolver,
        pytest.raises(InstalledCosmeticCatalogError, match="outside the installed data"),
    ):
        resolver.open(outside)


def test_capture_cli_writes_platform_independent_lf_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    game = tmp_path / "game"
    game.mkdir()
    output = tmp_path / "capture.json"
    expected = {"catalogCount": 557, "note": "metadata only"}
    monkeypatch.setattr(capture_cosmetics, "capture", lambda _root: expected)
    monkeypatch.setattr("sys.argv", ["capture", "--game-dir", str(game), "--output", str(output)])
    capture_cosmetics.main()
    assert output.read_bytes() == (json.dumps(expected, indent=2) + "\n").encode("utf-8")
