from repo_save_editor.desktop_api.__main__ import ping


def test_ping_returns_desktop_api_health_response() -> None:
    assert ping() == {
        "ok": True,
        "message": "pong",
        "source": "python",
    }
