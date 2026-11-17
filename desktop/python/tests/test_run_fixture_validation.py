"""Synthetic tests for the developer-only Run save validator."""

import json
import os
from hashlib import sha256

import pytest

from desktop.scripts.tauri import validate_run_fixture as tool
from repo_save_editor.core.crypto import encrypt_save

SLOT = "REPO_SAVE_2026_08_08_10_20_30"
NAME = "Private Fixture Player"
PLAYER_ID = "76561190000000123"


@pytest.fixture
def export(tmp_path, sample_save, monkeypatch):
    root = tmp_path / "private-export-root"
    fixture = root / "saves" / SLOT / f"{SLOT}.es3"
    fixture.parent.mkdir(parents=True)
    sample_save["playerNames"]["value"] = {PLAYER_ID: NAME}
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["playerHealth"] = {PLAYER_ID: 137}
    dictionaries["playerUpgradeHealth"] = {PLAYER_ID: 2}
    fixture.write_bytes(encrypt_save(sample_save))
    provenance = root / "provenance.json"
    record = {
        "appId": "3241660",
        "buildId": "26407089",
        "installedFileSha256": {**tool.REVIEWED_DIGESTS, "appmanifest_3241660.acf": "a" * 64},
        "generationProcedure": "Private synthetic generation note.",
        "capturedUtc": "2026-11-16T17:45:00.1234567Z",
        "originalFile": f"C:\\Users\\Fixture\\AppData\\LocalLow\\semiwork\\Repo\\saves\\{SLOT}\\{SLOT}.es3",
        "guestCopy": f"C:\\GuestExport\\saves\\{SLOT}\\{SLOT}.es3",
        "intendedHostCopy": str(fixture),
        "encryptedSha256": sha256(fixture.read_bytes()).hexdigest().upper(),
    }
    provenance.write_text(json.dumps(record), encoding="utf-8-sig")
    monkeypatch.setattr(tool, "INTAKE_ROOT", root)
    return fixture, provenance, record


def run(fixture, provenance, capsys):
    exit_code = tool.main([str(fixture), str(provenance)])
    captured = capsys.readouterr()
    assert captured.err == ""
    for private in (
        str(fixture),
        str(provenance),
        "private-export-root",
        "GuestExport",
        NAME,
        PLAYER_ID,
        SLOT,
        "Private synthetic generation note",
    ):
        assert private not in captured.out
    return exit_code, json.loads(captured.out)


def test_valid_export_checks_raw_health_without_disclosing_it(export, capsys):
    fixture, provenance, _ = export
    original = fixture.read_bytes()
    modified = fixture.stat().st_mtime_ns
    paths = set(tool.INTAKE_ROOT.rglob("*"))
    exit_code, report = run(fixture, provenance, capsys)
    assert exit_code == 0
    assert report == {
        "status": "read_only_pass",
        "buildId": "26407089",
        "installedEvidence": "reviewed_binary_digests_match",
        "generationEvidence": "operator_record",
        "encryptedInputUnchanged": True,
        "healthWriteCompatibility": "unsupported",
        "healthFieldRepresentation": "nonnegative_int32",
        "playerCount": 1,
        "playerHealthEntries": 1,
        "playerUpgradeHealthEntries": 1,
    }
    assert fixture.read_bytes() == original
    assert fixture.stat().st_mtime_ns == modified
    assert set(tool.INTAKE_ROOT.rglob("*")) == paths


@pytest.mark.parametrize(("index", "reason"), [(0, "fixture_missing"), (1, "provenance_missing")])
def test_missing_inputs_are_reported_without_discovery(export, capsys, index, reason):
    fixture, provenance, _ = export
    export[index].unlink()
    code, report = run(fixture, provenance, capsys)
    assert code == 1
    assert report["reason"] == reason


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ("fixture_digest", "fixture_digest_mismatch"),
        ("malformed_provenance", "invalid_provenance"),
        ("duplicate_provenance_field", "invalid_provenance"),
        ("wrong_export_path", "invalid_provenance"),
        ("build_digest", "build_digest_mismatch"),
        ("unsupported_build", "unsupported_build"),
    ],
)
def test_rejects_unverified_evidence_before_loading_save(
    export, capsys, monkeypatch, change, reason
):
    fixture, provenance, record = export

    def unexpected_load(_encrypted):
        pytest.fail("Unverified evidence reached the parser")

    monkeypatch.setattr(tool.SaveRepository, "load_bytes", unexpected_load)
    match change:
        case "fixture_digest":
            record["encryptedSha256"] = "0" * 64
        case "malformed_provenance":
            record.pop("capturedUtc")
        case "wrong_export_path":
            record["intendedHostCopy"] = str(fixture.with_name("another-file.es3"))
        case "build_digest":
            record["installedFileSha256"]["REPO.exe"] = "0" * 64
        case "unsupported_build":
            record["buildId"] = "23363152"
    text = json.dumps(record)
    if change == "duplicate_provenance_field":
        text = '{"buildId":"26407089",' + text[1:]
    provenance.write_text(text, encoding="utf-8")
    original = fixture.read_bytes()
    code, report = run(fixture, provenance, capsys)
    assert code == 1
    assert report["reason"] == reason
    assert fixture.read_bytes() == original


def test_path_outside_intake_is_rejected_before_opening(export, capsys, tmp_path, monkeypatch):
    _, provenance, _ = export

    def unexpected_read(*_args):
        pytest.fail("A path outside the intake reached the file opener")

    monkeypatch.setattr(tool, "open_input", unexpected_read)
    code, report = run(tmp_path / "private.es3", provenance, capsys)
    assert code == 1
    assert report["reason"] == "outside_intake"


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        ("malformed_ciphertext", "malformed_encrypted"),
        ("invalid_run", "unsupported_run_schema"),
        ("coerced_health", "unsupported_health"),
        ("missing_health", "unsupported_health"),
    ],
)
def test_parser_failures_are_sanitized_and_preserve_input(
    export, sample_save, capsys, case, reason
):
    fixture, provenance, record = export
    if case == "malformed_ciphertext":
        payload = b"invalid ciphertext"
    else:
        dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
        if case == "invalid_run":
            dictionaries.pop("runStats")
        elif case == "coerced_health":
            dictionaries["playerHealth"][PLAYER_ID] = "137"
        else:
            dictionaries["playerHealth"].pop(PLAYER_ID)
        payload = encrypt_save(sample_save)
    fixture.write_bytes(payload)
    record["encryptedSha256"] = sha256(payload).hexdigest()
    provenance.write_text(json.dumps(record), encoding="utf-8")
    code, report = run(fixture, provenance, capsys)
    assert code == 1
    assert report["reason"] == reason
    assert fixture.read_bytes() == payload


def test_second_read_detects_changed_bytes_even_when_metadata_matches(export, capsys, monkeypatch):
    fixture, provenance, _ = export
    original_loader = tool.SaveRepository.load_bytes
    before = fixture.stat()

    def parse_then_external_write(encrypted):
        parsed = original_loader(encrypted)
        fixture.write_bytes(bytes([encrypted[0] ^ 1]) + encrypted[1:])
        os.utime(fixture, ns=(before.st_atime_ns, before.st_mtime_ns))
        return parsed

    monkeypatch.setattr(tool.SaveRepository, "load_bytes", parse_then_external_write)
    code, report = run(fixture, provenance, capsys)
    assert code == 1
    assert report["reason"] == "input_changed"
