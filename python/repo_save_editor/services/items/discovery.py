"""Evidence-backed item and related save discovery."""

from __future__ import annotations

from collections.abc import Mapping

from repo_save_editor.core.schema import get_dictionaries
from repo_save_editor.core.types import SaveData
from repo_save_editor.services.items.models import (
    AdvancedCapability,
    AdvancedItem,
    AdvancedRunValue,
    AdvancedSaveError,
    AdvancedSaveView,
    ItemChargeState,
    ItemRechargeCapability,
)
from repo_save_editor.services.items.schema import (
    ITEM_KEY_PATTERN,
    _container,
    _integer_entries,
)

RUN_VALUE_LABELS = {
    "chargingStationCharge": "Charging station charge",
    "chargingStationChargeTotal": "Charging station charge total",
}


def _item_entries(data: SaveData) -> tuple[dict[str, int], dict[object, object] | None]:
    dictionaries = get_dictionaries(data)
    item_container = _container(dictionaries, "item")
    return _integer_entries(item_container, "item"), item_container


def discover_item_type_names(data: SaveData) -> tuple[str, ...]:
    """Return unique full installed-game item identities observed in one save."""
    item_entries, _ = _item_entries(data)
    names: dict[str, None] = {}
    for save_key in item_entries:
        match = ITEM_KEY_PATTERN.fullmatch(save_key)
        if match is None:
            raise AdvancedSaveError("An item instance key did not match the observed format.")
        names.setdefault(match.group("name"), None)
    return tuple(names)


def _charge_state(
    recharge_capability: ItemRechargeCapability,
    save_key: str,
    charge_entries: dict[str, int],
) -> ItemChargeState:
    if save_key in charge_entries:
        return ItemChargeState.STORED
    if recharge_capability is ItemRechargeCapability.RECHARGEABLE:
        return ItemChargeState.DEFAULT_FULL
    if recharge_capability is ItemRechargeCapability.NOT_RECHARGEABLE:
        return ItemChargeState.NOT_APPLICABLE
    return ItemChargeState.UNKNOWN


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


def discover_advanced_save(
    data: SaveData,
    recharge_capabilities: Mapping[str, ItemRechargeCapability] | None = None,
) -> AdvancedSaveView:
    """Return supported advanced structures with independent recharge evidence."""
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
    capabilities = recharge_capabilities or {}
    structural_refill_support = item_container is not None and charge_container is not None

    items: list[AdvancedItem] = []
    for save_key in item_entries:
        match = ITEM_KEY_PATTERN.fullmatch(save_key)
        if match is None:
            raise AdvancedSaveError("An item instance key did not match the observed format.")
        item_type_name = match.group("name")
        recharge_capability = capabilities.get(
            item_type_name,
            ItemRechargeCapability.UNKNOWN,
        )
        charge_state = _charge_state(recharge_capability, save_key, charge_entries)
        items.append(
            AdvancedItem(
                save_key=save_key,
                name=item_type_name.removeprefix("Item "),
                instance_id=match.group("instance_id"),
                stored_charge=charge_entries.get(save_key),
                charge_state=charge_state,
                recharge_capability=recharge_capability,
                can_refill_to_full=(
                    structural_refill_support
                    and recharge_capability is ItemRechargeCapability.RECHARGEABLE
                    and charge_state is ItemChargeState.STORED
                ),
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
                can_refill_to_full=structural_refill_support,
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
