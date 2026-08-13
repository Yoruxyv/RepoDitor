import json
import sys
from pathlib import Path

import pytest

import repo_save_editor.desktop_api.__main__ as desktop_main
from repo_save_editor.desktop_api.discovery.environment import serialize_environment
from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.saves.discovery import discover_saves


@pytest.mark.parametrize(
    ("command", "target", "arguments", "expected_call"),
    [
        ("environment", "discover_environment", (), ()),
        ("game-status", "get_game_status", (), ()),
        ("maps-list", "list_maps", (), ()),
        ("icons-roots", "get_icon_roots", (), ()),
        ("cosmetics-get", "get_cosmetics", (), ()),
        ("saves-open", "open_save", ("save-id",), ("save-id",)),
        ("players-list", "list_players", ("save-id",), ("save-id",)),
        (
            "players-avatar",
            "get_player_avatar",
            ("save-id", "player-id"),
            ("save-id", "player-id"),
        ),
        ("upgrades-list", "list_upgrades", ("save-id",), ("save-id",)),
        ("run-get", "get_run_state", ("save-id",), ("save-id",)),
        ("advanced-get", "get_advanced_save", ("save-id",), ("save-id",)),
    ],
)
def test_read_commands_preserve_names_arguments_and_one_json_result(
    monkeypatch,
    capsys,
    command: str,
    target: str,
    arguments: tuple[str, ...],
    expected_call: tuple[str, ...],
) -> None:
    calls: list[tuple[object, ...]] = []

    def fake(*args: object) -> dict[str, object]:
        calls.append(args)
        return {"ok": True, "command": command}

    monkeypatch.setattr(desktop_main, target, fake)
    monkeypatch.setattr(sys, "argv", ["repo_save_editor.desktop_api", command, *arguments])

    desktop_main.main()

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0]) == {"ok": True, "command": command}
    assert calls == [expected_call]


def test_saves_write_cli_preserves_positional_payload_contract(monkeypatch, capsys) -> None:
    calls: list[tuple[object, ...]] = []
    changes = [{"feature": "run", "entity": "run", "field": "level", "after": 4}]

    def fake(*args: object) -> dict[str, object]:
        calls.append(args)
        return {"ok": True}

    monkeypatch.setattr(desktop_main, "save_changes", fake)
    monkeypatch.setattr(
        sys,
        "argv",
        ["repo_save_editor.desktop_api", "saves-write", "save-id", "f" * 64, json.dumps(changes)],
    )

    desktop_main.main()

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0]) == {"ok": True}
    assert calls == [("save-id", "f" * 64, changes)]


@pytest.mark.parametrize(
    "arguments",
    [
        ("saves-open",),
        ("players-avatar", "save-id"),
        ("saves-write", "save-id"),
        ("cosmetics-write",),
    ],
)
def test_commands_report_missing_required_arguments_as_one_json_result(
    monkeypatch,
    capsys,
    arguments: tuple[str, ...],
) -> None:
    monkeypatch.setattr(sys, "argv", ["repo_save_editor.desktop_api", *arguments])

    desktop_main.main()

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["error"]["code"] == "invalid_request"


@pytest.mark.parametrize(
    "arguments",
    [
        ("saves-write", "save-id", "f" * 64, "not-json"),
        ("cosmetics-write", "f" * 64, "not-json"),
    ],
)
def test_write_commands_reject_malformed_json_as_one_result(
    monkeypatch,
    capsys,
    arguments: tuple[str, ...],
) -> None:
    monkeypatch.setattr(sys, "argv", ["repo_save_editor.desktop_api", *arguments])

    desktop_main.main()

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0]) == {
        "ok": False,
        "error": {
            "code": "invalid_request",
            "message": "The pending changes payload is invalid.",
        },
    }


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


def test_game_status_cli_returns_narrow_status(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        desktop_main,
        "get_game_status",
        lambda: {"ok": True, "status": "not_running", "running": False},
    )
    monkeypatch.setattr(sys, "argv", ["repo_save_editor.desktop_api", "game-status"])

    desktop_main.main()

    assert json.loads(capsys.readouterr().out) == {
        "ok": True,
        "status": "not_running",
        "running": False,
    }
