from pathlib import Path

from repo_save_editor.desktop_api.discovery.environment import serialize_environment
from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.saves.discovery import discover_saves


def test_environment_serialization_adapts_domain_names(tmp_path: Path) -> None:
    save_root = tmp_path / "saves"
    slot_name = "REPO_SAVE_2026_08_08_10_20_30"
    save_path = save_root / slot_name / f"{slot_name}.es3"
    save_path.parent.mkdir(parents=True)
    save_path.write_bytes(b"save")

    game_root = tmp_path / "game"
    catalog = game_root / "REPO_Data/StreamingAssets/aa/catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")

    payload = serialize_environment(
        discover_saves(save_root),
        discover_game_installation(game_root),
    )

    assert payload["saveRootDetected"] is True
    assert payload["saveCount"] == 1
    assert payload["gameDetected"] is True
    assert payload["gameRoot"] == str(game_root)
    saves = payload["saves"]
    assert isinstance(saves, list)
    assert saves[0]["path"] == str(save_path)
