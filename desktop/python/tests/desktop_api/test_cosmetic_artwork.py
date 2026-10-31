"""Cosmetic read-only Electron DTO regression tests."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from repo_save_editor.desktop_api.cosmetic_artwork import get_cosmetic_artwork
from repo_save_editor.services.cosmetics.installed_artwork import ArtworkWatch, DecodedCosmeticArtwork


def test_invalid_ids_never_decode() -> None:
    with patch("repo_save_editor.desktop_api.cosmetic_artwork.prepare_installed_cosmetic_artwork") as decode:
        for value in ("-1", "01", "1.0", "2147483648", "", " 1", "1 ", "١", "NaN"):
            assert get_cosmetic_artwork(value)["ok"] is False
        decode.assert_not_called()


def test_success_payload_includes_source_watches(tmp_path: Path) -> None:
    image = DecodedCosmeticArtwork(
        cosmetic_id=7, asset_guid="a" * 32, asset_path="assets/cosmetics/hat.png",
        png=b"example", width=16, height=16, source_identity="c" * 64,
        watches=(ArtworkWatch(tmp_path / "source.bundle", 12, 1234),),
    )
    with patch("repo_save_editor.desktop_api.cosmetic_artwork.prepare_installed_cosmetic_artwork", return_value=(image,)):
        response = get_cosmetic_artwork("7")
    assert response["ok"] is True
    assert response["artwork"]["cosmeticId"] == 7
    assert response["artwork"]["pngBase64"] == "ZXhhbXBsZQ=="
    assert response["artwork"]["watches"][0]["size"] == "12"


def test_unsupported_assets_fail_soft() -> None:
    with patch("repo_save_editor.desktop_api.cosmetic_artwork.prepare_installed_cosmetic_artwork", side_effect=ImportError("optional dependencies")):
        assert get_cosmetic_artwork("0") == {"ok": True, "artwork": None}
