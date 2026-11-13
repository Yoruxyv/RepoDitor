"""Synthetic-only MetaSave transactions; Run sessions never authorize this file."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from typing import Any, TypedDict, cast

from repo_save_editor.core.crypto import encrypt_save_fields
from repo_save_editor.core.save_resources import SaveResourceError, bounded_save_operation
from repo_save_editor.desktop_api.cosmetics import (
    _apply_changes,
    _load_meta_save,
    _meta_path,
    _serialize,
)
from repo_save_editor.desktop_api.game_status import GameSafetyError, require_game_closed
from repo_save_editor.desktop_api.protocol import DesktopSaveError
from repo_save_editor.services.cosmetics.admission import admit_cosmetics
from repo_save_editor.services.game.processes import GameProcessStatus, get_game_process_status
from repo_save_editor.storage.health_recovery import (
    HealthTransaction,
    RecoveryError,
    health_lock,
    inspect_pending,
    valid_meta_intent,
    valid_operation,
)
from repo_save_editor.storage.repository import (
    SaveBackupError,
    SaveStaleError,
    SaveVerificationError,
)
from repo_save_editor.storage.windows_save_directory import SaveDirectory

FIELDS = frozenset({"cosmeticHistory", "cosmeticUnlocks", "cosmeticPresets", "colorPresets"})


def _failure(operation: str, status: str, reason: str) -> dict[str, object]:
    return {"ok": True, "operationId": operation, "status": status, "reason": reason}


def _reason(exc: Exception) -> str:
    if isinstance(exc, (RecoveryError, DesktopSaveError, GameSafetyError)):
        return exc.code
    if isinstance(exc, SaveResourceError):
        return "save_unsupported"
    if isinstance(exc, SaveBackupError):
        return "backup_failed"
    if isinstance(exc, SaveStaleError):
        return "save_stale"
    if isinstance(exc, SaveVerificationError):
        return "save_verification_failed"
    return "save_write_failed" if isinstance(exc, OSError) else "save_validation_failed"


def _changes(intent: dict[str, Any]) -> list[dict[str, object]]:
    action = intent["metaCosmetics"]
    tag = action["action"]
    if tag == "unlockIds":
        return [
            {"feature": "cosmetics", "entity": str(i), "field": "owned", "after": True}
            for i in action["ids"]
        ]
    entity, field, after = {
        "unlockAll": ("known", "unlockAll", True),
        "lockAll": ("known", "lockAll", False),
        "clearPresets": ("presets", "clearAll", True),
    }[tag]
    return [{"feature": "cosmetics", "entity": entity, "field": field, "after": after}]


class _Canonical(TypedDict):
    view: dict[str, object]
    admission: dict[str, str] | None


def _canonical(root: Path, directory: SaveDirectory | None) -> _Canonical:
    _path, data, source, _repository = _load_meta_save(root, directory)
    try:
        proof, catalog = admit_cosmetics(root.parents[2])
    except (OSError, ValueError, TypeError):
        proof, catalog = None, None
    return {
        "view": _serialize(data, source, catalog, preset_clearing_allowed=proof is not None),
        "admission": proof,
    }


@bounded_save_operation
def meta_state(root: Path, operation: str | None = None) -> dict[str, object]:
    """Read canonical state or independently inspect existing evidence without cleanup."""
    try:
        path = _meta_path(root)
        with health_lock(path) as directory:
            receipt = inspect_pending(path, directory)
            if receipt is not None:
                if operation is not None and operation != receipt.operation:
                    raise RecoveryError("write_conflict")
                operation = receipt.operation
            tx = HealthTransaction(path, operation or "0" * 32, directory=directory)
            pending = None
            if operation is not None:
                result = tx.inspect()
                if result["status"] not in {"applied", "unchanged"}:
                    raise RecoveryError("write_conflict")
                pending = {
                    **result,
                    "proof": tx.proof(),
                    "intent": receipt.intent if receipt else None,
                }
            canonical = _canonical(root, directory)
            return {
                "ok": True,
                "state": "pending" if pending else "idle",
                "pending": pending,
                "namespace": tx.namespace(),
                **canonical,
            }
    except (OSError, ValueError, TypeError, GameSafetyError, DesktopSaveError) as exc:
        return {"ok": True, "state": "busy" if _reason(exc) == "write_busy" else "blocked"}


@bounded_save_operation
def meta_write(
    root: Path,
    operation: str,
    fingerprint: str,
    intent: object,
    *,
    namespace: str,
    prepare: bool = False,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
) -> dict[str, object]:
    """Reserve or claim the same fixed action, then use the existing protected overwrite."""
    if not valid_operation(operation) or not valid_meta_intent(intent):
        return _failure(operation, "rejected", "invalid_request")
    value = cast(dict[str, Any], intent)
    tx = None
    try:
        path = _meta_path(root)
        with health_lock(path) as directory:
            tx = HealthTransaction(path, operation, intent=value, directory=directory)
            if tx.namespace() != namespace:
                raise RecoveryError("write_conflict")
            if prepare:
                tx.admit()
            else:
                tx.resume()
                if tx.intent != value:
                    raise RecoveryError("write_conflict")
            require_game_closed(game_status_loader)
            _path, data, source, repository = _load_meta_save(root, directory)
            if sha256(source).hexdigest() != fingerprint:
                raise RecoveryError("save_stale")
            proof, catalog = admit_cosmetics(root.parents[2])
            if proof["digest"] != value["metaCosmetics"]["admission"]:
                raise RecoveryError("save_stale")
            original = deepcopy(data)
            _apply_changes(data, _changes(value), catalog)
            if data == original:
                raise RecoveryError("save_validation_failed")
            if prepare:
                require_game_closed(game_status_loader)
                tx.prepare(source)
                return {"ok": True, "operationId": operation, "status": "prepared"}

            def before_replace() -> None:
                # Complete every catalog read before the last authoritative game query.
                current, _catalog = admit_cosmetics(root.parents[2])
                if current != proof:
                    raise RecoveryError("save_stale")
                require_game_closed(game_status_loader)

            _backup, written = repository.overwrite(
                path,
                data,
                expected_source=source,
                directory=directory,
                health_transaction=tx,
                encoder=lambda edited, original: encrypt_save_fields(edited, original, FIELDS),
                before_replace=before_replace,
            )
            result = tx.recover(own_completion=True)
            return {"ok": True, **result, "view": _serialize(data, written, catalog)}
    except (OSError, ValueError, TypeError, GameSafetyError, DesktopSaveError) as exc:
        return _failure(
            operation, "uncertain" if tx is not None and tx.started else "rejected", _reason(exc)
        )


@bounded_save_operation
def meta_recover(root: Path, operation: str, proof: str) -> dict[str, object]:
    """Settle only inspected evidence, never replace MetaSave bytes or replay intent."""
    try:
        path = _meta_path(root)
        with health_lock(path) as directory:
            tx = HealthTransaction(path, operation, directory=directory)
            result = tx.inspect()
            fingerprint = result["fingerprint"]
            if (
                result["status"] not in {"applied", "unchanged"}
                or not isinstance(fingerprint, str)
                or tx.proof() != proof
            ):
                raise RecoveryError("write_conflict")
            canonical = _canonical(root, directory)
            if canonical["view"]["fingerprint"] != fingerprint or tx.proof() != proof:
                raise RecoveryError("write_conflict")
            if tx.recover() != result or inspect_pending(path, directory) is not None:
                raise RecoveryError("write_conflict")
            return {
                "ok": True,
                **result,
                **canonical,
                "state": "idle",
                "namespace": tx.namespace(),
                "pending": None,
            }
    except (OSError, ValueError, TypeError, GameSafetyError, DesktopSaveError) as exc:
        return _failure(operation, "conflict", _reason(exc))
