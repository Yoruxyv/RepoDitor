"""One opt-in RGBA experiment for Health Pack Small; never a thumbnail provider.

The Standard/GGX equations are checked against Unity's version-matched built-in
shader sources. Unimplemented engine terms keep the fidelity gate closed. Only
explicitly requested, ignored local comparison files contain game-derived pixels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
import time
from importlib import import_module
from pathlib import Path
from typing import Any

from repo_save_editor.services.baked_artwork import _installation, _item_keys
from repo_save_editor.services.cosmetics.installed_reader import CosmeticCatalogResolver
from repo_save_editor.services.game.installed_build import (
    SUNSTONE_ARTWORK_ASSEMBLY_SHA256,
    SUNSTONE_ARTWORK_BUILD_ID,
    validated_installed_artwork_build,
)
from repo_save_editor.services.texture_codec import decode_texture_rgba, top_mip_size
from repo_save_editor.services.unity_hash import unity_hash128
from repo_save_editor.services.unity_serialized import parse_mono_behaviour_prefix, read_pptr
from repo_save_editor.services.unity_textures import (
    parse_game_object,
    parse_texture2d,
    parse_transform,
)
from tools.artwork_probe import (
    MAX_OUTPUT_BYTES,
    SIDE,
    Probe,
    multiply,
    source_stamp,
    transform_matrix,
    triangles,
    validate_mesh_budget,
)

CONTROL = "Item Health Pack Small"
MAX_BUFFER_BYTES = 64 * 1024 * 1024
UNSUPPORTED = (
    "Unity deferred G-buffer/light-buffer precision and engine-selected shader variant",
    "PropLight runtime state and generated point-light attenuation lookup",
    "Runtime ambient-probe refresh and environment reflection state",
    "Original baked-image capture provenance and effective MSAA/resolve behavior",
)


def reviewed_settings(probe: Probe, index: Any) -> dict[str, Any]:
    records = list(index.iter_records(frozenset({30, 129})))
    graphics = next(r for r in records if r.class_id == 30)
    settings = probe.native(index, graphics.path_id).read_typetree()
    # The whole PlayerSettings native schema has a four-byte tail discrepancy.
    # This exact source binding authorizes only its independently checked prefix.
    if (
        probe.hashes[index.path.relative_to(probe.root).as_posix()]
        != "0b0c9ac3ceb81a6bc9254b51a5e93647926a59f51cc16e60e4c875d69a4035a9"
    ):
        raise ValueError("Unreviewed PlayerSettings prefix source.")
    player = next(r for r in records if r.class_id == 129)
    reader = index.object_reader(player)
    reader.skip(244)
    if reader.i32() != 0 or player.byte_size != 948:
        raise ValueError("The experiment requires the reviewed gamma settings.")
    paths = [settings[f"m_TierSettings_Tier{i}"]["renderingPath"] for i in (1, 2, 3)]
    if (
        paths != [3, 3, 3]
        or settings["m_CustomRenderPipeline"]["m_PathID"]
        or settings["m_LightsUseLinearIntensity"]
    ):
        raise ValueError("Unreviewed rendering path or light-intensity convention.")
    return {
        "activeColorSpace": "Gamma",
        "tierRenderingPaths": paths,
        "linearLightIntensity": False,
        "playerSettingsFullRead": "unsupported four-byte tail",
    }


def validate_material(material: dict[str, Any]) -> None:
    floats = dict(material["m_SavedProperties"]["m_Floats"])
    if set(material["m_ValidKeywords"]) != {"_NORMALMAP", "_EMISSION"} or any(
        floats[k] != expected
        for k, expected in {"_Mode": 0, "_SrcBlend": 1, "_DstBlend": 0, "_BumpScale": 1}.items()
    ):
        raise ValueError("Material requires unsupported shader behavior.")
    main = dict(material["m_SavedProperties"]["m_TexEnvs"])["_MainTex"]
    if main["m_Scale"] != {"x": 1.0, "y": 1.0} or main["m_Offset"] != {"x": 0.0, "y": 0.0}:
        raise ValueError("Unexpected control UV transform.")


def rgba_metrics(candidate: bytes, reference: bytes) -> dict[str, Any]:
    """Byte-domain and composited errors; foreground metrics cannot hide in clear RGB."""
    if not candidate or len(candidate) != len(reference) or len(candidate) % 4:
        raise ValueError("RGBA buffers must have the same nonzero pixel count.")
    squares = alpha_abs = alpha_sq = alpha_equal = exact = union = intersection = 0
    foreground_abs = foreground_sq = foreground_channels = 0
    black_sq = white_sq = 0.0
    for offset in range(0, len(candidate), 4):
        a, b = candidate[offset : offset + 4], reference[offset : offset + 4]
        squares += sum((x - y) ** 2 for x, y in zip(a, b, strict=True))
        alpha_abs += abs(a[3] - b[3])
        alpha_sq += (a[3] - b[3]) ** 2
        alpha_equal += a[3] == b[3]
        exact += a == b
        union += a[3] >= 128 or b[3] >= 128
        intersection += a[3] >= 128 and b[3] >= 128
        for channel in range(3):
            if b[3] > 0:
                foreground_abs += abs(a[channel] - b[channel])
                foreground_sq += (a[channel] - b[channel]) ** 2
                foreground_channels += 1
            ac, bc = a[channel] * a[3] / 255, b[channel] * b[3] / 255
            black_sq += (ac - bc) ** 2
            white_sq += (ac + 255 - a[3] - bc - 255 + b[3]) ** 2
    pixels = len(candidate) // 4
    mse = foreground_sq / foreground_channels if foreground_channels else 0
    return {
        "rgbaRmse255": math.sqrt(squares / len(candidate)),
        "referenceForegroundRgbMae255": foreground_abs / foreground_channels
        if foreground_channels
        else None,
        "referenceForegroundRgbRmse255": math.sqrt(mse) if foreground_channels else None,
        "referenceForegroundRgbPsnrDb": 20 * math.log10(255 / math.sqrt(mse)) if mse else None,
        "alphaMae255": alpha_abs / pixels,
        "alphaRmse255": math.sqrt(alpha_sq / pixels),
        "alphaExactFraction": alpha_equal / pixels,
        "alphaIoU128": intersection / union if union else 1,
        "rgbaExactPixelFraction": exact / pixels,
        "blackCompositeRgbRmse255": math.sqrt(black_sq / (pixels * 3)),
        "whiteCompositeRgbRmse255": math.sqrt(white_sq / (pixels * 3)),
    }


def normalize(np: Any, vectors: Any) -> Any:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-10)


def standard_direct_gamma(
    np: Any,
    albedo: Any,
    normal: Any,
    view: Any,
    direction: Any,
    intensity: float,
    metallic: float,
    smoothness: float,
) -> Any:
    """Desktop Standard BRDF1's direct term in gamma space; no invented exposure."""
    diffuse = albedo * ((1 - 0.220916301) * (1 - metallic))
    specular = 0.220916301 * (1 - metallic) + albedo * metallic
    half_vector = normalize(np, view + direction)
    nv = np.abs(np.sum(normal * view, axis=-1))
    nl = np.clip(np.sum(normal * direction, axis=-1), 0, 1)
    nh = np.clip(np.sum(normal * half_vector, axis=-1), 0, 1)
    lh = np.clip(np.sum(direction * half_vector, axis=-1), 0, 1)
    perceptual = 1 - smoothness
    roughness = max(perceptual**2, 0.002)
    fd90 = 0.5 + 2 * lh**2 * perceptual
    disney = (1 + (fd90 - 1) * (1 - nl) ** 5) * (1 + (fd90 - 1) * (1 - nv) ** 5) * nl
    visibility = 0.5 / (
        nl * (nv * (1 - roughness) + roughness) + nv * (nl * (1 - roughness) + roughness) + 1e-5
    )
    distribution = roughness**2 / (math.pi * ((nh**2 * (roughness**2 - 1) + 1) ** 2 + 1e-7))
    spec_term = np.sqrt(np.maximum(1e-4, visibility * distribution * math.pi)) * nl
    fresnel = specular + (1 - specular) * (1 - lh[..., None]) ** 5
    return intensity * (diffuse * disney[..., None] + fresnel * spec_term[..., None])


def sample_point(np: Any, levels: list[Any], uv: Any, lod: Any) -> Any:
    if not levels or not np.all(np.isfinite(uv)) or not np.all(np.isfinite(lod)):
        raise ValueError("Invalid texture sample inputs.")
    selected = np.clip(np.floor(lod + 0.5), 0, len(levels) - 1).astype(int)
    result = np.empty((*uv.shape[:-1], 4), dtype=np.float32)
    for level, image in enumerate(levels):
        use = selected == level
        coords = uv[use] % 1.0
        # Raw decoded Unity rows start at v=0; no reference-driven UV flipping.
        xy = np.floor(coords * np.array([image.shape[1], image.shape[0]])).astype(int)
        result[use] = image[xy[:, 1], xy[:, 0]]
    return result


def texture_levels(
    probe: Probe, index: Any, pointer: dict[str, int], np: Any
) -> tuple[list[Any], dict[str, Any]]:
    ti, record = probe.resolve(index, pointer)
    metadata = parse_texture2d(ti, record)
    native = probe.native(ti, record.path_id).read_typetree()
    settings = native["m_TextureSettings"]
    if (metadata.width, metadata.height, metadata.mip_count) != (SIDE, SIDE, 10):
        raise ValueError("Unexpected control texture dimensions or mip count.")
    if settings["m_FilterMode"] != 0 or settings["m_WrapU"] or settings["m_WrapV"]:
        raise ValueError("This control experiment requires authored point/repeat sampling.")
    data = probe.stream(metadata.stream_path, metadata.stream_offset, metadata.stream_size)
    levels, cursor = [], 0
    for mip in range(metadata.mip_count):
        width, height = max(1, metadata.width >> mip), max(1, metadata.height >> mip)
        size = top_mip_size(width, height, metadata.texture_format)
        rgba = decode_texture_rgba(
            data[cursor : cursor + size], width, height, metadata.texture_format
        )
        levels.append(
            np.frombuffer(rgba, dtype=np.uint8).reshape(height, width, 4).astype(np.float32) / 255
        )
        cursor += size
    if cursor != len(data):
        raise ValueError("Unexpected texture mip-chain byte coverage.")
    return levels, {
        "name": metadata.name,
        "format": metadata.texture_format,
        "mips": metadata.mip_count,
        "colorSpace": native["m_ColorSpace"],
        "sampling": settings,
    }


def icon_lights(probe: Probe, level: Any) -> list[dict[str, Any]]:
    """Read only the reviewed ItemManager fields and its finite light subtree."""
    record = level.find_records({2799})[2799]
    prefix = parse_mono_behaviour_prefix(level, record)
    reader = level.object_reader(record)
    reader.skip(prefix.field_offset)
    if record.byte_size != 64 or any(reader.i32() != 0 for _ in range(5)):
        raise ValueError("Unreviewed ItemManager field layout.")
    pointer = read_pptr(reader)
    if pointer.file_id or pointer.path_id != 10 or reader.remaining:
        raise ValueError("Unexpected shared light root.")
    identity = [[float(i == j) for j in range(4)] for i in range(4)]
    pending = [(pointer.path_id, identity, True)]
    lights: list[dict[str, Any]] = []
    visited: set[int] = set()
    while pending:
        gid, parent, active_parent = pending.pop()
        if gid in visited or len(visited) >= 512:
            raise ValueError("Invalid light hierarchy.")
        visited.add(gid)
        go = parse_game_object(level, level.find_records({gid})[gid])
        components = level.find_records({p.path_id for p in go.components})
        transform = next(r for r in components.values() if r.class_id == 4)
        tree = probe.native(level, transform.path_id).read_typetree()
        world = multiply(parent, transform_matrix(tree))
        active = active_parent and probe.native(level, gid).read_typetree()["m_IsActive"]
        for component in components.values():
            if component.class_id == 108:
                light = probe.native(level, component.path_id).read_typetree()
                if not active or not light["m_Enabled"]:
                    continue
                if (
                    light["m_Type"] != 1
                    or light["m_Shadows"]["m_Type"]
                    or light["m_Cookie"]["m_PathID"]
                    or light["m_Color"] != dict.fromkeys("rgba", 1.0)
                ):
                    raise ValueError("Unsupported shared light.")
                lights.append(
                    {
                        "name": go.name,
                        "world": world,
                        "directionToLight": [-world[r][2] for r in range(3)],
                        "color": light["m_Color"],
                        "intensity": light["m_Intensity"],
                    }
                )
        for child in parse_transform(level, transform).children:
            tr = level.find_records({child.path_id})[child.path_id]
            pending.append((parse_transform(level, tr).game_object.path_id, world, active))
    if len(lights) != 4:
        raise ValueError("Unexpected shared directional-light coverage.")
    return lights


def rasterize(
    np: Any, vertices: Any, screen: Any, camera_z: Any, faces: Any
) -> tuple[Any, Any, Any]:
    """Single-sample, clockwise-front, perspective-correct control G-buffer."""
    depth = np.full((SIDE, SIDE), np.inf, dtype=np.float32)
    face_ids = np.full((SIDE, SIDE), -1, dtype=np.int32)
    weights = np.zeros((SIDE, SIDE, 3), dtype=np.float32)
    if len(vertices) != 931 or len(faces) != 657:
        raise ValueError("This experiment only supports the reviewed control mesh.")
    for number, face in enumerate(faces):
        xy, z = screen[face], camera_z[face]
        if np.any(z <= 0.3) or np.any(z >= 1000):
            raise ValueError("Unsupported triangle clipping.")
        a, b, c = xy
        area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if area <= 1e-8:
            continue
        low = np.maximum(np.floor(xy.min(axis=0)).astype(int), 0)
        high = np.minimum(np.ceil(xy.max(axis=0)).astype(int), SIDE)
        xx, yy = np.meshgrid(np.arange(low[0], high[0]) + 0.5, np.arange(low[1], high[1]) + 0.5)
        first = ((b[0] - xx) * (c[1] - yy) - (b[1] - yy) * (c[0] - xx)) / area
        second = ((c[0] - xx) * (a[1] - yy) - (c[1] - yy) * (a[0] - xx)) / area
        bary = np.stack((first, second, 1 - first - second), axis=-1)
        inverse = (bary / z).sum(axis=-1)
        ds = depth[low[1] : high[1], low[0] : high[0]]
        use = np.all(bary >= 0, axis=-1) & (1 / np.maximum(inverse, 1e-10) < ds)
        ds[use] = 1 / inverse[use]
        face_ids[low[1] : high[1], low[0] : high[0]][use] = number
        weights[low[1] : high[1], low[0] : high[0]][use] = (bary / z / inverse[..., None])[use]
    return depth, face_ids, weights


def render_control(
    np: Any,
    mesh: Any,
    handler: Any,
    row: dict[str, Any],
    camera: Any,
    textures: dict[str, Any],
    material: Any,
    lights: Any,
    clear: Any,
) -> tuple[bytes, int]:
    vertices = np.asarray(handler.m_Vertices, dtype=np.float32)
    world_matrix = np.asarray(row["worldMatrix"], dtype=np.float32)
    camera_matrix = np.asarray(camera["worldMatrix"], dtype=np.float32)
    if not np.allclose(camera_matrix[:3, :3].T @ camera_matrix[:3, :3], np.eye(3), atol=0.001):
        raise ValueError("Scaled camera is outside this control experiment.")
    world = vertices @ world_matrix[:3, :3].T + world_matrix[:3, 3]
    view_positions = (world - camera_matrix[:3, 3]) @ camera_matrix[:3, :3]
    extent = view_positions[:, 2] * math.tan(
        math.radians(camera["components"]["Camera"]["field of view"]) / 2
    )
    screen = np.stack(
        (
            (view_positions[:, 0] / extent + 1) * SIDE / 2,
            (1 - view_positions[:, 1] / extent) * SIDE / 2,
        ),
        axis=-1,
    )
    faces = np.asarray(triangles(mesh, handler)[0], dtype=np.int32)
    depth, ids, weights = rasterize(np, vertices, screen, view_positions[:, 2], faces)
    visible = ids >= 0
    indices, bary = faces[ids[visible]], weights[visible]

    def interpolate(values: Any) -> Any:
        return np.sum(values[indices] * bary[..., None], axis=1)

    positions = interpolate(world)
    uv = interpolate(np.asarray(handler.m_UV0, dtype=np.float32))
    normal_vertices = normalize(
        np, np.asarray(handler.m_Normals)[:, :3] @ np.linalg.inv(world_matrix[:3, :3])
    )
    tangent_data = np.asarray(handler.m_Tangents)
    tangent_vertices = normalize(np, tangent_data[:, :3] @ world_matrix[:3, :3].T)
    bitangent_vertices = (
        np.cross(normal_vertices, tangent_vertices)
        * tangent_data[:, 3, None]
        * np.sign(np.linalg.det(world_matrix[:3, :3]))
    )
    normals, tangents, bitangents = map(
        interpolate, (normal_vertices, tangent_vertices, bitangent_vertices)
    )
    # shortcut: base mip only; require GPU quad derivatives before accepting texture fidelity.
    lod = np.zeros(len(uv), dtype=np.float32)
    albedo = sample_point(np, textures["_MainTex"], uv, lod)[:, :3]
    emission = sample_point(np, textures["_EmissionMap"], uv, lod)[:, :3]
    packed = sample_point(np, textures["_BumpMap"], uv, lod)
    xy = np.stack((packed[:, 0] * packed[:, 3], packed[:, 1]), axis=-1) * 2 - 1
    tangent_normal = np.column_stack((xy, np.sqrt(1 - np.clip((xy * xy).sum(axis=-1), 0, 1))))
    normals = normalize(
        np,
        tangents * tangent_normal[:, 0, None]
        + bitangents * tangent_normal[:, 1, None]
        + normals * tangent_normal[:, 2, None],
    )
    props = material["m_SavedProperties"]
    floats, colors = dict(props["m_Floats"]), dict(props["m_Colors"])
    albedo *= np.array([colors["_Color"][c] for c in "rgb"])
    rgb = albedo * ((1 - 0.220916301) * (1 - floats["_Metallic"]))
    view = normalize(np, camera_matrix[:3, 3] - positions)
    for light in lights:
        rgb += standard_direct_gamma(
            np,
            albedo,
            normals,
            view,
            normalize(np, np.asarray(light["directionToLight"])),
            light["intensity"],
            floats["_Metallic"],
            floats["_Glossiness"],
        )
    rgb += emission * np.array([colors["_EmissionColor"][c] for c in "rgb"])
    output = np.empty((SIDE, SIDE, 4), dtype=np.uint8)
    output[:] = np.rint(np.asarray(clear) * 255).astype(np.uint8)
    output[visible, :3] = np.rint(np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    output[visible, 3] = 255
    buffers = sum(
        a.nbytes
        for a in (vertices, world, depth, ids, weights, normals, tangents, bitangents, output, rgb)
    )
    buffers += sum(level.nbytes for levels in textures.values() for level in levels)
    if buffers > MAX_BUFFER_BYTES:
        raise ValueError("Control render buffer budget exceeded.")
    return output.tobytes(), buffers


def save_local_comparison(image_module: Any, output: bytes, reference: bytes) -> str:
    workspace = Path(__file__).resolve().parents[1]
    directory = workspace / "build/item-thumbnail-proof/rgba-proof"
    if not directory.resolve().is_relative_to(workspace) or directory.is_symlink():
        raise ValueError("Comparison output escapes the research workspace.")
    directory.mkdir(parents=True, exist_ok=True)
    target = Path(tempfile.mkdtemp(prefix="color-", dir=directory))
    candidate = image_module.frombytes("RGBA", (SIDE, SIDE), output)
    ref = image_module.frombytes("RGBA", (SIDE, SIDE), reference)
    comparison = image_module.new("RGB", (SIDE * 3, SIDE), "white")
    comparison.paste(ref, (0, 0), ref)
    comparison.paste(candidate, (SIDE, 0), candidate)
    difference = import_module("PIL.ImageChops").difference(
        ref.convert("RGB"), candidate.convert("RGB")
    )
    comparison.paste(difference, (SIDE * 2, 0))
    for name, image in (
        ("health-pack-small-candidate.png", candidate),
        ("comparison-local-only.png", comparison),
    ):
        # Exclusive creation cannot overwrite an existing file, link, save or asset.
        with (target / name).open("xb") as handle:
            image.save(handle, format="PNG")
    return target.relative_to(workspace).as_posix()


def capture(write_local: bool = False) -> dict[str, Any]:
    installation = _installation(None)
    build = validated_installed_artwork_build(installation) if installation else None
    if installation is None or build is None or build.build_id != SUNSTONE_ARTWORK_BUILD_ID:
        raise ValueError("The reviewed installation is required.")
    np = import_module("numpy")
    started, manifest = time.perf_counter(), source_stamp(build.manifest_path)
    resolver = CosmeticCatalogResolver(installation.root / "REPO_Data")
    with resolver:
        probe = Probe(installation.root, resolver)
        assembly = installation.root / "REPO_Data/Managed/Assembly-CSharp.dll"
        probe.watch(assembly)
        with assembly.open("rb") as handle:
            if (
                hashlib.file_digest(handle, "sha256").hexdigest()
                != SUNSTONE_ARTWORK_ASSEMBLY_SHA256
            ):
                raise ValueError("Unreviewed managed assembly.")
        resources = resolver.open(installation.root / "REPO_Data/resources.assets")
        level = resolver.open(installation.root / "REPO_Data/level0")
        settings = reviewed_settings(
            probe, resolver.open(installation.root / "REPO_Data/globalgamemanagers")
        )
        rows = probe.hierarchy(resources, resources.find_records({459638})[459638])
        if rows[0]["name"] != CONTROL:
            raise ValueError("Control prefab identity changed.")
        camera = next(r for r in rows if "maker" in r)
        row = next(r for r in rows if r["pathId"] == 281926)
        lights = icon_lights(probe, level)
        ri, record = probe.resolve(resources, row["components"]["MeshFilter"]["m_Mesh"])
        mesh = probe.native(ri, record.path_id).parse_as_object()
        validate_mesh_budget(mesh)
        if mesh.m_StreamData and mesh.m_StreamData.path:
            stream = mesh.m_StreamData
            mesh.m_VertexData.m_DataSize = probe.stream(stream.path, stream.offset, stream.size)
            mesh.m_StreamData = None
        handler = import_module("UnityPy.helpers.MeshHelper").MeshHandler(mesh)
        handler.process()
        mi, mr = probe.resolve(resources, row["components"]["MeshRenderer"]["m_Materials"][0])
        material = probe.native(mi, mr.path_id).read_typetree()
        validate_material(material)
        si, sr = probe.resolve(mi, material["m_Shader"])
        shader = probe.native(si, sr.path_id).read_typetree()
        if shader["m_ParsedForm"]["m_Name"] != "Standard" or shader["platforms"] != [4]:
            raise ValueError("Unreviewed control shader/platform.")
        textures, texture_info = {}, {}
        for name, environment in material["m_SavedProperties"]["m_TexEnvs"]:
            if name in ("_MainTex", "_BumpMap", "_EmissionMap"):
                textures[name], texture_info[name] = texture_levels(
                    probe, mi, environment["m_Texture"], np
                )
        key = _item_keys(installation.root)[CONTROL]
        reference_path = (
            installation.root
            / "REPO_Data/StreamingAssets/BakedIcons/Items"
            / (unity_hash128(key) + ".png")
        )
        probe.watch(reference_path)
        image_module = import_module("PIL.Image")
        with image_module.open(reference_path) as image:
            if image.size != (SIDE, SIDE) or reference_path.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("Unexpected reference image.")
            reference = image.convert("RGBA").tobytes()
        camera_data = camera["components"]["Camera"]
        render_started = time.perf_counter()
        output, buffers = render_control(
            np,
            mesh,
            handler,
            row,
            camera,
            textures,
            material,
            lights,
            [camera_data["m_BackGroundColor"][c] for c in "rgba"],
        )
        render_seconds = time.perf_counter() - render_started
        metrics = rgba_metrics(output, reference)
        for path in probe.sources:
            probe.watch(path)
        if source_stamp(build.manifest_path) != manifest:
            raise ValueError("Manifest changed during proof.")
        local_comparison = (
            save_local_comparison(image_module, output, reference) if write_local else None
        )
        return {
            "control": CONTROL,
            "fidelityEstablished": False,
            "unsupported": [*UNSUPPORTED, "GPU derivative/quad mip LOD (base mip diagnostic only)"],
            "metrics": metrics,
            "renderSeconds": render_seconds,
            "totalSeconds": time.perf_counter() - started,
            "primaryBufferBytes": buffers,
            "streamBytes": probe.stream_bytes,
            "sourceHashes": probe.hashes,
            "sourceWatches": {
                path.relative_to(probe.root).as_posix(): list(stamp)
                for path, stamp in probe.sources.items()
            },
            "assemblySha256": SUNSTONE_ARTWORK_ASSEMBLY_SHA256,
            "lights": lights,
            "textures": texture_info,
            "settings": settings,
            "localComparison": local_comparison,
            "camera": {
                "verticalFov": camera_data["field of view"],
                "worldMatrix": camera["worldMatrix"],
                "near": camera_data["near clip plane"],
                "far": camera_data["far clip plane"],
                "cullingMask": camera_data["m_CullingMask"]["m_Bits"],
            },
            "material": {
                "shader": "Standard",
                "keywords": material["m_ValidKeywords"],
                "properties": material["m_SavedProperties"],
            },
            "pointLights": [
                {
                    "worldMatrix": r["worldMatrix"],
                    "light": {
                        k: v
                        for k, v in r["components"]["Light"].items()
                        if k in ("m_Type", "m_Color", "m_Intensity", "m_Range", "m_Enabled")
                    },
                }
                for r in rows
                if "Light" in r["components"]
            ],
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-local-comparison", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        output = json.dumps(capture(args.write_local_comparison), indent=2, allow_nan=False)
    else:
        command = [sys.executable, "-m", "tools.artwork_color_proof", "--worker"]
        if args.write_local_comparison:
            command.append("--write-local-comparison")
        try:
            child = subprocess.run(command, capture_output=True, text=True, timeout=120, check=True)  # noqa: S603 -- fixed module, no shell
        except subprocess.CalledProcessError as error:
            sys.stderr.write(error.stderr or "Color experiment failed.\n")
            raise
        output = child.stdout
    if len(output.encode()) > MAX_OUTPUT_BYTES:
        raise ValueError("Report exceeds the experiment budget.")
    sys.stdout.write(output + "\n")


if __name__ == "__main__":
    main()
