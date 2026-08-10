import pytest

from repo_save_editor.desktop_api.game_status import get_game_status, require_game_closed
from repo_save_editor.services.game.processes import GameProcessStatus


def test_game_status_boundary_exposes_only_narrow_state() -> None:
    result = get_game_status(lambda: GameProcessStatus.RUNNING)

    assert result == {"ok": True, "status": "running", "running": True}


def test_unknown_status_is_not_reported_as_running_but_fails_closed() -> None:
    result = get_game_status(lambda: GameProcessStatus.UNKNOWN)

    assert result == {"ok": True, "status": "unknown", "running": False}
    with pytest.raises(RuntimeError) as error:
        require_game_closed(lambda: GameProcessStatus.UNKNOWN)
    assert getattr(error.value, "code") == "game_status_unknown"
