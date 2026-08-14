import pytest

from repo_save_editor.services.player.upgrades import (
    UpgradePresentation,
    UpgradePresentationSource,
    discover_player_upgrades,
    get_player_upgrade,
    get_upgrade_label,
    set_player_upgrade,
)


def test_missing_upgrade_defaults_to_zero(sample_save):
    assert get_player_upgrade(sample_save, "222", "playerUpgradeStrength") == 0


def test_set_upgrade_creates_player_value(sample_save):
    set_player_upgrade(sample_save, "222", "playerUpgradeStrength", 100)
    assert get_player_upgrade(sample_save, "222", "playerUpgradeStrength") == 100


def test_negative_upgrade_is_rejected(sample_save):
    with pytest.raises(ValueError, match="cannot be negative"):
        set_player_upgrade(sample_save, "111", "playerUpgradeStrength", -1)


def test_discovery_uses_save_as_source_of_truth(sample_save):
    upgrades = discover_player_upgrades(sample_save)

    assert [(upgrade.key, upgrade.label, upgrade.presentation_source) for upgrade in upgrades] == [
        ("playerUpgradeStrength", "Strength", UpgradePresentationSource.HUMANIZED),
    ]


def test_discovery_includes_unknown_or_modded_upgrade(sample_save):
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["playerUpgradePocketcartKeepItems"] = {"111": 1}

    upgrades = discover_player_upgrades(sample_save)

    pocketcart = next(
        upgrade for upgrade in upgrades if upgrade.key == "playerUpgradePocketcartKeepItems"
    )
    assert pocketcart.label == "Pocketcart Keep Items"
    assert pocketcart.presentation_source is UpgradePresentationSource.HUMANIZED


def test_discovery_ignores_non_dictionary_upgrade_fields(sample_save):
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["playerUpgradeBroken"] = 123

    assert all(
        upgrade.key != "playerUpgradeBroken" for upgrade in discover_player_upgrades(sample_save)
    )


def test_unknown_upgrade_key_gets_friendly_label():
    assert get_upgrade_label("playerUpgradePocketcartKeepItems") == "Pocketcart Keep Items"


def test_installed_presentation_enriches_without_limiting_values(sample_save):
    presentation = UpgradePresentation(
        "Grab Strength",
        UpgradePresentationSource.INSTALLED,
        "Item Upgrade Player Grab Strength",
        "item upgrade player grab strength.png",
        10,
    )
    upgrade = discover_player_upgrades(sample_save, {"playerUpgradeStrength": presentation})[0]
    set_player_upgrade(sample_save, "111", upgrade.key, 99)
    assert upgrade.gameplay_cap == 10
    assert get_player_upgrade(sample_save, "111", upgrade.key) == 99
