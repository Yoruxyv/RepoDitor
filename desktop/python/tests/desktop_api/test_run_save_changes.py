import re
from copy import deepcopy

import pytest

from repo_save_editor.core.schema import SaveSchemaError
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api import run_save_changes as run_save_changes_module
from repo_save_editor.desktop_api.run_save_changes import (
    MAX_CHANGES,
    apply_run_save_changes,
    requested_refill_item_types,
)


def _currency_change(after: object = 20) -> dict[str, object]:
    return {"feature": "run", "entity": "run", "field": "currency", "after": after}


def test_upgrade_draft_contract_keeps_dynamic_keys_players_and_unrelated_data(sample_save):
    sample_save["dictionaryOfDictionaries"]["value"]["playerUpgradeFutureBoost"] = {"222": 7}
    before = deepcopy(sample_save)
    changes = [
        {"feature": "upgrades", "entity": "111", "field": "playerUpgradeStrength", "after": 3},
        {
            "feature": "upgrades",
            "entity": "222",
            "field": "playerUpgradeFutureBoost",
            "after": 2147483647,
        },
    ]
    apply_run_save_changes(sample_save, changes)
    expected = deepcopy(before)
    expected["dictionaryOfDictionaries"]["value"]["playerUpgradeStrength"]["111"] = 3
    expected["dictionaryOfDictionaries"]["value"]["playerUpgradeFutureBoost"]["222"] = 2147483647
    assert sample_save == expected


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        (None, "One to 512 pending changes are required."),
        ([], "One to 512 pending changes are required."),
        (
            [_currency_change() for _ in range(MAX_CHANGES + 1)],
            "One to 512 pending changes are required.",
        ),
        (
            [{"feature": "run", "entity": "run", "field": "currency"}],
            "A pending change did not match the supported format.",
        ),
        (
            [{"feature": 1, "entity": "run", "field": "currency", "after": 20}],
            "A pending change identifier is invalid.",
        ),
        (
            [_currency_change(), _currency_change(21)],
            "Duplicate pending changes are not supported.",
        ),
        (
            [_currency_change(True)],
            "A whole-number change value is required.",
        ),
        (
            [
                {
                    "feature": "run",
                    "entity": "run",
                    "field": "resumeLocation",
                    "after": 1,
                }
            ],
            "Resume Location must be text.",
        ),
        (
            [
                {
                    "feature": "future",
                    "entity": "run",
                    "field": "currency",
                    "after": 20,
                }
            ],
            "A pending change is not supported by this save.",
        ),
        (
            [
                {
                    "feature": "players",
                    "entity": "111",
                    "field": "currency",
                    "after": 20,
                }
            ],
            "A pending change is not supported by this save.",
        ),
        (
            [
                {
                    "feature": "run",
                    "entity": "111",
                    "field": "currency",
                    "after": 20,
                }
            ],
            "A pending change is not supported by this save.",
        ),
        (
            [
                {
                    "feature": "upgrades",
                    "entity": "111",
                    "field": "futureUpgrade",
                    "after": 2,
                }
            ],
            "A pending change is not supported by this save.",
        ),
    ],
)
def test_change_envelope_validation_contract(
    sample_save: SaveData,
    changes: object,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=rf"^{re.escape(message)}$"):
        apply_run_save_changes(deepcopy(sample_save), changes)


def test_requested_refill_item_types_preserves_first_seen_unique_item_types() -> None:
    changes: object = [
        {
            "feature": "advanced",
            "entity": "Item Gun Tranq/1",
            "field": "refillToFull",
            "after": True,
        },
        {
            "feature": "advanced",
            "entity": "Item Gun Tranq/2",
            "field": "refillToFull",
            "after": True,
        },
        {
            "feature": "advanced",
            "entity": "Item Melee Inflatable Hammer/3",
            "field": "refillToFull",
            "after": True,
        },
        {
            "feature": "advanced",
            "entity": "not-an-item-key",
            "field": "refillToFull",
            "after": True,
        },
        {
            "feature": "advanced",
            "entity": "Item Gun Tranq/4",
            "field": "refillToFull",
            "after": False,
        },
    ]

    assert requested_refill_item_types(changes) == (
        "Item Gun Tranq",
        "Item Melee Inflatable Hammer",
    )


def test_apply_run_save_changes_keeps_final_semantic_validation(
    sample_save: SaveData,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = deepcopy(sample_save)
    validated: list[SaveData] = []

    def record_validation(value: SaveData) -> None:
        validated.append(value)

    monkeypatch.setattr(run_save_changes_module, "validate_run_save", record_validation)

    apply_run_save_changes(data, [_currency_change(20)])

    assert validated == [data]


def test_object_shaped_run_stat_is_rejected_without_mutating_source(sample_save: SaveData) -> None:
    data = deepcopy(sample_save)
    data["dictionaryOfDictionaries"]["value"]["runStats"]["currency"] = {"amount": 12}
    original = deepcopy(data)

    with pytest.raises(SaveSchemaError, match=r"Run stat 'currency'.*supported integer"):
        apply_run_save_changes(data, [_currency_change(20)])

    assert data == original


def test_object_shaped_health_is_rejected_without_mutating_source(sample_save: SaveData) -> None:
    data = deepcopy(sample_save)
    data["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = {"hp": 80}
    original = deepcopy(data)

    with pytest.raises(SaveSchemaError, match=r"Player health for '111'.*supported integer"):
        apply_run_save_changes(
            data,
            [{"feature": "players", "entity": "111", "field": "health", "after": 95}],
        )

    assert data == original


def test_string_upgrade_value_is_rejected_without_mutating_source(sample_save: SaveData) -> None:
    data = deepcopy(sample_save)
    data["dictionaryOfDictionaries"]["value"]["playerUpgradeStrength"]["111"] = "2"
    original = deepcopy(data)

    with pytest.raises(
        SaveSchemaError,
        match=r"Upgrade 'playerUpgradeStrength' for player '111'.*supported integer",
    ):
        apply_run_save_changes(
            data,
            [
                {
                    "feature": "upgrades",
                    "entity": "111",
                    "field": "playerUpgradeStrength",
                    "after": 3,
                }
            ],
        )

    assert data == original


@pytest.mark.parametrize("target", ["run", "health", "upgrade"])
def test_boolean_existing_scalar_values_are_not_accepted_as_integers(
    sample_save: SaveData,
    target: str,
) -> None:
    data = deepcopy(sample_save)
    dictionaries = data["dictionaryOfDictionaries"]["value"]
    if target == "run":
        dictionaries["runStats"]["currency"] = True
        changes = [_currency_change(20)]
    elif target == "health":
        dictionaries["playerHealth"]["111"] = True
        changes = [{"feature": "players", "entity": "111", "field": "health", "after": 95}]
    else:
        dictionaries["playerUpgradeStrength"]["111"] = True
        changes = [
            {
                "feature": "upgrades",
                "entity": "111",
                "field": "playerUpgradeStrength",
                "after": 3,
            }
        ]
    original = deepcopy(data)

    with pytest.raises(SaveSchemaError, match="supported integer"):
        apply_run_save_changes(data, changes)

    assert data == original


def test_supported_integer_scalars_still_mutate_through_production_path(
    sample_save: SaveData,
) -> None:
    data = deepcopy(sample_save)

    apply_run_save_changes(
        data,
        [
            {"feature": "players", "entity": "111", "field": "health", "after": 95},
            {
                "feature": "upgrades",
                "entity": "111",
                "field": "playerUpgradeStrength",
                "after": 3,
            },
            _currency_change(20),
        ],
    )

    dictionaries = data["dictionaryOfDictionaries"]["value"]
    assert dictionaries["playerHealth"]["111"] == 95
    assert dictionaries["playerUpgradeStrength"]["111"] == 3
    assert dictionaries["runStats"]["currency"] == 20


def test_health_mutation_rejects_above_max_without_changing_unknown_data(
    sample_save: SaveData,
) -> None:
    data = deepcopy(sample_save)
    data["futurePlayerData"] = {"111": {"futureFlag": "preserve-me"}}
    original = deepcopy(data)

    with pytest.raises(ValueError, match="between 0 and 100"):
        apply_run_save_changes(
            data,
            [{"feature": "players", "entity": "111", "field": "health", "after": 101}],
        )

    assert data == original


def test_valid_health_mutation_preserves_unrelated_and_unknown_player_data(
    sample_save: SaveData,
) -> None:
    data = deepcopy(sample_save)
    data["futurePlayerData"] = {"111": {"futureFlag": "preserve-me"}}
    unrelated = deepcopy(data["futurePlayerData"])
    original_health = deepcopy(data["dictionaryOfDictionaries"]["value"]["playerHealth"])

    apply_run_save_changes(
        data,
        [{"feature": "players", "entity": "111", "field": "health", "after": 100}],
    )

    health = data["dictionaryOfDictionaries"]["value"]["playerHealth"]
    assert health["111"] == 100
    assert {key: value for key, value in health.items() if key != "111"} == {
        key: value for key, value in original_health.items() if key != "111"
    }
    assert data["futurePlayerData"] == unrelated


def test_health_mutation_uses_max_health_after_upgrade_changes(sample_save: SaveData) -> None:
    data = deepcopy(sample_save)
    dictionaries = data["dictionaryOfDictionaries"]["value"]
    dictionaries["playerUpgradeHealth"] = {"111": 0}

    apply_run_save_changes(
        data,
        [
            {"feature": "players", "entity": "111", "field": "health", "after": 120},
            {
                "feature": "upgrades",
                "entity": "111",
                "field": "playerUpgradeHealth",
                "after": 1,
            },
        ],
    )

    assert dictionaries["playerHealth"]["111"] == 120


def test_health_mutation_rejects_max_reduced_in_the_same_batch(sample_save: SaveData) -> None:
    data = deepcopy(sample_save)
    dictionaries = data["dictionaryOfDictionaries"]["value"]
    dictionaries["playerUpgradeHealth"] = {"111": 1}

    with pytest.raises(ValueError, match="between 0 and 100"):
        apply_run_save_changes(
            data,
            [
                {"feature": "players", "entity": "111", "field": "health", "after": 120},
                {
                    "feature": "upgrades",
                    "entity": "111",
                    "field": "playerUpgradeHealth",
                    "after": 0,
                },
            ],
        )


def test_missing_supported_upgrade_entry_can_still_be_created_through_production_path(
    sample_save: SaveData,
) -> None:
    data = deepcopy(sample_save)
    assert "222" not in data["dictionaryOfDictionaries"]["value"]["playerUpgradeStrength"]

    apply_run_save_changes(
        data,
        [
            {
                "feature": "upgrades",
                "entity": "222",
                "field": "playerUpgradeStrength",
                "after": 4,
            }
        ],
    )

    assert data["dictionaryOfDictionaries"]["value"]["playerUpgradeStrength"]["222"] == 4
