from pathlib import Path

from repo_save_editor.desktop_api.player.players import get_player_avatar, list_players
from repo_save_editor.storage.repository import SaveRepository


def _write_save(root: Path, sample_save) -> Path:
    save_id = "REPO_SAVE_2026_08_08_10_20_30"
    save_path = root / save_id / f"{save_id}.es3"
    SaveRepository(root).save_as(save_path, sample_save)
    return save_path


def test_list_players_returns_safe_dtos_without_mutating_source(
    tmp_path: Path, sample_save
) -> None:
    save_path = _write_save(tmp_path, sample_save)
    before = save_path.read_bytes()

    assert list_players(save_path.parent.name, tmp_path) == {
        "ok": True,
        "players": [
            {"id": "111", "name": "Alpha", "health": 80, "maxHealth": 100},
            {"id": "222", "name": "Beta", "health": 0, "maxHealth": 100},
        ],
    }
    assert save_path.read_bytes() == before


def test_player_avatar_is_scoped_to_the_selected_save(tmp_path: Path, sample_save) -> None:
    save_path = _write_save(tmp_path, sample_save)
    calls: list[str] = []

    result = get_player_avatar(
        save_path.parent.name,
        "111",
        tmp_path,
        resolver=lambda player_id: calls.append(player_id) or None,
    )

    assert result == {
        "ok": True,
        "avatar": {"playerId": "111", "avatarUrl": None},
    }
    assert calls == ["111"]
    assert get_player_avatar(save_path.parent.name, "999", tmp_path)["error"]["code"] == (
        "invalid_request"
    )


def test_players_reuse_stable_missing_save_failure(tmp_path: Path) -> None:
    result = list_players("REPO_SAVE_2026_08_08_10_20_30", tmp_path)
    assert result["error"]["code"] == "save_missing"
