"""Validation and structural access helpers for decrypted run saves."""

from __future__ import annotations

from typing import Any, Final, cast

from .types import SaveData


class SaveSchemaError(ValueError):
    """Raised when expected save data is missing or malformed."""


# ``dictionaryOfDictionaries`` declares every inner value as ``System.Int32``.
SAVE_INT32_MIN: Final = -(2**31)
SAVE_INT32_MAX: Final = 2**31 - 1


def get_typed_value(data: SaveData, key: str) -> Any:
    """Return the Easy Save typed entry value for ``key``."""
    entry = data.get(key)
    if not isinstance(entry, dict) or "value" not in entry:
        raise SaveSchemaError(f"Missing or invalid save field: {key}")
    return entry["value"]


def validate_run_save(data: SaveData) -> None:
    """Validate the minimum structure required by the run-save editor."""
    players = get_typed_value(data, "playerNames")
    dictionaries = get_typed_value(data, "dictionaryOfDictionaries")

    if not isinstance(players, dict):
        raise SaveSchemaError("'playerNames.value' is not a dictionary.")
    if not isinstance(dictionaries, dict):
        raise SaveSchemaError("'dictionaryOfDictionaries.value' is not a dictionary.")

    run_stats = dictionaries.get("runStats")
    if not isinstance(run_stats, dict):
        raise SaveSchemaError("The save does not contain a valid 'runStats' dictionary.")


def get_dictionaries(data: SaveData) -> dict[str, Any]:
    """Return ``dictionaryOfDictionaries.value`` after validating the save."""
    validate_run_save(data)
    return cast(dict[str, Any], get_typed_value(data, "dictionaryOfDictionaries"))
