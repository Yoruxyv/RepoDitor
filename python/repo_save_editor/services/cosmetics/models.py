"""Typed cosmetic service models."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class InstalledCosmeticMetadata:
    """Derived metadata for one installed cosmetic catalog position."""

    cosmetic_id: int
    asset_name: str
    cosmetic_type: int
    rarity: int
    status: int
    icon_cache_key: str | None = None


@dataclass(frozen=True, slots=True)
class CosmeticCapabilities:
    """Evidence-backed operations available for the current MetaSave model."""

    can_read_cosmetics: bool = True
    can_unlock_cosmetic: bool = True
    can_unlock_all: bool = True
    can_remove_ownership: bool = True


@dataclass(frozen=True, slots=True)
class Cosmetic:
    """Renderer-safe state for one installed or preserved cosmetic identifier."""

    cosmetic_id: int
    display_name: str
    cosmetic_type: int | None
    rarity: int | None
    status: int | None
    owned: bool
    known: bool
    mutation_eligible: bool
    removal_blocked_reason: str | None


@dataclass(frozen=True, slots=True)
class CosmeticsView:
    """Typed Cosmetics projection without raw MetaSave structures."""

    known_catalog_count: int
    known_owned_count: int
    known_locked_count: int
    saved_preset_count: int
    cosmetics: tuple[Cosmetic, ...]
    unknown_owned_ids: tuple[int, ...]
    capabilities: CosmeticCapabilities
