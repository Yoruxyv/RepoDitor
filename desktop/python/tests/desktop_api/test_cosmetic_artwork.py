"""Cosmetic read-only Electron DTO regression tests."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

import pytest

from repo_save_editor.desktop_api import cosmetic_artwork as native
from repo_save_editor.desktop_api.cosmetic_artwork import get_cosmetic_artwork
from repo_save_editor.services.cosmetics.installed_artwork import (
    ArtworkWatch,
    DecodedCosmeticArtwork,
)
from repo_save_editor.services.texture_codec import encode_rgba_png


def test_invalid_ids_never_decode() -> None:
    with patch(
        "repo_save_editor.desktop_api.cosmetic_artwork.prepare_installed_cosmetic_artwork"
    ) as decode:
        for value in ("-1", "01", "1.0", "2147483648", "", " 1", "1 ", "Ù¡", "NaN", "9" * 5000):
            assert get_cosmetic_artwork(value)["ok"] is False
        decode.assert_not_called()


def test_success_payload_includes_source_watches(tmp_path: Path) -> None:
    image = DecodedCosmeticArtwork(
        cosmetic_id=7,
        asset_guid="a" * 32,
        asset_path="assets/cosmetics/hat.png",
        png=b"example",
        width=16,
        height=16,
        source_identity="c" * 64,
        watches=(ArtworkWatch(tmp_path / "source.bundle", 12, 1234),),
    )
    with patch(
        "repo_save_editor.desktop_api.cosmetic_artwork.prepare_installed_cosmetic_artwork",
        return_value=(image,),
    ):
        response = get_cosmetic_artwork("7")
    assert response["ok"] is True
    assert response["artwork"]["cosmeticId"] == 7
    assert response["artwork"]["pngBase64"] == "ZXhhbXBsZQ=="
    assert response["artwork"]["watches"][0]["size"] == "12"


def test_unsupported_assets_fail_soft() -> None:
    with patch(
        "repo_save_editor.desktop_api.cosmetic_artwork.prepare_installed_cosmetic_artwork",
        side_effect=ImportError("optional dependencies"),
    ):
        assert get_cosmetic_artwork("0") == {"ok": True, "artwork": None}


def test_native_proof_binds_exact_id_source_and_metasave(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = bytes.fromhex("a" * 64)
    monkeypatch.setenv("REPODITOR_NATIVE_COSMETIC_KEY", key.hex())
    meta = tmp_path / "MetaSave.es3"
    meta.write_bytes(b"synthetic MetaSave bytes")
    fingerprint = sha256(meta.read_bytes()).hexdigest()
    revision, filename, png_revision = "b" * 64, "c" * 32, "d" * 64
    binding = f"{revision}:{filename}:{png_revision}"
    proof = f"{binding}:{native._signature(key, fingerprint, '556', binding)}"
    png = encode_rgba_png(bytes((1, 2, 3, 255)), 1, 1)
    monkeypatch.setattr(native, "_meta_path", lambda _: meta)
    with patch.object(native, "read_bound_cosmetic_png", return_value=png) as read:
        unavailable = {"ok": True, "artwork": None}
        for identity in ("0556", "555", "2000", "999", "../file"):
            assert native.get_native_cosmetic_artwork(fingerprint, proof, identity) == unavailable
        assert (
            native.get_native_cosmetic_artwork(fingerprint, "e" + proof[1:], "556") == unavailable
        )
        read.assert_not_called()
        response = native.get_native_cosmetic_artwork(fingerprint, proof, "556")
        assert response["artwork"]["cosmeticId"] == 556
        assert response["artwork"]["sourceIdentity"] == revision
        assert "watches" not in response["artwork"]
        read.assert_called_once_with(revision, filename, png_revision)
        meta.write_bytes(b"changed")
        assert native.get_native_cosmetic_artwork(fingerprint, proof, "556") == unavailable
        meta.unlink()
        assert native.get_native_cosmetic_artwork(fingerprint, proof, "556") == unavailable
        read.assert_called_once()
