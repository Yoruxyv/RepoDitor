"""Opt-in Health, Upgrades and Run intents over the shared Python save-write boundary."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from hashlib import sha256
from pathlib import Path
from typing import Any, cast

from repo_save_editor.core.save_resources import SaveResourceError, bounded_save_operation
from repo_save_editor.core.schema import SAVE_INT32_MAX, get_dictionaries
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.editor.game_status import GameSafetyError, require_game_closed
from repo_save_editor.desktop_api.items import RechargeCapabilityLoader, serialize_advanced_save
from repo_save_editor.desktop_api.player.players import serialize_players
from repo_save_editor.desktop_api.player.upgrades import serialize_upgrades
from repo_save_editor.desktop_api.protocol import DesktopSaveError, save_access_reason
from repo_save_editor.desktop_api.saves.run import serialize_run
from repo_save_editor.desktop_api.saves.saves import (
    load_discovered_save,
    save_changes,
    serialize_open_save,
)
from repo_save_editor.desktop_api.transactions.run_save_changes import (
    apply_run_save_changes,
    requested_refill_item_types,
)
from repo_save_editor.services.artwork.baked_artwork import entry_artwork_revision
from repo_save_editor.services.game.processes import GameProcessStatus, get_game_process_status
from repo_save_editor.services.items.discovery import discover_advanced_save
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.recharge_capability import (
    discover_installed_recharge_capabilities,
)
from repo_save_editor.services.player.state import get_player_health, get_players
from repo_save_editor.services.player.upgrades import discover_player_upgrades, get_player_upgrade
from repo_save_editor.services.run import get_available_run_stats, get_resume_location_label
from repo_save_editor.services.saves.discovery import discover_saves
from repo_save_editor.services.saves.private_health import Approval
from repo_save_editor.storage.health_recovery import (
    HealthTransaction,
    RecoveryError,
    _snapshot,
    health_lock,
    inspect_pending,
    valid_operation,
)
from repo_save_editor.storage.receipt_intents import (
    valid_health_batch_intent,
    valid_mixed_intent,
    valid_refill_intent,
    valid_run_intent,
    valid_upgrade_intent,
)
from repo_save_editor.storage.windows_save_directory import SaveDirectory


def _outcome(operation: str, status: str, reason: str | None = None) -> dict[str, object]:
    return {
        "ok": True,
        "transaction": {
            "operationId": operation,
            "status": status,
            "fingerprint": None,
            "backupAvailable": False,
            "reason": reason,
        },
    }


def _reason(error: Exception, fallback: str, *, single: bool) -> str:
    if single and fallback not in {"write_busy", "game_status_unknown"}:
        return save_access_reason(error) or fallback
    return fallback


def _path(save_id: str, root: Path) -> Path:
    for save in discover_saves(root).saves:
        if save.identifier == save_id:
            return save.path
    raise RecoveryError("save_missing")


def _refill_changes(
    data: SaveData, changes: object, loader: RechargeCapabilityLoader
) -> tuple[list[dict[str, object]], Mapping[str, ItemRechargeCapability]]:
    edits = cast(list[dict[str, Any]], changes)
    engine = [
        {"feature": "advanced", "entity": edit["saveKey"], "field": "refillToFull", "after": True}
        for edit in edits
    ]
    capabilities = loader(requested_refill_item_types(engine))
    items = {item.save_key: item for item in discover_advanced_save(data, capabilities).items}
    for edit in edits:
        item = items.get(edit["saveKey"])
        if item is None or not item.can_refill_to_full:
            raise DesktopSaveError("save_validation_failed", "The item cannot be safely refilled.")
        if item.stored_charge != edit["before"]:
            raise DesktopSaveError("save_stale", "The item's stored charge changed after opening.")
    return engine, capabilities


def _health_changes(
    data: SaveData,
    changes: object,
    *,
    verify_health_field: bool = False,
    allow_missing_health: bool = False,
) -> list[dict[str, object]]:
    players = {player.player_id for player in get_players(data)}
    result = []
    for edit in cast(list[dict[str, Any]], changes):
        player = edit["playerId"]
        if player not in players:
            raise DesktopSaveError("save_validation_failed", "The player is unavailable.")
        if verify_health_field:
            values = get_dictionaries(data).get("playerHealth", {})
            missing = 0 if allow_missing_health else None
            raw_health = values.get(player, missing) if isinstance(values, dict) else None
            if type(raw_health) is not int or not 0 <= raw_health <= SAVE_INT32_MAX:
                raise DesktopSaveError("save_validation_failed", "The Health field is unsupported.")
        if get_player_health(data, player) != edit["before"]:
            raise DesktopSaveError("save_stale", "The player's Health changed after it was opened.")
        result.append(
            {"feature": "players", "entity": player, "field": "health", "after": edit["value"]}
        )
    return result


def _run_changes(data: SaveData, changes: object) -> list[dict[str, object]]:
    available: dict[str, object] = {
        key: value for _label, key, value in get_available_run_stats(data)
    }
    available["resumeLocation"] = get_resume_location_label(data)
    raw = get_dictionaries(data)["runStats"]
    result = []
    for edit in cast(list[dict[str, Any]], changes):
        field = edit["field"]
        if (
            field not in available
            or type(raw.get("save level" if field == "resumeLocation" else field, 0)) is not int
        ):
            raise DesktopSaveError("save_validation_failed", "The Run field is unavailable.")
        if available[field] != edit["before"]:
            raise DesktopSaveError("save_stale", "The Run field changed after it was opened.")
        result.append({"feature": "run", "entity": "run", "field": field, "after": edit["value"]})
    return result


def _upgrade_changes(data: SaveData, changes: object) -> list[dict[str, object]]:
    players = {player.player_id for player in get_players(data)}
    keys = {upgrade.key for upgrade in discover_player_upgrades(data)}
    result = []
    for edit in cast(list[dict[str, Any]], changes):
        if edit["playerId"] not in players or edit["key"] not in keys:
            raise DesktopSaveError(
                "save_validation_failed", "The upgrade or player is unavailable."
            )
        if get_player_upgrade(data, edit["playerId"], edit["key"]) != edit["before"]:
            raise DesktopSaveError("save_stale", "The upgrade changed after it was opened.")
        result.append(
            {
                "feature": "upgrades",
                "entity": edit["playerId"],
                "field": edit["key"],
                "after": edit["value"],
            }
        )
    return result


def _runtime_dictionary_types(data: SaveData) -> bool:
    def dictionary_type(key: str, *, nested: bool) -> bool:
        entry = data.get(key)
        typename = entry.get("__type") if isinstance(entry, dict) else None
        if not isinstance(typename, str) or len(typename) > 1024:
            return False
        generic = "System.Collections.Generic.Dictionary`2"
        short_value = f"{generic}[System.String,System.Int32]" if nested else "System.String"
        qualified_value = (
            f"{generic}[[System.String],[System.Int32]]" if nested else "System.String"
        )
        normalized = (
            typename.replace(" ", "")
            .replace(
                ",mscorlib,Version=4.0.0.0,Culture=neutral,PublicKeyToken=b77a5c561934e089",
                ",mscorlib",
            )
            .replace(",mscorlib", "")
        )
        return normalized in {
            "Dictionary",
            f"{generic}[System.String,{short_value}]",
            f"{generic}[[System.String],[{qualified_value}]]",
        }

    return dictionary_type("playerNames", nested=False) and dictionary_type(
        "dictionaryOfDictionaries", nested=True
    )


def _runtime_resume_field(data: SaveData) -> bool:
    values = get_dictionaries(data).get("runStats")
    previous: object = values.get("save level") if isinstance(values, dict) else None
    return type(previous) is int and previous in (0, 1)


def validate_runtime_write(intent: dict[str, object], resume_allowed: bool, data: SaveData) -> None:
    """Restrict runtime-validated writes to the supported types in the loaded save."""
    if not _runtime_dictionary_types(data):
        raise DesktopSaveError("save_unsupported", "The save's dictionary types are unsupported.")
    dictionaries = get_dictionaries(data)
    domains = intent if "mixed" not in intent else cast(dict[str, object], intent["mixed"])
    for domain, edits in domains.items():
        if domain == "refillToFull":
            # _refill_changes independently verifies the existing exact charge and instance.
            continue
        for edit in cast(list[dict[str, Any]], edits):
            if domain == "health":
                group, field = "playerHealth", edit["playerId"]
            elif domain == "upgrades":
                group, field = edit["key"], edit["playerId"]
            elif domain == "run":
                group = "runStats"
                field = "save level" if edit["field"] == "resumeLocation" else edit["field"]
            else:
                raise DesktopSaveError("save_unsupported", "The save field is unsupported.")
            values = dictionaries.get(group)
            previous: object = values.get(field) if isinstance(values, dict) else None
            if type(previous) is not int or not -(2**31) <= previous <= SAVE_INT32_MAX:
                raise DesktopSaveError(
                    "save_unsupported", "The existing save field is unsupported."
                )
            if field == "save level" and (not resume_allowed or previous not in (0, 1)):
                raise DesktopSaveError("save_unsupported", "The Resume contract is unsupported.")


def _verify_target(verify: Callable[[SaveData], None] | None, data: SaveData) -> None:
    if verify is not None:
        verify(data)


def _mixed_changes(
    data: SaveData,
    changes: object,
    loader: RechargeCapabilityLoader,
    *,
    verify_health_field: bool = False,
    allow_missing_health: bool = False,
) -> tuple[list[dict[str, object]], Mapping[str, ItemRechargeCapability]]:
    groups = cast(dict[str, list[object]], changes)
    edits = _health_changes(
        data,
        groups["health"],
        verify_health_field=verify_health_field,
        allow_missing_health=allow_missing_health,
    )
    edits.extend(_upgrade_changes(data, groups["upgrades"]))
    edits.extend(_run_changes(data, groups["run"]))
    if groups["refillToFull"]:
        refills, capabilities = _refill_changes(data, groups["refillToFull"], loader)
        return edits + refills, capabilities
    return edits, {}


@bounded_save_operation
def prepare_health(
    save_id: str,
    fingerprint: str,
    changes: object,
    operation: str,
    root: Path,
    *,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
    remember_intent: bool = False,
    refill_batch: bool = False,
    health_batch: bool = False,
    upgrade_batch: bool = False,
    run_batch: bool = False,
    mixed_batch: bool = False,
    verify_source_identity: bool = False,
    allow_missing_health: bool = False,
    approval: Approval | None = None,
    recharge_capability_loader: RechargeCapabilityLoader = discover_installed_recharge_capabilities,
    verify_target: Callable[[SaveData], None] | None = None,
) -> dict[str, object]:
    """Reserve the target without writing save bytes, before the host launches a writer."""
    single = not (refill_batch or health_batch or upgrade_batch or run_batch or mixed_batch)
    valid = _valid_changes(
        changes,
        refill_batch=refill_batch,
        health_batch=health_batch,
        upgrade_batch=upgrade_batch,
        run_batch=run_batch,
        mixed_batch=mixed_batch,
    )
    if not valid_operation(operation) or not valid:
        return _outcome(operation, "rejected", "invalid_request")
    try:
        path = _path(save_id, root)
        with health_lock(path) as directory:
            transaction = HealthTransaction(path, operation, directory=directory)
            transaction.admit()
            require_game_closed(game_status_loader)
            identity = None
            if single or mixed_batch or verify_source_identity or approval is not None:
                current, identity = _snapshot(path, directory)
                if current != fingerprint or (
                    approval is not None
                    and (
                        (current, identity) != approval.original
                        or transaction.namespace() != approval.namespace
                    )
                ):
                    return _outcome(operation, "rejected", "save_stale")
            _save, data, source = load_discovered_save(save_id, root, directory=directory)
            if sha256(source).hexdigest() != fingerprint:
                return _outcome(operation, "rejected", "save_stale")
            _verify_target(verify_target, data)
            engine_changes: object
            capabilities: Mapping[str, ItemRechargeCapability] = {}
            if mixed_batch:
                intent = {"mixed": changes}
                engine_changes, capabilities = _mixed_changes(
                    data,
                    changes,
                    recharge_capability_loader,
                    verify_health_field=verify_source_identity,
                    allow_missing_health=allow_missing_health,
                )
            elif refill_batch:
                intent = {"refillToFull": changes}
                engine_changes, capabilities = _refill_changes(
                    data, changes, recharge_capability_loader
                )
            elif health_batch:
                intent = {"health": changes}
                engine_changes = _health_changes(
                    data,
                    changes,
                    verify_health_field=verify_source_identity,
                    allow_missing_health=allow_missing_health,
                )
            elif run_batch:
                intent = {"run": changes}
                engine_changes = _run_changes(data, changes)
            elif upgrade_batch:
                intent = {"upgrades": changes}
                engine_changes = _upgrade_changes(data, changes)
            else:
                change = cast(list[dict[str, object]], changes)[0]
                intent = {
                    "playerId": change["entity"],
                    "health": change["after"],
                    "before": get_player_health(data, cast(str, change["entity"])),
                }
                engine_changes = changes
            apply_run_save_changes(data, engine_changes, capabilities)
            require_game_closed(game_status_loader)
            if remember_intent or not single:
                transaction = HealthTransaction(
                    path,
                    operation,
                    directory=directory,
                    intent=intent,
                )
            transaction.prepare(source, expected_identity=identity)
            return _outcome(operation, "prepared")
    except (RecoveryError, DesktopSaveError, GameSafetyError) as exc:
        return _outcome(
            operation, "rejected", _reason(exc, exc.code, single=single or verify_source_identity)
        )
    except SaveResourceError:
        return _outcome(operation, "rejected", "save_unsupported")
    except (ValueError, TypeError):
        return _outcome(
            operation,
            "rejected",
            "backend_unavailable" if single else "save_validation_failed",
        )
    except OSError as exc:
        return _outcome(
            operation,
            "rejected",
            _reason(exc, "backend_unavailable", single=single or verify_source_identity),
        )


def _health_change(changes: object) -> bool:
    return (
        isinstance(changes, list)
        and len(changes) == 1
        and isinstance(changes[0], dict)
        and set(changes[0]) == {"feature", "entity", "field", "after"}
        and changes[0].get("feature") == "players"
        and changes[0].get("field") == "health"
    )


def _valid_changes(
    changes: object,
    *,
    refill_batch: bool,
    health_batch: bool,
    upgrade_batch: bool,
    run_batch: bool,
    mixed_batch: bool,
) -> bool:
    if sum((refill_batch, health_batch, upgrade_batch, run_batch, mixed_batch)) > 1:
        return False
    if mixed_batch:
        return valid_mixed_intent({"mixed": changes})
    if refill_batch:
        return valid_refill_intent({"refillToFull": changes})
    if health_batch:
        return valid_health_batch_intent({"health": changes})
    if run_batch:
        return valid_run_intent({"run": changes})
    if upgrade_batch:
        return valid_upgrade_intent({"upgrades": changes})
    return _health_change(changes)


@bounded_save_operation
def write_health(
    save_id: str,
    fingerprint: str,
    changes: object,
    operation: str,
    root: Path,
    *,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
    reserved: bool = False,
    own_reservation: bool = False,
    refill_batch: bool = False,
    health_batch: bool = False,
    upgrade_batch: bool = False,
    run_batch: bool = False,
    mixed_batch: bool = False,
    verify_source_identity: bool = False,
    allow_missing_health: bool = False,
    verify_build: Callable[[], None] | None = None,
    approval: Approval | None = None,
    recharge_capability_loader: RechargeCapabilityLoader = discover_installed_recharge_capabilities,
    verify_target: Callable[[SaveData], None] | None = None,
) -> dict[str, object]:
    """Delegate one typed domain intent, recording ambiguous completion explicitly."""
    single = not (refill_batch or health_batch or upgrade_batch or run_batch or mixed_batch)
    transaction: HealthTransaction | None = None
    if not valid_operation(operation) or (mixed_batch and not reserved):
        return _outcome(operation, "rejected", "invalid_request")
    valid = _valid_changes(
        changes,
        refill_batch=refill_batch,
        health_batch=health_batch,
        upgrade_batch=upgrade_batch,
        run_batch=run_batch,
        mixed_batch=mixed_batch,
    )
    if not valid:
        return _outcome(operation, "rejected", "invalid_request")
    try:
        path = _path(save_id, root)
        with health_lock(path) as directory:
            transaction = HealthTransaction(
                path,
                operation,
                directory=directory,
                intent={"mixed": changes}
                if mixed_batch
                else {"refillToFull": changes}
                if refill_batch
                else {"health": changes}
                if health_batch
                else {"run": changes}
                if run_batch
                else {"upgrades": changes}
                if upgrade_batch
                else None,
            )
            if approval is not None and (
                _snapshot(path, directory) != approval.original
                or transaction.namespace() != approval.namespace
            ):
                raise RecoveryError("save_stale")
            if reserved:
                requested = transaction.intent
                transaction.resume(own_reservation=own_reservation)
                mismatch = transaction.intent != requested
                if single and transaction.intent is not None:
                    change = cast(list[dict[str, object]], changes)[0]
                    mismatch = (
                        "playerId" not in transaction.intent
                        or transaction.intent["playerId"] != change["entity"]
                        or transaction.intent["health"] != change["after"]
                    )
                if mismatch:
                    return _outcome(operation, "uncertain", "invalid_request")
            else:
                transaction.admit()
            if not single:
                _, data, _ = load_discovered_save(save_id, root, directory=directory)
                _verify_target(verify_target, data)
                changes = (
                    _mixed_changes(
                        data,
                        changes,
                        recharge_capability_loader,
                        verify_health_field=verify_source_identity,
                        allow_missing_health=allow_missing_health,
                    )[0]
                    if mixed_batch
                    else _refill_changes(data, changes, recharge_capability_loader)[0]
                    if refill_batch
                    else _health_changes(
                        data,
                        changes,
                        verify_health_field=verify_source_identity,
                        allow_missing_health=allow_missing_health,
                    )
                    if health_batch
                    else _run_changes(data, changes)
                    if run_batch
                    else _upgrade_changes(data, changes)
                )

            def verify_before_replace() -> None:
                if verify_build is not None:
                    verify_build()
                transaction.verify_before_replace()

            result = save_changes(
                save_id,
                fingerprint,
                changes,
                root,
                game_status_loader=game_status_loader,
                recharge_capability_loader=recharge_capability_loader,
                health_transaction=transaction,
                verify_replacement=verify_before_replace
                if single or mixed_batch or verify_source_identity
                else None,
            )
            if result["ok"] is not True:
                error = cast(dict[str, object], result["error"])
                return _outcome(
                    operation,
                    "uncertain" if transaction.started else "rejected",
                    cast(str, error["code"]),
                )
            return {
                "ok": True,
                "transaction": {**transaction.recover(own_completion=True), "reason": None},
            }
    except (DesktopSaveError, RecoveryError) as exc:
        return _outcome(
            operation,
            "uncertain" if transaction is not None and transaction.started else "rejected",
            _reason(exc, exc.code, single=single or verify_source_identity),
        )
    except SaveResourceError:
        status = "uncertain" if transaction is not None and transaction.started else "rejected"
        return _outcome(operation, status, "save_unsupported")
    except (OSError, ValueError, TypeError) as exc:
        return _outcome(
            operation,
            "uncertain" if transaction is not None and transaction.started else "rejected",
            _reason(exc, "backend_unavailable", single=single or verify_source_identity),
        )


@bounded_save_operation
def recover_health(
    save_id: str,
    operation: str,
    root: Path,
    *,
    canonical: bool = False,
    game_root: Path | None = None,
    acknowledge: bool = True,
    intent_allowed: Callable[[object], bool] | None = None,
    approval: Approval | None = None,
    recharge_capability_loader: RechargeCapabilityLoader | None = None,
) -> dict[str, object]:
    """Inspect authoritative bytes under the exited-owner lock; never apply pending intent."""
    if not valid_operation(operation):
        return _outcome(operation, "conflict", "invalid_request")
    try:
        path = _path(save_id, root)
        with health_lock(path) as directory:
            transaction = HealthTransaction(path, operation, directory=directory)
            if approval is not None and transaction.namespace() != approval.namespace:
                raise RecoveryError("write_conflict")
            original = approval.original if approval is not None else None
            if intent_allowed is not None and not intent_allowed(
                transaction.inspect_intent(original)
            ):
                raise RecoveryError("save_unsupported")
            if canonical:
                # Preflight decoding before recovery can settle receipts or clean staging.
                load_discovered_save(save_id, root, directory=directory)
            result = transaction.recover(acknowledge=not canonical)
            if canonical:
                result["canonical"] = _canonical(
                    save_id,
                    root,
                    cast(str, result["fingerprint"]),
                    directory,
                    transaction.intent,
                    game_root=game_root,
                    recharge_capability_loader=recharge_capability_loader,
                )
                if acknowledge:
                    transaction.recover()
            return {"ok": True, "transaction": {**result, "reason": None}}
    except RecoveryError as exc:
        return _outcome(operation, "busy" if exc.code == "write_busy" else "conflict", exc.code)
    except SaveResourceError:
        return _outcome(operation, "conflict", "save_unsupported")
    except DesktopSaveError as exc:
        return _outcome(operation, "conflict", exc.code)
    except (OSError, ValueError, TypeError):
        return _outcome(operation, "conflict", "backend_unavailable")


def _canonical(
    save_id: str,
    root: Path,
    fingerprint: str | None = None,
    directory: SaveDirectory | None = None,
    intent: dict[str, object] | None = None,
    *,
    game_root: Path | None = None,
    recharge_capability_loader: RechargeCapabilityLoader | None = None,
    check_runtime_resume: bool = False,
) -> dict[str, object]:
    save, data, source = load_discovered_save(save_id, root, directory=directory)
    if fingerprint is not None and sha256(source).hexdigest() != fingerprint:
        raise RecoveryError("write_conflict")
    result: dict[str, object] = {
        "opened": serialize_open_save(save, data, source),
        "players": serialize_players(data),
        "upgrades": serialize_upgrades(data),
        "run": serialize_run(data),
    }
    if check_runtime_resume:
        result["resumeFieldSupported"] = _runtime_dictionary_types(data) and _runtime_resume_field(
            data
        )
    artwork_revision = entry_artwork_revision(game_root) if game_root is not None else None
    refill_receipt = valid_refill_intent(intent) or (
        intent is not None
        and valid_mixed_intent(intent)
        and bool(cast(dict[str, object], intent["mixed"])["refillToFull"])
    )
    if recharge_capability_loader is not None or refill_receipt:
        if recharge_capability_loader is None:
            advanced = serialize_advanced_save(data, reuse_native_metadata=game_root is not None)
        else:
            advanced = serialize_advanced_save(
                data,
                reuse_native_metadata=game_root is not None,
                capability_loader=recharge_capability_loader,
            )
        if advanced.get("ok") is True:
            result["advanced"] = advanced["advanced"]
        elif refill_receipt:
            raise DesktopSaveError("save_unsupported", "Canonical item state is unavailable.")
        if artwork_revision is not None and artwork_revision != entry_artwork_revision(game_root):
            artwork_revision = None
    if artwork_revision is not None:
        result["artworkRevision"] = artwork_revision
    return result


@bounded_save_operation
def health_state(
    save_id: str,
    root: Path,
    *,
    intent_allowed: Callable[[object], bool] | None = None,
    approval: Approval | None = None,
    recharge_capability_loader: RechargeCapabilityLoader | None = None,
    game_root: Path | None = None,
    check_runtime_resume: bool = False,
) -> dict[str, object]:
    """Rediscover pending identity/intent without acknowledging or replaying an operation."""
    try:
        path = _path(save_id, root)
        with health_lock(path) as directory:
            receipt = inspect_pending(path, directory)
            if approval is not None:
                if (
                    HealthTransaction(path, "0" * 32, directory=directory).namespace()
                    != approval.namespace
                ):
                    raise RecoveryError("write_conflict")
                if receipt is None and _snapshot(path, directory) != approval.original:
                    return {"ok": True, "state": "disabled"}
                if (
                    receipt is not None
                    and (receipt.before, receipt.before_identity) != approval.original
                ):
                    raise RecoveryError("write_conflict")
            if receipt is None:
                return {
                    "ok": True,
                    "state": "idle",
                    "canonical": _canonical(
                        save_id,
                        root,
                        directory=directory,
                        game_root=game_root,
                        recharge_capability_loader=recharge_capability_loader,
                        check_runtime_resume=check_runtime_resume,
                    ),
                }
            if intent_allowed is not None and not intent_allowed(receipt.intent):
                return {"ok": True, "state": "blocked"}
            return {
                "ok": True,
                "state": "pending",
                "pending": {
                    "operationId": receipt.operation,
                    "fingerprint": receipt.before,
                    "intent": receipt.intent,
                },
            }
    except RecoveryError as exc:
        return {"ok": True, "state": "busy" if exc.code == "write_busy" else "blocked"}
    except (DesktopSaveError, OSError, TypeError, ValueError):
        return {"ok": True, "state": "blocked"}
