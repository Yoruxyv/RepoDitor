from copy import deepcopy

import pytest

from repo_save_editor.core.schema import SaveSchemaError
from repo_save_editor.services.cosmetics.discovery import KNOWN_COSMETIC_IDS, discover_cosmetics
from repo_save_editor.services.cosmetics.mutations import (
    CosmeticMutationError,
    clear_all_presets,
    lock_all_cosmetics,
    remove_cosmetic_ownership,
    unlock_all_cosmetics,
    unlock_cosmetic,
)
from repo_save_editor.services.cosmetics.schema import validate_meta_save


def _meta_save(
    *,
    history: list[int] | None = None,
    unlocks: list[int] | None = None,
    equipped: object = None,
    presets: object = None,
    color_presets: object = None,
) -> dict[str, object]:
    return {
        "cosmeticHistory": {"value": list(history or [])},
        "cosmeticUnlocks": {"value": list(unlocks or [])},
        "cosmeticEquipped": {"value": [] if equipped is None else equipped},
        "cosmeticPresets": {"value": [] if presets is None else presets},
        "cosmeticTokens": {"value": [99]},
        "colorsEquipped": {"value": [4]},
        "colorPresets": {"value": [[1, 2, 3]] if color_presets is None else color_presets},
    }


def test_discovery_projects_known_catalog_and_preserves_unknown_owned_ids() -> None:
    data = _meta_save(history=[27, 999], unlocks=[27, 999, 999], presets=[{"slots": [27]}])

    view = discover_cosmetics(data)

    assert tuple(range(547)) == KNOWN_COSMETIC_IDS
    assert view.known_catalog_count == 547
    assert view.known_owned_count == 1
    assert view.known_locked_count == 546
    assert view.saved_preset_count == 1
    assert view.unknown_owned_ids == (999,)
    assert view.cosmetics[27].owned is True
    assert view.cosmetics[-1].display_name == "Cosmetic #999"
    assert view.cosmetics[-1].known is False


def test_discovery_does_not_count_empty_preset_slots_as_saved_presets() -> None:
    view = discover_cosmetics(_meta_save(presets=[[] for _ in range(28)]))

    assert view.saved_preset_count == 0


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"cosmeticHistory": {"value": []}, "cosmeticUnlocks": []},
        {"cosmeticHistory": {"value": []}, "cosmeticUnlocks": {"value": "27"}},
        {"cosmeticHistory": {"value": []}, "cosmeticUnlocks": {"value": [True]}},
    ],
)
def test_validation_rejects_malformed_ownership_without_normalizing(data) -> None:
    before = deepcopy(data)

    with pytest.raises(SaveSchemaError):
        validate_meta_save(data)

    assert data == before


def test_unlock_is_idempotent_and_changes_only_proven_ownership_lists() -> None:
    data = _meta_save(history=[27, 999], unlocks=[27, 999])
    preserved = deepcopy(
        {key: data[key] for key in data if key not in {"cosmeticHistory", "cosmeticUnlocks"}}
    )

    assert unlock_cosmetic(data, 28) is True
    assert unlock_cosmetic(data, 28) is False

    assert data["cosmeticHistory"]["value"] == [27, 999, 28]
    assert data["cosmeticUnlocks"]["value"] == [27, 999, 28]
    assert {key: data[key] for key in preserved} == preserved


def test_unlock_all_composes_missing_ids_without_sorting_or_deleting_unknowns() -> None:
    data = _meta_save(history=[999, 2], unlocks=[999, 2])

    assert unlock_all_cosmetics(data) is True
    assert unlock_all_cosmetics(data) is False

    history = data["cosmeticHistory"]["value"]
    unlocks = data["cosmeticUnlocks"]["value"]
    assert history[:2] == [999, 2]
    assert unlocks[:2] == [999, 2]
    assert set(history) == {*range(547), 999}
    assert set(unlocks) == {*range(547), 999}
    assert len(history) == len(set(history)) == 548
    assert len(unlocks) == len(set(unlocks)) == 548


def test_clear_all_presets_preserves_outer_lengths_and_unrelated_meta_save_fields() -> None:
    data = _meta_save(
        history=[27, 999],
        unlocks=[27, 999],
        equipped=[27],
        presets=[[27], [], {"slots": [999]}],
        color_presets=[[1, 2, 3], [4], []],
    )
    data["futureField"] = {"value": {"keep": True}}
    preserved = deepcopy(
        {
            key: data[key]
            for key in (
                "cosmeticHistory",
                "cosmeticUnlocks",
                "cosmeticEquipped",
                "cosmeticTokens",
                "colorsEquipped",
                "futureField",
            )
        }
    )
    cosmetic_length = len(data["cosmeticPresets"]["value"])
    color_length = len(data["colorPresets"]["value"])

    assert clear_all_presets(data) is True
    assert clear_all_presets(data) is False

    assert data["cosmeticPresets"]["value"] == [[], [], []]
    assert data["colorPresets"]["value"] == [[], [], []]
    assert len(data["cosmeticPresets"]["value"]) == cosmetic_length
    assert len(data["colorPresets"]["value"]) == color_length
    assert {key: data[key] for key in preserved} == preserved


def test_clear_all_presets_clears_remaining_color_preset_data() -> None:
    data = _meta_save(presets=[[], []], color_presets=[[1], [2]])

    assert clear_all_presets(data) is True
    assert data["cosmeticPresets"]["value"] == [[], []]
    assert data["colorPresets"]["value"] == [[], []]


def test_lock_all_composes_proven_removals_and_preserves_unknown_ids() -> None:
    data = _meta_save(history=[27, 28, 999], unlocks=[27, 28, 999])

    assert lock_all_cosmetics(data) is True
    assert lock_all_cosmetics(data) is False

    assert data["cosmeticHistory"]["value"] == [999]
    assert data["cosmeticUnlocks"]["value"] == [999]


def test_lock_all_is_atomic_when_any_owned_cosmetic_is_referenced() -> None:
    data = _meta_save(history=[27, 28], unlocks=[27, 28], equipped=[28])
    before = deepcopy(data)

    with pytest.raises(CosmeticMutationError, match="equipped"):
        lock_all_cosmetics(data)

    assert data == before


def test_remove_ownership_removes_only_exact_unreferenced_id() -> None:
    data = _meta_save(history=[27, 28, 999], unlocks=[27, 28, 999])
    preserved = deepcopy(
        {key: data[key] for key in data if key not in {"cosmeticHistory", "cosmeticUnlocks"}}
    )

    assert remove_cosmetic_ownership(data, 28) is True
    assert remove_cosmetic_ownership(data, 28) is False

    assert data["cosmeticHistory"]["value"] == [27, 999]
    assert data["cosmeticUnlocks"]["value"] == [27, 999]
    assert {key: data[key] for key in preserved} == preserved


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("cosmeticEquipped", {"slot": 28}, "equipped"),
        ("cosmeticPresets", [{"slots": [27, 28]}], "preset"),
    ],
)
def test_remove_ownership_is_blocked_when_referenced(field, value, message) -> None:
    data = _meta_save(history=[28], unlocks=[28])
    data[field]["value"] = value
    before = deepcopy(data)

    with pytest.raises(CosmeticMutationError, match=message):
        remove_cosmetic_ownership(data, 28)

    assert data == before


def test_mutations_reject_unknown_future_ids() -> None:
    data = _meta_save(history=[999], unlocks=[999])

    with pytest.raises(CosmeticMutationError, match="0 through 546"):
        unlock_cosmetic(data, 999)
    with pytest.raises(CosmeticMutationError, match="0 through 546"):
        remove_cosmetic_ownership(data, 999)
