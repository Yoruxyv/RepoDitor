from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from unittest.mock import Mock

import pytest

from repo_save_editor.core.crypto import decrypt_save, encrypt_save
from repo_save_editor.desktop_api import cosmetics as cosmetics_api
from repo_save_editor.desktop_api.cosmetics import get_cosmetics, save_cosmetics
from repo_save_editor.services.cosmetics import presentation_catalog as presentation
from repo_save_editor.services.cosmetics.installed_catalog import _catalog_payload
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.installed_build import artwork_installation
from repo_save_editor.services.game.local_data import get_repo_local_data_roots
from repo_save_editor.services.game.processes import GameProcessStatus
from tests.services.test_installed_cosmetic_catalog import _build_install


def test_default_meta_path_uses_shared_repo_local_data_root(
    tmp_path: Path,
    monkeypatch,
) -> None:
    roots = get_repo_local_data_roots(lambda: tmp_path / "LocalLow")
    assert roots is not None
    monkeypatch.setattr(cosmetics_api, "get_repo_local_data_roots", lambda: roots)

    assert cosmetics_api._meta_path(None) == roots.meta_save


def test_missing_local_data_root_fails_soft_without_home_guess(monkeypatch) -> None:
    monkeypatch.setattr(cosmetics_api, "get_repo_local_data_roots", lambda: None)

    result = get_cosmetics(catalog_loader=lambda: None)

    assert result == {
        "ok": False,
        "error": {
            "code": "backend_unavailable",
            "message": "R.E.P.O. local data location could not be resolved.",
        },
    }


def _game_closed() -> GameProcessStatus:
    return GameProcessStatus.NOT_RUNNING


def _catalog(
    count: int = 547,
    *,
    names: tuple[str, ...] | None = None,
) -> tuple[InstalledCosmeticMetadata, ...]:
    if names is not None:
        count = len(names)
    return tuple(
        InstalledCosmeticMetadata(
            cosmetic_id=cosmetic_id,
            asset_name=(names[cosmetic_id] if names is not None else f"Cosmetic #{cosmetic_id}"),
            cosmetic_type=cosmetic_id % 4,
            rarity=cosmetic_id % 3,
            status=1,
        )
        for cosmetic_id in range(count)
    )


def _catalog_loader() -> tuple[InstalledCosmeticMetadata, ...]:
    return _catalog()


def _paths(tmp_path: Path) -> tuple[Path, Path]:
    save_root = tmp_path / "Repo" / "saves"
    meta_path = save_root.parent / "MetaSave.es3"
    return save_root, meta_path


def _meta_save() -> dict[str, object]:
    return {
        "cosmeticHistory": {"value": [27, 999]},
        "cosmeticUnlocks": {"value": [27, 999]},
        "cosmeticEquipped": {"value": []},
        "cosmeticPresets": {"value": [[] for _ in range(28)]},
        "cosmeticTokens": {"value": [7]},
        "colorsEquipped": {"value": [4]},
        "colorPresets": {"value": [[1, 2, 3]]},
    }


def _write_fixture(tmp_path: Path) -> tuple[Path, Path]:
    save_root, meta_path = _paths(tmp_path)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_bytes(encrypt_save(_meta_save()))
    return save_root, meta_path


def test_get_cosmetics_returns_only_typed_projection(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()

    result = get_cosmetics(
        save_root, catalog_loader=_catalog_loader, mutation_catalog_loader=_catalog_loader
    )

    assert result["ok"] is True
    view = result["cosmetics"]
    assert view["fingerprint"] == sha256(original).hexdigest()
    assert view["catalogAvailable"] is True
    assert view["knownCatalogCount"] == 547
    assert view["knownOwnedCount"] == 1
    assert view["savedPresetCount"] == 0
    assert view["unknownOwnedIds"] == [999]
    assert view["cosmetics"][27] == {
        "id": 27,
        "displayName": "Cosmetic #27",
        "type": 3,
        "rarity": 0,
        "status": 1,
        "owned": True,
        "known": True,
        "state": "owned",
        "mutationEligible": True,
        "removalBlockedReason": None,
        "iconKey": None,
    }
    assert "cosmeticTokens" not in view
    assert meta_path.read_bytes() == original


def test_get_cosmetics_never_uses_game_generated_icon_keys(tmp_path: Path) -> None:
    save_root, _meta_path = _write_fixture(tmp_path)
    catalog = list(_catalog())
    catalog[27] = InstalledCosmeticMetadata(
        cosmetic_id=27,
        asset_name="Duplicate display name",
        cosmetic_type=3,
        rarity=0,
        status=1,
        icon_cache_key="cosmetic-object-27.png",
    )

    result = get_cosmetics(
        save_root,
        catalog_loader=lambda: tuple(catalog),
        mutation_catalog_loader=lambda: tuple(catalog),
    )

    assert result["cosmetics"]["cosmetics"][27]["iconKey"] is None


def test_save_cosmetics_creates_exact_backup_and_reopens_output(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()
    before = decrypt_save(original)

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "28", "field": "owned", "after": True}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=_catalog_loader,
    )

    assert result["ok"] is True
    backup = Path(result["result"]["backupPath"])
    assert backup.read_bytes() == original
    reopened = decrypt_save(meta_path.read_bytes())
    assert reopened["cosmeticHistory"]["value"] == [27, 999, 28]
    assert reopened["cosmeticUnlocks"]["value"] == [27, 999, 28]
    for key in before.keys() - {"cosmeticHistory", "cosmeticUnlocks"}:
        assert reopened[key] == before[key]


def test_save_cosmetics_rejects_stale_source_without_backup(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    opened = meta_path.read_bytes()
    externally_changed = deepcopy(_meta_save())
    externally_changed["cosmeticTokens"]["value"] = [8]
    meta_path.write_bytes(encrypt_save(externally_changed))
    external_bytes = meta_path.read_bytes()

    result = save_cosmetics(
        sha256(opened).hexdigest(),
        [{"feature": "cosmetics", "entity": "28", "field": "owned", "after": True}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=_catalog_loader,
    )

    assert result["error"]["code"] == "save_stale"
    assert meta_path.read_bytes() == external_bytes
    assert not list(meta_path.parent.glob("MetaSave.es3.bak-*"))


def test_validation_failure_never_modifies_or_backs_up_meta_save(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "999", "field": "owned", "after": False}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=_catalog_loader,
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert meta_path.read_bytes() == original
    assert not list(meta_path.parent.glob("MetaSave.es3.bak-*"))


def test_unlock_all_cannot_be_mixed_with_individual_changes(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [
            {"feature": "cosmetics", "entity": "known", "field": "unlockAll", "after": True},
            {"feature": "cosmetics", "entity": "28", "field": "owned", "after": False},
        ],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=_catalog_loader,
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert meta_path.read_bytes() == original
    assert not list(meta_path.parent.glob("MetaSave.es3.bak-*"))


def test_clear_all_presets_uses_safe_write_and_preserves_unrelated_fields(
    tmp_path: Path,
) -> None:
    save_root, meta_path = _paths(tmp_path)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    data = _meta_save()
    data["cosmeticPresets"]["value"] = [[27], [], [999]]
    data["colorPresets"]["value"] = [[1, 2], [3], []]
    data["futureField"] = {"value": {"keep": True}}
    meta_path.write_bytes(encrypt_save(data))
    original = meta_path.read_bytes()
    before = decrypt_save(original)

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "presets", "field": "clearAll", "after": True}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=_catalog_loader,
    )

    assert result["ok"] is True
    reopened = decrypt_save(meta_path.read_bytes())
    assert reopened["cosmeticPresets"]["value"] == [[], [], []]
    assert reopened["colorPresets"]["value"] == [[], [], []]
    assert len(reopened["cosmeticPresets"]["value"]) == len(before["cosmeticPresets"]["value"])
    assert len(reopened["colorPresets"]["value"]) == len(before["colorPresets"]["value"])
    for key in (
        "cosmeticHistory",
        "cosmeticUnlocks",
        "cosmeticEquipped",
        "cosmeticTokens",
        "colorsEquipped",
        "futureField",
    ):
        assert reopened[key] == before[key]
    assert result["result"]["cosmetics"]["savedPresetCount"] == 0
    assert Path(result["result"]["backupPath"]).read_bytes() == original


def test_lock_all_uses_the_existing_safe_write_pipeline(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "known", "field": "lockAll", "after": False}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=_catalog_loader,
    )

    assert result["ok"] is True
    reopened = decrypt_save(meta_path.read_bytes())
    assert reopened["cosmeticHistory"]["value"] == [999]
    assert reopened["cosmeticUnlocks"]["value"] == [999]
    assert Path(result["result"]["backupPath"]).read_bytes() == original


def test_missing_or_malformed_meta_save_fails_safely(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    meta_path.unlink()
    assert (
        get_cosmetics(save_root, catalog_loader=_catalog_loader)["error"]["code"] == "meta_missing"
    )

    meta_path.write_bytes(encrypt_save({"cosmeticHistory": {"value": []}}))
    assert (
        get_cosmetics(save_root, catalog_loader=_catalog_loader)["error"]["code"]
        == "save_unsupported"
    )


def test_game_running_blocks_cosmetics_write_before_backup_or_source_change(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "known", "field": "unlockAll", "after": True}],
        save_root,
        game_status_loader=lambda: GameProcessStatus.RUNNING,
        catalog_loader=_catalog_loader,
    )

    assert result["error"]["code"] == "game_running"
    assert meta_path.read_bytes() == original
    assert not list(meta_path.parent.glob("MetaSave.es3.bak-*"))


def test_game_start_after_early_check_blocks_cosmetics_write_before_persistence(
    tmp_path: Path, monkeypatch
) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()
    status_loader = Mock(side_effect=[GameProcessStatus.NOT_RUNNING, GameProcessStatus.RUNNING])
    overwrite = Mock(side_effect=AssertionError("overwrite must not be reached"))
    monkeypatch.setattr(cosmetics_api.EncryptedSaveRepository, "overwrite", overwrite)

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "known", "field": "unlockAll", "after": True}],
        save_root,
        game_status_loader=status_loader,
        catalog_loader=_catalog_loader,
    )

    assert result["ok"] is False
    assert result["error"]["code"] == "game_running"
    assert "result" not in result
    assert status_loader.call_count == 2
    overwrite.assert_not_called()
    assert meta_path.read_bytes() == original
    assert not list(meta_path.parent.glob("MetaSave.es3.bak-*"))


@pytest.mark.parametrize(
    ("final_status", "reason"),
    [
        (GameProcessStatus.NOT_RUNNING, None),
        (GameProcessStatus.RUNNING, "game_running"),
        (GameProcessStatus.UNKNOWN, "game_status_unknown"),
        ("query_error", "game_status_unknown"),
    ],
)
def test_cosmetics_write_rechecks_game_after_staged_verification(
    tmp_path, monkeypatch, final_status, reason
):
    save_root, path = _write_fixture(tmp_path)
    before = path.read_bytes()
    load = cosmetics_api.EncryptedSaveRepository.load
    verified = False
    observations = []

    def verify(repository, staging, *, directory=None):
        nonlocal verified
        data = load(repository, staging, directory=directory)
        verified = True
        return data

    def status():
        observations.append(verified)
        if verified and final_status == "query_error":
            raise OSError("private process query failure")
        return final_status if verified else GameProcessStatus.NOT_RUNNING

    monkeypatch.setattr(cosmetics_api.EncryptedSaveRepository, "load", verify)
    result = save_cosmetics(
        sha256(before).hexdigest(),
        [{"feature": "cosmetics", "entity": "known", "field": "unlockAll", "after": True}],
        save_root,
        game_status_loader=status,
        catalog_loader=_catalog_loader,
    )

    assert observations == [False, False, True]
    assert next(path.parent.glob("MetaSave.es3.bak-*")).read_bytes() == before
    assert not list(path.parent.glob("*.tmp"))
    if reason is None:
        assert result["ok"] is True
        assert 0 in decrypt_save(path.read_bytes())["cosmeticHistory"]["value"]
    else:
        assert result["ok"] is False
        assert result["error"]["code"] == reason
        assert "result" not in result
        assert "private" not in str(result)
        assert path.read_bytes() == before


def test_get_cosmetics_round_trips_dynamic_metadata_and_duplicate_names(tmp_path: Path) -> None:
    save_root, _meta_path_value = _write_fixture(tmp_path)
    catalog = _catalog(names=("Duplicate Name", "Duplicate Name", "Monkey"))

    result = get_cosmetics(save_root, catalog_loader=lambda: catalog)

    assert result["ok"] is True
    view = result["cosmetics"]
    assert view["catalogAvailable"] is True
    assert view["knownCatalogCount"] == 3
    assert [
        (item["id"], item["displayName"], item["type"], item["rarity"], item["status"])
        for item in view["cosmetics"][:3]
    ] == [
        (0, "Duplicate Name", 0, 0, 1),
        (1, "Duplicate Name", 1, 1, 1),
        (2, "Monkey", 2, 2, 1),
    ]
    assert view["cosmetics"][0]["state"] == "locked"
    assert view["cosmetics"][1]["state"] == "locked"
    assert view["unknownOwnedIds"] == [27, 999]


def test_get_cosmetics_reports_explicit_degraded_catalog_without_metadata(tmp_path: Path) -> None:
    save_root, _meta_path_value = _write_fixture(tmp_path)

    result = get_cosmetics(save_root, catalog_loader=lambda: None)

    assert result["ok"] is True
    view = result["cosmetics"]
    assert view["catalogAvailable"] is False
    assert view["knownCatalogCount"] == 0
    assert view["knownOwnedCount"] == 0
    assert view["knownLockedCount"] == 0
    assert view["unknownOwnedIds"] == [27, 999]
    assert view["capabilities"] == {
        "canReadCosmetics": True,
        "canUnlockCosmetic": False,
        "canUnlockAll": False,
        "canRemoveOwnership": False,
        "canClearPresets": False,
    }
    assert view["cosmetics"][0] == {
        "id": 27,
        "displayName": "Cosmetic #27",
        "type": None,
        "rarity": None,
        "status": None,
        "owned": True,
        "known": False,
        "state": "unknown",
        "mutationEligible": False,
        "removalBlockedReason": (
            "Cosmetic ID is absent from the installed catalog and is preserved read-only."
        ),
        "iconKey": None,
    }


def test_empty_catalog_serializes_as_degraded_unknown_read_only(tmp_path: Path) -> None:
    save_root, _meta_path_value = _write_fixture(tmp_path)

    result = get_cosmetics(save_root, catalog_loader=lambda: ())

    assert result["ok"] is True
    view = result["cosmetics"]
    assert view["catalogAvailable"] is False
    assert view["knownCatalogCount"] == 0
    assert view["knownOwnedCount"] == 0
    assert view["knownLockedCount"] == 0
    assert view["capabilities"] == {
        "canReadCosmetics": True,
        "canUnlockCosmetic": False,
        "canUnlockAll": False,
        "canRemoveOwnership": False,
        "canClearPresets": False,
    }
    assert view["unknownOwnedIds"] == [27, 999]
    assert [
        (item["id"], item["state"], item["mutationEligible"]) for item in view["cosmetics"]
    ] == [
        (27, "unknown", False),
        (999, "unknown", False),
    ]


def test_unavailable_catalog_blocks_ownership_write_without_backup(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "28", "field": "owned", "after": True}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=lambda: None,
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert "catalog is unavailable" in result["error"]["message"]
    assert meta_path.read_bytes() == original
    assert not list(meta_path.parent.glob("MetaSave.es3.bak-*"))


def test_clear_presets_remains_available_when_catalog_is_unavailable(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    data = decrypt_save(meta_path.read_bytes())
    data["cosmeticPresets"]["value"] = [[27], []]
    data["colorPresets"]["value"] = [[1], []]
    meta_path.write_bytes(encrypt_save(data))
    original = meta_path.read_bytes()

    view = get_cosmetics(
        save_root, catalog_loader=lambda: None, mutation_catalog_loader=lambda: None
    )["cosmetics"]
    assert view["savedPresetCount"] > 0
    assert view["capabilities"]["canClearPresets"] is True
    assert view["capabilities"]["canUnlockAll"] is False

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "presets", "field": "clearAll", "after": True}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=lambda: None,
    )

    assert result["ok"] is True
    reopened = decrypt_save(meta_path.read_bytes())
    assert reopened["cosmeticPresets"]["value"] == [[], []]
    assert reopened["colorPresets"]["value"] == [[], []]
    assert result["result"]["cosmetics"]["catalogAvailable"] is False
    assert result["result"]["cosmetics"]["knownCatalogCount"] == 0
    assert result["result"]["cosmetics"]["capabilities"]["canClearPresets"] is True


def test_noncanonical_numeric_entity_is_rejected_before_mutation(tmp_path: Path) -> None:
    save_root, meta_path = _write_fixture(tmp_path)
    original = meta_path.read_bytes()

    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": "028", "field": "owned", "after": True}],
        save_root,
        game_status_loader=_game_closed,
        catalog_loader=_catalog_loader,
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert "canonical cosmetic ID" in result["error"]["message"]
    assert meta_path.read_bytes() == original
    assert not list(meta_path.parent.glob("MetaSave.es3.bak-*"))


@pytest.mark.parametrize("cosmetic_id", range(547, 557))
def test_current_cosmetic_individual_unlock_remove_and_encrypted_reopen(tmp_path, cosmetic_id):
    root, path = _write_fixture(tmp_path)

    def loader():
        return _catalog(557)

    before = decrypt_save(path.read_bytes())
    original = path.read_bytes()
    result = save_cosmetics(
        sha256(original).hexdigest(),
        [{"feature": "cosmetics", "entity": str(cosmetic_id), "field": "owned", "after": True}],
        root,
        catalog_loader=loader,
        game_status_loader=_game_closed,
    )
    assert result["ok"] is True
    assert Path(result["result"]["backupPath"]).read_bytes() == original
    reopened = decrypt_save(path.read_bytes())
    for key in ("cosmeticHistory", "cosmeticUnlocks"):
        assert reopened[key]["value"] == [27, 999, cosmetic_id]
    for key in before.keys() - {"cosmeticHistory", "cosmeticUnlocks"}:
        assert reopened[key] == before[key]
    result = save_cosmetics(
        sha256(path.read_bytes()).hexdigest(),
        [{"feature": "cosmetics", "entity": str(cosmetic_id), "field": "owned", "after": False}],
        root,
        catalog_loader=loader,
        game_status_loader=_game_closed,
    )
    assert result["ok"] is True
    assert decrypt_save(path.read_bytes()) == before


@pytest.fixture
def new_build(tmp_path, monkeypatch):
    root, _level, _target, manifest = _build_install(
        tmp_path / "installed", unity_version="6000.3.17f1", build_id="26407089"
    )
    installation = artwork_installation(root)
    assert installation is not None
    monkeypatch.setattr(presentation, "artwork_installation", lambda *_args: installation)
    monkeypatch.setattr(presentation, "discover_baked_artwork", lambda *_args, **_kwargs: None)
    return manifest


@pytest.mark.usefixtures("new_build")
def test_new_build_displays_metadata_without_projecting_write_capabilities(tmp_path):
    root, path = _write_fixture(tmp_path)
    data = decrypt_save(path.read_bytes())
    data["cosmeticPresets"]["value"] = [[27], []]
    data["colorPresets"]["value"] = [[1], []]
    path.write_bytes(encrypt_save(data))
    before = path.read_bytes()
    result = get_cosmetics(root)
    assert result["ok"] is True
    view = result["cosmetics"]
    assert view["savedPresetCount"] > 0
    assert view["knownCatalogCount"] == 3
    assert [(c["id"], c["displayName"]) for c in view["cosmetics"][:3]] == [
        (0, "Hat"),
        (1, "Hat"),
        (2, "Glasses"),
    ]
    assert view["capabilities"] == {
        "canReadCosmetics": True,
        "canUnlockCosmetic": False,
        "canUnlockAll": False,
        "canRemoveOwnership": False,
        "canClearPresets": False,
    }
    assert all(not c["mutationEligible"] and c["removalBlockedReason"] for c in view["cosmetics"])
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    "change",
    [
        {"entity": "0", "field": "owned", "after": True},
        {"entity": "27", "field": "owned", "after": False},
        {"entity": "known", "field": "unlockAll", "after": True},
        {"entity": "known", "field": "lockAll", "after": False},
        {"entity": "presets", "field": "clearAll", "after": True},
    ],
)
@pytest.mark.usefixtures("new_build")
def test_default_writer_denies_every_new_build_mutation_before_backup(tmp_path, change):
    root, path = _write_fixture(tmp_path)
    before = path.read_bytes()
    assert get_cosmetics(root)["cosmetics"]["catalogAvailable"] is True
    result = save_cosmetics(
        sha256(before).hexdigest(),
        [{"feature": "cosmetics", **change}],
        root,
        game_status_loader=_game_closed,
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "save_validation_failed"
    assert "not approved" in result["error"]["message"]
    assert path.read_bytes() == before
    assert not list(path.parent.glob("MetaSave.es3.bak-*"))
    assert not list(path.parent.glob("*.tmp"))


def test_legacy_writer_revalidates_build_before_final_game_query(tmp_path, new_build, monkeypatch):
    root, path = _write_fixture(tmp_path)
    before = path.read_bytes()
    new_build.write_bytes(new_build.read_bytes().replace(b"26407089", b"26294889"))
    installation = artwork_installation(new_build.parent / "common/REPO")
    assert installation is not None
    monkeypatch.setattr(presentation, "artwork_installation", lambda *_args: installation)
    monkeypatch.setattr(
        presentation,
        "discover_baked_artwork",
        lambda *_args, **_kwargs: {"cosmeticCatalog": _catalog_payload(_catalog_loader())},
    )
    original = cosmetics_api.EncryptedSaveRepository.load
    events = []

    def staged(repository, source, *, directory=None):
        data = original(repository, source, directory=directory)
        events.append("staged")
        new_build.write_bytes(new_build.read_bytes().replace(b"26294889", b"26407089"))
        return data

    def stopped():
        events.append("game")
        return GameProcessStatus.NOT_RUNNING

    monkeypatch.setattr(cosmetics_api.EncryptedSaveRepository, "load", staged)
    result = save_cosmetics(
        sha256(before).hexdigest(),
        [{"feature": "cosmetics", "entity": "0", "field": "owned", "after": True}],
        root,
        game_status_loader=stopped,
    )
    assert result["ok"] is False
    assert events == ["game", "game", "staged"]
    assert path.read_bytes() == before
    assert next(path.parent.glob("MetaSave.es3.bak-*")).read_bytes() == before
