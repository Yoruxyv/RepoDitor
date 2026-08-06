"""Schema helpers for manipulating decrypted R.E.P.O. saves."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class SaveSchemaError(ValueError):
    """Raised when expected save data is missing or malformed."""


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

RUN_STATS: tuple[tuple[str, str], ...] = (
    ("Level", "level"),
    ("Currency", "currency"),
    ("Lives", "lives"),
    ("Total Haul", "totalHaul"),
    ("Save Level", "save level"),
)


@dataclass(frozen=True, slots=True)
class Player:
    player_id: str
    name: str

    @property
    def display_name(self) -> str:
        return f"{self.name}  [{self.player_id}]"


def _typed_value(data: dict[str, Any], key: str) -> Any:
    entry = data.get(key)
    if not isinstance(entry, dict) or "value" not in entry:
        raise SaveSchemaError(f"Missing or invalid save field: {key}")
    return entry["value"]


def validate_save(data: dict[str, Any]) -> None:
    players = _typed_value(data, "playerNames")
    dictionaries = _typed_value(data, "dictionaryOfDictionaries")

    if not isinstance(players, dict):
        raise SaveSchemaError("'playerNames.value' is not a dictionary.")
    if not isinstance(dictionaries, dict):
        raise SaveSchemaError("'dictionaryOfDictionaries.value' is not a dictionary.")
    if "runStats" not in dictionaries or not isinstance(dictionaries["runStats"], dict):
        raise SaveSchemaError("The save does not contain a valid 'runStats' dictionary.")


def get_players(data: dict[str, Any]) -> list[Player]:
    validate_save(data)
    raw = _typed_value(data, "playerNames")
    return [Player(str(player_id), str(name)) for player_id, name in raw.items()]


def get_team_name(data: dict[str, Any]) -> str:
    value = _typed_value(data, "teamName")
    return str(value)


def get_date(data: dict[str, Any]) -> str:
    value = _typed_value(data, "dateAndTime")
    return str(value)


def get_time_played_seconds(data: dict[str, Any]) -> float:
    value = _typed_value(data, "timePlayed")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise SaveSchemaError("Invalid timePlayed value.") from exc


def format_duration(seconds: float) -> str:
    seconds_i = max(0, int(seconds))
    hours, rem = divmod(seconds_i, 3600)
    minutes, seconds_i = divmod(rem, 60)
    return f"{hours}h {minutes}m {seconds_i}s"


def _dictionaries(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    validate_save(data)
    return _typed_value(data, "dictionaryOfDictionaries")


def get_player_upgrade(data: dict[str, Any], player_id: str, key: str) -> int:
    dictionaries = _dictionaries(data)
    values = dictionaries.get(key, {})
    if not isinstance(values, dict):
        return 0

    raw = values.get(player_id, 0)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def set_player_upgrade(
    data: dict[str, Any],
    player_id: str,
    key: str,
    value: int,
) -> None:
    if value < 0:
        raise ValueError("Upgrade values cannot be negative.")

    dictionaries = _dictionaries(data)
    values = dictionaries.setdefault(key, {})
    if not isinstance(values, dict):
        raise SaveSchemaError(f"Upgrade field '{key}' is not a dictionary.")

    values[player_id] = int(value)


def get_run_stat(data: dict[str, Any], key: str) -> int:
    run_stats = _dictionaries(data)["runStats"]
    raw = run_stats.get(key, 0)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def set_run_stat(data: dict[str, Any], key: str, value: int) -> None:
    run_stats = _dictionaries(data)["runStats"]
    run_stats[key] = int(value)

def get_player_health(data: dict, player_id: str) -> int:
    dictionaries = _dictionaries(data)
    values = dictionaries.get("playerHealth", {})
    return int(values.get(player_id, 0))


def set_player_health(data: dict, player_id: str, value: int) -> None:
    dictionaries = _dictionaries(data)
    values = dictionaries.setdefault("playerHealth", {})
    values[player_id] = int(value)