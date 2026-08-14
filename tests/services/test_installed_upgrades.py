from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.player.installed_upgrades import (
    discover_installed_upgrade_presentations,
    match_upgrade_items,
)
from repo_save_editor.services.player.upgrades import UpgradePresentationSource


def _metadata(_names):
    return {
        "Item Upgrade Player Energy": InstalledItemMetadata(
            ItemRechargeCapability.NOT_RECHARGEABLE,
            "item upgrade player energy.png",
            "Item Upgrade Player Energy",
            "Stamina Upgrade",
            10,
        ),
        "Item Upgrade Player Tumble Launch": InstalledItemMetadata(
            ItemRechargeCapability.NOT_RECHARGEABLE,
            None,
            "Item Upgrade Player Tumble Launch",
            "Tumble Launch Upgrade",
            10,
        ),
        "Item Upgrade Player Sprint Speed": InstalledItemMetadata(
            ItemRechargeCapability.NOT_RECHARGEABLE,
            None,
            "Item Upgrade Player Sprint Speed",
            "Sprint Speed Upgrade",
            10,
        ),
    }


def test_installed_upgrade_metadata_enriches_labels_caps_and_exact_available_icon():
    result = discover_installed_upgrade_presentations(
        ("playerUpgradeStamina", "playerUpgradeLaunch", "playerUpgradeSpeed"),
        metadata_loader=_metadata,
        icon_loader=lambda domain, keys: frozenset(keys),
    )

    assert result["playerUpgradeStamina"].label == "Stamina"
    assert result["playerUpgradeStamina"].icon_cache_key == "item upgrade player energy.png"
    assert result["playerUpgradeLaunch"].label == "Tumble Launch"
    assert result["playerUpgradeSpeed"].label == "Sprint Speed"
    assert all(value.source is UpgradePresentationSource.INSTALLED for value in result.values())
    assert all(value.gameplay_cap == 10 for value in result.values())


def test_missing_install_and_future_upgrade_remain_open_fail_soft_fallbacks():
    result = discover_installed_upgrade_presentations(
        ("playerUpgradeThrow", "playerUpgradeSuperMegaJump"),
        metadata_loader=lambda _names: {},
        icon_loader=lambda _domain, _keys: frozenset(),
    )

    assert result["playerUpgradeThrow"].label == "Throw"
    assert result["playerUpgradeSuperMegaJump"].label == "Super Mega Jump"
    assert result["playerUpgradeSuperMegaJump"].source is UpgradePresentationSource.HUMANIZED
    assert all(value.icon_cache_key is None for value in result.values())


def test_dynamic_upgrade_keys_match_upgrade_item_prefab_names_without_closed_membership():
    result = match_upgrade_items(
        ("playerUpgradeStrength", "playerUpgradeMoonBoots"),
        (
            "Item Upgrade Player Grab Strength",
            "Item Upgrade Player Moon Boots",
            "Item Unrelated",
        ),
    )

    assert result == {
        "Item Upgrade Player Grab Strength": "playerUpgradeStrength",
        "Item Upgrade Player Moon Boots": "playerUpgradeMoonBoots",
    }
