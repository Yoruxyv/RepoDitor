"""Narrow desktop safety boundary for the running R.E.P.O. process."""

from __future__ import annotations

from collections.abc import Callable

from repo_save_editor.services.game.processes import GameProcessStatus, get_game_process_status

GAME_RUNNING_MESSAGE = (
    "Close R.E.P.O. before saving. The game can keep save state in memory and write it later."
)
GAME_STATUS_UNKNOWN_MESSAGE = (
    "RepoDitor could not verify that R.E.P.O. is closed. Nothing was written."
)


class GameSafetyError(RuntimeError):
    """Stable write-blocking failure at the desktop process boundary."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def get_game_status(
    status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
) -> dict[str, object]:
    """Return only the renderer-safe game-running state.

    Args:
        status_loader: Injectable validated-process status loader used by tests.

    Returns:
        A narrow status payload without installation paths or process details.
    """
    status = status_loader()
    return {
        "ok": True,
        "status": status.value,
        "running": status is GameProcessStatus.RUNNING,
    }


def require_game_closed(
    status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
) -> None:
    """Require validated process inspection to confirm R.E.P.O. is closed.

    Args:
        status_loader: Injectable validated-process status loader used by tests.

    Raises:
        GameSafetyError: The game is running or its status cannot be verified.
    """
    status = status_loader()
    if status is GameProcessStatus.RUNNING:
        raise GameSafetyError("game_running", GAME_RUNNING_MESSAGE)
    if status is not GameProcessStatus.NOT_RUNNING:
        raise GameSafetyError("game_status_unknown", GAME_STATUS_UNKNOWN_MESSAGE)
