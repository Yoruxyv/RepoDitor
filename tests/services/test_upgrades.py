import pytest

from repo_save_editor.services.upgrades import get_player_upgrade, set_player_upgrade


def test_missing_upgrade_defaults_to_zero(sample_save):
    assert get_player_upgrade(sample_save, "222", "playerUpgradeStrength") == 0


def test_set_upgrade_creates_player_value(sample_save):
    set_player_upgrade(sample_save, "222", "playerUpgradeStrength", 100)
    assert get_player_upgrade(sample_save, "222", "playerUpgradeStrength") == 100


def test_negative_upgrade_is_rejected(sample_save):
    with pytest.raises(ValueError, match="cannot be negative"):
        set_player_upgrade(sample_save, "111", "playerUpgradeStrength", -1)
