"""Models for evidence-backed item save data."""

from __future__ import annotations

from dataclasses import dataclass


class AdvancedSaveError(ValueError):
    """Raised when an observed advanced structure is malformed."""


@dataclass(frozen=True, slots=True)
class AdvancedCapability:
    """Read and mutation support for one advanced save domain."""

    key: str
    label: str
    status: str
    entry_count: int | None
    can_read: bool
    can_edit: bool = False
    can_add: bool = False
    can_delete: bool = False
    can_duplicate: bool = False
    can_refill_to_full: bool = False


@dataclass(frozen=True, slots=True)
class AdvancedItem:
    """One confirmed item instance without its unverified stored integer."""

    save_key: str
    name: str
    instance_id: str
    stored_charge: int | None


@dataclass(frozen=True, slots=True)
class AdvancedRunValue:
    """One observed, read-only lower-level Run value."""

    save_key: str
    label: str
    value: int


@dataclass(frozen=True, slots=True)
class AdvancedSaveView:
    """Renderer-safe projection of evidence-supported advanced structures."""

    domains: tuple[AdvancedCapability, ...]
    items: tuple[AdvancedItem, ...]
    run_values: tuple[AdvancedRunValue, ...]
    unlinked_charge_entry_count: int
