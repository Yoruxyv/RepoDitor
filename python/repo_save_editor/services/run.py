"""Run-stat and resume-state operations."""

from __future__ import annotations

from enum import IntEnum

from repo_save_editor.core.schema import (
    SAVE_INT32_MAX,
    SAVE_INT32_MIN,
    SaveSchemaError,
    get_dictionaries,
)
from repo_save_editor.core.types import SaveData

RUN_STATS: tuple[tuple[str, str], ...] = (
    ("Level", "level"),
    ("Currency", "currency"),
    ("Lives", "lives"),
    ("Total Haul", "totalHaul"),
)


class ResumeLocation(IntEnum):
    """Confirmed values for the save's resume-location selector."""

    NORMAL = 0
    SHOP = 1


RESUME_LOCATION_LABELS: dict[ResumeLocation, str] = {
    ResumeLocation.NORMAL: "Normal",
    ResumeLocation.SHOP: "Shop / Service Station",
}
RESUME_LOCATION_OPTIONS: tuple[str, ...] = tuple(RESUME_LOCATION_LABELS.values())


def get_run_stat(data: SaveData, key: str) -> int:
    """Return an integer value from ``runStats``."""
    run_stats = get_dictionaries(data)["runStats"]
    raw = run_stats.get(key, 0)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def set_run_stat(data: SaveData, key: str, value: int) -> None:
    """Set an integer value in ``runStats``."""
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not SAVE_INT32_MIN <= value <= SAVE_INT32_MAX
    ):
        raise ValueError(f"Run value must be between {SAVE_INT32_MIN:,} and {SAVE_INT32_MAX:,}.")
    run_stats = get_dictionaries(data)["runStats"]
    if key in run_stats:
        raw = run_stats[key]
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise SaveSchemaError(f"Run stat '{key}' is not a supported integer value.")
    run_stats[key] = value


def get_display_level(data: SaveData) -> int:
    """Return the one-based level shown by the game."""
    return get_run_stat(data, "level") + 1


def set_display_level(data: SaveData, value: int) -> None:
    """Store a one-based game level in the zero-based save field."""
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= SAVE_INT32_MAX + 1
    ):
        raise ValueError(f"Level must be between 1 and {SAVE_INT32_MAX + 1:,}.")
    set_run_stat(data, "level", value - 1)


def get_resume_location_label(data: SaveData) -> str:
    """Return a friendly label for the raw ``save level`` value."""
    raw = get_run_stat(data, "save level")
    try:
        location = ResumeLocation(raw)
    except ValueError:
        return f"Unknown ({raw})"
    return RESUME_LOCATION_LABELS[location]


def set_resume_location_from_label(data: SaveData, label: str) -> None:
    """Store a resume location selected by an interface.

    Unknown values are accepted only in the exact ``Unknown (<int>)`` form so
    loading and saving a future game value does not silently rewrite it.
    """
    for location, known_label in RESUME_LOCATION_LABELS.items():
        if label == known_label:
            set_run_stat(data, "save level", int(location))
            return

    if label.startswith("Unknown (") and label.endswith(")"):
        try:
            raw = int(label.removeprefix("Unknown (").removesuffix(")"))
        except ValueError as exc:
            raise ValueError("Resume Location is invalid.") from exc
        set_run_stat(data, "save level", raw)
        return

    raise ValueError("Resume Location must be Normal or Shop / Service Station.")


def get_run_stat_for_display(data: SaveData, key: str) -> int:
    """Return a run stat using the same representation as the editor UI."""
    if key == "level":
        return get_display_level(data)
    return get_run_stat(data, key)


def get_available_run_stats(data: SaveData) -> tuple[tuple[str, str, int], ...]:
    """Return friendly run stats supported by the loaded save."""
    run_stats = get_dictionaries(data)["runStats"]
    return tuple(
        (label, key, get_run_stat_for_display(data, key))
        for label, key in RUN_STATS
        if key in {"level", "currency"} or key in run_stats
    )


def set_run_stat_from_display(data: SaveData, key: str, value: int) -> None:
    """Store a run stat supplied by an interface."""
    if key == "level":
        set_display_level(data, value)
        return
    set_run_stat(data, key, value)
