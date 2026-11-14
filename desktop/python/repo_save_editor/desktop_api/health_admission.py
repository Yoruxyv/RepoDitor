"""Single-player Health transactions with explicitly injected fixture admission."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from re import fullmatch
from secrets import token_hex
from threading import Lock
from time import monotonic
from typing import cast

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.save_resources import SaveResourceError, bounded_save_operation
from repo_save_editor.core.schema import SAVE_INT32_MAX, get_dictionaries, get_typed_value
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.game_status import GameSafetyError, require_game_closed
from repo_save_editor.desktop_api.protocol import DesktopSaveError
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.player.state import set_player_health
from repo_save_editor.services.saves.discovery import SAVE_SLOT_PATTERN, SAVE_SLOT_TIMESTAMP_FORMAT
from repo_save_editor.storage.health_recovery import (
    HealthTransaction,
    RecoveryError,
    _snapshot,
    health_lock,
    inspect_pending,
    valid_operation,
)
from repo_save_editor.storage.repository import (
    SaveBackupError,
    SaveRepository,
    SaveStaleError,
    SaveVerificationError,
    read_save_bytes,
)
from repo_save_editor.storage.windows_save_directory import SaveDirectory

_GRANT_SECONDS = 60
_FIXTURE_AREA = Path(__file__).resolve().parents[3] / "build" / "health-admission-fixtures"


@dataclass(frozen=True, slots=True)
class HealthResult:
    status: str
    operation_id: str | None = None
    reason: str | None = None
    fingerprint: str | None = None
    backup_available: bool = False
    health: int | None = None


@dataclass(frozen=True, slots=True)
class _Grant:
    token: str
    operation: str
    save: str
    path: Path
    namespace: str
    fingerprint: str
    identity: list[int]
    player: str
    before: int
    health: int
    expires: float


def _existing_health(data: SaveData, player: str) -> int:
    players = get_typed_value(data, "playerNames")
    dictionaries = get_dictionaries(data)
    values = dictionaries.get("playerHealth")
    upgrades = dictionaries.get("playerUpgradeHealth", {})
    # These are the checked-in fixture wrappers. Installed-game admission needs its own schema evidence.
    if (
        data["playerNames"].get("__type") != "Dictionary"
        or data["dictionaryOfDictionaries"].get("__type") != "Dictionary"
        or player not in players
        or not isinstance(players[player], str)
        or not isinstance(values, dict)
        or type(before := values.get(player)) is not int
        or not 0 <= before <= SAVE_INT32_MAX
        or not isinstance(upgrades, dict)
        or type(upgrade := upgrades.get(player, 0)) is not int
        or not 0 <= upgrade <= SAVE_INT32_MAX
    ):
        raise RecoveryError("save_validation_failed")
    return before


def _load(path: Path, directory: SaveDirectory | None, fingerprint: str) -> tuple[SaveData, bytes]:
    source = read_save_bytes(path, directory)
    if sha256(source).hexdigest() != fingerprint:
        raise RecoveryError("save_stale")
    return SaveRepository.load_bytes(source), source


def _reason(exc: Exception) -> str:
    if isinstance(exc, (RecoveryError, GameSafetyError, DesktopSaveError)):
        return exc.code
    if isinstance(exc, (SaveResourceError, SaveCryptoError)):
        return "save_unsupported"
    if isinstance(exc, SaveBackupError):
        return "backup_failed"
    if isinstance(exc, SaveStaleError):
        return "save_stale"
    if isinstance(exc, SaveVerificationError):
        return "save_verification_failed"
    if isinstance(exc, OSError):
        return "save_write_failed"
    return "save_validation_failed"


class FixtureHealthTransaction:
    """In-process authority for the one disposable fixture root supplied by the test caller."""

    def __init__(
        self,
        resolve_fixture_root: Callable[[], Path | None],
        game_status: Callable[[], GameProcessStatus],
        *,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._resolve_fixture_root = resolve_fixture_root
        self._game_status = game_status
        self._clock = clock
        self._grant: _Grant | None = None
        self._guard = Lock()

    def _path(self, save: str) -> Path:
        slot = (
            SAVE_SLOT_PATTERN.fullmatch(save) if isinstance(save, str) and save.isascii() else None
        )
        if slot is None:
            raise RecoveryError("invalid_request")
        try:
            datetime.strptime(slot["timestamp"], SAVE_SLOT_TIMESTAMP_FORMAT).replace(tzinfo=UTC)
        except ValueError as exc:
            raise RecoveryError("invalid_request") from exc
        root = self._resolve_fixture_root()
        if root is None or not root.is_relative_to(_FIXTURE_AREA):
            raise RecoveryError("fixture_unavailable")
        parts = root.relative_to(_FIXTURE_AREA).parts
        if not parts or any(fullmatch(r"[a-zA-Z0-9_-]+", part) is None for part in parts):
            raise RecoveryError("fixture_unavailable")
        # Keep the path lexical so the storage lock can reject reparse points in its ancestry.
        return root / save / f"{save}.es3"

    def invalidate(self) -> None:
        """Retire the confirmation when the caller closes or switches the workspace."""
        with self._guard:
            self._grant = None

    @bounded_save_operation
    def confirm(self, save: str, fingerprint: str, player: str, health: int, operation: str) -> str:
        """Bind an explicitly confirmed edit to the current fixture and operation."""
        with self._guard:
            self._grant = None
            if (
                not valid_operation(operation)
                or not isinstance(fingerprint, str)
                or fullmatch(r"[0-9a-f]{64}", fingerprint) is None
                or not isinstance(player, str)
                or not (0 < len(player) <= 20 and player.isascii() and player.isdigit())
                or type(health) is not int
            ):
                raise RecoveryError("invalid_request")
            try:
                require_game_closed(self._game_status)
                path = self._path(save)
                with health_lock(path) as directory:
                    tx = HealthTransaction(path, operation, directory=directory)
                    tx.admit()
                    current, identity = _snapshot(path, directory)
                    if current != fingerprint:
                        raise RecoveryError("save_stale")
                    data, _source = _load(path, directory, fingerprint)
                    before = _existing_health(data, player)
                    set_player_health(data, player, health)
                    if before == health:
                        raise RecoveryError("save_unchanged")
                    token = token_hex(16)
                    if self._path(save) != path or _snapshot(path, directory) != (
                        fingerprint,
                        identity,
                    ):
                        raise RecoveryError("save_stale")
                    self._grant = _Grant(
                        token,
                        operation,
                        save,
                        path,
                        tx.namespace(),
                        fingerprint,
                        identity,
                        player,
                        before,
                        health,
                        self._clock() + _GRANT_SECONDS,
                    )
                    return token
            except (OSError, ValueError, TypeError, GameSafetyError) as exc:
                raise RecoveryError(_reason(exc)) from exc

    @bounded_save_operation
    def commit(self, token: str) -> HealthResult:
        """Commit once. Keep the receipt pending for recovery after the writer exits."""
        with self._guard:
            grant = self._grant
            if grant is None or token != grant.token:
                return HealthResult("rejected", reason="invalid_session")
            self._grant = None
            return self._commit(grant)

    def _commit(self, grant: _Grant) -> HealthResult:
        tx = None
        try:
            require_game_closed(self._game_status)
            path = self._path(grant.save)
            if path != grant.path:
                raise RecoveryError("save_stale")
            with health_lock(path) as directory:
                tx = HealthTransaction(
                    path,
                    grant.operation,
                    directory=directory,
                    intent={
                        "playerId": grant.player,
                        "before": grant.before,
                        "health": grant.health,
                    },
                )
                tx.admit()

                def check_binding() -> None:
                    if self._clock() >= grant.expires:
                        raise RecoveryError("admission_expired")
                    if (
                        self._path(grant.save) != path
                        or tx.namespace() != grant.namespace
                        or _snapshot(path, directory) != (grant.fingerprint, grant.identity)
                    ):
                        raise RecoveryError("save_stale")

                check_binding()
                data, source = _load(path, directory, grant.fingerprint)
                if _existing_health(data, grant.player) != grant.before:
                    raise RecoveryError("save_stale")
                set_player_health(data, grant.player, grant.health)

                def before_replace() -> None:
                    try:
                        if _snapshot(tx.backup, directory)[0] != grant.fingerprint:
                            raise RecoveryError("backup_failed")
                        check_binding()
                    except RecoveryError as exc:
                        # Repository I/O errors are translated before they cross this boundary.
                        raise DesktopSaveError(exc.code, "Health admission changed.") from exc
                    require_game_closed(self._game_status)
                    if self._clock() >= grant.expires:
                        raise DesktopSaveError("admission_expired", "Health confirmation expired.")

                SaveRepository(path.parent).overwrite(
                    path,
                    data,
                    expected_source=source,
                    directory=directory,
                    health_transaction=tx,
                    before_replace=before_replace,
                )
                result = tx.recover(own_completion=True)
                if result["status"] != "applied" or result["backupAvailable"] is not True:
                    raise RecoveryError("write_conflict")
                return HealthResult(
                    "pending",
                    grant.operation,
                    fingerprint=cast(str, result["fingerprint"]),
                    backup_available=True,
                )
        except (OSError, ValueError, TypeError, GameSafetyError, DesktopSaveError) as exc:
            status = "uncertain" if tx is not None and tx.started else "rejected"
            return HealthResult(status, grant.operation, _reason(exc))

    @bounded_save_operation
    def recover(self, save: str, operation: str | None = None) -> HealthResult:
        """Reconcile existing evidence only, without fresh edit admission."""
        with self._guard:
            self._grant = None
            try:
                path = self._path(save)
                with health_lock(path) as directory:
                    pending = inspect_pending(path, directory)
                    if pending is None and operation is None:
                        return HealthResult("idle")
                    if pending is not None:
                        if operation is not None and operation != pending.operation:
                            raise RecoveryError("write_conflict")
                        operation = pending.operation
                    if not valid_operation(operation):
                        raise RecoveryError("invalid_request")
                    tx = HealthTransaction(path, cast(str, operation), directory=directory)
                    proof = tx.proof()
                    intent = tx.inspect_single_health()
                    result = tx.inspect()
                    fingerprint = cast(str, result["fingerprint"])
                    data, _source = _load(path, directory, fingerprint)
                    health = _existing_health(data, cast(str, intent["playerId"]))
                    expected = (
                        intent["health"] if result["status"] == "applied" else intent["before"]
                    )
                    if health != expected or tx.proof() != proof:
                        raise RecoveryError("write_conflict")
                    if tx.recover() != result or inspect_pending(path, directory) is not None:
                        raise RecoveryError("write_conflict")
                    return HealthResult(
                        cast(str, result["status"]),
                        operation,
                        fingerprint=fingerprint,
                        backup_available=result["backupAvailable"] is True,
                        health=health,
                    )
            except (OSError, ValueError, TypeError) as exc:
                reason = _reason(exc)
                return HealthResult(
                    "busy" if reason == "write_busy" else "conflict", operation, reason
                )
