from repo_save_editor.core.crypto import decrypt_save, encrypt_save


def test_crypto_round_trip(sample_save):
    encrypted = encrypt_save(sample_save)

    assert encrypted[:1] != b"{"
    assert decrypt_save(encrypted) == sample_save
