"""Read-only save opening for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.services.players import get_players
from repo_save_editor.services.run_state import get_resume_location_label, get_run_stat
from repo_save_editor.services.save_discovery import SaveRootStatus, discover_saves
from repo_save_editor.services.saves import get_save_summary
from repo_save_editor.storage.repository import SaveRepository


def _failure(code: str, message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": code, "message": message}}


def open_save(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Resolve, decrypt, validate, and summarize one discovered save."""
    discovery = discover_saves(root)
    if discovery.status is SaveRootStatus.UNREADABLE:
        return _failure("backend_unavailable", "The save folder could not be read.")

    save = next((item for item in discovery.saves if item.identifier == save_id), None)
    if save is None:
        return _failure("save_missing", "The selected save no longer exists.")

    try:
        data = SaveRepository.load(save.path)
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
    except FileNotFoundError:
        return _failure("save_missing", "The selected save no longer exists.")
    except SaveCryptoError as exc:
        if "too small" in str(exc):
            return _failure("save_corrupt", "The selected save is corrupted.")
        return _failure("save_decrypt_failed", "The selected save could not be decrypted.")
    except ValueError:
        return _failure("save_unsupported", "The selected save format is not supported.")
    except OSError:
        return _failure("backend_unavailable", "The selected save could not be opened.")

    return {"ok": True, "session": session}
