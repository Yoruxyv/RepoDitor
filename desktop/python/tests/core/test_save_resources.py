"""Selected byte ceilings, actual read bounds, and operation accounting."""

import json
from io import BytesIO
from types import SimpleNamespace

import pytest

from repo_save_editor.core import crypto
from repo_save_editor.core import save_resources as resources


@pytest.mark.parametrize("delta", [-1, 0, 1])
@pytest.mark.parametrize("kind", ["encrypted", "plaintext"])
def test_per_payload_boundary(monkeypatch, kind, delta):
    monkeypatch.setattr(resources, f"{kind.upper()}_LIMIT", 64)
    check = resources.check_encrypted if kind == "encrypted" else resources.check_plaintext
    if delta > 0:
        with pytest.raises(resources.SaveResourceError, match="supported-size"):
            check(b"x" * (64 + delta))
    else:
        check(b"x" * (64 + delta))


@pytest.mark.parametrize("delta", [-1, 0, 1])
@pytest.mark.parametrize("kind", ["encrypted", "plaintext"])
def test_aggregate_boundary_and_exact_rereads(monkeypatch, kind, delta):
    monkeypatch.setattr(resources, f"{kind.upper()}_OPERATION_LIMIT", 100)
    check = resources.check_encrypted if kind == "encrypted" else resources.check_plaintext
    with resources.save_operation():
        check(b"a" * 50)
        check(b"a" * 50)  # Exact backups and staged rereads do not inflate the payload set.
        if delta > 0:
            with pytest.raises(resources.SaveResourceError):
                check(b"b" * (50 + delta))
        else:
            check(b"b" * (50 + delta))
    check(b"b" * 60)  # The next independent command gets a fresh budget.


@pytest.mark.parametrize("hash_only", [False, True])
def test_growth_after_fstat_is_bounded(monkeypatch, hash_only):
    monkeypatch.setattr(resources, "ENCRYPTED_LIMIT", 64)
    monkeypatch.setattr(resources.os, "fstat", lambda _fd: SimpleNamespace(st_size=1))

    class Growing(BytesIO):
        def fileno(self):
            return 0

    stream = Growing(b"x" * 4096)
    process = resources.hash_encrypted if hash_only else resources.read_encrypted
    with pytest.raises(resources.SaveResourceError):
        process(stream)
    assert stream.tell() == 65


@pytest.mark.parametrize("hash_only", [False, True])
def test_sparse_oversize_rejected_without_reading(tmp_path, hash_only):
    path = tmp_path / "oversized.es3"
    with path.open("wb") as stream:
        stream.truncate(resources.ENCRYPTED_LIMIT + 1)
    process = resources.hash_encrypted if hash_only else resources.read_encrypted
    with path.open("rb") as stream, pytest.raises(resources.SaveResourceError):
        process(stream)
    assert path.stat().st_size == 32 * 1024 * 1024 + 1


def test_plaintext_rejected_before_json_parse(monkeypatch):
    plaintext = b'{"value":"synthetic"}'
    blob = crypto._encrypt_plaintext(plaintext)
    monkeypatch.setattr(resources, "PLAINTEXT_LIMIT", len(plaintext) - 1)

    def no_parse(*_args, **_kwargs):
        pytest.fail("JSON parsing must not receive excessive plaintext")

    monkeypatch.setattr(crypto.json, "loads", no_parse)
    with pytest.raises(resources.SaveResourceError):
        crypto.decrypt_save(blob)


@pytest.mark.parametrize("delta", [-1, 0, 1])
@pytest.mark.parametrize("kind", ["encrypted", "plaintext"])
def test_valid_container_at_policy_boundary(monkeypatch, delta, kind):
    plaintext = b'{"synthetic":true}'
    blob = crypto._encrypt_plaintext(plaintext)
    size = len(blob) if kind == "encrypted" else len(plaintext)
    monkeypatch.setattr(resources, f"{kind.upper()}_LIMIT", size + delta)
    if delta < 0:
        with pytest.raises(resources.SaveResourceError):
            crypto.decrypt_save(blob)
    else:
        assert crypto.decrypt_save(blob) == {"synthetic": True}


@pytest.mark.parametrize("delta", [-1, 0, 1])
@pytest.mark.parametrize("hash_only", [False, True])
def test_actual_file_read_boundary(tmp_path, monkeypatch, delta, hash_only):
    monkeypatch.setattr(resources, "ENCRYPTED_LIMIT", 64)
    path = tmp_path / "boundary.es3"
    blob = b"x" * (64 + delta)
    path.write_bytes(blob)
    process = resources.hash_encrypted if hash_only else resources.read_encrypted
    with path.open("rb") as stream:
        if delta > 0:
            with pytest.raises(resources.SaveResourceError):
                process(stream)
        else:
            result = process(stream)
            assert result == (resources.sha256(blob).hexdigest() if hash_only else blob)


@pytest.mark.parametrize("plaintext", [b"{broken", b'"not an object"', b"[" * 1100 + b"]" * 1100])
def test_malformed_and_deep_json_fail_safely(plaintext):
    with pytest.raises(crypto.SaveCryptoError):
        crypto.decrypt_save(crypto._encrypt_plaintext(plaintext))


def test_oversized_ciphertext_never_reaches_cipher(monkeypatch):
    monkeypatch.setattr(resources, "ENCRYPTED_LIMIT", 32)

    def no_cipher(*_args, **_kwargs):
        pytest.fail("Oversized ciphertext must not reach the cipher")

    monkeypatch.setattr(crypto, "Cipher", no_cipher)
    with pytest.raises(resources.SaveResourceError):
        crypto.decrypt_save(b"x" * 33)


def test_operation_budget_covers_multiple_decryptions(monkeypatch):
    first, second = (crypto.encrypt_save({"value": n}) for n in (1, 2))
    monkeypatch.setattr(resources, "ENCRYPTED_OPERATION_LIMIT", len(first) + len(second) - 1)
    with resources.save_operation():
        assert crypto.decrypt_save(first) == {"value": 1}
        with pytest.raises(resources.SaveResourceError):
            crypto.decrypt_save(second)
    monkeypatch.setattr(resources, "ENCRYPTED_OPERATION_LIMIT", 1000)
    monkeypatch.setattr(resources, "PLAINTEXT_OPERATION_LIMIT", 1)
    with pytest.raises(resources.SaveResourceError):
        crypto.decrypt_save(first)


def test_standard_serializer_and_crypto_vector_remain_compatible():
    data = {"unknown": "ภาษาไทย", "number": 9_007_199_254_740_991}
    blob = crypto.encrypt_save(data)
    assert crypto._decrypt_plaintext(blob) == json.dumps(data, ensure_ascii=False, indent=4).encode(
        "utf-8"
    )
    assert crypto.decrypt_save(blob) == data
