"""Read-only save opening for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.types import SaveData
from repo_save_editor.services.players import get_players
from repo_save_editor.services.run_state import get_resume_location_label, get_run_stat
from repo_save_editor.services.save_discovery import (
    DiscoveredSave,
    SaveRootStatus,
    discover_saves,
)
from repo_save_editor.services.saves import get_save_summary
from repo_save_editor.storage.repository import SaveRepository


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
) -> tuple[DiscoveredSave, SaveData]:
    """Resolve and load one save previously exposed by discovery."""
    discovery = discover_saves(root)
    if discovery.status is SaveRootStatus.UNREADABLE:
        raise DesktopSaveError("backend_unavailable", "The save folder could not be read.")

    save = next((item for item in discovery.saves if item.identifier == save_id), None)
    if save is None:
        raise DesktopSaveError("save_missing", "The selected save no longer exists.")

    try:
        return save, SaveRepository.load(save.path)
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


def open_save(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Resolve, decrypt, validate, and summarize one discovered save."""
    try:
        save, data = load_discovered_save(save_id, root)
        summary = get_save_summary(data)
        session = {
            "id": save.identifier,
            "displayName": save.display_name,
            "path": str(save.path),
            "lastModified": save.modified_at.isoformat(),
            "level": summary.level,
            "currency": get_run_stat(data, "currency"),
            "playerCount": len(get_players(data)),
            "resumeLocation": get_resume_location_label(data),
        }
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    return {"ok": True, "session": session}
