"""Player-upgrade discovery and editing operations."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from repo_save_editor.core.schema import SaveSchemaError, get_dictionaries
from repo_save_editor.core.types import SaveData

UPGRADE_PREFIX = "playerUpgrade"

UPGRADE_LABEL_ALIASES: dict[str, str] = {
    "playerUpgradeLaunch": "Tumble Launch",
    "playerUpgradeSpeed": "Sprint Speed",
}

_CAMEL_ACRONYM_BOUNDARY = re.compile(r"(?<=[A-Z])(?=[A-Z][a-z])")
_CAMEL_WORD_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


class UpgradePresentationSource(StrEnum):
    """Origin of one player-facing upgrade label."""

    INSTALLED = "installed"
    ALIAS = "alias"
    HUMANIZED = "humanized"


@dataclass(frozen=True, slots=True)
class UpgradePresentation:
    """Optional presentation metadata that never authorizes mutation."""

    label: str
    source: UpgradePresentationSource
    installed_item_name: str | None = None
    icon_cache_key: str | None = None
    gameplay_cap: int | None = None


@dataclass(frozen=True, slots=True)
class PlayerUpgrade:
    """One player-upgrade dictionary discovered in a loaded save."""

    key: str
    label: str
    presentation_source: UpgradePresentationSource
    icon_cache_key: str | None
    gameplay_cap: int | None


def _humanize_upgrade_key(key: str) -> str:
    suffix = key.removeprefix(UPGRADE_PREFIX).replace("_", " ").strip()
    if not suffix:
        return key

    suffix = _CAMEL_ACRONYM_BOUNDARY.sub(" ", suffix)
    suffix = _CAMEL_WORD_BOUNDARY.sub(" ", suffix)
    return " ".join(suffix.split())


def get_upgrade_label(key: str) -> str:
    """Return a friendly fail-soft label for any upgrade key."""
    return get_fallback_presentation(key).label


def get_fallback_presentation(key: str) -> UpgradePresentation:
    """Return the tiny semantic-alias or open CamelCase fallback."""
    alias = UPGRADE_LABEL_ALIASES.get(key)
    return UpgradePresentation(
        alias or _humanize_upgrade_key(key),
        UpgradePresentationSource.ALIAS if alias else UpgradePresentationSource.HUMANIZED,
    )


def discover_player_upgrades(
    data: SaveData,
    presentations: Mapping[str, UpgradePresentation] | None = None,
) -> tuple[PlayerUpgrade, ...]:
    """Discover player-upgrade dictionaries from the loaded save itself.

    Installed metadata is optional presentation only. Newer game versions and
    modded saves remain visible and editable through the same prefix rule.
    """
    dictionaries = get_dictionaries(data)
    upgrades = [
        PlayerUpgrade(
            key,
            presentation.label,
            presentation.source,
            presentation.icon_cache_key,
            presentation.gameplay_cap,
        )
        for key, value in dictionaries.items()
        if isinstance(key, str)
        and key.startswith(UPGRADE_PREFIX)
        and key != UPGRADE_PREFIX
        and isinstance(value, dict)
        for presentation in [(presentations or {}).get(key, get_fallback_presentation(key))]
    ]
    upgrades.sort(
        key=lambda upgrade: (
            upgrade.presentation_source != UpgradePresentationSource.INSTALLED,
            upgrade.label.casefold(),
            upgrade.key,
        )
    )
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
