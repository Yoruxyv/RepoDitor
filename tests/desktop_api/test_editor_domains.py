import base64
import json
from copy import deepcopy
from pathlib import Path

from repo_save_editor.desktop_api.advanced import get_advanced_save
from repo_save_editor.desktop_api.maps import list_maps
from repo_save_editor.desktop_api.run import get_run_state
from repo_save_editor.desktop_api.upgrades import list_upgrades
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

    result = list_upgrades(save_path.parent.name, tmp_path)

    assert result == {
        "ok": True,
        "upgrades": [
            {
                "key": "playerUpgradeStrength",
                "label": "Strength",
                "known": True,
                "values": [
                    {"playerId": "111", "value": 2},
                    {"playerId": "222", "value": 0},
                ],
            },
            {
                "key": "playerUpgradeMoonBoots",
                "label": "Moon Boots",
                "known": False,
                "values": [
                    {"playerId": "111", "value": 0},
                    {"playerId": "222", "value": 7},
                ],
            },
        ],
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
            },
            {
                "internalName": "Modded Moon",
                "displayName": "Modded Moon",
                "knownLabel": False,
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
    dictionaries["runStats"]["chargingStationCharge"] = 10
    source = deepcopy(sample_save)
    save_path = _write_save(tmp_path, sample_save)
    before = save_path.read_bytes()

    result = get_advanced_save(save_path.parent.name, tmp_path)

    assert result["ok"] is True
    advanced = result["advanced"]
    assert set(advanced) == {
        "domains",
        "items",
        "runValues",
        "unlinkedChargeEntryCount",
    }
    assert advanced["items"] == [
        {
            "saveKey": "Item Melee Inflatable Hammer/1",
            "name": "Melee Inflatable Hammer",
            "instanceId": "1",
            "storedCharge": 99,
        }
    ]
    assert advanced["runValues"] == [
        {
            "saveKey": "chargingStationCharge",
            "label": "Charging station charge",
            "value": 10,
            "status": "partially_confirmed",
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


def test_editor_reads_reuse_stable_missing_save_failure(tmp_path: Path) -> None:
    save_id = "REPO_SAVE_2026_08_08_10_20_30"
    assert list_upgrades(save_id, tmp_path)["error"]["code"] == "save_missing"
    assert get_run_state(save_id, tmp_path)["error"]["code"] == "save_missing"
    assert get_advanced_save(save_id, tmp_path)["error"]["code"] == "save_missing"
