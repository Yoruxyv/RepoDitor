"""Renderer-safe item-save reads for the desktop process boundary."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from pathlib import Path

from repo_save_editor.desktop_api.protocol import DesktopSaveError, _failure
from repo_save_editor.desktop_api.saves import load_discovered_save
from repo_save_editor.services.icon_cache import IconDomain, available_icon_keys
from repo_save_editor.services.items.discovery import (
    discover_advanced_save,
    discover_item_type_names,
)
from repo_save_editor.services.items.models import (
    AdvancedSaveError,
    InstalledItemMetadata,
    ItemRechargeCapability,
)
from repo_save_editor.services.items.recharge_capability import (
    discover_installed_item_metadata_with_evidence,
)
from repo_save_editor.services.items.recharge_evidence import (
    RechargeEvidence,
    serialize_recharge_evidence,
)
from repo_save_editor.services.player.installed_upgrades import match_upgrade_items
from repo_save_editor.services.player.upgrades import discover_player_upgrades

RechargeCapabilityLoader = Callable[
    [tuple[str, ...]],
    Mapping[str, ItemRechargeCapability],
]
ItemMetadataLoader = Callable[[tuple[str, ...]], Mapping[str, InstalledItemMetadata]]
ItemMetadataEvidenceLoader = Callable[
    [tuple[str, ...]],
    tuple[Mapping[str, InstalledItemMetadata], RechargeEvidence | None],
]
IconAvailabilityLoader = Callable[[IconDomain, Iterable[str]], frozenset[str]]


def get_advanced_save(
    save_id: str,
    root: Path | None = None,
    *,
    capability_loader: RechargeCapabilityLoader | None = None,
    metadata_loader: ItemMetadataLoader | None = None,
    metadata_evidence_loader: ItemMetadataEvidenceLoader = (
        discover_installed_item_metadata_with_evidence
    ),
    icon_availability_loader: IconAvailabilityLoader = available_icon_keys,
) -> dict[str, object]:
    """Return evidence-backed advanced data without exposing the decrypted save."""
    try:
        _, data, _ = load_discovered_save(save_id, root)
        item_type_names = discover_item_type_names(data)
        upgrade_keys = tuple(upgrade.key for upgrade in discover_player_upgrades(data))
        upgrade_visual_keys = match_upgrade_items(upgrade_keys, item_type_names)
        evidence: RechargeEvidence | None = None
        if capability_loader is not None:
            metadata: Mapping[str, InstalledItemMetadata] = {}
            capabilities = capability_loader(item_type_names)
        elif metadata_loader is not None:
            metadata = metadata_loader(item_type_names)
            capabilities = {name: value.recharge_capability for name, value in metadata.items()}
        else:
            metadata, evidence = metadata_evidence_loader(item_type_names)
            capabilities = {name: value.recharge_capability for name, value in metadata.items()}
        icon_keys = {
            value.icon_cache_key for value in metadata.values() if value.icon_cache_key is not None
        }
        available_icons = icon_availability_loader("item", icon_keys)
        icons_by_type = {
            name: value.icon_cache_key
            for name, value in metadata.items()
            if value.icon_cache_key in available_icons
        }
        advanced = discover_advanced_save(data, capabilities)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)
    except AdvancedSaveError:
        return _failure(
            "save_unsupported",
            "The selected save contains malformed advanced item data.",
        )

    result: dict[str, object] = {
        "ok": True,
        "advanced": {
            "domains": [
                {
                    "key": domain.key,
                    "label": domain.label,
                    "status": domain.status,
                    "entryCount": domain.entry_count,
                    "capabilities": {
                        "canRead": domain.can_read,
                        "canEdit": domain.can_edit,
                        "canAdd": domain.can_add,
                        "canDelete": domain.can_delete,
                        "canDuplicate": domain.can_duplicate,
                        "canRefillToFull": domain.can_refill_to_full,
                    },
                }
                for domain in advanced.domains
            ],
            "items": [
                {
                    "saveKey": item.save_key,
                    "name": item.name,
                    "instanceId": item.instance_id,
                    "isUpgrade": item.is_upgrade,
                    "storedCharge": item.stored_charge,
                    "chargeState": item.charge_state.value,
                    "rechargeCapability": item.recharge_capability.value,
                    "canRefillToFull": item.can_refill_to_full,
                    "iconKey": icons_by_type.get(f"Item {item.name}"),
                    **(
                        {"upgradeVisualKey": upgrade_visual_keys[f"Item {item.name}"]}
                        if f"Item {item.name}" in upgrade_visual_keys
                        else {}
                    ),
                }
                for item in advanced.items
            ],
            "unlinkedChargeEntryCount": advanced.unlinked_charge_entry_count,
        },
    }
    if evidence is not None:
        result["rechargeEvidence"] = serialize_recharge_evidence(evidence)
    return result
