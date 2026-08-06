from repo_save_editor.crypto import decrypt_save, encrypt_save


def test_crypto_round_trip():
    source = {
        "teamName": {"__type": "System.String", "value": "R.E.P.O."},
        "dateAndTime": {"__type": "System.String", "value": "2026-08-06"},
        "timePlayed": {"__type": "System.Single", "value": 123.5},
        "playerNames": {
            "__type": "System.Collections.Generic.Dictionary`2",
            "value": {"123": "Tester"},
        },
        "dictionaryOfDictionaries": {
            "__type": "System.Collections.Generic.Dictionary`2",
            "value": {
                "runStats": {"level": 2, "currency": 10},
                "playerUpgradeStrength": {"123": 5},
            },
        },
    }

    encrypted = encrypt_save(source)

    assert encrypted[:1] != b"{"
    assert decrypt_save(encrypted) == source
