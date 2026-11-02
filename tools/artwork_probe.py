"""Opt-in, read-only item geometry experiment; never a thumbnail provider.

Reuse the installed readers and UnityPy native types. Emit metadata/coverage only,
never game pixels, mesh arrays, shader programs, save data or cache entries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import time
from collections import Counter
from importlib import import_module
from pathlib import Path
from typing import Any

from repo_save_editor.services.baked_artwork import _installation, _item_keys, owned_file
from repo_save_editor.services.cosmetics.installed_reader import CosmeticCatalogResolver
from repo_save_editor.services.game.installed_build import (
    SUNSTONE_ARTWORK_ASSEMBLY_SHA256,
    SUNSTONE_ARTWORK_BUILD_ID,
    validated_installed_artwork_build,
)
from repo_save_editor.services.player.upgrade_textures import _resolve_stream_range
from repo_save_editor.services.texture_codec import decode_texture_rgba
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_hash import unity_hash128
from repo_save_editor.services.unity_serialized import (
    PPtr,
    find_resource_manager_pointer,
    parse_mono_behaviour_prefix,
    parse_mono_script,
    read_pptr,
)
from repo_save_editor.services.unity_textures import (
    MAX_PREFAB_OBJECTS,
    find_prefab_renderers,
    parse_game_object,
    parse_mesh_vertex_data,
    parse_texture2d,
    parse_transform,
)

MISSING = (
    "Item Cart Cannon",
    "Item Cart Laser",
    "Item Cart Medium",
    "Item Leaf Blower",
    "Item Power Crystal",
    "Item Vehicle Semiscooter",
    "Item Vehicle Semiscooter Small",
)
CONTROLS = ("Item Melee Baseball Bat", "Item Cart Small", "Item Health Pack Small")
MAX_INPUT_BYTES = 768 * 1024 * 1024
MAX_STREAM_BYTES = 64 * 1024 * 1024
MAX_VERTICES = 65_536
MAX_TRIANGLES = 100_000
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
SIDE = 512


def source_stamp(path: Path) -> tuple[int, int, int, int]:
    """Reads can change access time; only content/file identity invalidates input."""
    info = path.stat()
    return info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino


def reported_number(value: float) -> float | str:
    """Retain authored nonfinite material sentinels without emitting invalid JSON."""
    return value if math.isfinite(value) else str(value)


def multiply(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    """Compose affine transforms without losing nonuniform parent scale."""
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def transform_matrix(tree: dict[str, Any]) -> list[list[float]]:
    """Unity local TRS; validate before projection, including quaternion length."""
    q, p, s = (tree[k] for k in ("m_LocalRotation", "m_LocalPosition", "m_LocalScale"))
    x, y, z, w = (q[k] for k in "xyzw")
    values = [*q.values(), *p.values(), *s.values()]
    if not all(math.isfinite(v) for v in values) or abs(x * x + y * y + z * z + w * w - 1) > 0.001:
        raise ValueError("Nonfinite transform or nonunit quaternion.")
    rot = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [[rot[r][c] * s[k] for c, k in enumerate("xyz")] + [p["xyz"[r]]] for r in range(3)] + [
        [0.0, 0.0, 0.0, 1.0]
    ]


def point(matrix: list[list[float]], vertex: tuple[float, ...]) -> tuple[float, ...]:
    return tuple(sum(matrix[r][c] * vertex[c] for c in range(3)) + matrix[r][3] for r in range(3))


def camera_point(matrix: list[list[float]], vertex: tuple[float, ...]) -> tuple[float, ...]:
    """Invert a rigid authored camera pose; reject scaled cameras rather than guess."""
    axes = [tuple(matrix[r][c] for r in range(3)) for c in range(3)]
    if any(
        abs(sum(a * b for a, b in zip(u, v, strict=True)) - (i == j)) > 0.001
        for i, u in enumerate(axes)
        for j, v in enumerate(axes)
    ):
        raise ValueError("Scaled/sheared camera is unsupported.")
    delta = tuple(vertex[r] - matrix[r][3] for r in range(3))
    return tuple(sum(a * b for a, b in zip(axis, delta, strict=True)) for axis in axes)


def project(vertex: tuple[float, ...], camera: dict[str, Any]) -> tuple[float, float]:
    x, y, z = vertex
    if not all(math.isfinite(c) for c in vertex):
        raise ValueError("Nonfinite camera-space vertex.")
    if not camera["near clip plane"] <= z <= camera["far clip plane"]:
        raise ValueError("Geometry crosses a clip plane; clipping is unimplemented.")
    if camera["orthographic"]:
        extent = camera["orthographic size"]
    else:
        extent = z * math.tan(math.radians(camera["field of view"]) / 2)
    if extent <= 0 or not math.isfinite(extent):
        raise ValueError("Invalid camera projection.")
    return ((x / extent + 1) * SIDE / 2, (1 - y / extent) * SIDE / 2)


def triangles(mesh: Any, handler: Any) -> list[list[tuple[int, ...]]]:
    """Validate native index ranges and base vertices before using MeshHandler."""
    index_size = 2 if handler.m_Use16BitIndices else 4
    count = len(handler.m_Vertices or [])
    if not 0 < count <= MAX_VERTICES or not mesh.m_SubMeshes or len(mesh.m_SubMeshes) > 64:
        raise ValueError("Unsupported vertex/submesh count.")
    total = 0
    for sub in mesh.m_SubMeshes:
        if (
            int(sub.topology) != 0
            or sub.indexCount < 0
            or sub.indexCount % 3
            or sub.firstByte < 0
            or sub.firstByte % index_size
            or sub.firstByte // index_size + sub.indexCount > len(handler.m_IndexBuffer or [])
        ):
            raise ValueError("Unsupported topology or invalid index range.")
        total += sub.indexCount // 3
    if total > MAX_TRIANGLES:
        raise ValueError("Triangle budget exceeded.")
    result: list[list[tuple[int, ...]]] = handler.get_triangles()
    for sub, faces in zip(mesh.m_SubMeshes, result, strict=True):
        base = sub.baseVertex or 0
        for i, face in enumerate(faces):
            resolved = tuple(v + base for v in face)
            if len(resolved) != 3 or any(v < 0 or v >= count for v in resolved):
                raise ValueError("Mesh index is outside the vertex array.")
            faces[i] = resolved
    return result


def validate_mesh_budget(mesh: Any) -> None:
    """Bound native decompression before MeshHandler allocates channel arrays."""
    if not 0 < mesh.m_VertexData.m_VertexCount <= MAX_VERTICES:
        raise ValueError("Vertex budget exceeded.")
    if (
        len(mesh.m_SubMeshes) > 64
        or sum(s.indexCount for s in mesh.m_SubMeshes) > MAX_TRIANGLES * 3
    ):
        raise ValueError("Index budget exceeded.")
    compressed = mesh.m_CompressedMesh
    for name in (
        "m_Vertices",
        "m_UV",
        "m_Normals",
        "m_Tangents",
        "m_FloatColors",
        "m_BoneIndices",
        "m_Triangles",
    ):
        packed = getattr(compressed, name, None)
        if packed is not None and not 0 <= packed.m_NumItems <= MAX_VERTICES * 8:
            raise ValueError("Compressed mesh budget exceeded.")


class Probe:
    """One finite experiment owning its read-only indexes and native-object cache."""

    def __init__(self, root: Path, resolver: CosmeticCatalogResolver) -> None:
        self.root, self.resolver = root, resolver
        self.environments: dict[Path, Any] = {}
        self.sources: dict[Path, tuple[int, int, int, int]] = {}
        self.hashes: dict[str, str] = {}
        self.stream_bytes = 0
        self.meshes: dict[tuple[Path, int], Any] = {}
        self.materials: dict[tuple[Path, int], dict[str, Any]] = {}

    def watch(self, path: Path) -> None:
        owned_file(self.root, path)
        stamp = source_stamp(path)
        if path in self.sources:
            if self.sources[path] != stamp:
                raise ValueError("Installed input changed during the experiment.")
            return
        self.sources[path] = stamp

    def native(self, index: Any, path_id: int) -> Any:
        self.watch(index.path)
        if index.path not in self.environments:
            total = sum(p.stat().st_size for p in self.environments) + index.path.stat().st_size
            if len(self.environments) >= 8 or total > MAX_INPUT_BYTES:
                raise ValueError("Native serialized-file budget exceeded.")
            self.environments[index.path] = import_module("UnityPy").load(str(index.path))
            with index.path.open("rb") as handle:
                self.hashes[index.path.relative_to(self.root).as_posix()] = hashlib.file_digest(
                    handle, "sha256"
                ).hexdigest()
        env = self.environments[index.path]
        assets = next(f for f in env.files.values() if hasattr(f, "objects"))
        record = index.find_records({path_id})[path_id]
        if record.byte_size > 16 * 1024 * 1024:
            raise ValueError("Native object exceeds the experiment budget.")
        return assets.objects[path_id]

    def resolve(self, source: Any, raw: dict[str, int]) -> tuple[Any, Any]:
        pointer = PPtr(raw["m_FileID"], raw["m_PathID"])
        if pointer.file_id:
            names = source.external_names(pointer.file_id)
            if len(names) == 1 and names[0] in ("unity default resources", "unity_builtin_extra"):
                path = self.root / "REPO_Data/Resources" / names[0]
                self.watch(path)
                index = self.resolver.open(path)
                record = index.find_records({pointer.path_id})[pointer.path_id]
                return index, record
            # Check authored paths before the existing resolver canonicalizes them.
            for name in names:
                candidate = self.root / "REPO_Data" / name
                if candidate.is_file():
                    self.watch(candidate)
        index, record = self.resolver.resolve(source, pointer)
        self.watch(index.path)
        return index, record

    def stream(self, path: str, offset: int, size: int) -> bytes:
        resolved, _ = _resolve_stream_range(self.root / "REPO_Data", path, offset, size)
        self.watch(resolved)
        self.stream_bytes += size
        if self.stream_bytes > MAX_STREAM_BYTES:
            raise ValueError("Stream read budget exceeded.")
        with resolved.open("rb") as handle:
            handle.seek(offset)
            data = handle.read(size)
        if len(data) != size:
            raise ValueError("Stream was truncated during read.")
        return data

    def mesh(self, index: Any, record: Any) -> Any:
        key = (index.path, record.path_id)
        if key not in self.meshes:
            mesh = self.native(index, record.path_id).parse_as_object()
            validate_mesh_budget(mesh)
            narrow = True
            stream = mesh.m_StreamData
            data = (
                self.stream(stream.path, stream.offset, stream.size)
                if stream and stream.path
                else None
            )
            try:
                parse_mesh_vertex_data(index, record, stream_data=data)
            except ValueError:
                narrow = False
            if data is not None:
                mesh.m_VertexData.m_DataSize = data
                mesh.m_StreamData = None  # The validated reader owns all external reads.
            handler = import_module("UnityPy.helpers.MeshHelper").MeshHandler(mesh)
            handler.process()
            faces = triangles(mesh, handler)
            vertices = tuple(tuple(v) for v in handler.m_Vertices)
            if not all(math.isfinite(c) for v in vertices for c in v):
                raise ValueError("Nonfinite mesh vertices.")
            self.meshes[key] = (
                vertices,
                faces,
                {
                    "name": mesh.m_Name,
                    "file": index.path.name,
                    "pathId": record.path_id,
                    "vertices": len(vertices),
                    "triangles": sum(map(len, faces)),
                    "submeshes": len(faces),
                    "normals": len(handler.m_Normals or []),
                    "uv0": len(handler.m_UV0 or []),
                    "narrowReader": narrow,
                    "baseVertices": [s.baseVertex or 0 for s in mesh.m_SubMeshes],
                },
            )
        return self.meshes[key]

    def texture(self, index: Any, record: Any) -> dict[str, Any]:
        metadata = parse_texture2d(index, record)
        if metadata.stream_path:
            data = self.stream(metadata.stream_path, metadata.stream_offset, metadata.top_mip_size)
        else:
            raise ValueError("Inline texture diagnostic is unimplemented.")
        rgba = decode_texture_rgba(data, metadata.width, metadata.height, metadata.texture_format)
        alpha = rgba[3::4]
        return {
            "name": metadata.name,
            "format": metadata.texture_format,
            "dimensions": [metadata.width, metadata.height],
            "alphaRange": [min(alpha), max(alpha)],
        }

    def material(self, index: Any, record: Any) -> dict[str, Any]:
        key = (index.path, record.path_id)
        if key not in self.materials:
            tree = self.native(index, record.path_id).read_typetree()
            si, sr = self.resolve(index, tree["m_Shader"])
            shader = self.native(si, sr.path_id).read_typetree()["m_ParsedForm"]
            props = tree["m_SavedProperties"]
            textures = {}
            for name, env in props["m_TexEnvs"]:
                if env["m_Texture"]["m_PathID"]:
                    try:
                        ti, tr = self.resolve(index, env["m_Texture"])
                        textures[name] = self.texture(ti, tr)
                    except ValueError as error:
                        textures[name] = {"unsupported": str(error)}
            self.materials[key] = {
                "name": tree["m_Name"],
                "shader": shader["m_Name"],
                "queue": tree["m_CustomRenderQueue"],
                "textures": textures,
                "floats": {name: reported_number(value) for name, value in props["m_Floats"]},
                "colors": {
                    name: {channel: reported_number(value) for channel, value in color.items()}
                    for name, color in props["m_Colors"]
                },
                "passes": [
                    p["m_State"]["m_Name"] for s in shader["m_SubShaders"] for p in s["m_Passes"]
                ],
                "shaderImplemented": False,
            }
        return self.materials[key]

    def hierarchy(self, index: Any, root: Any) -> list[dict[str, Any]]:
        # The production walker is authoritative for renderer membership. The
        # experiment additionally reads native visibility, TRS and camera fields.
        expected = {r.path_id for r, _ in find_prefab_renderers(index, root)}
        identity = [[float(r == c) for c in range(4)] for r in range(4)]
        pending = [(root, identity, True, True)]
        rows: list[dict[str, Any]] = []
        seen: set[int] = set()
        found: set[int] = set()
        while pending:
            record, parent, parent_active, parent_capture = pending.pop()
            if record.path_id in seen or len(seen) >= MAX_PREFAB_OBJECTS:
                raise ValueError("Cyclic or oversized prefab.")
            seen.add(record.path_id)
            go = parse_game_object(index, record)
            native = self.native(index, record.path_id).read_typetree()
            components = index.find_records({p.path_id for p in go.components})
            transform = next(r for r in components.values() if r.class_id in (4, 224))
            tree = self.native(index, transform.path_id).read_typetree()
            world = multiply(parent, transform_matrix(tree))
            active = parent_active and native["m_IsActive"]
            capture_active = parent_capture and native["m_IsActive"]
            row = {
                "pathId": record.path_id,
                "name": go.name,
                "layer": native["m_Layer"],
                "activeSelf": native["m_IsActive"],
                "activeHierarchy": active,
                "localMatrix": transform_matrix(tree),
                "worldMatrix": world,
                "transformPathId": transform.path_id,
                "parentTransformPathId": tree["m_Father"]["m_PathID"],
                "components": {},
            }
            for comp in components.values():
                if comp.class_id in (20, 23, 33, 96, 108, 120, 137, 199, 212, 222):
                    obj = self.native(index, comp.path_id)
                    row["components"][obj.type.name] = obj.read_typetree()
                if comp.class_id == 23:
                    found.add(comp.path_id)
                if comp.class_id == 114:
                    prefix = parse_mono_behaviour_prefix(index, comp)
                    si, sr = self.resolve(
                        index,
                        {"m_FileID": prefix.script.file_id, "m_PathID": prefix.script.path_id},
                    )
                    self.watch(si.path)
                    script = parse_mono_script(si, sr).class_name
                    if script == "BatteryVisualLogic":
                        # ItemAttributes.IconCapture disables this subtree temporarily.
                        capture_active = False
                    if script == "SemiIconMaker":
                        reader = index.object_reader(comp)
                        reader.skip(prefix.field_offset)
                        cam, rt = read_pptr(reader), read_pptr(reader)
                        if cam.file_id or rt.file_id or not cam.path_id or not rt.path_id:
                            raise ValueError("Unsupported icon camera/render-target pointer.")
                        if cam.path_id not in components or components[cam.path_id].class_id != 20:
                            raise ValueError("Icon maker does not reference its authored camera.")
                        placed = reader.u8()
                        reader.align4()
                        row["maker"] = {
                            "camera": cam.path_id,
                            "renderTexture": rt.path_id,
                            "placed": placed,
                            "ambient": list(reader.unpack("4f")),
                        }
            row["captureActive"] = capture_active
            rows.append(row)
            for child in parse_transform(index, transform).children:
                child_transform = index.find_records({child.path_id})[child.path_id]
                child_go = parse_transform(index, child_transform).game_object.path_id
                pending.append(
                    (index.find_records({child_go})[child_go], world, active, capture_active)
                )
        if found != expected:
            raise ValueError("Native hierarchy disagrees with the production walker.")
        return rows

    def item(self, index: Any, root: Any, name: str, key: str) -> dict[str, Any]:
        rows = self.hierarchy(index, root)
        cameras = [r for r in rows if "maker" in r]
        camera_row = cameras[0] if len(cameras) == 1 else None
        camera = camera_row["components"].get("Camera") if camera_row else None
        render_texture = None
        if camera_row:
            render_texture = self.native(
                index, camera_row["maker"]["renderTexture"]
            ).read_typetree()
            if (render_texture["m_Width"], render_texture["m_Height"]) != (SIDE, SIDE):
                raise ValueError("The diagnostic requires the authored square 512px render target.")
        image = import_module("PIL.Image").new("1", (SIDE, SIDE))
        draw = import_module("PIL.ImageDraw").Draw(image)
        result: dict[str, Any] = {
            "name": name,
            "root": root.path_id,
            "objects": len(rows),
            "hierarchy": [
                {
                    k: r[k]
                    for k in (
                        "pathId",
                        "name",
                        "transformPathId",
                        "parentTransformPathId",
                        "localMatrix",
                        "worldMatrix",
                        "activeSelf",
                        "activeHierarchy",
                        "captureActive",
                    )
                }
                for r in rows
            ],
            "renderers": [],
            "camera": camera,
            "cameraWorld": camera_row["worldMatrix"] if camera_row else None,
            "maker": camera_row.get("maker") if camera_row else None,
            "renderTexture": {
                k: v
                for k, v in (render_texture or {}).items()
                if k
                in (
                    "m_Width",
                    "m_Height",
                    "m_ColorFormat",
                    "m_AntiAliasing",
                    "m_DepthStencilFormat",
                    "m_SRGB",
                )
            },
            "otherRenderers": dict(
                Counter(
                    k
                    for r in rows
                    for k in r["components"]
                    if k.endswith("Renderer") and k != "MeshRenderer"
                )
            ),
            "authenticThumbnail": False,
            "geometryProjectionOnly": True,
        }
        for row in rows:
            mr = row["components"].get("MeshRenderer")
            if mr is None:
                continue
            visible = row["captureActive"] and mr["m_Enabled"]
            admitted = visible and (
                camera is None or bool(camera["m_CullingMask"]["m_Bits"] & (1 << row["layer"]))
            )
            entry = {
                k: row[k]
                for k in (
                    "pathId",
                    "name",
                    "layer",
                    "activeSelf",
                    "activeHierarchy",
                    "captureActive",
                    "localMatrix",
                    "worldMatrix",
                )
            }
            entry.update(enabled=mr["m_Enabled"], admitted=admitted)
            result["renderers"].append(entry)
            if not admitted:
                continue
            entry["materials"] = []
            for pointer in mr["m_Materials"]:
                try:
                    entry["materials"].append(self.material(*self.resolve(index, pointer)))
                except ValueError as error:
                    entry.setdefault("unsupportedMaterials", []).append(str(error))
            try:
                if "MeshFilter" not in row["components"]:
                    raise ValueError("Procedural renderer has no authored MeshFilter.")
                if not row["components"]["MeshFilter"]["m_Mesh"]["m_PathID"]:
                    entry["emptyMesh"] = True
                    continue
                mi, mesh_record = self.resolve(index, row["components"]["MeshFilter"]["m_Mesh"])
                vertices, faces, entry["mesh"] = self.mesh(mi, mesh_record)
                if camera and camera_row:
                    projected = [
                        project(
                            camera_point(camera_row["worldMatrix"], point(row["worldMatrix"], v)),
                            camera,
                        )
                        for v in vertices
                    ]
                    for sub in faces:
                        for face in sub:
                            draw.polygon([projected[v] for v in face], fill=1)
            except (ValueError, KeyError) as error:
                entry["unsupported"] = str(error)
        result["projectedBounds"] = image.getbbox() if camera else None
        result["projectedPixels"] = SIDE * SIDE - image.histogram()[0] if camera else None
        result.update(self.comparison(image, key, camera is not None))
        return result

    def comparison(self, image: Any, key: str, has_camera: bool) -> dict[str, Any]:
        baked = (
            self.root / "REPO_Data/StreamingAssets/BakedIcons/Items" / (unity_hash128(key) + ".png")
        )
        result: dict[str, Any] = {"bakedPresent": baked.is_file()}
        if baked.is_file() and has_camera:
            self.watch(baked)
            if baked.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("Oversized comparison PNG.")
            with import_module("PIL.Image").open(baked) as reference:
                if reference.size != (SIDE, SIDE):
                    raise ValueError("Unexpected comparison dimensions.")
                alpha = (
                    reference.convert("RGBA")
                    .getchannel("A")
                    .point(lambda a: 255 if a >= 128 else 0)
                    .convert("1")
                )
            a, b = image.convert("L").tobytes(), alpha.convert("L").tobytes()
            union = sum(bool(x or y) for x, y in zip(a, b, strict=True))
            result["alphaIoU"] = (
                sum(bool(x and y) for x, y in zip(a, b, strict=True)) / union if union else 0
            )
            result["bakedBounds"] = alpha.getbbox()
        return result


def capture(game_dir: Path | None) -> dict[str, Any]:
    """Fail closed on an unreviewed installation; run only in a disposable worker."""
    installation = _installation(game_dir)
    if installation is None:
        raise ValueError("A reviewed installed artwork build is required.")
    build = validated_installed_artwork_build(installation)
    if build is None or build.build_id != SUNSTONE_ARTWORK_BUILD_ID:
        raise ValueError("A reviewed installed artwork build is required.")
    manifest_before = source_stamp(build.manifest_path)
    root = installation.root.resolve(strict=True)
    started = time.perf_counter()
    resolver = CosmeticCatalogResolver(root / "REPO_Data")
    with resolver:
        probe = Probe(root, resolver)
        for relative in (
            "REPO_Data/resources.assets",
            "REPO_Data/globalgamemanagers.assets",
            "REPO_Data/Managed/Assembly-CSharp.dll",
        ):
            probe.watch(root / relative)
        assembly = root / "REPO_Data/Managed/Assembly-CSharp.dll"
        with assembly.open("rb") as handle:
            assembly_hash = hashlib.file_digest(handle, "sha256").hexdigest()
        if assembly_hash != SUNSTONE_ARTWORK_ASSEMBLY_SHA256:
            raise ValueError("The installed managed assembly is not reviewed.")
        probe.hashes[assembly.relative_to(root).as_posix()] = assembly_hash
        keys = _item_keys(root)
        resources = resolver.open(root / "REPO_Data/resources.assets")
        manager = resolver.open(root / "REPO_Data/globalgamemanagers")
        probe.watch(manager.path)
        if (
            not isinstance(resources, ArtworkFileIndex)
            or resources.unity_version != SUNSTONE_UNITY_VERSION
        ):
            raise ValueError("This probe only reviews Sunstone artwork.")
        items = []
        for name in (*MISSING, *CONTROLS):
            key = keys[name]
            _, pointer = find_resource_manager_pointer(
                manager, ("items/" + key.split("|")[1].lower(),)
            )
            ri, record = probe.resolve(
                manager, {"m_FileID": pointer.file_id, "m_PathID": pointer.path_id}
            )
            items.append(probe.item(ri, record, name, key))
        for path in probe.sources:
            probe.watch(path)
        if (
            manifest_before != source_stamp(build.manifest_path)
            or validated_installed_artwork_build(installation) != build
        ):
            raise ValueError("Steam provenance changed during the experiment.")
        return {
            "schema": "item-artwork-feasibility-v1",
            "build": installation.steam_build_id,
            "unity": resources.unity_version,
            "seconds": time.perf_counter() - started,
            "streamBytes": probe.stream_bytes,
            "sources": probe.hashes,
            "sourceWatches": {
                path.relative_to(root).as_posix(): list(stamp)
                for path, stamp in probe.sources.items()
            },
            "manifestIdentity": list(manifest_before),
            "items": items,
            "fidelityEstablished": False,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-dir", type=Path)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        output = json.dumps(capture(args.game_dir), indent=2, allow_nan=False)
    else:
        command = [sys.executable, "-m", "tools.artwork_probe", "--worker"]
        if args.game_dir:
            command.extend(("--game-dir", str(args.game_dir)))
        # Fixed module/arguments, no shell; timeout also cleans up native-library state.
        try:
            child = subprocess.run(command, capture_output=True, text=True, timeout=120, check=True)  # noqa: S603
        except subprocess.CalledProcessError as error:
            sys.stderr.write(error.stderr or "Native experiment worker failed.\n")
            raise
        output = child.stdout
    if len(output.encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise ValueError("Experiment report exceeds the output budget.")
    sys.stdout.write(output + "\n")


if __name__ == "__main__":
    main()
