import base64
from unittest.mock import patch

from repo_save_editor.core.crypto import decrypt_save, encrypt_save

COMPATIBILITY_DATA = {"compatibility": "R.E.P.O. ES3", "value": 7}
COMPATIBILITY_VECTOR = base64.b64decode(
    "AAECAwQFBgcICQoLDA0OD6DTEigr0WH8L5MQRBOBT18pcyu4HH2yPq7NR0U2G273"
    "ZMhLBUEj64I1G72gJB91Wobcksz7Tp7pV6bEDMr5B/w="
)


def test_crypto_round_trip(sample_save):
    encrypted = encrypt_save(sample_save)

    assert encrypted[:1] != b"{"
    assert decrypt_save(encrypted) == sample_save


def test_known_es3_compatibility_vector():
    assert decrypt_save(COMPATIBILITY_VECTOR) == COMPATIBILITY_DATA

    with patch("repo_save_editor.core.crypto.os.urandom", return_value=bytes(range(16))):
        assert encrypt_save(COMPATIBILITY_DATA) == COMPATIBILITY_VECTOR
