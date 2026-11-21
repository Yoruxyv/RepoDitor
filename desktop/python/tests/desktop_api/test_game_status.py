import pytest

from repo_save_editor.desktop_api.game_status import (
    GameSafetyError,
    get_game_status,
    require_game_closed,
)
from repo_save_editor.services.game.processes import GameProcessStatus, ProcessInspectionError


def test_game_status_boundary_exposes_only_narrow_state() -> None:
    result = get_game_status(lambda: GameProcessStatus.RUNNING)

    assert result == {"ok": True, "status": "running", "running": True}


def test_unknown_status_is_not_reported_as_running_but_fails_closed() -> None:
    result = get_game_status(lambda: GameProcessStatus.UNKNOWN)

    assert result == {"ok": True, "status": "unknown", "running": False}
    with pytest.raises(RuntimeError) as error:
        require_game_closed(lambda: GameProcessStatus.UNKNOWN)
    assert error.value.code == "game_status_unknown"


@pytest.mark.parametrize("failure", [OSError, ProcessInspectionError])
def test_status_inspection_failure_blocks_writes_without_exposing_diagnostics(failure):
    def failed_status():
        raise failure("private process inspection details")

    with pytest.raises(GameSafetyError) as error:
        require_game_closed(failed_status)

    assert error.value.code == "game_status_unknown"
    assert "private" not in error.value.message
