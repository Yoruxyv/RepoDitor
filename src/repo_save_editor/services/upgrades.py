"""Player-upgrade discovery and editing operations."""

from __future__ import annotations

import re
from dataclasses import dataclass

from repo_save_editor.core.schema import SaveSchemaError, get_dictionaries
from repo_save_editor.core.types import SaveData

UPGRADE_PREFIX = "playerUpgrade"

KNOWN_UPGRADE_LABELS: dict[str, str] = {
    "playerUpgradeHealth": "Health",
    "playerUpgradeStamina": "Stamina / Energy",
    "playerUpgradeExtraJump": "Extra Jump",
    "playerUpgradeLaunch": "Tumble Launch",
    "playerUpgradeTumbleClimb": "Tumble Climb",
    "playerUpgradeDeathHeadBattery": "Death Head Battery",
    "playerUpgradeMapPlayerCount": "Map Player Count",
    "playerUpgradeSpeed": "Speed",
    "playerUpgradeStrength": "Strength",
    "playerUpgradeRange": "Range",
    "playerUpgradeThrow": "Throw",
    "playerUpgradeCrouchRest": "Crouch Rest",
    "playerUpgradeTumbleWings": "Tumble Wings",
}

_CAMEL_ACRONYM_BOUNDARY = re.compile(r"(?<=[A-Z])(?=[A-Z][a-z])")
_CAMEL_WORD_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


@dataclass(frozen=True, slots=True)
class PlayerUpgrade:
    """One player-upgrade dictionary discovered in a loaded save."""

    key: str
    label: str
    known: bool


def _humanize_upgrade_key(key: str) -> str:
    suffix = key.removeprefix(UPGRADE_PREFIX).replace("_", " ").strip()
    if not suffix:
        return key

    suffix = _CAMEL_ACRONYM_BOUNDARY.sub(" ", suffix)
    suffix = _CAMEL_WORD_BOUNDARY.sub(" ", suffix)
    return " ".join(suffix.split())


def get_upgrade_label(key: str) -> str:
    """Return a friendly label for a known or newly detected upgrade key."""
    return KNOWN_UPGRADE_LABELS.get(key, _humanize_upgrade_key(key))


def discover_player_upgrades(data: SaveData) -> tuple[PlayerUpgrade, ...]:
    """Discover player-upgrade dictionaries from the loaded save itself.

    Known keys receive curated labels. Unknown keys are still exposed so newer
    game versions and modded saves do not require a RepoDitor code change just
    to make their upgrade values editable.
    """
    dictionaries = get_dictionaries(data)
    upgrades = [
        PlayerUpgrade(
            key=key,
            label=get_upgrade_label(key),
            known=key in KNOWN_UPGRADE_LABELS,
        )
        for key, value in dictionaries.items()
        if isinstance(key, str)
        and key.startswith(UPGRADE_PREFIX)
        and key != UPGRADE_PREFIX
        and isinstance(value, dict)
    ]
    upgrades.sort(key=lambda upgrade: (not upgrade.known, upgrade.label.casefold(), upgrade.key))
    return tuple(upgrades)


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
