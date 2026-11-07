"""Cosmetic mutation trust policy, separate from installed presentation metadata."""

from __future__ import annotations

from typing import Final

from repo_save_editor.services.cosmetics.known_cosmetics import PROVEN_COSMETIC_IDS
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata

# This exact generated set is evidence for the currently proven save-mutation boundary,
# not a catalog size. Gaps remain gaps when future evidence is non-contiguous.
# Installed catalog data (including the derived disk cache) may only narrow this set. It can
# never grant mutation authority to an ID outside this independently proven boundary.
PROVEN_MUTATION_IDS = PROVEN_COSMETIC_IDS
PROVEN_MUTATION_ID_SET = frozenset(PROVEN_MUTATION_IDS)
# cosmetics.v1/v2 prove these builds; artwork-only approval must not extend this set.
PROVEN_MUTATION_BUILD_IDS: Final = frozenset({"23363152", "26294889"})

CATALOG_UNAVAILABLE_REASON = (
    "Installed cosmetic catalog is unavailable; ownership changes are disabled."
)
ABSENT_FROM_CATALOG_REASON = (
    "Cosmetic ID is absent from the installed catalog and is preserved read-only."
)
OUTSIDE_MUTATION_TRUST_REASON = (
    "Cosmetic ID is outside the proven mutation trust boundary and is preserved read-only."
)


def installed_id_set(
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> frozenset[int]:
    """Return canonical installed IDs without consulting presentation fields."""
    if not installed_catalog:
        return frozenset()
    return frozenset(entry.cosmetic_id for entry in installed_catalog)


def mutation_eligible_ids(
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> tuple[int, ...]:
    """Return installed IDs that also remain inside the proven mutation trust set."""
    installed = installed_id_set(installed_catalog)
    return tuple(cosmetic_id for cosmetic_id in PROVEN_MUTATION_IDS if cosmetic_id in installed)


def mutation_block_reason(
    cosmetic_id: object,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> str | None:
    """Return why an ID cannot be mutated without using display metadata as evidence."""
    if isinstance(cosmetic_id, bool) or not isinstance(cosmetic_id, int):
        return "A canonical integer cosmetic ID is required."
    if not installed_catalog:
        return CATALOG_UNAVAILABLE_REASON
    if cosmetic_id not in installed_id_set(installed_catalog):
        return ABSENT_FROM_CATALOG_REASON
    if cosmetic_id not in PROVEN_MUTATION_ID_SET:
        return OUTSIDE_MUTATION_TRUST_REASON
    return None
