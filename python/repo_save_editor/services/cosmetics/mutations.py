"""Narrow evidence-backed MetaSave cosmetic ownership mutations."""

from __future__ import annotations

from repo_save_editor.core.types import SaveData
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.policy import (
    CATALOG_UNAVAILABLE_REASON,
    OUTSIDE_MUTATION_TRUST_REASON,
    mutation_block_reason,
    mutation_eligible_ids,
)
from repo_save_editor.services.cosmetics.schema import (
    get_ownership_lists,
    get_preset_lists,
    removal_blocked_reason,
)


class CosmeticMutationError(ValueError):
    """Raised when a requested ownership change exceeds the evidence boundary."""


def _require_mutation_eligible(
    cosmetic_id: object,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> int:
    reason = mutation_block_reason(cosmetic_id, installed_catalog)
    if reason is not None:
        raise CosmeticMutationError(reason)
    assert isinstance(cosmetic_id, int) and not isinstance(cosmetic_id, bool)
    return cosmetic_id


def _bulk_mutation_ids(
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> tuple[int, ...]:
    if not installed_catalog:
        raise CosmeticMutationError(CATALOG_UNAVAILABLE_REASON)
    eligible = mutation_eligible_ids(installed_catalog)
    if not eligible:
        raise CosmeticMutationError(OUTSIDE_MUTATION_TRUST_REASON)
    return eligible


def unlock_cosmetic(
    data: SaveData,
    cosmetic_id: object,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> bool:
    """Add one installed and independently trusted ID to both ownership lists."""
    canonical_id = _require_mutation_eligible(cosmetic_id, installed_catalog)
    history, unlocks = get_ownership_lists(data)
    if canonical_id in unlocks:
        return False
    unlocks.append(canonical_id)
    if canonical_id not in history:
        history.append(canonical_id)
    return True


def unlock_all_cosmetics(
    data: SaveData,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> bool:
    """Unlock only installed IDs that remain inside the proven mutation trust set."""
    changed = False
    for cosmetic_id in _bulk_mutation_ids(installed_catalog):
        changed = unlock_cosmetic(data, cosmetic_id, installed_catalog) or changed
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


def lock_all_cosmetics(
    data: SaveData,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> bool:
    """Remove only installed, trusted, unreferenced ownership and preserve everything else."""
    trusted_ids = frozenset(_bulk_mutation_ids(installed_catalog))
    _history, unlocks = get_ownership_lists(data)
    owned_ids = [cosmetic_id for cosmetic_id in unlocks if cosmetic_id in trusted_ids]
    for cosmetic_id in owned_ids:
        blocked = removal_blocked_reason(data, cosmetic_id)
        if blocked is not None:
            raise CosmeticMutationError(blocked)
    changed = False
    for cosmetic_id in owned_ids:
        changed = remove_cosmetic_ownership(data, cosmetic_id, installed_catalog) or changed
    return changed


def remove_cosmetic_ownership(
    data: SaveData,
    cosmetic_id: object,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> bool:
    """Remove one installed, trusted, unreferenced ID from both ownership lists."""
    canonical_id = _require_mutation_eligible(cosmetic_id, installed_catalog)
    history, unlocks = get_ownership_lists(data)
    if canonical_id not in unlocks:
        return False
    blocked = removal_blocked_reason(data, canonical_id)
    if blocked is not None:
        raise CosmeticMutationError(blocked)
    history[:] = [item for item in history if item != canonical_id]
    unlocks[:] = [item for item in unlocks if item != canonical_id]
    return True
