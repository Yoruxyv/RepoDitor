"""Validation and application of pending run-save changes."""

from __future__ import annotations

from collections.abc import Mapping

from repo_save_editor.core.schema import validate_run_save
from repo_save_editor.core.types import SaveData
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.mutations import refill_item_to_full
from repo_save_editor.services.items.schema import ITEM_KEY_PATTERN
from repo_save_editor.services.player.state import get_players, set_player_health
from repo_save_editor.services.player.upgrades import (
    discover_player_upgrades,
    set_player_upgrade,
)
from repo_save_editor.services.run import (
    get_available_run_stats,
    set_resume_location_from_label,
    set_run_stat_from_display,
)

MAX_CHANGES = 512


def _integer(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("A whole-number change value is required.")
    return value


def requested_refill_item_types(changes: object) -> tuple[str, ...]:
    """Return full item-type identities from syntactically plausible refill edits."""
    if not isinstance(changes, list):
        return ()
    names: dict[str, None] = {}
    for change in changes:
        if not isinstance(change, dict):
            continue
        if (
            change.get("feature") != "advanced"
            or change.get("field") != "refillToFull"
            or change.get("after") is not True
        ):
            continue
        entity = change.get("entity")
        if not isinstance(entity, str):
            continue
        match = ITEM_KEY_PATTERN.fullmatch(entity)
        if match is not None:
            names.setdefault(match.group("name"), None)
    return tuple(names)


def apply_run_save_changes(
    data: SaveData,
    changes: object,
    recharge_capabilities: Mapping[str, ItemRechargeCapability] | None = None,
) -> None:
    """Validate and apply one pending change set to an in-memory run save."""
    if not isinstance(changes, list) or not changes or len(changes) > MAX_CHANGES:
        raise ValueError("One to 512 pending changes are required.")

    players = {player.player_id for player in get_players(data)}
    upgrades = {upgrade.key for upgrade in discover_player_upgrades(data)}
    run_fields = {key for _, key, _ in get_available_run_stats(data)}
    seen: set[tuple[str, str, str]] = set()

    for change in changes:
        if not isinstance(change, dict) or set(change) != {
            "feature",
            "entity",
            "field",
            "after",
        }:
            raise ValueError("A pending change did not match the supported format.")
        feature = change["feature"]
        entity = change["entity"]
        field = change["field"]
        after = change["after"]
        if not all(isinstance(value, str) for value in (feature, entity, field)):
            raise ValueError("A pending change identifier is invalid.")

        signature = (feature, entity, field)
        if signature in seen:
            raise ValueError("Duplicate pending changes are not supported.")
        seen.add(signature)

        if feature == "players" and entity in players and field == "health":
            set_player_health(data, entity, _integer(after))
        elif feature == "upgrades" and entity in players and field in upgrades:
            set_player_upgrade(data, entity, field, _integer(after))
        elif feature == "run" and entity == "run" and field == "resumeLocation":
            if not isinstance(after, str):
                raise ValueError("Resume Location must be text.")
            set_resume_location_from_label(data, after)
        elif feature == "run" and entity == "run" and field in run_fields:
            set_run_stat_from_display(data, field, _integer(after))
        elif feature == "advanced" and field == "refillToFull" and after is True:
            match = ITEM_KEY_PATTERN.fullmatch(entity)
            capability = (
                ItemRechargeCapability.UNKNOWN
                if match is None or recharge_capabilities is None
                else recharge_capabilities.get(
                    match.group("name"),
                    ItemRechargeCapability.UNKNOWN,
                )
            )
            if capability is not ItemRechargeCapability.RECHARGEABLE:
                raise ValueError("Recharge capability could not be verified for the selected item.")
            refill_item_to_full(data, entity)
        else:
            raise ValueError("A pending change is not supported by this save.")

    validate_run_save(data)
