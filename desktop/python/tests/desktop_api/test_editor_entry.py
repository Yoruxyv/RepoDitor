from hashlib import sha256
from types import SimpleNamespace

import pytest

from repo_save_editor.core.crypto import encrypt_save
from repo_save_editor.desktop_api import __main__ as cli
from repo_save_editor.desktop_api import editor_entry, saves
from repo_save_editor.desktop_api.player.players import list_players
from repo_save_editor.desktop_api.run import get_run_state
from repo_save_editor.services import baked_artwork
from repo_save_editor.services.items.discovery import discover_item_type_names
from repo_save_editor.services.player.installed_upgrades import upgrade_item_candidates


@pytest.mark.parametrize("changed", [False, True])
def test_editor_entry_projects_one_snapshot_and_rechecks_it(
    tmp_path, sample_save, monkeypatch, changed
):
    save_id = "REPO_SAVE_2026_08_08_10_20_30"
    path = tmp_path / save_id / f"{save_id}.es3"
    path.parent.mkdir()
    original = encrypt_save(sample_save)
    path.write_bytes(original)
    fingerprint = sha256(original).hexdigest()
    discoveries = []

    def metadata(names, *, reuse_native_metadata):
        assert reuse_native_metadata
        discoveries.append(set(names))
        return {}

    def maps(*, entry_proof):
        assert entry_proof
        if changed:
            path.write_bytes(encrypt_save(sample_save))
        return {"ok": True, "available": False, "catalogPath": None, "maps": []}

    monkeypatch.setattr(editor_entry, "discover_installed_item_metadata", metadata)
    monkeypatch.setattr(editor_entry, "list_maps", maps)
    monkeypatch.setattr(editor_entry, "entry_artwork_revision", lambda: None)
    result = editor_entry.prepare_editor_entry(save_id, fingerprint, tmp_path)
    assert discoveries == [
        set(discover_item_type_names(sample_save))
        | set(upgrade_item_candidates("playerUpgradeStrength"))
    ]
    if changed:
        assert result["error"]["code"] == "save_stale"
        assert "players" not in result
    else:
        assert result["ok"] is True
        assert result["fingerprint"] == fingerprint
        assert result["players"] == list_players(save_id, tmp_path)
        assert result["run"] == get_run_state(save_id, tmp_path)
        assert result["upgrades"]["ok"] is True
        assert result["items"]["ok"] is True
        assert result["cacheRevision"] is None
        assert path.read_bytes() == original


@pytest.mark.parametrize("matches", [True, False])
def test_warm_open_proves_installed_sources_before_reading_the_save(monkeypatch, matches):
    revision = "a" * 64
    checks = []

    def installed_revision():
        checks.append("installation")
        return revision if matches else "b" * 64

    def open_save(save_id):
        checks.append(save_id)
        return {"ok": True}

    monkeypatch.setattr(baked_artwork, "entry_artwork_revision", installed_revision)
    monkeypatch.setattr(saves, "open_save", open_save)
    result = cli._open_save(SimpleNamespace(save_id="slot", native=True, entry_revision=revision))
    assert result.get("verifiedEntryRevision") == (revision if matches else None)
    assert checks == ["installation", "slot"]
