"""Evidence-backed MetaSave cosmetic ownership discovery."""

from __future__ import annotations

from repo_save_editor.core.types import SaveData
from repo_save_editor.services.cosmetics.models import (
    Cosmetic,
    CosmeticCapabilities,
    CosmeticsView,
)
from repo_save_editor.services.cosmetics.schema import (
    get_ownership_lists,
    removal_blocked_reason,
)

KNOWN_COSMETIC_IDS = tuple(range(547))
KNOWN_COSMETIC_ID_SET = frozenset(KNOWN_COSMETIC_IDS)


def discover_cosmetics(data: SaveData) -> CosmeticsView:
    """Project MetaSave ownership without exposing decrypted save data."""
    _history, unlocks = get_ownership_lists(data)
    owned = set(unlocks)
    cosmetics = [
        Cosmetic(
            cosmetic_id=cosmetic_id,
            display_name=f"Cosmetic #{cosmetic_id}",
            owned=cosmetic_id in owned,
            known=True,
            removal_blocked_reason=(
                removal_blocked_reason(data, cosmetic_id) if cosmetic_id in owned else None
            ),
        )
        for cosmetic_id in KNOWN_COSMETIC_IDS
    ]
    unknown_owned_ids = tuple(
        dict.fromkeys(
            cosmetic_id for cosmetic_id in unlocks if cosmetic_id not in KNOWN_COSMETIC_ID_SET
        )
    )
    cosmetics.extend(
        Cosmetic(
            cosmetic_id=cosmetic_id,
            display_name=f"Cosmetic #{cosmetic_id}",
            owned=True,
            known=False,
            removal_blocked_reason="Unknown or future cosmetics are preserved read-only.",
        )
        for cosmetic_id in unknown_owned_ids
    )
    known_owned_count = len(owned & KNOWN_COSMETIC_ID_SET)
    return CosmeticsView(
        known_catalog_count=len(KNOWN_COSMETIC_IDS),
        known_owned_count=known_owned_count,
        known_locked_count=len(KNOWN_COSMETIC_IDS) - known_owned_count,
        cosmetics=tuple(cosmetics),
        unknown_owned_ids=unknown_owned_ids,
        capabilities=CosmeticCapabilities(),
    )
