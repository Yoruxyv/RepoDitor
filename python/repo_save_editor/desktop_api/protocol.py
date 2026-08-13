"""Stable result and error primitives for the Electron-facing desktop protocol."""

from __future__ import annotations


def _failure(code: str, message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": code, "message": message}}


class DesktopSaveError(Exception):
    """Stable failure while resolving or loading a desktop save."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
