import json
from copy import deepcopy
from pathlib import Path

import pytest

from repo_save_editor.services.items.discovery import discover_advanced_save
from repo_save_editor.services.items.models import AdvancedSaveError, ItemChargeState
from repo_save_editor.services.items.mutations import refill_item_to_full

EVIDENCE_PAIR = Path(__file__).parents[1] / "fixtures" / "advanced_charge_pair.json"


def _advanced_save(sample_save):
    data = deepcopy(sample_save)
    dictionaries = data["dictionaryOfDictionaries"]["value"]
    dictionaries.update(
        {
            "item": {
                "Item Cart Medium/1": 2,
                "Item Cart Medium/2": 2,
                "Item Health Pack Medium/2": 23,
                "Item Melee Inflatable Hammer/1": 21,
            },
            "itemStatBattery": {"Item Melee Inflatable Hammer/1": 99},
            "itemBatteryUpgrades": {},
            "itemsUpgradesPurchased": {"Item Upgrade Player Health": 18},
            "itemsPurchased": {"Item Cart Medium": 4},
            "itemsPurchasedTotal": {
                "Item Cart Medium": 4,
                "Item Upgrade Player Health": 18,
            },
        }
    )
    dictionaries["runStats"].update({"chargingStationCharge": 10, "chargingStationChargeTotal": 95})
    return data


def test_discovers_confirmed_items_charge_and_read_only_capabilities(sample_save) -> None:
    data = _advanced_save(sample_save)
    before = deepcopy(data)

    advanced = discover_advanced_save(data)

    assert data == before
    assert [(item.name, item.instance_id) for item in advanced.items] == [
        ("Cart Medium", "1"),
        ("Cart Medium", "2"),
        ("Health Pack Medium", "2"),
        ("Melee Inflatable Hammer", "1"),
    ]
    hammer = advanced.items[-1]
    assert hammer.save_key == "Item Melee Inflatable Hammer/1"
    assert hammer.stored_charge == 99
    assert hammer.charge_state is ItemChargeState.STORED
    assert all(item.charge_state is ItemChargeState.UNKNOWN for item in advanced.items[:-1])
    assert advanced.unlinked_charge_entry_count == 0
    assert [(value.save_key, value.value) for value in advanced.run_values] == [
        ("chargingStationCharge", 10),
        ("chargingStationChargeTotal", 95),
    ]

    domains = {domain.key: domain for domain in advanced.domains}
    assert domains["items"].status == "confirmed"
    assert domains["items"].entry_count == 4
    assert domains["items"].can_read is True
    assert domains["currentCharge"].status == "partially_confirmed"
    assert domains["currentCharge"].can_refill_to_full is True
    assert domains["batteryUpgrades"].status == "unknown"
    assert domains["batteryUpgrades"].entry_count == 0
    assert domains["batteryUpgrades"].can_read is False
    assert domains["purchasedUpgrades"].entry_count == 1
    assert domains["purchasedItemsTotal"].entry_count == 2
    assert all(
        not capability
        for domain in advanced.domains
        for capability in (
            domain.can_edit,
            domain.can_add,
            domain.can_delete,
            domain.can_duplicate,
        )
    )
    assert all(
        domain.can_refill_to_full is (domain.key == "currentCharge") for domain in advanced.domains
    )


def test_refill_removes_only_the_exact_charge_leaf(sample_save) -> None:
    data = _advanced_save(sample_save)
    before = deepcopy(data)

    assert refill_item_to_full(data, "Item Melee Inflatable Hammer/1") is True

    before_dictionaries = before["dictionaryOfDictionaries"]["value"]
    after_dictionaries = data["dictionaryOfDictionaries"]["value"]
    assert after_dictionaries["itemStatBattery"] == {}
    before_dictionaries["itemStatBattery"] = {}
    assert data == before


def test_refill_is_a_safe_noop_when_charge_is_absent(sample_save) -> None:
    data = _advanced_save(sample_save)
    del data["dictionaryOfDictionaries"]["value"]["itemStatBattery"][
        "Item Melee Inflatable Hammer/1"
    ]
    before = deepcopy(data)

    assert refill_item_to_full(data, "Item Melee Inflatable Hammer/1") is False
    assert data == before


@pytest.mark.parametrize(
    ("save_key", "charge_container"),
    [
        ("Item Missing/1", {}),
        ("bad-key", {}),
        ("Item Melee Inflatable Hammer/1", []),
        ("Item Melee Inflatable Hammer/1", {"Item Melee Inflatable Hammer/1": 1.5}),
    ],
)
def test_refill_rejects_missing_items_and_malformed_charge(
    sample_save, save_key, charge_container
) -> None:
    data = _advanced_save(sample_save)
    data["dictionaryOfDictionaries"]["value"]["itemStatBattery"] = charge_container

    with pytest.raises(AdvancedSaveError):
        refill_item_to_full(data, save_key)


def test_charge_evidence_is_sparse_after_one_hammer_use(sample_save) -> None:
    evidence = json.loads(EVIDENCE_PAIR.read_text(encoding="utf-8"))
    before = deepcopy(sample_save)
    after = deepcopy(sample_save)
    for data, projection in ((before, evidence["before"]), (after, evidence["after"])):
        dictionaries = data["dictionaryOfDictionaries"]["value"]
        dictionaries["item"] = projection["item"]
        dictionaries["itemStatBattery"] = projection["itemStatBattery"]
        dictionaries["runStats"].update(projection["runStats"])

    before_item = discover_advanced_save(before).items[0]
    after_items = discover_advanced_save(after).items
    after_hammer = next(item for item in after_items if item.save_key == before_item.save_key)

    assert before_item.save_key == after_hammer.save_key == "Item Melee Inflatable Hammer/1"
    assert before_item.stored_charge == 99
    assert before_item.charge_state is ItemChargeState.STORED
    assert after_hammer.stored_charge is None
    assert after_hammer.charge_state is ItemChargeState.DEFAULT_FULL
    assert {item.save_key for item in after_items} - {before_item.save_key} == {
        "Item Staff Torque/1"
    }
    assert before["dictionaryOfDictionaries"]["value"]["runStats"]["save level"] == 2
    assert after["dictionaryOfDictionaries"]["value"]["runStats"]["save level"] == 0


def test_distinguishes_missing_from_supported_empty_structures(sample_save) -> None:
    missing = discover_advanced_save(sample_save)
    missing_domains = {domain.key: domain for domain in missing.domains}
    assert missing_domains["items"].entry_count is None
    assert missing_domains["items"].can_read is False

    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {}
    dictionaries["itemStatBattery"] = {}
    empty = discover_advanced_save(sample_save)
    empty_domains = {domain.key: domain for domain in empty.domains}
    assert empty_domains["items"].entry_count == 0
    assert empty_domains["items"].can_read is True
    assert empty_domains["currentCharge"].entry_count == 0
    assert empty.items == ()


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("item", []),
        ("item", None),
        ("item", {"bad-key": 1}),
        ("item", {"Item Cart Medium/1": True}),
        ("itemStatBattery", {"Item Cart Medium/1": 1.5}),
        ("itemBatteryUpgrades", []),
        ("itemsUpgradesPurchased", {"Item Upgrade Player Health": "1"}),
        ("itemsPurchased", {1: 2}),
        ("itemsPurchasedTotal", {"Item Cart Medium": False}),
    ],
)
def test_rejects_malformed_observed_structures(sample_save, key, value) -> None:
    sample_save["dictionaryOfDictionaries"]["value"][key] = value

    with pytest.raises(AdvancedSaveError):
        discover_advanced_save(sample_save)


def test_rejects_malformed_observed_run_value(sample_save) -> None:
    sample_save["dictionaryOfDictionaries"]["value"]["runStats"]["chargingStationCharge"] = 1.5

    with pytest.raises(AdvancedSaveError):
        discover_advanced_save(sample_save)


def test_ignores_unknown_containers_and_reports_unlinked_charge(sample_save) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {"Item Cart Medium/1": 2}
    dictionaries["itemStatBattery"] = {"Item Modded Tool/7": 44}
    dictionaries["futureAdvancedData"] = {"opaque": object()}

    advanced = discover_advanced_save(sample_save)

    assert advanced.items[0].stored_charge is None
    assert advanced.items[0].charge_state is ItemChargeState.UNKNOWN
    assert advanced.unlinked_charge_entry_count == 1


def test_absent_charge_is_full_only_for_evidence_backed_item_names(sample_save) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {
        "Item Gun Tranq/1": 15,
        "Item Melee Inflatable Hammer/2": 21,
        "Item Cart Medium/3": 2,
    }
    dictionaries["itemStatBattery"] = {}

    states = {
        item.save_key: item.charge_state for item in discover_advanced_save(sample_save).items
    }

    assert states == {
        "Item Cart Medium/3": ItemChargeState.UNKNOWN,
        "Item Gun Tranq/1": ItemChargeState.DEFAULT_FULL,
        "Item Melee Inflatable Hammer/2": ItemChargeState.DEFAULT_FULL,
    }
    assert ItemChargeState.NOT_APPLICABLE not in states.values()
