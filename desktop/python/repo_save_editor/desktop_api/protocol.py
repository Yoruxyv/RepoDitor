"""Stable result and error primitives for the desktop sidecar protocol."""

from __future__ import annotations

from repo_save_editor.storage.windows_save_directory import (
    SaveNamespaceConflictError,
    SaveNamespaceError,
)


def save_access_reason(error: BaseException) -> str | None:
    """Classify evidence from the scoped save operation, including wrapped NT errors."""
    current: BaseException | None = error
    while current is not None:
        if isinstance(current, OSError):
            match getattr(current, "winerror", None):
                case 32:  # ERROR_SHARING_VIOLATION
                    return "save_in_use"
                case 5:  # ERROR_ACCESS_DENIED does not identify a competing writer.
                    return "save_verification_unavailable"
            if isinstance(current, SaveNamespaceConflictError):
                return "write_conflict"
            if isinstance(current, (SaveNamespaceError, PermissionError)):
                return "save_verification_unavailable"
        current = current.__cause__
    return None


def _failure(code: str, message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": code, "message": message}}


def invalid_request(message: str) -> dict[str, object]:
    return _failure("invalid_request", message)


class DesktopSaveError(Exception):
    """Stable failure while resolving or loading a desktop save."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
