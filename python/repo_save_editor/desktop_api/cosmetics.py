"""Renderer-safe MetaSave cosmetic ownership boundary."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.saves import DesktopSaveError, _failure
from repo_save_editor.services.cosmetics.discovery import discover_cosmetics
from repo_save_editor.services.cosmetics.mutations import (
    lock_all_cosmetics,
    remove_cosmetic_ownership,
    unlock_all_cosmetics,
    unlock_cosmetic,
)
from repo_save_editor.services.cosmetics.schema import validate_meta_save
from repo_save_editor.services.saves.discovery import SaveRootStatus, discover_saves
from repo_save_editor.storage.repository import (
    EncryptedSaveRepository,
    SaveBackupError,
    SaveStaleError,
    SaveVerificationError,
    SaveWriteError,
)

META_SAVE_NAME = "MetaSave.es3"
MAX_COSMETIC_CHANGES = 547


def _meta_path(save_id: str, root: Path | None) -> Path:
    discovery = discover_saves(root)
    if discovery.status is SaveRootStatus.UNREADABLE:
        raise DesktopSaveError("backend_unavailable", "The save folder could not be read.")
    if not any(save.identifier == save_id for save in discovery.saves):
        raise DesktopSaveError("save_missing", "The selected save no longer exists.")
    return discovery.root.parent / META_SAVE_NAME


def _load_meta_save(
    save_id: str,
    root: Path | None,
) -> tuple[Path, SaveData, bytes, EncryptedSaveRepository]:
    path = _meta_path(save_id, root)
    repository = EncryptedSaveRepository(path.parent, validate_meta_save)
    try:
        source = path.read_bytes()
        return path, repository.load_bytes(source), source, repository
    except FileNotFoundError as exc:
        raise DesktopSaveError("meta_missing", "MetaSave.es3 was not found.") from exc
    except SaveCryptoError as exc:
        raise DesktopSaveError(
            "save_decrypt_failed", "MetaSave.es3 could not be decrypted."
        ) from exc
    except ValueError as exc:
        raise DesktopSaveError("save_unsupported", "MetaSave.es3 is not supported.") from exc
    except OSError as exc:
        raise DesktopSaveError("backend_unavailable", "MetaSave.es3 could not be opened.") from exc


def _serialize(data: SaveData, source: bytes) -> dict[str, object]:
    view = discover_cosmetics(data)
    return {
        "fingerprint": sha256(source).hexdigest(),
        "knownCatalogCount": view.known_catalog_count,
        "knownOwnedCount": view.known_owned_count,
        "knownLockedCount": view.known_locked_count,
        "savedPresetCount": view.saved_preset_count,
        "unknownOwnedIds": list(view.unknown_owned_ids),
        "capabilities": {
            "canReadCosmetics": view.capabilities.can_read_cosmetics,
            "canUnlockCosmetic": view.capabilities.can_unlock_cosmetic,
            "canUnlockAll": view.capabilities.can_unlock_all,
            "canRemoveOwnership": view.capabilities.can_remove_ownership,
        },
        "cosmetics": [
            {
                "id": cosmetic.cosmetic_id,
                "displayName": cosmetic.display_name,
                "owned": cosmetic.owned,
                "known": cosmetic.known,
                "removalBlockedReason": cosmetic.removal_blocked_reason,
            }
            for cosmetic in view.cosmetics
        ],
    }


def get_cosmetics(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Return the typed cosmetic ownership projection for MetaSave.es3."""
    try:
        _path, data, source, _repository = _load_meta_save(save_id, root)
        return {"ok": True, "cosmetics": _serialize(data, source)}
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)


def _cosmetic_id(value: object) -> int:
    if not isinstance(value, str) or not value.isascii() or not value.isdigit():
        raise ValueError("A known cosmetic ID is required.")
    return int(value)


def _apply_changes(data: SaveData, changes: object) -> None:
    if not isinstance(changes, list) or not changes or len(changes) > MAX_COSMETIC_CHANGES:
        raise ValueError("One to 547 cosmetic changes are required.")
    if len(changes) > 1 and any(
        isinstance(change, dict)
        and change.get("entity") == "known"
        and change.get("field") in {"unlockAll", "lockAll"}
        for change in changes
    ):
        raise ValueError("Bulk cosmetic actions must be submitted alone.")
    seen: set[tuple[str, str]] = set()
    for change in changes:
        if not isinstance(change, dict) or set(change) != {"feature", "entity", "field", "after"}:
            raise ValueError("A cosmetic change did not match the supported format.")
        if change["feature"] != "cosmetics":
            raise ValueError("Only cosmetic ownership changes are supported.")
        entity = change["entity"]
        field = change["field"]
        signature = (str(entity), str(field))
        if signature in seen:
            raise ValueError("Duplicate cosmetic changes are not supported.")
        seen.add(signature)
        if entity == "known" and field == "unlockAll" and change["after"] is True:
            unlock_all_cosmetics(data)
        elif entity == "known" and field == "lockAll" and change["after"] is False:
            lock_all_cosmetics(data)
        elif field == "owned" and isinstance(change["after"], bool):
            cosmetic_id = _cosmetic_id(entity)
            if change["after"]:
                unlock_cosmetic(data, cosmetic_id)
            else:
                remove_cosmetic_ownership(data, cosmetic_id)
        else:
            raise ValueError("A cosmetic change is not supported.")
    validate_meta_save(data)


def save_cosmetics(
    save_id: str,
    expected_fingerprint: str,
    changes: object,
    root: Path | None = None,
) -> dict[str, object]:
    """Validate and safely persist typed MetaSave ownership changes."""
    try:
        path, data, source, repository = _load_meta_save(save_id, root)
        if (
            not isinstance(expected_fingerprint, str)
            or len(expected_fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in expected_fingerprint)
        ):
            return _failure("save_validation_failed", "The MetaSave fingerprint is invalid.")
        if sha256(source).hexdigest() != expected_fingerprint:
            return _failure("save_stale", "MetaSave.es3 changed after it was opened.")
        _apply_changes(data, changes)
        backup, written = repository.overwrite(path, data, expected_source=source)
        return {
            "ok": True,
            "result": {
                "backupPath": str(backup),
                "cosmetics": _serialize(data, written),
            },
        }
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)
    except (ValueError, TypeError) as exc:
        return _failure("save_validation_failed", str(exc))
    except SaveBackupError:
        return _failure(
            "backup_failed", "MetaSave.es3 could not be backed up. Nothing was written."
        )
    except SaveStaleError:
        return _failure("save_stale", "MetaSave.es3 changed while edits were being prepared.")
    except SaveVerificationError:
        return _failure("save_verification_failed", "The staged MetaSave could not be verified.")
    except FileNotFoundError:
        return _failure("meta_missing", "MetaSave.es3 was not found.")
    except (SaveCryptoError, SaveWriteError, OSError):
        return _failure("save_write_failed", "MetaSave.es3 could not be written safely.")
