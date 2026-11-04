"""Opt-in single-player health transactions; Electron's existing writes stay unchanged."""

from __future__ import annotations

from collections.abc import Callable
from hashlib import sha256
from pathlib import Path
from typing import cast

from repo_save_editor.desktop_api.game_status import GameSafetyError, require_game_closed
from repo_save_editor.desktop_api.player.players import serialize_players
from repo_save_editor.desktop_api.protocol import DesktopSaveError
from repo_save_editor.desktop_api.run_save_changes import apply_run_save_changes
from repo_save_editor.desktop_api.saves import (
    load_discovered_save,
    save_changes,
    serialize_open_save,
)
from repo_save_editor.services.game.processes import GameProcessStatus, get_game_process_status
from repo_save_editor.services.player.state import get_player_health
from repo_save_editor.services.saves.discovery import discover_saves
from repo_save_editor.storage.health_recovery import (
    HealthTransaction,
    RecoveryError,
    health_lock,
    inspect_pending,
    valid_operation,
)


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


def _path(save_id: str, root: Path) -> Path:
    for save in discover_saves(root).saves:
        if save.identifier == save_id:
            return save.path
    raise RecoveryError("save_missing")


def prepare_health(
    save_id: str,
    fingerprint: str,
    changes: object,
    operation: str,
    root: Path,
    *,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
    remember_intent: bool = False,
) -> dict[str, object]:
    """Reserve the target without writing save bytes, before the host launches a writer."""
    if not valid_operation(operation) or not _health_change(changes):
        return _outcome(operation, "rejected", "invalid_request")
    try:
        path = _path(save_id, root)
        with health_lock(path):
            transaction = HealthTransaction(path, operation)
            transaction.admit()
            require_game_closed(game_status_loader)
            _save, data, source = load_discovered_save(save_id, root)
            if sha256(source).hexdigest() != fingerprint:
                return _outcome(operation, "rejected", "save_stale")
            change = cast(list[dict[str, object]], changes)[0]
            before = get_player_health(data, cast(str, change["entity"]))
            apply_run_save_changes(data, changes, {})
            require_game_closed(game_status_loader)
            if remember_intent:
                transaction = HealthTransaction(
                    path,
                    operation,
                    intent={
                        "playerId": change["entity"],
                        "health": change["after"],
                        "before": before,
                    },
                )
            transaction.prepare(source)
            return _outcome(operation, "prepared")
    except (RecoveryError, DesktopSaveError, GameSafetyError) as exc:
        return _outcome(operation, "rejected", exc.code)
    except (OSError, ValueError, TypeError):
        return _outcome(operation, "rejected", "backend_unavailable")


def _health_change(changes: object) -> bool:
    return (
        isinstance(changes, list)
        and len(changes) == 1
        and isinstance(changes[0], dict)
        and set(changes[0]) == {"feature", "entity", "field", "after"}
        and changes[0].get("feature") == "players"
        and changes[0].get("field") == "health"
    )


def write_health(
    save_id: str,
    fingerprint: str,
    changes: object,
    operation: str,
    root: Path,
    *,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
    reserved: bool = False,
) -> dict[str, object]:
    """Delegate exactly one typed health edit, recording ambiguous completion explicitly."""
    transaction: HealthTransaction | None = None
    if not valid_operation(operation):
        return _outcome(operation, "rejected", "invalid_request")
    if not _health_change(changes):
        return _outcome(operation, "rejected", "invalid_request")
    try:
        path = _path(save_id, root)
        with health_lock(path):
            transaction = HealthTransaction(path, operation)
            if reserved:
                transaction.resume()
                change = cast(list[dict[str, object]], changes)[0]
                if transaction.intent is not None and (
                    transaction.intent["playerId"] != change["entity"]
                    or transaction.intent["health"] != change["after"]
                ):
                    return _outcome(operation, "uncertain", "invalid_request")
            else:
                transaction.admit()
            result = save_changes(
                save_id,
                fingerprint,
                changes,
                root,
                game_status_loader=game_status_loader,
                health_transaction=transaction,
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
    except RecoveryError as exc:
        status = "uncertain" if transaction is not None and transaction.started else "rejected"
        return _outcome(operation, status, exc.code)
    except (OSError, ValueError, TypeError):
        return _outcome(
            operation,
            "uncertain" if transaction is not None and transaction.started else "rejected",
            "backend_unavailable",
        )


def recover_health(
    save_id: str, operation: str, root: Path, *, canonical: bool = False, acknowledge: bool = True
) -> dict[str, object]:
    """Inspect authoritative bytes under the exited-owner lock; never apply pending intent."""
    if not valid_operation(operation):
        return _outcome(operation, "conflict", "invalid_request")
    try:
        path = _path(save_id, root)
        with health_lock(path):
            transaction = HealthTransaction(path, operation)
            result = transaction.recover(acknowledge=not canonical)
            if canonical:
                result["canonical"] = _canonical(save_id, root, cast(str, result["fingerprint"]))
                if acknowledge:
                    transaction.recover()
            return {"ok": True, "transaction": {**result, "reason": None}}
    except RecoveryError as exc:
        return _outcome(operation, "busy" if exc.code == "write_busy" else "conflict", exc.code)
    except (OSError, ValueError, TypeError):
        return _outcome(operation, "conflict", "backend_unavailable")


def _canonical(save_id: str, root: Path, fingerprint: str | None = None) -> dict[str, object]:
    save, data, source = load_discovered_save(save_id, root)
    if fingerprint is not None and sha256(source).hexdigest() != fingerprint:
        raise RecoveryError("write_conflict")
    return {"opened": serialize_open_save(save, data, source), "players": serialize_players(data)}


def health_state(save_id: str, root: Path) -> dict[str, object]:
    """Rediscover pending identity/intent without acknowledging or replaying an operation."""
    try:
        path = _path(save_id, root)
        with health_lock(path):
            receipt = inspect_pending(path)
            if receipt is None:
                return {"ok": True, "state": "idle", "canonical": _canonical(save_id, root)}
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
