import pytest

from repo_save_editor.core.schema import SAVE_INT32_MAX
from repo_save_editor.services.player.state import (
    get_player_health,
    get_player_max_health,
    get_players,
    set_player_health,
)


def test_players(sample_save):
    players = get_players(sample_save)
    assert [player.name for player in players] == ["Alpha", "Beta"]


def test_player_health_round_trip(sample_save):
    assert get_player_health(sample_save, "111") == 80

    set_player_health(sample_save, "111", 120)

    assert get_player_health(sample_save, "111") == 120


def test_player_max_health_uses_base_and_health_upgrades(sample_save):
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["playerUpgradeHealth"] = {"111": 100, "222": 2}

    assert get_player_max_health(sample_save, "111") == 2100
    assert get_player_max_health(sample_save, "222") == 140


def test_player_max_health_defaults_safely_for_missing_or_invalid_upgrades(sample_save):
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    assert get_player_max_health(sample_save, "111") == 100

    dictionaries["playerUpgradeHealth"] = {"111": "invalid", "222": -3}
    assert get_player_max_health(sample_save, "111") == 100
    assert get_player_max_health(sample_save, "222") == 100


@pytest.mark.parametrize("value", [-1, SAVE_INT32_MAX + 1, True, 1.5, "1"])
def test_player_health_rejects_values_outside_storage_representation(sample_save, value):
    with pytest.raises(ValueError, match="between 0 and 2,147,483,647"):
        set_player_health(sample_save, "111", value)
