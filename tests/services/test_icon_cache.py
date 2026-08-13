from __future__ import annotations

from pathlib import Path

from repo_save_editor.services.icon_cache import (
    IconCacheRoots,
    available_icon_keys,
    get_icon_cache_roots,
    normalize_icon_cache_key,
)


def test_known_folder_root_uses_only_the_fixed_game_cache_suffix(tmp_path: Path) -> None:
    roots = get_icon_cache_roots(lambda: tmp_path / "LocalLow")

    assert roots == IconCacheRoots(
        items=tmp_path / "LocalLow" / "semiwork" / "Repo" / "Cache" / "Icons" / "Items",
        cosmetics=(tmp_path / "LocalLow" / "semiwork" / "Repo" / "Cache" / "Icons" / "Cosmetics"),
    )


def test_cache_key_normalization_matches_clone_removal_and_invariant_lowercase() -> None:
    assert normalize_icon_cache_key("Item Gun Tranq(Clone)") == "item gun tranq.png"
    assert normalize_icon_cache_key("Bølle") == "bølle.png"
    assert normalize_icon_cache_key("../secret") is None
    assert normalize_icon_cache_key("") is None


def test_availability_is_optional_and_domain_scoped(tmp_path: Path) -> None:
    roots = IconCacheRoots(tmp_path / "Items", tmp_path / "Cosmetics")
    roots.items.mkdir()
    roots.cosmetics.mkdir()
    (roots.items / "item tool.png").write_bytes(b"item")
    (roots.items / "item walkietalkiebox.png").write_bytes(b"black placeholder")
    (roots.cosmetics / "cosmetic.png").write_bytes(b"cosmetic")

    def loader() -> IconCacheRoots:
        return roots

    assert available_icon_keys("item", ("item tool.png", "missing.png"), loader) == {
        "item tool.png"
    }
    assert available_icon_keys("cosmetic", ("cosmetic.png",), loader) == {"cosmetic.png"}
    assert available_icon_keys("item", ("cosmetic.png",), loader) == frozenset()
    assert available_icon_keys("item", ("item walkietalkiebox.png",), loader) == frozenset()
    assert available_icon_keys("item", ("item tool.png",), lambda: None) == frozenset()
