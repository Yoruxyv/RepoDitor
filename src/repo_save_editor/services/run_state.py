"""Run-stat and resume-state operations."""

from __future__ import annotations

from enum import IntEnum

from repo_save_editor.core.schema import get_dictionaries
from repo_save_editor.core.types import SaveData

RUN_STATS: tuple[tuple[str, str], ...] = (
    ("Level", "level"),
    ("Currency", "currency"),
    ("Lives", "lives"),
    ("Total Haul", "totalHaul"),
    ("Save Level", "save level"),
)


class ResumeLocation(IntEnum):
    """Known values for the save's resume-location selector."""

    NORMAL = 0
    SHOP = 1


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
    run_stats = get_dictionaries(data)["runStats"]
    run_stats[key] = int(value)


def get_display_level(data: SaveData) -> int:
    """Return the one-based level shown by the game."""
    return get_run_stat(data, "level") + 1


def set_display_level(data: SaveData, value: int) -> None:
    """Store a one-based game level in the zero-based save field."""
    if value < 1:
        raise ValueError("Level must be at least 1.")
    set_run_stat(data, "level", value - 1)


def get_run_stat_for_display(data: SaveData, key: str) -> int:
    """Return a run stat using the same representation as the editor UI."""
    if key == "level":
        return get_display_level(data)
    return get_run_stat(data, key)


def set_run_stat_from_display(data: SaveData, key: str, value: int) -> None:
    """Store a run stat supplied by an interface."""
    if key == "level":
        set_display_level(data, value)
        return
    set_run_stat(data, key, value)
