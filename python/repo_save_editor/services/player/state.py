"""Player identity and status operations."""

from __future__ import annotations

from dataclasses import dataclass

from repo_save_editor.core.schema import (
    SAVE_INT32_MAX,
    SaveSchemaError,
    get_dictionaries,
    get_typed_value,
)
from repo_save_editor.core.types import SaveData
from repo_save_editor.services.player.upgrades import get_player_upgrade

BASE_PLAYER_HEALTH = 100
HEALTH_PER_UPGRADE = 20


@dataclass(frozen=True, slots=True)
class Player:
    """A player entry stored in a run save."""

    player_id: str
    name: str

    @property
    def display_name(self) -> str:
        """Return the UI-friendly player label."""
        return f"{self.name}  [{self.player_id}]"


def get_players(data: SaveData) -> list[Player]:
    """Return all players stored in the run save."""
    raw = get_typed_value(data, "playerNames")
    if not isinstance(raw, dict):
        raise SaveSchemaError("'playerNames.value' is not a dictionary.")
    return [Player(str(player_id), str(name)) for player_id, name in raw.items()]


def get_player_health(data: SaveData, player_id: str) -> int:
    """Return a player's current HP, defaulting to zero when absent."""
    values = get_dictionaries(data).get("playerHealth", {})
    if not isinstance(values, dict):
        return 0

    raw = values.get(player_id, 0)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def get_player_max_health(data: SaveData, player_id: str) -> int:
    """Return base health plus twenty HP per saved Health upgrade."""
    health_upgrades = max(get_player_upgrade(data, player_id, "playerUpgradeHealth"), 0)
    return BASE_PLAYER_HEALTH + health_upgrades * HEALTH_PER_UPGRADE


def set_player_health(data: SaveData, player_id: str, value: int) -> None:
    """Set a player's current HP."""
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= SAVE_INT32_MAX:
        raise ValueError(f"Current Health must be between 0 and {SAVE_INT32_MAX:,}.")

    dictionaries = get_dictionaries(data)
    values = dictionaries.setdefault("playerHealth", {})
    if not isinstance(values, dict):
        raise SaveSchemaError("Player health field is not a dictionary.")
    if player_id in values:
        raw = values[player_id]
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise SaveSchemaError(
                f"Player health for '{player_id}' is not a supported integer value."
            )
    values[player_id] = value
