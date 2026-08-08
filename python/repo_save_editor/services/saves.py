"""Read-only metadata helpers for run saves."""

from __future__ import annotations

from dataclasses import dataclass

from repo_save_editor.core.schema import get_typed_value
from repo_save_editor.core.types import SaveData
from repo_save_editor.services.run_state import get_display_level


@dataclass(frozen=True, slots=True)
class SaveSummary:
    """Small save summary suitable for lists and interface headers."""

    team_name: str
    level: int
    date: str
    time_played_seconds: float


def get_team_name(data: SaveData) -> str:
    """Return the saved team name."""
    return str(get_typed_value(data, "teamName"))


def get_date(data: SaveData) -> str:
    """Return the game's saved date/time label."""
    return str(get_typed_value(data, "dateAndTime"))


def get_time_played_seconds(data: SaveData) -> float:
    """Return total play time stored in the save."""
    value = get_typed_value(data, "timePlayed")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid timePlayed value.") from exc


def format_duration(seconds: float) -> str:
    """Format seconds as a compact human-readable duration."""
    seconds_i = max(0, int(seconds))
    hours, remainder = divmod(seconds_i, 3600)
    minutes, seconds_i = divmod(remainder, 60)
    return f"{hours}h {minutes}m {seconds_i}s"


def get_save_summary(data: SaveData) -> SaveSummary:
    """Build a consistent summary for UI and future IPC consumers."""
    return SaveSummary(
        team_name=get_team_name(data),
        level=get_display_level(data),
        date=get_date(data),
        time_played_seconds=get_time_played_seconds(data),
    )
