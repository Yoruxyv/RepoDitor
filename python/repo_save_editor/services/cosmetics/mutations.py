"""Narrow evidence-backed MetaSave cosmetic ownership mutations."""

from __future__ import annotations

from repo_save_editor.core.types import SaveData
from repo_save_editor.services.cosmetics.discovery import KNOWN_COSMETIC_ID_SET, KNOWN_COSMETIC_IDS
from repo_save_editor.services.cosmetics.schema import (
    get_ownership_lists,
    get_preset_lists,
    removal_blocked_reason,
)


class CosmeticMutationError(ValueError):
    """Raised when a requested ownership change exceeds the evidence boundary."""


def _known_id(cosmetic_id: int) -> None:
    if isinstance(cosmetic_id, bool) or cosmetic_id not in KNOWN_COSMETIC_ID_SET:
        raise CosmeticMutationError("Only known cosmetic IDs 0 through 546 can be changed.")


def unlock_cosmetic(data: SaveData, cosmetic_id: int) -> bool:
    """Add one known locked ID to both proven ownership lists."""
    _known_id(cosmetic_id)
    history, unlocks = get_ownership_lists(data)
    if cosmetic_id in unlocks:
        return False
    unlocks.append(cosmetic_id)
    if cosmetic_id not in history:
        history.append(cosmetic_id)
    return True


def unlock_all_cosmetics(data: SaveData) -> bool:
    """Compose the proven single-unlock rule for every known current ID."""
    changed = False
    for cosmetic_id in KNOWN_COSMETIC_IDS:
        changed = unlock_cosmetic(data, cosmetic_id) or changed
    return changed


def clear_all_presets(data: SaveData) -> bool:
    """Clear every existing paired preset slot without changing outer lengths."""
    cosmetic_presets, color_presets = get_preset_lists(data)

    changed = any(bool(slot) for slot in cosmetic_presets) or any(
        bool(slot) for slot in color_presets
    )
    if not changed:
        return False

    cosmetic_presets[:] = [[] for _ in cosmetic_presets]
    color_presets[:] = [[] for _ in color_presets]
    return True


def lock_all_cosmetics(data: SaveData) -> bool:
    """Compose proven removals only when every known owned ID is unreferenced."""
    _history, unlocks = get_ownership_lists(data)
    owned_ids = [cosmetic_id for cosmetic_id in unlocks if cosmetic_id in KNOWN_COSMETIC_ID_SET]
    for cosmetic_id in owned_ids:
        blocked = removal_blocked_reason(data, cosmetic_id)
        if blocked is not None:
            raise CosmeticMutationError(blocked)
    changed = False
    for cosmetic_id in owned_ids:
        changed = remove_cosmetic_ownership(data, cosmetic_id) or changed
    return changed


def remove_cosmetic_ownership(data: SaveData, cosmetic_id: int) -> bool:
    """Remove one known, unreferenced ID from both ownership lists."""
    _known_id(cosmetic_id)
    history, unlocks = get_ownership_lists(data)
    if cosmetic_id not in unlocks:
        return False
    blocked = removal_blocked_reason(data, cosmetic_id)
    if blocked is not None:
        raise CosmeticMutationError(blocked)
    history[:] = [item for item in history if item != cosmetic_id]
    unlocks[:] = [item for item in unlocks if item != cosmetic_id]
    return True
