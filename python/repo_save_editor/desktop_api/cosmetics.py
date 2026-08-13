"""Renderer-safe MetaSave cosmetic ownership boundary."""

from __future__ import annotations

from collections.abc import Callable
from hashlib import sha256
from pathlib import Path

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.game_status import GameSafetyError, require_game_closed
from repo_save_editor.desktop_api.saves import DesktopSaveError, _failure
from repo_save_editor.services.cosmetics.discovery import discover_cosmetics
from repo_save_editor.services.cosmetics.installed_catalog import (
    discover_installed_cosmetic_catalog,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.mutations import (
    clear_all_presets,
    lock_all_cosmetics,
    remove_cosmetic_ownership,
    unlock_all_cosmetics,
    unlock_cosmetic,
)
from repo_save_editor.services.cosmetics.policy import PROVEN_MUTATION_IDS
from repo_save_editor.services.cosmetics.schema import validate_meta_save
from repo_save_editor.services.game.processes import GameProcessStatus, get_game_process_status
from repo_save_editor.services.saves.discovery import get_default_save_root
from repo_save_editor.storage.repository import (
    EncryptedSaveRepository,
    SaveBackupError,
    SaveStaleError,
    SaveVerificationError,
    SaveWriteError,
)

META_SAVE_NAME = "MetaSave.es3"
MAX_COSMETIC_CHANGES = len(PROVEN_MUTATION_IDS)

CatalogLoader = Callable[[], tuple[InstalledCosmeticMetadata, ...] | None]


def _meta_path(root: Path | None) -> Path:
    save_root = get_default_save_root() if root is None else root
    return save_root.parent / META_SAVE_NAME


def _load_meta_save(
    root: Path | None,
) -> tuple[Path, SaveData, bytes, EncryptedSaveRepository]:
    path = _meta_path(root)
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


def _serialize(
    data: SaveData,
    source: bytes,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> dict[str, object]:
    view = discover_cosmetics(data, installed_catalog)
    return {
        "fingerprint": sha256(source).hexdigest(),
        "catalogAvailable": bool(installed_catalog),
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
                "type": cosmetic.cosmetic_type,
                "rarity": cosmetic.rarity,
                "status": cosmetic.status,
                "owned": cosmetic.owned,
                "known": cosmetic.known,
                "state": (
                    "unknown" if not cosmetic.known else "owned" if cosmetic.owned else "locked"
                ),
                "mutationEligible": cosmetic.mutation_eligible,
                "removalBlockedReason": cosmetic.removal_blocked_reason,
            }
            for cosmetic in view.cosmetics
        ],
    }


def get_cosmetics(
    root: Path | None = None,
    *,
    catalog_loader: CatalogLoader = discover_installed_cosmetic_catalog,
) -> dict[str, object]:
    """Return the typed Cosmetics projection for MetaSave.es3.

    Args:
        root: Optional Run-save root whose parent contains the isolated MetaSave.

    Returns:
        A renderer-safe operation result containing known-catalog totals,
        preservation metadata, capabilities, and the current fingerprint.
    """
    try:
        _path, data, source, _repository = _load_meta_save(root)
        installed_catalog = catalog_loader()
        return {"ok": True, "cosmetics": _serialize(data, source, installed_catalog)}
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)


def _cosmetic_id(value: object) -> int:
    if not isinstance(value, str) or not value.isascii() or not value.isdigit():
        raise ValueError("A canonical cosmetic ID is required.")
    cosmetic_id = int(value)
    if str(cosmetic_id) != value:
        raise ValueError("A canonical cosmetic ID is required.")
    return cosmetic_id


def _apply_changes(
    data: SaveData,
    changes: object,
    installed_catalog: tuple[InstalledCosmeticMetadata, ...] | None,
) -> None:
    if not isinstance(changes, list) or not changes or len(changes) > MAX_COSMETIC_CHANGES:
        raise ValueError(f"One to {MAX_COSMETIC_CHANGES} cosmetic changes are required.")
    if len(changes) > 1 and any(
        isinstance(change, dict)
        and (
            (change.get("entity") == "known" and change.get("field") in {"unlockAll", "lockAll"})
            or (change.get("entity") == "presets" and change.get("field") == "clearAll")
        )
        for change in changes
    ):
        raise ValueError("Bulk cosmetic actions must be submitted alone.")
    seen: set[tuple[str, str]] = set()
    for change in changes:
        if not isinstance(change, dict) or set(change) != {"feature", "entity", "field", "after"}:
            raise ValueError("A cosmetic change did not match the supported format.")
        if change["feature"] != "cosmetics":
            raise ValueError("Only supported cosmetic changes are accepted.")
        entity = change["entity"]
        field = change["field"]
        signature = (str(entity), str(field))
        if signature in seen:
            raise ValueError("Duplicate cosmetic changes are not supported.")
        seen.add(signature)
        if entity == "known" and field == "unlockAll" and change["after"] is True:
            unlock_all_cosmetics(data, installed_catalog)
        elif entity == "known" and field == "lockAll" and change["after"] is False:
            lock_all_cosmetics(data, installed_catalog)
        elif entity == "presets" and field == "clearAll" and change["after"] is True:
            clear_all_presets(data)
        elif field == "owned" and isinstance(change["after"], bool):
            cosmetic_id = _cosmetic_id(entity)
            if change["after"]:
                unlock_cosmetic(data, cosmetic_id, installed_catalog)
            else:
                remove_cosmetic_ownership(data, cosmetic_id, installed_catalog)
        else:
            raise ValueError("A cosmetic change is not supported.")
    validate_meta_save(data)


def save_cosmetics(
    expected_fingerprint: str,
    changes: object,
    root: Path | None = None,
    *,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
    catalog_loader: CatalogLoader = discover_installed_cosmetic_catalog,
) -> dict[str, object]:
    """Validate and safely persist supported MetaSave changes.

    The operation requires the game to be closed and reuses the shared stale
    fingerprint, exact-byte backup, staged verification, and atomic-write path.

    Args:
        expected_fingerprint: SHA-256 captured when MetaSave was read.
        changes: Typed ownership or paired preset-clearing changes.
        root: Optional Run-save root used by isolated tests.
        game_status_loader: Injectable game-process check used by tests.

    Returns:
        A renderer-safe result containing the updated Cosmetics projection or a
        stable error payload.
    """
    try:
        require_game_closed(game_status_loader)
        path, data, source, repository = _load_meta_save(root)
        if (
            not isinstance(expected_fingerprint, str)
            or len(expected_fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in expected_fingerprint)
        ):
            return _failure("save_validation_failed", "The MetaSave fingerprint is invalid.")
        if sha256(source).hexdigest() != expected_fingerprint:
            return _failure("save_stale", "MetaSave.es3 changed after it was opened.")
        installed_catalog = catalog_loader()
        _apply_changes(data, changes, installed_catalog)
        backup, written = repository.overwrite(path, data, expected_source=source)
        return {
            "ok": True,
            "result": {
                "backupPath": str(backup),
                "cosmetics": _serialize(data, written, installed_catalog),
            },
        }
    except GameSafetyError as exc:
        return _failure(exc.code, exc.message)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)
    except SaveCryptoError:
        return _failure("save_write_failed", "MetaSave.es3 could not be written safely.")
    except (ValueError, TypeError) as exc:
        return _failure("save_validation_failed", str(exc))
    except SaveBackupError:
        return _failure(
            "backup_failed",
            "MetaSave.es3 could not be backed up. Nothing was written.",
        )
    except SaveStaleError:
        return _failure(
            "save_stale",
            "MetaSave.es3 changed while edits were being prepared.",
        )
    except SaveVerificationError:
        return _failure(
            "save_verification_failed",
            "The staged MetaSave could not be verified.",
        )
    except FileNotFoundError:
        return _failure("meta_missing", "MetaSave.es3 was not found.")
    except (SaveWriteError, OSError):
        return _failure("save_write_failed", "MetaSave.es3 could not be written safely.")
