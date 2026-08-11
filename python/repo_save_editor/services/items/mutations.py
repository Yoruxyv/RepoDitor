"""Evidence-backed item mutations."""

from __future__ import annotations

from repo_save_editor.core.schema import get_dictionaries
from repo_save_editor.core.types import SaveData
from repo_save_editor.services.items.models import AdvancedSaveError
from repo_save_editor.services.items.schema import (
    ITEM_KEY_PATTERN,
    _container,
    _integer_entries,
)


def refill_item_to_full(data: SaveData, save_key: str) -> bool:
    """Remove the exact stored-charge leaf for one confirmed item instance.

    Args:
        data: Validated Run-save data to mutate in memory.
        save_key: Exact observed item-instance key, including its numeric suffix.

    Returns:
        ``True`` when a charge leaf was removed, or ``False`` when the instance
        already used the evidence-backed absent/full-default representation.

    Raises:
        AdvancedSaveError: The key is malformed or does not identify an item in
            this save.
    """
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
