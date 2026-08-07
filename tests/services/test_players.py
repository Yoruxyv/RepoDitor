from repo_save_editor.services.players import (
    get_player_health,
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
