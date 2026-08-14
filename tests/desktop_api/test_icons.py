from __future__ import annotations

from pathlib import Path

from repo_save_editor.desktop_api import icons
from repo_save_editor.services.player.upgrade_textures import DecodedUpgradeTexture, SourceWatch
from repo_save_editor.services.unity_textures import Texture2DMetadata


def test_upgrade_texture_reports_encoded_crop_dimensions(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source = tmp_path / "resources.assets"
    source.write_bytes(b"x")
    texture = Texture2DMetadata(
        path_id=40,
        name="Upgrade_Health_Albedo",
        width=512,
        height=512,
        texture_format="DXT5",
        mip_count=10,
        stream_path="resources.assets.resS",
        stream_offset=0,
        stream_size=349_552,
        inline_data_size=0,
        top_mip_size=262_144,
    )
    # Header-only bytes are enough here; Electron performs the protocol-level PNG
    # validation while this adapter test only verifies the projected dimensions.
    decoded = DecodedUpgradeTexture(
        "playerUpgradeHealth",
        texture,
        b"png",
        183,
        277,
        "a" * 64,
        (SourceWatch(source, 1, source.stat().st_mtime_ns),),
    )
    monkeypatch.setattr(icons, "decode_installed_upgrade_texture", lambda _key: decoded)

    result = icons.get_upgrade_texture("playerUpgradeHealth")

    assert result["texture"]["width"] == 183
    assert result["texture"]["height"] == 277
    assert result["texture"]["textureName"] == "Upgrade_Health_Albedo"
