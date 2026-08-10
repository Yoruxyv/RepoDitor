import json
import sys
from pathlib import Path

import repo_save_editor.desktop_api.__main__ as desktop_main
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


def test_cosmetics_get_cli_requires_no_run_save_id(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        desktop_main,
        "get_cosmetics",
        lambda: {"ok": True, "cosmetics": {"fingerprint": "a" * 64}},
    )
    monkeypatch.setattr(sys, "argv", ["repo_save_editor.desktop_api", "cosmetics-get"])

    desktop_main.main()

    assert json.loads(capsys.readouterr().out)["ok"] is True


def test_cosmetics_write_cli_uses_fingerprint_and_changes_only(monkeypatch, capsys) -> None:
    captured: dict[str, object] = {}

    def fake_save(fingerprint: str, changes: object) -> dict[str, object]:
        captured["fingerprint"] = fingerprint
        captured["changes"] = changes
        return {"ok": True}

    changes = [{"feature": "cosmetics", "entity": "known", "field": "unlockAll", "after": True}]
    monkeypatch.setattr(desktop_main, "save_cosmetics", fake_save)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "repo_save_editor.desktop_api",
            "cosmetics-write",
            "b" * 64,
            json.dumps(changes),
        ],
    )

    desktop_main.main()

    assert json.loads(capsys.readouterr().out)["ok"] is True
    assert captured == {"fingerprint": "b" * 64, "changes": changes}
