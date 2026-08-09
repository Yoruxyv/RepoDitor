"""Renderer-safe advanced save reads for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.desktop_api.saves import DesktopSaveError, _failure, load_discovered_save
from repo_save_editor.services.advanced import AdvancedSaveError, discover_advanced_save


def get_advanced_save(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Return evidence-backed advanced data without exposing the decrypted save."""
    try:
        _, data, _ = load_discovered_save(save_id, root)
        advanced = discover_advanced_save(data)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)
    except AdvancedSaveError:
        return _failure(
            "save_unsupported",
            "The selected save contains malformed advanced item data.",
        )

    return {
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
                    "storedCharge": item.stored_charge,
                }
                for item in advanced.items
            ],
            "runValues": [
                {
                    "saveKey": value.save_key,
                    "label": value.label,
                    "value": value.value,
                    "status": "partially_confirmed",
                }
                for value in advanced.run_values
            ],
            "unlinkedChargeEntryCount": advanced.unlinked_charge_entry_count,
        },
    }
