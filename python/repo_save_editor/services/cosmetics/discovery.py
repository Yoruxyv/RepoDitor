"""Evidence-backed MetaSave cosmetic ownership discovery."""

from __future__ import annotations

from repo_save_editor.core.types import SaveData
from repo_save_editor.services.cosmetics.models import (
    Cosmetic,
    CosmeticCapabilities,
    CosmeticsView,
    InstalledCosmeticMetadata,
)
from repo_save_editor.services.cosmetics.policy import (
    ABSENT_FROM_CATALOG_REASON,
    mutation_block_reason,
    mutation_eligible_ids,
)
from repo_save_editor.services.cosmetics.schema import (
    get_ownership_lists,
    get_saved_preset_count,
    removal_blocked_reason,
)


def discover_cosmetics(
    data: SaveData,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> CosmeticsView:
    """Project save ownership against a proven installed catalog.

    Installed names and other metadata are presentation only. Canonical identity remains
    the integer catalog position, while mutation authority is evaluated independently.
    """
    _history, unlocks = get_ownership_lists(data)
    owned = set(unlocks)
    catalog = installed_catalog or ()
    installed_ids = frozenset(entry.cosmetic_id for entry in catalog)
    eligible_ids = frozenset(mutation_eligible_ids(installed_catalog))

    cosmetics: list[Cosmetic] = []
    for metadata in catalog:
        cosmetic_id = metadata.cosmetic_id
        blocked_reason = mutation_block_reason(cosmetic_id, installed_catalog)
        if cosmetic_id in owned and blocked_reason is None:
            blocked_reason = removal_blocked_reason(data, cosmetic_id)
        cosmetics.append(
            Cosmetic(
                cosmetic_id=cosmetic_id,
                display_name=metadata.asset_name,
                cosmetic_type=metadata.cosmetic_type,
                rarity=metadata.rarity,
                status=metadata.status,
                owned=cosmetic_id in owned,
                known=True,
                mutation_eligible=cosmetic_id in eligible_ids,
                removal_blocked_reason=blocked_reason,
            )
        )

    unknown_owned_ids = tuple(
        dict.fromkeys(cosmetic_id for cosmetic_id in unlocks if cosmetic_id not in installed_ids)
    )
    cosmetics.extend(
        Cosmetic(
            cosmetic_id=cosmetic_id,
            display_name=f"Cosmetic #{cosmetic_id}",
            cosmetic_type=None,
            rarity=None,
            status=None,
            owned=True,
            known=False,
            mutation_eligible=False,
            removal_blocked_reason=ABSENT_FROM_CATALOG_REASON,
        )
        for cosmetic_id in unknown_owned_ids
    )

    known_owned_count = len(owned & installed_ids)
    mutation_available = bool(eligible_ids)
    return CosmeticsView(
        known_catalog_count=len(catalog),
        known_owned_count=known_owned_count,
        known_locked_count=len(catalog) - known_owned_count,
        saved_preset_count=get_saved_preset_count(data),
        cosmetics=tuple(cosmetics),
        unknown_owned_ids=unknown_owned_ids,
        capabilities=CosmeticCapabilities(
            can_read_cosmetics=True,
            can_unlock_cosmetic=mutation_available,
            can_unlock_all=mutation_available,
            can_remove_ownership=mutation_available,
        ),
    )
