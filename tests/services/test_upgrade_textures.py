from __future__ import annotations

import hashlib
import struct
from pathlib import Path

import pytest
from tests.unity_serialized_fixture import aligned_string, pptr, write_serialized_file

from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.player import upgrade_textures
from repo_save_editor.services.player.upgrade_textures import (
    UpgradeTextureError,
    _front_uv_bounds,
    _resolve_stream,
    _resolve_texture_metadata,
    _resolve_upgrade_visual,
    _uv_crop,
    decode_installed_upgrade_texture,
)
from repo_save_editor.services.unity_serialized import SerializedFileIndex, UnityMetadataError
from repo_save_editor.services.unity_textures import (
    MeshVertexData,
    Texture2DMetadata,
    parse_mesh_stream_metadata,
    parse_mesh_vertex_data,
    parse_texture2d,
)


def _game_object(name: str, components: list[int]) -> bytes:
    return (
        struct.pack("<i", len(components))
        + b"".join(pptr(0, component) for component in components)
        + struct.pack("<i", 0)
        + aligned_string(name)
    )


def _transform(game_object: int, children: list[int]) -> bytes:
    return (
        pptr(0, game_object)
        + (b"\0" * 40)
        + struct.pack("<i", len(children))
        + b"".join(pptr(0, child) for child in children)
    )


def _renderer(game_object: int, material: int) -> bytes:
    return pptr(0, game_object) + struct.pack("<i", 1) + pptr(0, material)


def _material(texture: int) -> bytes:
    return aligned_string("_MainTex") + pptr(0, texture)


def _mesh_filter(game_object: int, mesh: int) -> bytes:
    return pptr(0, game_object) + pptr(0, mesh)


def _upgrade_pack_mesh() -> bytes:
    positions = [
        (-1.0, -1.0, 1.0),
        (1.0, -1.0, 1.0),
        (1.0, 1.0, 1.0),
        (-1.0, 1.0, 1.0),
        (-1.0, -1.0, -1.0),
        (1.0, -1.0, -1.0),
        (1.0, 1.0, -1.0),
        (-1.0, 1.0, -1.0),
    ]
    normals = [(0.0, 0.0, 1.0)] * 4 + [(0.0, 0.0, -1.0)] * 4
    uvs = [
        (0.5, 0.0),
        (1.0, 0.0),
        (1.0, 0.5),
        (0.5, 0.5),
        (0.0, 0.0),
        (0.5, 0.0),
        (0.5, 0.5),
        (0.0, 0.5),
    ]
    vertex_data = b"".join(
        struct.pack("<3f3f2f", *position, *normal, *uv)
        for position, normal, uv in zip(positions, normals, uvs, strict=True)
    )
    channels = bytes(
        (
            0,
            0,
            0,
            3,
            0,
            12,
            0,
            3,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            24,
            0,
            2,
        )
    )
    return (
        aligned_string("Upgrade Pack")
        + b"vertex-prefix"
        + b"\0" * 3
        + struct.pack("<Ii", len(positions), 5)
        + channels
        + struct.pack("<i", len(vertex_data))
        + vertex_data
    )


def _streamed_upgrade_pack_mesh(
    *,
    stream_offset: int = 16,
    stream_path: str = "resources.assets.resS",
) -> tuple[bytes, bytes]:
    positions = [
        (-1.0, -1.0, 1.0),
        (1.0, -1.0, 1.0),
        (1.0, 1.0, 1.0),
        (-1.0, 1.0, 1.0),
        (-1.0, -1.0, -1.0),
        (1.0, -1.0, -1.0),
        (1.0, 1.0, -1.0),
        (-1.0, 1.0, -1.0),
    ]
    normals = [(0.0, 0.0, 1.0)] * 4 + [(0.0, 0.0, -1.0)] * 4
    uvs = [
        (0.5, 0.0),
        (1.0, 0.0),
        (1.0, 0.5),
        (0.5, 0.5),
        (0.0, 0.0),
        (0.5, 0.0),
        (0.5, 0.5),
        (0.0, 0.5),
    ]
    vertex_data = b"".join(
        struct.pack(
            "<3f4e4e2e2f",
            *position,
            normal[0],
            normal[1],
            normal[2],
            0.0,
            1.0,
            0.0,
            0.0,
            1.0,
            *uv,
            0.0,
            0.0,
        )
        for position, normal, uv in zip(positions, normals, uvs, strict=True)
    )
    channels = bytes(
        (
            0,
            0,
            0,
            3,
            0,
            12,
            1,
            0x34,
            0,
            20,
            1,
            4,
            0,
            0,
            0,
            0,
            0,
            28,
            1,
            2,
            0,
            32,
            0,
            2,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        )
    )
    mesh = (
        aligned_string("Upgrade Pack")
        + b"vertex-prefix"
        + b"\0" * 3
        + struct.pack("<Ii", len(positions), 14)
        + channels
        + struct.pack("<i", 0)
        + b"compressed-mesh-placeholder"
    )
    mesh += b"\0" * ((-len(mesh)) % 4)
    mesh += struct.pack("<QI", stream_offset, len(vertex_data)) + aligned_string(stream_path)
    return mesh, vertex_data


def _texture2d(
    *,
    name: str = "Upgrade_Health_Albedo",
    width: int = 4,
    height: int = 4,
    texture_format: int = 10,
    mip_count: int = 1,
    stream_path: str = "resources.assets.resS",
    stream_offset: int = 0,
    stream_size: int = 8,
    inline_size: int = 0,
) -> bytes:
    complete_size = max(stream_size, 1)
    return (
        aligned_string(name)
        + struct.pack("<i", 4)
        + bytes((0, 0))
        + b"\0\0"
        + struct.pack(
            "<iiiiii",
            width,
            height,
            complete_size,
            0,
            texture_format,
            mip_count,
        )
        + bytes((1, 0, 0, 1))
        + struct.pack("<iii", 0, 0, 0)
        + struct.pack("<ii", 1, 2)
        + (b"\0" * 24)
        + struct.pack("<ii", 0, 0)
        + struct.pack("<i", 0)
        + struct.pack("<i", inline_size)
        + struct.pack("<QI", stream_offset, stream_size)
        + aligned_string(stream_path)
    )


def _resource_manager(*entries: tuple[str, int, int]) -> bytes:
    return struct.pack("<i", len(entries)) + b"".join(
        aligned_string(key) + pptr(file_id, path_id) for key, file_id, path_id in entries
    )


def _write_resource_manager(
    path: Path,
    *entries: tuple[str, int, int],
    external_name: str = "resources.assets",
) -> None:
    write_serialized_file(
        path,
        [(900, 147, _resource_manager(*entries))],
        externals=(("", external_name),),
    )


def _write_upgrade_assets(path: Path, *, texture: bytes | None = None) -> None:
    write_serialized_file(
        path,
        [
            (1, 1, _game_object("Item Upgrade Player Health", [10])),
            (10, 4, _transform(1, [11])),
            (2, 1, _game_object("Upgrade Mesh", [11, 20, 21])),
            (11, 4, _transform(2, [])),
            (20, 23, _renderer(2, 30)),
            (21, 33, _mesh_filter(2, 50)),
            (30, 21, _material(40)),
            (40, 28, texture or _texture2d()),
            (50, 43, _upgrade_pack_mesh()),
        ],
    )


def _metadata(**overrides: object) -> Texture2DMetadata:
    values = {
        "path_id": 40,
        "name": "Upgrade_Health_Albedo",
        "width": 4,
        "height": 4,
        "texture_format": "DXT1",
        "mip_count": 1,
        "stream_path": "resources.assets.resS",
        "stream_offset": 0,
        "stream_size": 8,
        "inline_data_size": 0,
        "top_mip_size": 8,
    }
    values.update(overrides)
    return Texture2DMetadata(**values)  # type: ignore[arg-type]


def test_dynamic_prefab_renderer_material_maintex_texture_chain(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    _write_upgrade_assets(resources)
    _write_resource_manager(
        managers,
        ("items/item upgrade player health", 1, 1),
    )

    metadata = _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Health",))

    assert metadata.path_id == 40
    assert metadata.name == "Upgrade_Health_Albedo"
    assert metadata.width == 4
    assert metadata.height == 4
    assert metadata.texture_format == "DXT1"
    assert metadata.stream_path == "resources.assets.resS"
    assert metadata.stream_size == 8
    assert metadata.top_mip_size == 8


def test_mesh_vertex_data_resolves_installed_front_uv_bounds(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    write_serialized_file(resources, [(50, 43, _upgrade_pack_mesh())])

    with SerializedFileIndex(resources) as index:
        record = index.find_records({50})[50]
        mesh = parse_mesh_vertex_data(index, record)

    assert mesh.path_id == 50
    assert len(mesh.positions) == 8
    assert _front_uv_bounds(mesh) == (0.5, 0.0, 1.0, 0.5)
    assert _uv_crop(_front_uv_bounds(mesh), 512, 512) == (256, 256, 512, 512)


def test_streamed_float16_mesh_resolves_installed_front_uv_bounds(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    mesh_bytes, stream_bytes = _streamed_upgrade_pack_mesh()
    write_serialized_file(resources, [(50, 43, mesh_bytes)])

    with SerializedFileIndex(resources) as index:
        record = index.find_records({50})[50]
        stream = parse_mesh_stream_metadata(index, record)
        assert stream is not None
        assert stream.path == "resources.assets.resS"
        assert stream.offset == 16
        assert stream.size == len(stream_bytes)
        mesh = parse_mesh_vertex_data(index, record, stream_data=stream_bytes)

    assert len(mesh.positions) == 8
    assert _front_uv_bounds(mesh) == (0.5, 0.0, 1.0, 0.5)


def test_upgrade_visual_reads_bounded_streamed_mesh_for_framing(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    mesh_bytes, stream_bytes = _streamed_upgrade_pack_mesh()
    write_serialized_file(
        resources,
        [
            (1, 1, _game_object("Item Upgrade Player Health", [10])),
            (10, 4, _transform(1, [11])),
            (2, 1, _game_object("Upgrade Mesh", [11, 20, 21])),
            (11, 4, _transform(2, [])),
            (20, 23, _renderer(2, 30)),
            (21, 33, _mesh_filter(2, 50)),
            (30, 21, _material(40)),
            (40, 28, _texture2d()),
            (50, 43, mesh_bytes),
        ],
    )
    _write_resource_manager(managers, ("items/item upgrade player health", 1, 1))
    stream_file = tmp_path / "resources.assets.resS"
    stream_file.write_bytes(b"\0" * 16 + stream_bytes)

    visual = _resolve_upgrade_visual(
        resources,
        managers,
        ("Item Upgrade Player Health",),
        data_root=tmp_path,
    )

    assert visual.framing is not None
    assert visual.framing.uv_bounds == (0.5, 0.0, 1.0, 0.5)
    assert visual.framing.source_path == stream_file.resolve()


def test_real_strength_uv_oracle_maps_to_measured_front_panel_crop() -> None:
    bounds = (0.499512, 0.00293, 0.85498, 0.541992)

    assert _uv_crop(bounds, 512, 512) == (255, 234, 438, 511)


def test_front_uv_bounds_reject_non_front_or_out_of_range_meshes() -> None:
    no_front = MeshVertexData(1, ((0.0, 0.0, 0.0),) * 3, ((0.0, 1.0, 0.0),) * 3, ((0.0, 0.0),) * 3)
    with pytest.raises(UnityMetadataError, match="presentation face"):
        _front_uv_bounds(no_front)

    bad_uv = MeshVertexData(
        1,
        ((0.0, 0.0, 1.0), (1.0, 0.0, 1.0), (0.0, 1.0, 1.0)),
        ((0.0, 0.0, 1.0),) * 3,
        ((0.5, 0.0), (1.1, 0.0), (0.5, 0.5)),
    )
    with pytest.raises(UnityMetadataError, match="outside"):
        _front_uv_bounds(bad_uv)


def test_multiple_prefab_renderers_resolve_unique_supported_texture_chain(
    tmp_path: Path,
) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    write_serialized_file(
        resources,
        [
            (1, 1, _game_object("Item Upgrade Player Health", [10])),
            (10, 4, _transform(1, [11, 12, 13])),
            (2, 1, _game_object("Packaging", [11, 20])),
            (11, 4, _transform(2, [])),
            # This renderer has no parseable material vector and must not block the
            # relevant upgrade chain.
            (20, 23, pptr(0, 2) + b"\0" * 24),
            (3, 1, _game_object("Upgrade Mesh", [12, 21])),
            (12, 4, _transform(3, [])),
            (21, 23, _renderer(3, 30)),
            (30, 21, _material(40)),
            (40, 28, _texture2d()),
            (4, 1, _game_object("Equip Helper", [13, 22])),
            (13, 4, _transform(4, [])),
            (22, 23, _renderer(4, 31)),
            (31, 21, aligned_string("_Color")),
        ],
    )
    _write_resource_manager(
        managers,
        ("items/item upgrade player health", 1, 1),
    )

    metadata = _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Health",))

    assert metadata.path_id == 40


def test_multiple_supported_texture_chains_are_rejected_as_ambiguous(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    write_serialized_file(
        resources,
        [
            (1, 1, _game_object("Item Upgrade Player Health", [10])),
            (10, 4, _transform(1, [11, 12])),
            (2, 1, _game_object("Upgrade Mesh A", [11, 20])),
            (11, 4, _transform(2, [])),
            (20, 23, _renderer(2, 30)),
            (30, 21, _material(40)),
            (40, 28, _texture2d(name="Upgrade_A_Albedo")),
            (3, 1, _game_object("Upgrade Mesh B", [12, 21])),
            (12, 4, _transform(3, [])),
            (21, 23, _renderer(3, 31)),
            (31, 21, _material(41)),
            (41, 28, _texture2d(name="Upgrade_B_Albedo")),
        ],
    )
    _write_resource_manager(
        managers,
        ("items/item upgrade player health", 1, 1),
    )

    with pytest.raises(UnityMetadataError, match="missing or ambiguous"):
        _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Health",))


def test_texture2d_unsupported_format_rejected(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    _write_upgrade_assets(resources, texture=_texture2d(texture_format=4, stream_size=64))
    _write_resource_manager(
        managers,
        ("items/item upgrade player health", 1, 1),
    )

    with pytest.raises(UnityMetadataError, match="missing or ambiguous"):
        _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Health",))


def test_resource_manager_pointer_is_authoritative_when_prefab_names_repeat(
    tmp_path: Path,
) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    # A same-name GameObject exists but is not the canonical ResourceManager prefab.
    write_serialized_file(
        resources,
        [
            (99, 1, _game_object("Item Upgrade Player Health", [])),
            (1, 1, _game_object("Item Upgrade Player Health", [10])),
            (10, 4, _transform(1, [11])),
            (2, 1, _game_object("Upgrade Mesh", [11, 20])),
            (11, 4, _transform(2, [])),
            (20, 23, _renderer(2, 30)),
            (30, 21, _material(40)),
            (40, 28, _texture2d()),
        ],
    )
    _write_resource_manager(
        managers,
        ("items/item upgrade player health", 1, 1),
    )

    metadata = _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Health",))

    assert metadata.path_id == 40


def test_resource_manager_external_file_must_be_resources_assets(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    _write_upgrade_assets(resources)
    _write_resource_manager(
        managers,
        ("items/item upgrade player health", 1, 1),
        external_name="other.assets",
    )

    with pytest.raises(UnityMetadataError, match="unsupported file"):
        _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Health",))


def test_resource_manager_prefab_name_is_cross_checked(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    _write_upgrade_assets(resources)
    _write_resource_manager(
        managers,
        ("items/item upgrade player stamina", 1, 1),
    )

    with pytest.raises(UnityMetadataError, match="identity"):
        _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Stamina",))


def test_resource_manager_duplicate_entry_is_rejected(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    managers = tmp_path / "globalgamemanagers"
    _write_upgrade_assets(resources)
    _write_resource_manager(
        managers,
        ("items/item upgrade player health", 1, 1),
        ("items/item upgrade player health", 1, 1),
    )

    with pytest.raises(UnityMetadataError, match="missing or ambiguous"):
        _resolve_texture_metadata(resources, managers, ("Item Upgrade Player Health",))


def test_malformed_texture2d_rejected(tmp_path: Path) -> None:
    resources = tmp_path / "resources.assets"
    write_serialized_file(resources, [(40, 28, aligned_string("bad") + b"\0" * 8)])
    with SerializedFileIndex(resources) as index:
        record = next(iter(index.iter_records()))
        with pytest.raises(UnityMetadataError):
            parse_texture2d(index, record)


def test_traversal_stream_path_rejected(tmp_path: Path) -> None:
    data_root = tmp_path / "REPO_Data"
    data_root.mkdir()
    (tmp_path / "outside.resS").write_bytes(b"\0" * 8)

    with pytest.raises(UpgradeTextureError, match="unsafe"):
        _resolve_stream(data_root, _metadata(stream_path="../outside.resS"))


def test_absolute_stream_path_outside_repo_data_rejected(tmp_path: Path) -> None:
    data_root = tmp_path / "REPO_Data"
    data_root.mkdir()
    outside = tmp_path / "outside.resS"
    outside.write_bytes(b"\0" * 8)

    with pytest.raises(UpgradeTextureError, match="unsafe"):
        _resolve_stream(data_root, _metadata(stream_path=str(outside)))


def test_stream_offset_outside_file_rejected(tmp_path: Path) -> None:
    data_root = tmp_path / "REPO_Data"
    data_root.mkdir()
    (data_root / "resources.assets.resS").write_bytes(b"\0" * 8)

    with pytest.raises(UpgradeTextureError, match="outside"):
        _resolve_stream(data_root, _metadata(stream_offset=9))


def test_stream_size_outside_file_rejected(tmp_path: Path) -> None:
    data_root = tmp_path / "REPO_Data"
    data_root.mkdir()
    (data_root / "resources.assets.resS").write_bytes(b"\0" * 8)

    with pytest.raises(UpgradeTextureError, match="outside"):
        _resolve_stream(data_root, _metadata(stream_size=9))


def test_decode_installed_upgrade_texture_uses_synthetic_installed_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steamapps = tmp_path / "steamapps"
    game_root = steamapps / "common" / "REPO"
    data_root = game_root / "REPO_Data"
    (data_root / "StreamingAssets" / "aa").mkdir(parents=True)
    (data_root / "StreamingAssets" / "aa" / "catalog.json").write_text("{}", encoding="utf-8")
    steamapps.mkdir(exist_ok=True)
    (steamapps / "appmanifest_3241660.acf").write_text(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "23363152" }',
        encoding="utf-8",
    )
    resources = data_root / "resources.assets"
    _write_upgrade_assets(resources)
    # Installed item enrichment owns globalgamemanagers.assets; this decode test
    # deliberately lets that optional enrichment fail and resolves the prefab through
    # the authoritative ResourceManager in globalgamemanagers instead.
    (data_root / "globalgamemanagers.assets").write_bytes(b"synthetic")
    _write_resource_manager(
        data_root / "globalgamemanagers",
        ("items/item upgrade player health", 1, 1),
    )
    managed = data_root / "Managed"
    managed.mkdir()
    assembly = managed / "Assembly-CSharp.dll"
    assembly.write_bytes(b"synthetic assembly")
    monkeypatch.setattr(
        upgrade_textures,
        "VALIDATED_ASSEMBLY_SHA256",
        hashlib.sha256(assembly.read_bytes()).hexdigest(),
    )
    # One opaque-red DXT1 block; only the top mip is read even if stream metadata grows later.
    (data_root / "resources.assets.resS").write_bytes(struct.pack("<HHI", 0xF800, 0, 0))

    monkeypatch.setattr(
        upgrade_textures,
        "discover_game_installation",
        lambda _game_dir: discover_game_installation(steam_roots=(tmp_path,), environment={}),
    )
    decoded = decode_installed_upgrade_texture("playerUpgradeHealth")

    assert decoded is not None
    assert decoded.texture.name == "Upgrade_Health_Albedo"
    assert decoded.texture.texture_format == "DXT1"
    assert decoded.png.startswith(b"\x89PNG\r\n\x1a\n")
    assert (decoded.png_width, decoded.png_height) == (2, 2)
    assert struct.unpack_from(">II", decoded.png, 16) == (2, 2)
    assert len(decoded.watches) == 5
    assert len(decoded.source_identity) == 64
