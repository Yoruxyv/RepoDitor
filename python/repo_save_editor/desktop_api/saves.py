"""Safe save opening and writing for the desktop process boundary."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.schema import validate_run_save
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.game_status import GameSafetyError, require_game_closed
from repo_save_editor.services.game.processes import GameProcessStatus, get_game_process_status
from repo_save_editor.services.items.mutations import refill_item_to_full
from repo_save_editor.services.player.state import get_players, set_player_health
from repo_save_editor.services.player.upgrades import (
    discover_player_upgrades,
    set_player_upgrade,
)
from repo_save_editor.services.run import (
    get_available_run_stats,
    get_resume_location_label,
    get_run_stat,
    set_resume_location_from_label,
    set_run_stat_from_display,
)
from repo_save_editor.services.saves.discovery import (
    DiscoveredSave,
    SaveRootStatus,
    discover_saves,
)
from repo_save_editor.services.saves.summaries import get_save_summary
from repo_save_editor.storage.repository import (
    SaveBackupError,
    SaveRepository,
    SaveStaleError,
    SaveVerificationError,
    SaveWriteError,
)

MAX_CHANGES = 512


def _failure(code: str, message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": code, "message": message}}


class DesktopSaveError(Exception):
    """Stable failure at the desktop save boundary."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def load_discovered_save(
    save_id: str,
    root: Path | None = None,
) -> tuple[DiscoveredSave, SaveData, bytes]:
    """Resolve and load one save previously exposed by discovery."""
    discovery = discover_saves(root)
    if discovery.status is SaveRootStatus.UNREADABLE:
        raise DesktopSaveError("backend_unavailable", "The save folder could not be read.")

    save = next((item for item in discovery.saves if item.identifier == save_id), None)
    if save is None:
        raise DesktopSaveError("save_missing", "The selected save no longer exists.")

    try:
        source = save.path.read_bytes()
        return save, SaveRepository.load_bytes(source), source
    except FileNotFoundError as exc:
        raise DesktopSaveError("save_missing", "The selected save no longer exists.") from exc
    except SaveCryptoError as exc:
        if "too small" in str(exc):
            raise DesktopSaveError("save_corrupt", "The selected save is corrupted.") from exc
        raise DesktopSaveError(
            "save_decrypt_failed", "The selected save could not be decrypted."
        ) from exc
    except ValueError as exc:
        raise DesktopSaveError(
            "save_unsupported", "The selected save format is not supported."
        ) from exc
    except OSError as exc:
        raise DesktopSaveError(
            "backend_unavailable", "The selected save could not be opened."
        ) from exc


def _fingerprint(source: bytes) -> str:
    return sha256(source).hexdigest()


def _session(save: DiscoveredSave, data: SaveData, source: bytes) -> dict[str, object]:
    summary = get_save_summary(data)
    return {
        "id": save.identifier,
        "displayName": save.display_name,
        "path": str(save.path),
        "lastModified": save.modified_at.isoformat(),
        "fingerprint": _fingerprint(source),
        "level": summary.level,
        "currency": get_run_stat(data, "currency"),
        "playerCount": len(get_players(data)),
        "resumeLocation": get_resume_location_label(data),
    }


def open_save(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Resolve, decrypt, validate, and summarize one discovered save.

    Args:
        save_id: Opaque identifier previously returned by save discovery.
        root: Optional isolated discovery root used by tests.

    Returns:
        A renderer-safe operation result. Raw decrypted data never crosses this
        boundary.
    """
    try:
        save, data, source = load_discovered_save(save_id, root)
        session = _session(save, data, source)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    return {"ok": True, "session": session}


def _integer(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("A whole-number change value is required.")
    return value


def _apply_changes(data: SaveData, changes: object) -> None:
    if not isinstance(changes, list) or not changes or len(changes) > MAX_CHANGES:
        raise ValueError("One to 512 pending changes are required.")

    players = {player.player_id for player in get_players(data)}
    upgrades = {upgrade.key for upgrade in discover_player_upgrades(data)}
    run_fields = {key for _, key, _ in get_available_run_stats(data)}
    seen: set[tuple[str, str, str]] = set()

    for change in changes:
        if not isinstance(change, dict) or set(change) != {"feature", "entity", "field", "after"}:
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
            refill_item_to_full(data, entity)
        else:
            raise ValueError("A pending change is not supported by this save.")

    validate_run_save(data)


def save_changes(
    save_id: str,
    expected_fingerprint: str,
    changes: object,
    root: Path | None = None,
    *,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
) -> dict[str, object]:
    """Validate and safely persist one typed set of pending changes.

    The game must be confirmed closed. The source fingerprint is checked before
    mutation, then the shared repository creates an exact-byte backup, stages and
    reopens encrypted output, and atomically replaces the source.

    Args:
        save_id: Opaque identifier previously returned by discovery.
        expected_fingerprint: SHA-256 captured when the save was opened.
        changes: Typed pending changes accepted by the desktop boundary.
        root: Optional isolated discovery root used by tests.
        game_status_loader: Injectable game-process check used by tests.

    Returns:
        A renderer-safe success result or stable error payload.
    """
    try:
        require_game_closed(game_status_loader)
        save, data, source = load_discovered_save(save_id, root)
        if (
            not isinstance(expected_fingerprint, str)
            or len(expected_fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in expected_fingerprint)
        ):
            return _failure("save_validation_failed", "The opened save fingerprint is invalid.")
        if _fingerprint(source) != expected_fingerprint:
            return _failure(
                "save_stale",
                "The save changed after it was opened. Reopen it before saving edits.",
            )
        _apply_changes(data, changes)
        backup, written = SaveRepository(save.path.parent).overwrite(
            save.path,
            data,
            expected_source=source,
        )
        try:
            metadata = save.path.stat()
            modified_at = datetime.fromtimestamp(metadata.st_mtime, tz=UTC)
        except OSError:
            modified_at = datetime.now(tz=UTC)
        updated_save = replace(
            save,
            modified_at=modified_at,
            file_size=len(written),
        )
        result = {
            "backupPath": str(backup),
            "session": _session(updated_save, data, written),
        }
    except GameSafetyError as exc:
        return _failure(exc.code, exc.message)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)
    except SaveCryptoError:
        return _failure("save_write_failed", "The edited save could not be encrypted safely.")
    except (ValueError, TypeError) as exc:
        return _failure("save_validation_failed", str(exc))
    except SaveBackupError:
        return _failure(
            "backup_failed", "The original save could not be backed up. Nothing was written."
        )
    except SaveStaleError:
        return _failure(
            "save_stale",
            "The save changed while edits were being prepared. Reopen it before saving.",
        )
    except SaveVerificationError:
        return _failure(
            "save_verification_failed",
            "The staged save could not be verified. The original was preserved.",
        )
    except FileNotFoundError:
        return _failure("save_missing", "The selected save no longer exists.")
    except (SaveWriteError, OSError):
        return _failure("save_write_failed", "The edited save could not be written safely.")

    return {"ok": True, "result": result}
