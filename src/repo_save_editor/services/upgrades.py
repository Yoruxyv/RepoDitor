"""Player-upgrade operations.

The catalog is intentionally isolated here so it can be replaced with dynamic
``playerUpgrade*`` discovery without changing storage or UI infrastructure.
"""

from __future__ import annotations

from repo_save_editor.core.schema import SaveSchemaError, get_dictionaries
from repo_save_editor.core.types import SaveData

PLAYER_UPGRADES: tuple[tuple[str, str], ...] = (
    ("Health", "playerUpgradeHealth"),
    ("Stamina / Energy", "playerUpgradeStamina"),
    ("Extra Jump", "playerUpgradeExtraJump"),
    ("Tumble Launch", "playerUpgradeLaunch"),
    ("Tumble Climb", "playerUpgradeTumbleClimb"),
    ("Death Head Battery", "playerUpgradeDeathHeadBattery"),
    ("Map Player Count", "playerUpgradeMapPlayerCount"),
    ("Speed", "playerUpgradeSpeed"),
    ("Strength", "playerUpgradeStrength"),
    ("Range", "playerUpgradeRange"),
    ("Throw", "playerUpgradeThrow"),
    ("Crouch Rest", "playerUpgradeCrouchRest"),
    ("Tumble Wings", "playerUpgradeTumbleWings"),
)


def get_player_upgrade(data: SaveData, player_id: str, key: str) -> int:
    """Return one player's stored value for an upgrade key."""
    values = get_dictionaries(data).get(key, {})
    if not isinstance(values, dict):
        return 0

    raw = values.get(player_id, 0)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def set_player_upgrade(data: SaveData, player_id: str, key: str, value: int) -> None:
    """Set one player's stored value for an upgrade key."""
    if value < 0:
        raise ValueError("Upgrade values cannot be negative.")

    dictionaries = get_dictionaries(data)
    values = dictionaries.setdefault(key, {})
    if not isinstance(values, dict):
        raise SaveSchemaError(f"Upgrade field '{key}' is not a dictionary.")

    values[player_id] = int(value)
