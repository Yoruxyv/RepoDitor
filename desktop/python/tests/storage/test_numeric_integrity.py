"""Whole-save edits preserve numeric values or reject before replacement."""

import json
import os
from copy import deepcopy
from decimal import Decimal
from hashlib import sha256

import pytest

from repo_save_editor.core.crypto import SaveCryptoError, _decrypt_plaintext, _encrypt_plaintext
from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.desktop_api.saves import save_changes
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
CHANGES = [{"feature": "players", "entity": "111", "field": "health", "after": 17}]
PRECISE = "0.123456789012345678901234567890"


def source(data, fragment, location="root"):
    data = deepcopy(data)
    entry = {"type": "future", "value": "__numeric_fragment__", "text": "preserve ☺"}
    if location == "root":
        data["future"] = entry
    elif location == "nested":
        data["dictionaryOfDictionaries"]["value"]["future"] = entry
    else:
        data["future"] = [{"nested": [entry]}]
    plaintext = json.dumps(data, ensure_ascii=False).replace('"__numeric_fragment__"', fragment)
    return _encrypt_plaintext(plaintext.encode("utf-8"))


def exact(blob):
    return json.loads(_decrypt_plaintext(blob), parse_float=Decimal)


def fixture(root, data, fragment, location="root"):
    path = root / SAVE / f"{SAVE}.es3"
    path.parent.mkdir(parents=True)
    before = source(data, fragment, location)
    path.write_bytes(before)
    return path, before


def stopped():
    return GameProcessStatus.NOT_RUNNING


@pytest.mark.parametrize(
    "fragment",
    [
        PRECISE,
        "9007199254740993.0",
        "1.0000000000000001e+20",
        "1e309",
        "1e-400",
        "-1e-400",
        "4.9406564584124654e-324",
        "NaN",
        "Infinity",
        "-Infinity",
        "-0",
        '{"nested": 1, "nested": 2}',
        '[{"x": 1, "\\u0078": 2}]',
    ],
)
def test_full_serializer_rejects_unsupported_numbers_before_backup(tmp_path, sample_save, fragment):
    path, before = fixture(tmp_path, sample_save, fragment)
    repository = SaveRepository(tmp_path)
    edited = repository.load(path)
    edited["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 17
    with pytest.raises(SaveCryptoError, match="numeric"):
        repository.overwrite(path, edited, expected_source=before)
    assert path.read_bytes() == before
    assert list(path.parent.iterdir()) == [path]


@pytest.mark.parametrize("location", ["root", "nested", "array"])
@pytest.mark.parametrize("route", ["ordinary", "direct", "reserved"])
def test_precision_rejection_preserves_save_and_transaction_evidence(
    tmp_path, sample_save, monkeypatch, location, route
):
    path, before = fixture(tmp_path, sample_save, PRECISE, location)
    fingerprint = sha256(before).hexdigest()
    if route == "ordinary":
        result = save_changes(SAVE, fingerprint, CHANGES, tmp_path, game_status_loader=stopped)
        assert result["ok"] is False
        assert result["error"]["code"] == "save_write_failed"
    else:
        if route == "reserved":
            prepared = api.prepare_health(
                SAVE, fingerprint, CHANGES, OP, tmp_path, game_status_loader=stopped
            )["transaction"]
            assert prepared["status"] == "prepared"
            monkeypatch.setattr(storage, "_owner_exited", lambda *_: True)
        result = api.write_health(
            SAVE,
            fingerprint,
            CHANGES,
            OP,
            tmp_path,
            game_status_loader=stopped,
            reserved=route == "reserved",
        )["transaction"]
        assert result["status"] == ("uncertain" if route == "reserved" else "rejected")
        assert result["reason"] == "save_write_failed"
    assert path.read_bytes() == before
    assert PRECISE.encode() in _decrypt_plaintext(path.read_bytes())
    assert not list(path.parent.glob("*.bak-*"))
    assert not list(path.parent.glob("*.tmp"))
    pending = path.with_name(f".{path.name}.health-pending.json")
    archive = path.with_name(f".{path.name}.health-{OP}.json")
    if route == "reserved":
        receipt = pending.read_bytes()
        assert json.loads(receipt)["phase"] == "prepared"
        assert json.loads(receipt)["version"] == (3 if os.name == "nt" else 1)
        assert not archive.exists()
        recovered = api.recover_health(SAVE, OP, tmp_path)["transaction"]
        assert recovered["status"] == "unchanged"
        assert recovered["backupAvailable"] is False
        assert not pending.exists()
        assert json.loads(archive.read_bytes())["phase"] == "unchanged"
        assert api.recover_health(SAVE, OP, tmp_path)["transaction"] == recovered
    else:
        assert not pending.exists()
        assert not archive.exists()
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    "fragment",
    [
        "0",
        "-2147483648",
        "90071992547409931234567890",
        "0.1",
        "1.25",
        "1e3",
        "1e-12",
        "1.2300e+10",
        "-0.0",
        "5e-324",
        '[1, -2.5, 1e100, {"x": 0.125}]',
        '{"nested": {"x": [1e-100, 9007199254740993123]}}',
    ],
)
def test_supported_numeric_values_survive_health_write_and_recovery(
    tmp_path, sample_save, monkeypatch, fragment
):
    path, before = fixture(tmp_path, sample_save, fragment)
    expected = exact(before)
    expected["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 17
    result = api.write_health(
        SAVE, sha256(before).hexdigest(), CHANGES, OP, tmp_path, game_status_loader=stopped
    )["transaction"]
    assert result["status"] == "applied"
    assert result["backupAvailable"] is True
    assert exact(path.read_bytes()) == expected
    if fragment == "-0.0":
        assert exact(path.read_bytes())["future"]["value"].is_signed()
    assert next(path.parent.glob("*.bak-health-*")).read_bytes() == before
    pending = path.with_name(f".{path.name}.health-pending.json")
    assert json.loads(pending.read_bytes())["version"] == (3 if os.name == "nt" else 1)
    monkeypatch.setattr(storage, "_owner_exited", lambda *_: True)
    assert api.recover_health(SAVE, OP, tmp_path)["transaction"] == result
    after = path.read_bytes()
    replay = api.write_health(
        SAVE, sha256(after).hexdigest(), CHANGES, OP, tmp_path, game_status_loader=stopped
    )["transaction"]
    assert replay["status"] == "rejected"
    assert replay["reason"] == "write_duplicate"
    assert path.read_bytes() == after
