from __future__ import annotations

from pathlib import Path

import pytest

from repo_save_editor.services.game.discovery import (
    GameDiscoveryResult,
    GameDiscoveryStatus,
    GameInstallation,
)
from repo_save_editor.services.game.installed_build import ValidatedInstalledBuild
from repo_save_editor.services.items import recharge_evidence
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.recharge_evidence import (
    build_recharge_evidence,
    resolve_recharge_source_context,
    serialize_recharge_evidence,
    verify_recharge_evidence,
)


def _installation(root: Path, build_id: str = "23363152") -> GameInstallation:
    data_dir = root / "REPO_Data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "resources.assets").write_bytes(b"resources")
    (data_dir / "globalgamemanagers.assets").write_bytes(b"globals")
    manifest = root.parent / "appmanifest_3241660.acf"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(build_id, encoding="utf-8")
    catalog = data_dir / "StreamingAssets" / "aa" / "catalog.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text("{}", encoding="utf-8")
    return GameInstallation(
        root=root,
        catalog_path=catalog,
        steam_library_root=root.parent.parent,
        manifest_path=manifest,
        steam_build_id=build_id,
    )


def _install_context(
    monkeypatch: pytest.MonkeyPatch,
    installation: GameInstallation,
    *,
    build_id: str = "23363152",
) -> None:
    monkeypatch.setattr(
        recharge_evidence,
        "discover_game_installation",
        lambda _game_dir=None: GameDiscoveryResult(GameDiscoveryStatus.FOUND, installation),
    )
    monkeypatch.setattr(
        recharge_evidence,
        "validated_installed_build",
        lambda _installation: ValidatedInstalledBuild(build_id, installation.manifest_path),
    )


def _payload(
    monkeypatch: pytest.MonkeyPatch,
    installation: GameInstallation,
    capabilities: dict[str, ItemRechargeCapability],
) -> dict[str, object]:
    _install_context(monkeypatch, installation)
    context = resolve_recharge_source_context()
    assert context is not None
    return serialize_recharge_evidence(build_recharge_evidence(context, capabilities))


def test_valid_recharge_evidence_is_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installation = _installation(tmp_path / "steamapps" / "common" / "REPO")
    payload = _payload(
        monkeypatch,
        installation,
        {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE},
    )

    assert verify_recharge_evidence(payload, ("Item Rechargeable",)) == {
        "Item Rechargeable": ItemRechargeCapability.RECHARGEABLE
    }


def test_build_change_invalidates_recharge_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installation = _installation(tmp_path / "steamapps" / "common" / "REPO")
    payload = _payload(
        monkeypatch,
        installation,
        {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE},
    )
    _install_context(monkeypatch, installation, build_id="99999999")

    assert verify_recharge_evidence(payload, ("Item Rechargeable",)) is None


def test_installation_change_invalidates_recharge_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = _installation(tmp_path / "library-a" / "steamapps" / "common" / "REPO")
    payload = _payload(
        monkeypatch,
        first,
        {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE},
    )
    second = _installation(tmp_path / "library-b" / "steamapps" / "common" / "REPO")
    _install_context(monkeypatch, second)

    assert verify_recharge_evidence(payload, ("Item Rechargeable",)) is None


def test_resources_change_invalidates_recharge_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installation = _installation(tmp_path / "steamapps" / "common" / "REPO")
    payload = _payload(
        monkeypatch,
        installation,
        {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE},
    )
    resources = installation.root / "REPO_Data" / "resources.assets"
    resources.write_bytes(b"resources changed")

    assert verify_recharge_evidence(payload, ("Item Rechargeable",)) is None


def test_global_managers_change_invalidates_recharge_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installation = _installation(tmp_path / "steamapps" / "common" / "REPO")
    payload = _payload(
        monkeypatch,
        installation,
        {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE},
    )
    globals_path = installation.root / "REPO_Data" / "globalgamemanagers.assets"
    globals_path.write_bytes(b"globals changed")

    assert verify_recharge_evidence(payload, ("Item Rechargeable",)) is None


def test_uncovered_or_non_exact_item_set_invalidates_recharge_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installation = _installation(tmp_path / "steamapps" / "common" / "REPO")
    payload = _payload(
        monkeypatch,
        installation,
        {
            "Item Rechargeable": ItemRechargeCapability.RECHARGEABLE,
            "Item Other": ItemRechargeCapability.NOT_RECHARGEABLE,
        },
    )

    assert verify_recharge_evidence(payload, ("Item Missing",)) is None
    assert verify_recharge_evidence(payload, ("Item Rechargeable",)) is None


def test_malformed_partial_or_wrong_version_evidence_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installation = _installation(tmp_path / "steamapps" / "common" / "REPO")
    payload = _payload(
        monkeypatch,
        installation,
        {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE},
    )

    assert verify_recharge_evidence({"version": 1}, ("Item Rechargeable",)) is None
    payload["version"] = 2
    assert verify_recharge_evidence(payload, ("Item Rechargeable",)) is None
