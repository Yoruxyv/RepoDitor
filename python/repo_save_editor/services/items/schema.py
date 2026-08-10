"""Validation helpers for observed item save containers."""

from __future__ import annotations

import re

from repo_save_editor.services.items.models import AdvancedSaveError

ITEM_KEY_PATTERN = re.compile(r"^(?P<name>Item .+)/(?P<instance_id>\d+)$")


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
