import base64
import json
from copy import deepcopy
from pathlib import Path

import pytest

from repo_save_editor.core.crypto import encrypt_save
from repo_save_editor.desktop_api.discovery.maps import list_maps
from repo_save_editor.desktop_api.items import get_advanced_save
from repo_save_editor.desktop_api.player.upgrades import list_upgrades
from repo_save_editor.desktop_api.run import get_run_state
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.items.recharge_evidence import (
    InstalledFileIdentity,
    RechargeEvidence,
)
from repo_save_editor.services.player.upgrades import (
    UpgradePresentation,
    UpgradePresentationSource,
)
from repo_save_editor.storage.repository import SaveRepository


def _write_save(root: Path, data: dict[str, object]) -> Path:
    save_id = "REPO_SAVE_2026_08_08_10_20_30"
    save_path = root / save_id / f"{save_id}.es3"
    SaveRepository(root).save_as(save_path, data)
    return save_path


def _write_catalog(game_root: Path, text: str) -> Path:
    catalog = game_root / "REPO_Data/StreamingAssets/aa/catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text(
        json.dumps({"m_KeyDataString": base64.b64encode(text.encode()).decode()}),
        encoding="utf-8",
    )
    return catalog


def test_upgrades_are_dynamic_friendly_and_read_only(tmp_path: Path, sample_save) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["playerUpgradeMoonBoots"] = {"222": 7}
    save_path = _write_save(tmp_path, sample_save)
    before = save_path.read_bytes()

    result = list_upgrades(
        save_path.parent.name,
        tmp_path,
        presentation_loader=lambda _keys: {
            "playerUpgradeStrength": UpgradePresentation(
                "Strength", UpgradePresentationSource.INSTALLED, gameplay_cap=10
            )
        },
    )

    assert result == {
        "ok": True,
        "upgrades": [
            {
                "key": "playerUpgradeStrength",
                "label": "Strength",
                "presentationSource": "installed",
                "iconKey": None,
                "gameplayCap": 10,
                "values": [
                    {"playerId": "111", "value": 2},
                    {"playerId": "222", "value": 0},
                ],
            },
            {
                "key": "playerUpgradeMoonBoots",
                "label": "Moon Boots",
                "presentationSource": "humanized",
                "iconKey": None,
                "gameplayCap": None,
                "values": [
                    {"playerId": "111", "value": 0},
                    {"playerId": "222", "value": 7},
                ],
            },
        ],
    }
    assert save_path.read_bytes() == before


def test_upgrade_reads_preserve_values_above_caps_and_refresh_membership(
    tmp_path: Path, sample_save
) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["playerUpgradeStrength"]["111"] = 2_147_483_648
    save_path = _write_save(tmp_path, sample_save)
    before = save_path.read_bytes()
    result = list_upgrades(
        save_path.parent.name,
        tmp_path,
        presentation_loader=lambda _keys: {
            "playerUpgradeStrength": UpgradePresentation(
                "Strength", UpgradePresentationSource.INSTALLED, gameplay_cap=10
            )
        },
    )
    assert result["upgrades"][0]["gameplayCap"] == 10
    assert result["upgrades"][0]["values"][0]["value"] == 2_147_483_648
    assert save_path.read_bytes() == before

    del dictionaries["playerUpgradeStrength"]
    dictionaries["playerUpgradeFutureBoost"] = {"222": 37}
    save_path.write_bytes(encrypt_save(sample_save))
    changed = save_path.read_bytes()
    result = list_upgrades(save_path.parent.name, tmp_path, presentation_loader=lambda _keys: {})
    assert [item["key"] for item in result["upgrades"]] == ["playerUpgradeFutureBoost"]
    assert result["upgrades"][0]["values"] == [
        {"playerId": "111", "value": 0},
        {"playerId": "222", "value": 37},
    ]
    assert save_path.read_bytes() == changed


def test_upgrade_membership_ignores_non_dictionaries_and_empty_prefix(
    tmp_path: Path, sample_save
) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    del dictionaries["playerUpgradeStrength"]
    dictionaries.update({"playerUpgrade": {"111": 2}, "playerUpgradeMalformed": "bad"})
    save_path = _write_save(tmp_path, sample_save)
    before = save_path.read_bytes()
    assert list_upgrades(save_path.parent.name, tmp_path, presentation_loader=lambda _keys: {}) == {
        "ok": True,
        "upgrades": [],
    }
    assert save_path.read_bytes() == before


def test_run_state_uses_friendly_values_and_preserves_unknown_resume(
    tmp_path: Path, sample_save
) -> None:
    sample_save["dictionaryOfDictionaries"]["value"]["runStats"]["save level"] = 9
    save_path = _write_save(tmp_path, sample_save)

    result = get_run_state(save_path.parent.name, tmp_path)

    assert result["ok"] is True
    assert result["run"] == {
        "stats": [
            {"key": "level", "label": "Level", "value": 5},
            {"key": "currency", "label": "Currency", "value": 12},
            {"key": "lives", "label": "Lives", "value": 3},
            {"key": "totalHaul", "label": "Total Haul", "value": 500},
        ],
        "resumeLocation": {
            "value": "Unknown (9)",
            "options": ["Normal", "Shop / Service Station", "Unknown (9)"],
        },
    }


@pytest.mark.parametrize(
    "value", [-9_007_199_254_740_991, -2_147_483_649, 0, 2_147_483_648, 9_007_199_254_740_991]
)
def test_run_reads_keep_signed_values_optional_stats_and_fresh_source(
    tmp_path: Path, sample_save, value: int
) -> None:
    stats = sample_save["dictionaryOfDictionaries"]["value"]["runStats"]
    stats.update({"level": 2_147_483_647, "currency": value, "save level": 9})
    del stats["lives"]
    del stats["totalHaul"]
    save_path = _write_save(tmp_path, sample_save)
    original = save_path.read_bytes()
    result = get_run_state(save_path.parent.name, tmp_path)
    assert result["run"]["stats"] == [
        {"key": "level", "label": "Level", "value": 2_147_483_648},
        {"key": "currency", "label": "Currency", "value": value},
    ]
    assert result["run"]["resumeLocation"] == {
        "value": "Unknown (9)",
        "options": ["Normal", "Shop / Service Station", "Unknown (9)"],
    }
    assert save_path.read_bytes() == original
    stats.update({"currency": 37, "lives": -3, "totalHaul": 0, "save level": 1})
    save_path.write_bytes(encrypt_save(sample_save))
    changed = save_path.read_bytes()
    refreshed = get_run_state(save_path.parent.name, tmp_path)
    assert [stat["value"] for stat in refreshed["run"]["stats"]] == [2_147_483_648, 37, -3, 0]
    assert refreshed["run"]["resumeLocation"]["value"] == "Shop / Service Station"
    assert save_path.read_bytes() == changed


def test_maps_report_available_unavailable_and_feature_errors(tmp_path: Path) -> None:
    missing = list_maps(tmp_path / "missing")
    assert missing == {"ok": True, "available": False, "catalogPath": None, "maps": []}

    game_root = tmp_path / "game"
    catalog = _write_catalog(
        game_root,
        "Level/Arctic/Loading Graphics/a Level/Modded Moon/Loading Graphics/b",
    )
    assert list_maps(game_root) == {
        "ok": True,
        "available": True,
        "catalogPath": str(catalog),
        "maps": [
            {
                "internalName": "Arctic",
                "displayName": "McJannek Station",
                "knownLabel": True,
                "artworkRevision": None,
            },
            {
                "internalName": "Modded Moon",
                "displayName": "Modded Moon",
                "knownLabel": False,
                "artworkRevision": None,
            },
        ],
    }

    catalog.write_text("not json", encoding="utf-8")
    error = list_maps(game_root)
    assert error["ok"] is False
    assert error["error"]["code"] == "backend_unavailable"


def test_advanced_read_returns_narrow_evidence_backed_dto(tmp_path: Path, sample_save) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries.update(
        {
            "item": {"Item Melee Inflatable Hammer/1": 21},
            "itemStatBattery": {"Item Melee Inflatable Hammer/1": 99},
            "itemBatteryUpgrades": {},
            "itemsUpgradesPurchased": {"Item Upgrade Player Health": 18},
            "itemsPurchased": {"Item Melee Inflatable Hammer": 1},
            "itemsPurchasedTotal": {"Item Melee Inflatable Hammer": 1},
            "privateUnrelatedData": {"mustNotLeak": 123},
        }
    )
    source = deepcopy(sample_save)
    save_path = _write_save(tmp_path, sample_save)
    before = save_path.read_bytes()

    result = get_advanced_save(
        save_path.parent.name,
        tmp_path,
        capability_loader=lambda names: dict.fromkeys(names, ItemRechargeCapability.RECHARGEABLE),
    )

    assert result["ok"] is True
    advanced = result["advanced"]
    assert set(advanced) == {
        "domains",
        "items",
        "unlinkedChargeEntryCount",
    }
    assert advanced["items"] == [
        {
            "saveKey": "Item Melee Inflatable Hammer/1",
            "name": "Melee Inflatable Hammer",
            "instanceId": "1",
            "isUpgrade": False,
            "storedCharge": 99,
            "chargeState": "stored",
            "rechargeCapability": "rechargeable",
            "canRefillToFull": True,
            "iconKey": None,
        }
    ]
    capabilities = {domain["key"]: domain["capabilities"] for domain in advanced["domains"]}
    assert capabilities["currentCharge"] == {
        "canRead": True,
        "canEdit": False,
        "canAdd": False,
        "canDelete": False,
        "canDuplicate": False,
        "canRefillToFull": True,
    }
    assert all(
        not capability["canRefillToFull"]
        for key, capability in capabilities.items()
        if key != "currentCharge"
    )
    assert "privateUnrelatedData" not in json.dumps(result)
    assert sample_save == source
    assert save_path.read_bytes() == before


def test_advanced_read_rejects_malformed_structure(tmp_path: Path, sample_save) -> None:
    sample_save["dictionaryOfDictionaries"]["value"]["item"] = []
    save_path = _write_save(tmp_path, sample_save)

    result = get_advanced_save(save_path.parent.name, tmp_path)

    assert result == {
        "ok": False,
        "error": {
            "code": "save_unsupported",
            "message": "The selected save contains malformed advanced item data.",
        },
    }


@pytest.mark.parametrize("stored", [-9_007_199_254_740_991, 0, 9_007_199_254_740_991])
def test_advanced_projection_keeps_all_charge_states_and_refreshes_source(
    tmp_path: Path, sample_save, stored: int
) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries.update(
        {
            "item": {
                "Item Future Tool/1": 1,
                "Item Future Tool/2": 1,
                "Item Cart/3": 1,
                "Item Unknown/4": 1,
                "Item Unknown/5": 1,
            },
            "itemStatBattery": {
                "Item Future Tool/1": stored,
                "Item Unknown/5": 7,
                "Item Orphan/1": 8,
            },
        }
    )
    path = _write_save(tmp_path, sample_save)
    before = path.read_bytes()

    def read():
        return get_advanced_save(
            path.parent.name,
            tmp_path,
            capability_loader=lambda _names: {
                "Item Future Tool": ItemRechargeCapability.RECHARGEABLE,
                "Item Cart": ItemRechargeCapability.NOT_RECHARGEABLE,
            },
        )

    advanced = read()["advanced"]
    by_key = {item["saveKey"]: item for item in advanced["items"]}
    assert by_key["Item Future Tool/1"]["storedCharge"] == stored
    assert [
        by_key[key]["chargeState"]
        for key in [
            "Item Future Tool/1",
            "Item Future Tool/2",
            "Item Cart/3",
            "Item Unknown/4",
            "Item Unknown/5",
        ]
    ] == ["stored", "default_full", "not_applicable", "unknown", "stored"]
    assert by_key["Item Unknown/5"]["rechargeCapability"] == "unknown"
    assert by_key["Item Unknown/5"]["canRefillToFull"] is False
    assert advanced["unlinkedChargeEntryCount"] == 1
    assert len(advanced["domains"]) == 6
    assert path.read_bytes() == before
    dictionaries["itemStatBattery"]["Item Future Tool/1"] = 37
    path.write_bytes(encrypt_save(sample_save))
    changed = path.read_bytes()
    assert (
        next(
            item for item in read()["advanced"]["items"] if item["saveKey"] == "Item Future Tool/1"
        )["storedCharge"]
        == 37
    )
    assert path.read_bytes() == changed


def test_advanced_read_marks_matching_upgrade_item_for_internal_visual_resolution(
    tmp_path: Path, sample_save
) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {"Item Upgrade Player Grab Strength/1": 1}
    save_path = _write_save(tmp_path, sample_save)

    result = get_advanced_save(
        save_path.parent.name,
        tmp_path,
        capability_loader=lambda names: dict.fromkeys(
            names, ItemRechargeCapability.NOT_RECHARGEABLE
        ),
    )

    assert result["ok"] is True
    assert result["advanced"]["items"] == [
        {
            "saveKey": "Item Upgrade Player Grab Strength/1",
            "name": "Upgrade Player Grab Strength",
            "instanceId": "1",
            "isUpgrade": True,
            "storedCharge": None,
            "chargeState": "not_applicable",
            "rechargeCapability": "not_rechargeable",
            "canRefillToFull": False,
            "iconKey": None,
            "upgradeVisualKey": "playerUpgradeStrength",
        }
    ]


def test_advanced_read_returns_private_recharge_evidence_from_authoritative_metadata(
    tmp_path: Path, sample_save
) -> None:
    sample_save["dictionaryOfDictionaries"]["value"]["item"] = {"Item Gun Tranq/1": 15}
    save_path = _write_save(tmp_path, sample_save)
    source = InstalledFileIdentity("C:/REPO/resources.assets", 10, 20, 30, 40)
    evidence = RechargeEvidence(
        version=1,
        installation_root="C:/REPO",
        manifest_path="C:/Steam/appmanifest_3241660.acf",
        build_id="23363152",
        resources=source,
        global_managers=InstalledFileIdentity("C:/REPO/globalgamemanagers.assets", 11, 21, 31, 41),
        capabilities=(("Item Gun Tranq", ItemRechargeCapability.RECHARGEABLE),),
    )

    result = get_advanced_save(
        save_path.parent.name,
        tmp_path,
        metadata_evidence_loader=lambda names: (
            {
                name: InstalledItemMetadata(ItemRechargeCapability.RECHARGEABLE, None)
                for name in names
            },
            evidence,
        ),
    )

    assert result["ok"] is True
    assert result["rechargeEvidence"] == {
        "version": 1,
        "installationRoot": "C:/REPO",
        "manifestPath": "C:/Steam/appmanifest_3241660.acf",
        "buildId": "23363152",
        "resources": {
            "path": "C:/REPO/resources.assets",
            "size": "10",
            "mtimeNs": "20",
            "device": "30",
            "inode": "40",
        },
        "globalManagers": {
            "path": "C:/REPO/globalgamemanagers.assets",
            "size": "11",
            "mtimeNs": "21",
            "device": "31",
            "inode": "41",
        },
        "capabilities": [{"itemName": "Item Gun Tranq", "capability": "rechargeable"}],
    }


def test_advanced_read_never_requests_regular_item_locallow_artwork(
    tmp_path: Path, sample_save
) -> None:
    sample_save["dictionaryOfDictionaries"]["value"]["item"] = {
        "Item Melee Inflatable Hammer/1": 21
    }
    save_path = _write_save(tmp_path, sample_save)

    result = get_advanced_save(
        save_path.parent.name,
        tmp_path,
        metadata_loader=lambda names: {
            name: InstalledItemMetadata(
                ItemRechargeCapability.RECHARGEABLE, "item melee inflatable hammer.png"
            )
            for name in names
        },
        icon_availability_loader=lambda _domain, _keys: pytest.fail(
            "Regular items must not probe LocalLow"
        ),
    )

    assert result["advanced"]["items"][0]["iconKey"] is None


def test_editor_reads_reuse_stable_missing_save_failure(tmp_path: Path) -> None:
    save_id = "REPO_SAVE_2026_08_08_10_20_30"
    assert list_upgrades(save_id, tmp_path)["error"]["code"] == "save_missing"
    assert get_run_state(save_id, tmp_path)["error"]["code"] == "save_missing"
    assert get_advanced_save(save_id, tmp_path)["error"]["code"] == "save_missing"
