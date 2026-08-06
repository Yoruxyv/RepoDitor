from repo_save_editor.model import (
    get_player_upgrade,
    get_players,
    get_run_stat,
    set_player_upgrade,
    set_run_stat,
)


def sample_save():
    return {
        "teamName": {"__type": "System.String", "value": "R.E.P.O."},
        "dateAndTime": {"__type": "System.String", "value": "2026-08-06"},
        "timePlayed": {"__type": "System.Single", "value": 100.0},
        "playerNames": {
            "__type": "Dictionary",
            "value": {"111": "Alpha", "222": "Beta"},
        },
        "dictionaryOfDictionaries": {
            "__type": "Dictionary",
            "value": {
                "runStats": {
                    "level": 4,
                    "currency": 12,
                    "lives": 3,
                    "totalHaul": 500,
                },
                "playerUpgradeStrength": {"111": 2},
            },
        },
    }


def test_players():
    players = get_players(sample_save())
    assert [p.name for p in players] == ["Alpha", "Beta"]


def test_missing_upgrade_defaults_to_zero():
    assert get_player_upgrade(sample_save(), "222", "playerUpgradeStrength") == 0


def test_set_upgrade_creates_player_value():
    data = sample_save()
    set_player_upgrade(data, "222", "playerUpgradeStrength", 100)
    assert get_player_upgrade(data, "222", "playerUpgradeStrength") == 100


def test_run_stats():
    data = sample_save()
    assert get_run_stat(data, "level") == 4

    set_run_stat(data, "level", 20)
    assert get_run_stat(data, "level") == 20
