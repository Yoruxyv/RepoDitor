"""Cosmetic writes preserve unknown plaintext bytes without changing ES3 crypto."""

import pytest

from repo_save_editor.core.crypto import (
    SaveCryptoError,
    _decrypt_plaintext,
    _encrypt_plaintext,
    decrypt_save,
    encrypt_save_fields,
)
from repo_save_editor.storage.repository import EncryptedSaveRepository, SaveVerificationError

SOURCE = r"""{
  "cosmeticHistory" : {"type":"ints", "value" : [0], "future":1.230000000000000000009},
  "future" : { "large":90071992547409931234567890, "number":1.230000000000000000009, "text":"\u263a" },
  "cosmeticUnlocks": {"value":[0]},
  "cosmeticPresets": {"value":[]}
}
"""
FIELDS = frozenset({"cosmeticHistory", "cosmeticUnlocks"})


def test_cosmetic_encoder_changes_only_selected_array_spans():
    source = _encrypt_plaintext(SOURCE.encode())
    data = decrypt_save(source)
    for key in FIELDS:
        data[key]["value"].append(547)
    written = encrypt_save_fields(data, source, FIELDS)
    expected = SOURCE.replace('"value" : [0]', '"value" : [0, 547]').replace(
        '"value":[0]', '"value":[0, 547]'
    )
    assert _decrypt_plaintext(written).decode() == expected
    assert decrypt_save(written) == data


@pytest.mark.parametrize("damage", ["unknown", "metadata", "new-key"])
def test_cosmetic_encoder_rejects_edits_outside_declared_values(damage):
    source = _encrypt_plaintext(SOURCE.encode())
    data = decrypt_save(source)
    if damage == "unknown":
        data["future"]["large"] = 1
    elif damage == "metadata":
        data["cosmeticHistory"]["type"] = "changed"
    else:
        data["new"] = True
    with pytest.raises(SaveCryptoError):
        encrypt_save_fields(data, source, FIELDS)


def test_cosmetic_encoder_rejects_ambiguous_duplicate_fields():
    source = _encrypt_plaintext(b'{"cosmeticHistory":{"value":[]},"cosmeticHistory":{"value":[]}}')
    with pytest.raises(ValueError, match="Duplicate"):
        encrypt_save_fields(decrypt_save(source), source, FIELDS)


def test_custom_encoder_cannot_bypass_staged_data_verification(tmp_path):
    original = _encrypt_plaintext(SOURCE.encode())
    path = tmp_path / "MetaSave.es3"
    path.write_bytes(original)
    data = decrypt_save(original)
    data["cosmeticUnlocks"]["value"].append(556)
    repository = EncryptedSaveRepository(tmp_path, lambda _data: None)
    with pytest.raises(SaveVerificationError):
        repository.overwrite(
            path, data, expected_source=original, encoder=lambda _data, source: source
        )
    assert path.read_bytes() == original
    assert not list(tmp_path.glob("*.tmp"))
