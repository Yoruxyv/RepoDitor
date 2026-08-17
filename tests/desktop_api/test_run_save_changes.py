from copy import deepcopy

import pytest

from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api import run_save_changes as run_save_changes_module
from repo_save_editor.desktop_api.run_save_changes import (
    MAX_CHANGES,
    apply_run_save_changes,
    requested_refill_item_types,
)


def _currency_change(after: object = 20) -> dict[str, object]:
    return {"feature": "run", "entity": "run", "field": "currency", "after": after}


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
    with pytest.raises(ValueError) as exc_info:
        apply_run_save_changes(deepcopy(sample_save), changes)

    assert str(exc_info.value) == message


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
