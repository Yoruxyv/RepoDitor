"""Evidence-backed advanced save discovery and narrow mutations."""

from __future__ import annotations

import re
from dataclasses import dataclass

from repo_save_editor.core.schema import get_dictionaries
from repo_save_editor.core.types import SaveData

ITEM_KEY_PATTERN = re.compile(r"^(?P<name>Item .+)/(?P<instance_id>\d+)$")
RUN_VALUE_LABELS = {
    "chargingStationCharge": "Charging station charge",
    "chargingStationChargeTotal": "Charging station charge total",
}


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


def _container(dictionaries: dict[str, object], key: str) -> dict[object, object] | None:
    if key not in dictionaries:
        return None
    value = dictionaries[key]
    if not isinstance(value, dict):
        raise AdvancedSaveError(f"Advanced save field '{key}' is not a dictionary.")
    return value


def _integer_entries(container: dict[object, object] | None, key: str) -> dict[str, int]:
    if container is None:
        return {}
    entries: dict[str, int] = {}
    for save_key, value in container.items():
        if not isinstance(save_key, str) or isinstance(value, bool) or not isinstance(value, int):
            raise AdvancedSaveError(
                f"Advanced save field '{key}' must contain string keys and whole numbers."
            )
        entries[save_key] = value
    return entries


def _capability(
    key: str,
    label: str,
    status: str,
    container: dict[object, object] | None,
    *,
    can_read: bool,
    can_refill_to_full: bool = False,
) -> AdvancedCapability:
    return AdvancedCapability(
        key=key,
        label=label,
        status=status,
        entry_count=None if container is None else len(container),
        can_read=can_read,
        can_refill_to_full=can_refill_to_full,
    )


def refill_item_to_full(data: SaveData, save_key: str) -> bool:
    """Remove one confirmed item's stored-charge leaf; return False when already full."""
    dictionaries = get_dictionaries(data)
    item_entries = _integer_entries(_container(dictionaries, "item"), "item")
    charge_container = _container(dictionaries, "itemStatBattery")
    charge_entries = _integer_entries(charge_container, "itemStatBattery")

    if ITEM_KEY_PATTERN.fullmatch(save_key) is None or save_key not in item_entries:
        raise AdvancedSaveError("The selected item instance does not exist in this save.")
    if save_key not in charge_entries:
        return False

    assert charge_container is not None
    del charge_container[save_key]
    return True


def discover_advanced_save(data: SaveData) -> AdvancedSaveView:
    """Return only advanced structures supported by controlled save evidence."""
    dictionaries = get_dictionaries(data)
    item_container = _container(dictionaries, "item")
    charge_container = _container(dictionaries, "itemStatBattery")
    battery_container = _container(dictionaries, "itemBatteryUpgrades")
    upgrade_purchase_container = _container(dictionaries, "itemsUpgradesPurchased")
    purchased_container = _container(dictionaries, "itemsPurchased")
    purchased_total_container = _container(dictionaries, "itemsPurchasedTotal")

    item_entries = _integer_entries(item_container, "item")
    charge_entries = _integer_entries(charge_container, "itemStatBattery")
    _integer_entries(upgrade_purchase_container, "itemsUpgradesPurchased")
    _integer_entries(purchased_container, "itemsPurchased")
    _integer_entries(purchased_total_container, "itemsPurchasedTotal")

    items: list[AdvancedItem] = []
    for save_key in item_entries:
        match = ITEM_KEY_PATTERN.fullmatch(save_key)
        if match is None:
            raise AdvancedSaveError("An item instance key did not match the observed format.")
        item_name = match.group("name").removeprefix("Item ")
        items.append(
            AdvancedItem(
                save_key=save_key,
                name=item_name,
                instance_id=match.group("instance_id"),
                stored_charge=charge_entries.get(save_key),
            )
        )
    items.sort(
        key=lambda item: (
            item.name.casefold(),
            len(item.instance_id),
            item.instance_id,
            item.save_key,
        )
    )

    run_stats = dictionaries["runStats"]
    run_values: list[AdvancedRunValue] = []
    for save_key, label in RUN_VALUE_LABELS.items():
        if save_key not in run_stats:
            continue
        value = run_stats[save_key]
        if isinstance(value, bool) or not isinstance(value, int):
            raise AdvancedSaveError(f"Run value '{save_key}' is not a whole number.")
        run_values.append(AdvancedRunValue(save_key=save_key, label=label, value=value))

    item_keys = set(item_entries)
    return AdvancedSaveView(
        domains=(
            _capability(
                "items",
                "Item instances",
                "confirmed" if item_container is not None else "unknown",
                item_container,
                can_read=item_container is not None,
            ),
            _capability(
                "currentCharge",
                "Stored charge entries",
                "partially_confirmed" if charge_container is not None else "unknown",
                charge_container,
                can_read=charge_container is not None,
                can_refill_to_full=(item_container is not None and charge_container is not None),
            ),
            _capability(
                "batteryUpgrades",
                "Battery upgrade entries",
                "unknown",
                battery_container,
                can_read=False,
            ),
            _capability(
                "purchasedUpgrades",
                "Purchased upgrade entries",
                "partially_confirmed" if upgrade_purchase_container is not None else "unknown",
                upgrade_purchase_container,
                can_read=False,
            ),
            _capability(
                "purchasedItems",
                "Purchased item entries",
                "partially_confirmed" if purchased_container is not None else "unknown",
                purchased_container,
                can_read=False,
            ),
            _capability(
                "purchasedItemsTotal",
                "Total purchased item entries",
                "partially_confirmed" if purchased_total_container is not None else "unknown",
                purchased_total_container,
                can_read=False,
            ),
            AdvancedCapability(
                key="runMetadata",
                label="Additional Run values",
                status="partially_confirmed" if run_values else "unknown",
                entry_count=len(run_values),
                can_read=bool(run_values),
            ),
        ),
        items=tuple(items),
        run_values=tuple(run_values),
        unlinked_charge_entry_count=len(set(charge_entries) - item_keys),
    )
