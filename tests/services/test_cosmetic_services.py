from copy import deepcopy

import pytest

from repo_save_editor.core.schema import SaveSchemaError
from repo_save_editor.services.cosmetics.discovery import discover_cosmetics
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.mutations import (
    CosmeticMutationError,
    clear_all_presets,
    lock_all_cosmetics,
    remove_cosmetic_ownership,
    unlock_all_cosmetics,
    unlock_cosmetic,
)
from repo_save_editor.services.cosmetics.policy import (
    CATALOG_UNAVAILABLE_REASON,
    OUTSIDE_MUTATION_TRUST_REASON,
    PROVEN_MUTATION_IDS,
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


def test_discovery_projects_installed_owned_locked_and_unknown_ids() -> None:
    catalog = _catalog(names=("Long Sleeve", "Short Sleeve", "Monkey"))
    data = _meta_save(history=[1, 999], unlocks=[1, 999, 999], presets=[{"slots": [1]}])

    view = discover_cosmetics(data, catalog)

    assert view.known_catalog_count == 3
    assert view.known_owned_count == 1
    assert view.known_locked_count == 2
    assert view.saved_preset_count == 1
    assert view.unknown_owned_ids == (999,)
    assert [cosmetic.display_name for cosmetic in view.cosmetics[:3]] == [
        "Long Sleeve",
        "Short Sleeve",
        "Monkey",
    ]
    assert view.cosmetics[1].owned is True
    assert view.cosmetics[1].cosmetic_type == 1
    assert view.cosmetics[1].rarity == 1
    assert view.cosmetics[1].status == 1
    assert view.cosmetics[1].mutation_eligible is True
    assert view.cosmetics[-1].display_name == "Cosmetic #999"
    assert view.cosmetics[-1].known is False
    assert view.cosmetics[-1].cosmetic_type is None
    assert view.cosmetics[-1].rarity is None
    assert view.cosmetics[-1].status is None
    assert view.cosmetics[-1].mutation_eligible is False


def test_duplicate_installed_names_remain_distinct_canonical_ids() -> None:
    catalog = _catalog(names=("Same Name", "Same Name", "Other"))

    view = discover_cosmetics(_meta_save(unlocks=[1]), catalog)

    assert [(item.cosmetic_id, item.display_name) for item in view.cosmetics[:2]] == [
        (0, "Same Name"),
        (1, "Same Name"),
    ]
    assert view.cosmetics[0].owned is False
    assert view.cosmetics[1].owned is True


def test_discovery_without_catalog_fails_safe_to_unknown_read_only_ownership() -> None:
    view = discover_cosmetics(_meta_save(history=[27, 999], unlocks=[27, 999]), None)

    assert view.known_catalog_count == 0
    assert view.known_owned_count == 0
    assert view.known_locked_count == 0
    assert view.unknown_owned_ids == (27, 999)
    assert all(not cosmetic.known for cosmetic in view.cosmetics)
    assert view.capabilities.can_read_cosmetics is True
    assert view.capabilities.can_unlock_cosmetic is False
    assert view.capabilities.can_unlock_all is False
    assert view.capabilities.can_remove_ownership is False


def test_save_owned_id_absent_from_installed_catalog_is_unknown_and_preserved() -> None:
    view = discover_cosmetics(_meta_save(history=[27], unlocks=[27]), _catalog(count=3))

    assert view.unknown_owned_ids == (27,)
    assert view.cosmetics[-1].known is False
    assert "absent from the installed catalog" in (view.cosmetics[-1].removal_blocked_reason or "")


def test_future_installed_id_is_known_but_outside_mutation_trust() -> None:
    catalog = _catalog(count=548)
    view = discover_cosmetics(_meta_save(history=[547], unlocks=[547]), catalog)

    future = view.cosmetics[547]
    assert future.cosmetic_id == 547
    assert future.known is True
    assert future.owned is True
    assert future.mutation_eligible is False
    assert future.removal_blocked_reason == OUTSIDE_MUTATION_TRUST_REASON


def test_discovery_does_not_count_empty_preset_slots_as_saved_presets() -> None:
    view = discover_cosmetics(_meta_save(presets=[[] for _ in range(28)]), _catalog(count=3))

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
    catalog = _catalog()

    assert unlock_cosmetic(data, 28, catalog) is True
    assert unlock_cosmetic(data, 28, catalog) is False

    assert data["cosmeticHistory"]["value"] == [27, 999, 28]
    assert data["cosmeticUnlocks"]["value"] == [27, 999, 28]
    assert {key: data[key] for key in preserved} == preserved


def test_mutations_use_canonical_integer_ids_not_display_metadata() -> None:
    data = _meta_save()
    catalog = _catalog(names=("Same Name", "Same Name", "Other"))

    with pytest.raises(CosmeticMutationError, match="canonical integer"):
        unlock_cosmetic(data, "Same Name", catalog)

    assert unlock_cosmetic(data, 1, catalog) is True
    assert data["cosmeticUnlocks"]["value"] == [1]


def test_unlock_all_uses_installed_intersection_without_deleting_unknowns() -> None:
    data = _meta_save(history=[999, 2], unlocks=[999, 2])
    catalog = _catalog(count=3)

    assert unlock_all_cosmetics(data, catalog) is True
    assert unlock_all_cosmetics(data, catalog) is False

    assert data["cosmeticHistory"]["value"] == [999, 2, 0, 1]
    assert data["cosmeticUnlocks"]["value"] == [999, 2, 0, 1]


def test_unlock_all_does_not_broaden_to_future_discovered_ids() -> None:
    data = _meta_save()
    catalog = _catalog(count=548)

    assert unlock_all_cosmetics(data, catalog) is True

    unlocks = data["cosmeticUnlocks"]["value"]
    assert set(unlocks) == set(PROVEN_MUTATION_IDS)
    assert 547 not in unlocks


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

    assert lock_all_cosmetics(data, _catalog()) is True
    assert lock_all_cosmetics(data, _catalog()) is False

    assert data["cosmeticHistory"]["value"] == [999]
    assert data["cosmeticUnlocks"]["value"] == [999]


def test_lock_all_preserves_installed_future_ids_outside_trust() -> None:
    data = _meta_save(history=[27, 547], unlocks=[27, 547])
    catalog = _catalog(count=548)

    assert lock_all_cosmetics(data, catalog) is True

    assert data["cosmeticHistory"]["value"] == [547]
    assert data["cosmeticUnlocks"]["value"] == [547]


def test_lock_all_is_atomic_when_any_mutation_eligible_cosmetic_is_referenced() -> None:
    data = _meta_save(history=[27, 28], unlocks=[27, 28], equipped=[28])
    before = deepcopy(data)

    with pytest.raises(CosmeticMutationError, match="equipped"):
        lock_all_cosmetics(data, _catalog())

    assert data == before


def test_remove_ownership_removes_only_exact_unreferenced_id() -> None:
    data = _meta_save(history=[27, 28, 999], unlocks=[27, 28, 999])
    preserved = deepcopy(
        {key: data[key] for key in data if key not in {"cosmeticHistory", "cosmeticUnlocks"}}
    )

    assert remove_cosmetic_ownership(data, 28, _catalog()) is True
    assert remove_cosmetic_ownership(data, 28, _catalog()) is False

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
        remove_cosmetic_ownership(data, 28, _catalog())

    assert data == before


def test_mutations_reject_installed_future_ids_outside_proven_trust() -> None:
    data = _meta_save(history=[547], unlocks=[547])
    catalog = _catalog(count=548)

    with pytest.raises(CosmeticMutationError, match="proven mutation trust"):
        unlock_cosmetic(data, 547, catalog)
    with pytest.raises(CosmeticMutationError, match="proven mutation trust"):
        remove_cosmetic_ownership(data, 547, catalog)


def test_mutations_reject_trusted_id_when_absent_from_installed_catalog() -> None:
    data = _meta_save(history=[27], unlocks=[27])
    catalog = _catalog(count=3)

    with pytest.raises(CosmeticMutationError, match="absent from the installed catalog"):
        remove_cosmetic_ownership(data, 27, catalog)

    assert data["cosmeticUnlocks"]["value"] == [27]


def test_unavailable_catalog_disables_ownership_mutation_without_touching_save() -> None:
    data = _meta_save(history=[27], unlocks=[27])
    before = deepcopy(data)

    with pytest.raises(CosmeticMutationError, match="catalog is unavailable"):
        unlock_cosmetic(data, 28, None)
    with pytest.raises(CosmeticMutationError, match="catalog is unavailable"):
        lock_all_cosmetics(data, None)

    assert CATALOG_UNAVAILABLE_REASON.startswith("Installed cosmetic catalog")
    assert data == before
