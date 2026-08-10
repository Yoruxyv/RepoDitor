"""Validation and structural access for evidence-backed MetaSave cosmetics."""

from __future__ import annotations

from typing import cast

from repo_save_editor.core.schema import SaveSchemaError
from repo_save_editor.core.types import SaveData

OWNERSHIP_KEYS = ("cosmeticHistory", "cosmeticUnlocks")


def _typed_value(data: SaveData, key: str) -> object:
    entry = data.get(key)
    if not isinstance(entry, dict) or "value" not in entry:
        raise SaveSchemaError(f"Missing or invalid MetaSave field: {key}")
    return entry["value"]


def _cosmetic_ids(data: SaveData, key: str) -> list[int]:
    value = _typed_value(data, key)
    if not isinstance(value, list):
        raise SaveSchemaError(f"'{key}.value' is not a list.")
    if any(isinstance(item, bool) or not isinstance(item, int) for item in value):
        raise SaveSchemaError(f"'{key}.value' must contain only integer cosmetic IDs.")
    return cast(list[int], value)


def validate_meta_save(data: SaveData) -> None:
    """Validate the ownership structures supported by the cosmetics editor."""
    for key in OWNERSHIP_KEYS:
        _cosmetic_ids(data, key)
    get_saved_preset_count(data)


def get_saved_preset_count(data: SaveData) -> int:
    """Count populated preset slots without interpreting their contents."""
    presets = _typed_value(data, "cosmeticPresets")
    if not isinstance(presets, list):
        raise SaveSchemaError("'cosmeticPresets.value' is not a list.")
    return sum(bool(preset) for preset in presets)


def get_ownership_lists(data: SaveData) -> tuple[list[int], list[int]]:
    """Return mutable history and authoritative unlock ownership lists."""
    validate_meta_save(data)
    return _cosmetic_ids(data, "cosmeticHistory"), _cosmetic_ids(data, "cosmeticUnlocks")


def _contains_id(value: object, cosmetic_id: int) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value == cosmetic_id
    if isinstance(value, list):
        return any(_contains_id(item, cosmetic_id) for item in value)
    if isinstance(value, dict):
        return any(_contains_id(item, cosmetic_id) for item in value.values())
    return False


def removal_blocked_reason(data: SaveData, cosmetic_id: int) -> str | None:
    """Return the conservative reason ownership removal is not evidence-safe."""
    for key, label in (
        ("cosmeticEquipped", "equipped"),
        ("cosmeticPresets", "used by a preset"),
    ):
        try:
            value = _typed_value(data, key)
        except SaveSchemaError:
            return (
                "Removal unavailable because equipment and preset references could not be verified."
            )
        if _contains_id(value, cosmetic_id):
            return f"Removal unavailable while {label}."
    return None
