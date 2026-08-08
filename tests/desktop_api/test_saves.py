from pathlib import Path

from repo_save_editor.core.crypto import encrypt_save
from repo_save_editor.desktop_api.saves import open_save
from repo_save_editor.storage.repository import SaveRepository


def _save_path(root: Path) -> Path:
    save_id = "REPO_SAVE_2026_08_08_10_20_30"
    return root / save_id / f"{save_id}.es3"


def test_open_save_returns_renderer_safe_snapshot_without_mutating_source(
    tmp_path: Path,
    sample_save,
) -> None:
    save_path = _save_path(tmp_path)
    SaveRepository(tmp_path).save_as(save_path, sample_save)
    before = save_path.read_bytes()

    result = open_save(save_path.parent.name, tmp_path)

    assert result["ok"] is True
    assert result["session"] == {
        "id": save_path.parent.name,
        "displayName": "2026-08-08 10:20:30",
        "path": str(save_path),
        "lastModified": result["session"]["lastModified"],
        "level": 5,
        "currency": 12,
        "playerCount": 2,
        "resumeLocation": "Normal",
    }
    assert set(result["session"]) == {
        "id",
        "displayName",
        "path",
        "lastModified",
        "level",
        "currency",
        "playerCount",
        "resumeLocation",
    }
    assert save_path.read_bytes() == before


def test_open_save_reports_missing_save(tmp_path: Path) -> None:
    assert open_save("REPO_SAVE_2026_08_08_10_20_30", tmp_path) == {
        "ok": False,
        "error": {
            "code": "save_missing",
            "message": "The selected save no longer exists.",
        },
    }


def test_open_save_reports_corrupt_save(tmp_path: Path) -> None:
    save_path = _save_path(tmp_path)
    save_path.parent.mkdir(parents=True)
    save_path.write_bytes(b"broken")

    assert open_save(save_path.parent.name, tmp_path)["error"]["code"] == "save_corrupt"


def test_open_save_reports_decryption_failure(tmp_path: Path) -> None:
    save_path = _save_path(tmp_path)
    save_path.parent.mkdir(parents=True)
    save_path.write_bytes(bytes(32))

    assert open_save(save_path.parent.name, tmp_path)["error"]["code"] == "save_decrypt_failed"


def test_open_save_reports_unsupported_save(tmp_path: Path) -> None:
    save_path = _save_path(tmp_path)
    save_path.parent.mkdir(parents=True)
    save_path.write_bytes(encrypt_save({"teamName": {"value": "Future"}}))

    assert open_save(save_path.parent.name, tmp_path)["error"]["code"] == "save_unsupported"
