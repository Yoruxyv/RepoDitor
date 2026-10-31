"""Read-only, installed-game-derived cosmetic Sprite preparation (Sunstone).

The source mapping is reconstructed from the installed CosmeticAsset vector and
binary Addressables catalog, never from probe CSVs or a game's generated PNGs.
Only the artwork-approved Steam build is accepted. This module does not make any
save-mutation decision and does not write caches or PNGs to disk.

UnityPy, TypeTreeGeneratorAPI, and addressablestools are intentionally imported
lazily while their desktop packaging integration is being validated.
"""

from __future__ import annotations

import hashlib
import io
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Final, Iterable

GUID: Final = re.compile(r"^[a-f0-9]{32}$")
MAX_COSMETICS: Final = 2_000
MAX_BUNDLES: Final = 128
MAX_CATALOG_BYTES: Final = 100 * 1024 * 1024
MAX_IMAGE_SIDE: Final = 4_096
MAX_IMAGE_BYTES: Final = 16 * 1024 * 1024
MAX_TOTAL_PNG_BYTES: Final = 128 * 1024 * 1024
UNITY_VERSION: Final = "6000.3.17f1"
SUNSTONE_STEAM_BUILD: Final = "26294889"


class CosmeticArtworkError(ValueError):
    """A required installed-game artwork relationship was not independently proven."""


@dataclass(frozen=True, slots=True)
class ArtworkWatch:
    """Source file identity used later by a persistent presentation cache."""

    path: Path
    size: int
    mtime_ns: int


@dataclass(frozen=True, slots=True)
class DecodedCosmeticArtwork:
    """One validated PNG with its installed-source identity."""

    cosmetic_id: int
    asset_guid: str
    asset_path: str
    png: bytes
    width: int
    height: int
    source_identity: str
    watches: tuple[ArtworkWatch, ...]


def normalize_asset_path(raw: str) -> str:
    """Accept only exact, anchored Unity Assets paths, never fuzzy basenames."""
    if not isinstance(raw, str) or not raw or len(raw) > 2_048 or "\x00" in raw:
        return ""
    value = raw.replace("\\", "/").split("?", 1)[0].split("#", 1)[0]
    index = value.casefold().find("assets/")
    if index < 0 or (index > 0 and value[index - 1] not in ("/", ":")):
        return ""
    canonical = value[index:].casefold()
    parts = canonical.split("/")
    if len(parts) < 3 or parts[0] != "assets" or any(
        part in ("", ".", "..") for part in parts
    ):
        return ""
    return canonical


def normalized_guid(value: object) -> str:
    """Reject malformed and missing AssetReference GUIDs."""
    if not isinstance(value, str):
        raise CosmeticArtworkError("Cosmetic iconRef has no GUID string.")
    guid = value.lower().replace("-", "")
    if GUID.fullmatch(guid) is None or guid == "0" * 32:
        raise CosmeticArtworkError("Cosmetic iconRef GUID is invalid or empty.")
    return guid


def _find_named_value(node: object, names: frozenset[str], depth: int = 0) -> object | None:
    if depth > 5 or not isinstance(node, dict):
        return None
    for key, value in node.items():
        if isinstance(key, str) and key.casefold() in names:
            return value
    for value in node.values():
        if isinstance(value, dict):
            found = _find_named_value(value, names, depth + 1)
            if found is not None:
                return found
    return None


def _read_icon_guid(tree: object, expected_name: str) -> str:
    if not isinstance(tree, dict) or tree.get("assetName") != expected_name:
        raise CosmeticArtworkError("CosmeticAsset identity does not match installed catalog.")
    icon = tree.get("iconRef")
    if not isinstance(icon, dict):
        raise CosmeticArtworkError("CosmeticAsset has no typed iconRef field.")
    return normalized_guid(_find_named_value(
        icon, frozenset({"m_assetguid", "assetguid", "guid"})
    ))


def _sprite_location_paths(catalog: Any, guids: dict[int, str]) -> dict[int, str]:
    """Resolve exactly one Sprite-typed Addressables location per GUID."""
    by_guid: dict[str, list[object]] = defaultdict(list)
    for key, locations in catalog.resources.items():
        raw_key = str(key).lower().replace("-", "")
        if GUID.fullmatch(raw_key) is not None:
            if not isinstance(locations, (tuple, list)) or len(locations) > 128:
                raise CosmeticArtworkError("Addressables contains unbounded locations.")
            by_guid[raw_key].extend(locations)

    result: dict[int, str] = {}
    for cosmetic_id, guid in guids.items():
        locations = by_guid.get(guid, [])
        selected = {}
        for location in locations:
            resource_type = getattr(getattr(location, "type", None), "class_name", "")
            if (
                not isinstance(resource_type, str)
                or resource_type.split(",")[0].strip().split(".")[-1] != "Sprite"
            ):
                continue
            internal_id = getattr(location, "internal_id", None)
            asset_path = normalize_asset_path(internal_id) if isinstance(internal_id, str) else ""
            if not asset_path:
                raise CosmeticArtworkError(
                    f"Cosmetic {cosmetic_id} has an unsupported Sprite path."
                )
            fingerprint = (
                getattr(location, "primary_key", None),
                internal_id,
                getattr(location, "provider_id", None),
                str(getattr(location, "dependency_key", None)),
            )
            selected[fingerprint] = asset_path
        if len(selected) != 1:
            raise CosmeticArtworkError(
                f"Cosmetic {cosmetic_id} has {len(selected)} unique Sprite locations, expected one."
            )
        result[cosmetic_id] = next(iter(selected.values()))
    return result


def _watch(path: Path, root: Path) -> ArtworkWatch:
    candidate = path.resolve(strict=True)
    if not candidate.is_relative_to(root) or path.is_symlink() or not candidate.is_file():
        raise CosmeticArtworkError("Installed artwork source is outside the game root.")
    stat = candidate.stat()
    return ArtworkWatch(candidate, stat.st_size, stat.st_mtime_ns)


def _bundle_files(game_root: Path) -> tuple[Path, ...]:
    """Inspect only bounded, locally installed regular AssetBundles."""
    root = game_root.resolve(strict=True)
    aa = root / "REPO_Data" / "StreamingAssets" / "aa"
    if not aa.is_dir() or aa.is_symlink():
        raise CosmeticArtworkError("The local Addressables directory is missing.")
    candidates: list[Path] = []
    for path in sorted(aa.rglob("*.bundle")):
        _watch(path, root)
        candidates.append(path)
        if len(candidates) > MAX_BUNDLES:
            raise CosmeticArtworkError("Too many installed bundles to inspect safely.")
    if not candidates:
        raise CosmeticArtworkError("No installed AssetBundles were found.")
    return tuple(candidates)


def _sprite_pointer_object(pointer: Any) -> Any:
    if getattr(getattr(pointer, "type", None), "name", None) != "Sprite":
        raise CosmeticArtworkError("An object selected as a Sprite is not a Sprite.")
    deref = getattr(pointer, "deref", None)
    if not callable(deref):
        raise CosmeticArtworkError("The UnityPy Sprite pointer cannot be dereferenced.")
    reader = deref()
    if getattr(getattr(reader, "type", None), "name", None) != "Sprite":
        raise CosmeticArtworkError("The dereferenced asset is not a Sprite.")
    return reader.parse_as_object()


def _png_from_sprite(sprite: Any) -> tuple[bytes, int, int]:
    picture = sprite.image
    width, height = picture.size
    if (
        type(width) is not int or type(height) is not int
        or not 0 < width <= MAX_IMAGE_SIDE
        or not 0 < height <= MAX_IMAGE_SIDE
        or width * height > MAX_IMAGE_SIDE * MAX_IMAGE_SIDE
    ):
        raise CosmeticArtworkError("Decoded Sprite image dimensions are unsupported.")
    picture.load()
    if "A" in picture.getbands() and picture.getchannel("A").getbbox() is None:
        raise CosmeticArtworkError("Decoded Sprite image is fully transparent.")
    buffer = io.BytesIO()
    picture.save(buffer, format="PNG")
    png = buffer.getvalue()
    if len(png) > MAX_IMAGE_BYTES or not png.startswith(b"\x89PNG\r\n\x1a\n"):
        raise CosmeticArtworkError("Sprite PNG failed the output size/type check.")
    from PIL import Image

    with Image.open(io.BytesIO(png)) as check:
        check.verify()
    return png, width, height


def _source_identity(
    game_root: Path, cosmetic_id: int, guid: str, asset_path: str,
    watches: tuple[ArtworkWatch, ...],
) -> str:
    payload = [str(cosmetic_id), guid, asset_path, "sunstone-cosmetic-sprite-v1"]
    for watch in watches:
        payload.extend((
            watch.path.relative_to(game_root).as_posix(),
            str(watch.size),
            str(watch.mtime_ns),
        ))
    return hashlib.sha256("\x00".join(payload).encode("utf-8")).hexdigest()


def _installed_game_root(game_dir: Path | None) -> Path:
    """Require the independently approved Sunstone artwork build, not a mutation gate."""
    from repo_save_editor.services.game.discovery import (
        APP_MANIFEST_NAME, discover_game_installation, read_steam_app_manifest,
        validate_game_installation,
    )
    from repo_save_editor.services.game.installed_build import validated_installed_artwork_build

    if game_dir is None:
        installation = discover_game_installation().installation
    else:
        root = game_dir.expanduser().resolve(strict=True)
        library_root = root.parent.parent.parent
        manifest_path = library_root / "steamapps" / APP_MANIFEST_NAME
        manifest = read_steam_app_manifest(manifest_path)
        installation = validate_game_installation(
            root,
            steam_library_root=library_root,
            manifest_path=manifest_path,
            steam_build_id=manifest.build_id,
        )
    if installation is None:
        raise CosmeticArtworkError("A valid Steam game installation was not found.")
    build = validated_installed_artwork_build(installation)
    if build is None or build.build_id != SUNSTONE_STEAM_BUILD:
        raise CosmeticArtworkError("Installed game is not the validated Sunstone artwork build.")
    return installation.root.resolve(strict=True)


def _installed_guids(game_root: Path) -> tuple[dict[int, str], tuple[Path, ...]]:
    """Derive cosmetic ID to GUID directly from the authoritative installed vector."""
    import UnityPy
    from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator
    from repo_save_editor.services.cosmetics.installed_catalog import (
        _Resolver, _find_cosmetic_vector, _find_unique_meta_manager, _parse_cosmetic_metadata,
    )

    generator = TypeTreeGenerator(UNITY_VERSION)
    generator.load_local_game(str(game_root))
    nodes = generator.get_nodes_up("Assembly-CSharp", "CosmeticAsset")
    grouped: dict[Path, list[tuple[int, int, str]]] = defaultdict(list)
    with _Resolver(game_root / "REPO_Data") as resolver:
        level0 = resolver.open(game_root / "REPO_Data" / "level0")
        meta_record, meta_prefix, _ = _find_unique_meta_manager(resolver, level0)
        pointers = _find_cosmetic_vector(resolver, level0, meta_record, meta_prefix)
        if not 0 < len(pointers) <= MAX_COSMETICS:
            raise CosmeticArtworkError("Installed cosmetic catalog size is unsupported.")
        for cosmetic_id, pointer in enumerate(pointers):
            index, record = resolver.resolve(level0, pointer)
            metadata, _ = _parse_cosmetic_metadata(resolver, index, record, cosmetic_id)
            grouped[index.path].append((cosmetic_id, record.path_id, metadata.asset_name))

    result: dict[int, str] = {}
    for path, records in grouped.items():
        env = UnityPy.load(str(path))
        try:
            wanted = {path_id for _, path_id, _ in records}
            objects = {obj.path_id: obj for obj in env.objects if obj.path_id in wanted}
            for cosmetic_id, path_id, asset_name in records:
                obj = objects.get(path_id)
                if obj is None or getattr(obj.type, "name", None) != "MonoBehaviour":
                    raise CosmeticArtworkError(f"Cosmetic {cosmetic_id} has no MonoBehaviour.")
                tree = obj.read_typetree(nodes=nodes, check_read=True)
                result[cosmetic_id] = _read_icon_guid(tree, asset_name)
        finally:
            close = getattr(env, "close", None)
            if callable(close):
                close()

    if len(result) != len(pointers) or len(set(result.values())) != len(result):
        raise CosmeticArtworkError("Installed cosmetics have incomplete/duplicate GUID identities.")
    return result, tuple(sorted(grouped))


def _catalog_sprite_paths(game_root: Path, guids: dict[int, str]) -> dict[int, str]:
    from addressablestools import parse_binary

    catalog_path = game_root / "REPO_Data" / "StreamingAssets" / "aa" / "catalog.bin"
    watch = _watch(catalog_path, game_root)
    if not 0 < watch.size <= MAX_CATALOG_BYTES:
        raise CosmeticArtworkError("Binary Addressables catalog is empty or oversized.")
    catalog = parse_binary(catalog_path.read_bytes(), backend="python")
    if not hasattr(getattr(catalog, "resources", None), "items"):
        raise CosmeticArtworkError("Binary Addressables catalog has no resource index.")
    return _sprite_location_paths(catalog, guids)


def _find_unique_bundle_paths(
    game_root: Path, paths: dict[int, str],
) -> dict[int, Path]:
    """Match exact Sprite-class objects, never a Texture2D sharing the same path."""
    import UnityPy

    by_asset: dict[str, list[int]] = defaultdict(list)
    for cosmetic_id, asset_path in paths.items():
        by_asset[asset_path].append(cosmetic_id)
    if any(len(ids) != 1 for ids in by_asset.values()):
        raise CosmeticArtworkError("Multiple cosmetic IDs share one Sprite asset path.")
    matched: dict[int, list[Path]] = defaultdict(list)
    for bundle in _bundle_files(game_root):
        env = UnityPy.load(str(bundle))
        try:
            for container_path, pointer in env.container.items():
                if getattr(getattr(pointer, "type", None), "name", None) != "Sprite":
                    continue
                canonical = normalize_asset_path(container_path)
                if canonical in by_asset:
                    matched[by_asset[canonical][0]].append(bundle)
        finally:
            close = getattr(env, "close", None)
            if callable(close):
                close()
    if any(len(matched.get(cid, [])) != 1 for cid in paths):
        raise CosmeticArtworkError("Sprite identities are missing or ambiguous across bundles.")
    return {cid: matched[cid][0] for cid in paths}


def prepare_installed_cosmetic_artwork(
    cosmetic_ids: Iterable[int], *, game_dir: Path | None = None,
    on_decoded: Callable[[DecodedCosmeticArtwork], None] | None = None,
) -> tuple[DecodedCosmeticArtwork, ...]:
    """Decode selected installed-game Sprites, with no generated-file side effects.

    This deliberately does not write to the persistent presentation cache or grant
    mutation capabilities. Cache and Electron integration are separate stages.
    """
    requested = tuple(dict.fromkeys(cosmetic_ids))
    if not requested or len(requested) > MAX_COSMETICS or any(
        type(cid) is not int or not 0 <= cid < MAX_COSMETICS for cid in requested
    ):
        raise CosmeticArtworkError("A bounded set of canonical cosmetic IDs is required.")
    game_root = _installed_game_root(game_dir)
    guids, metadata_paths = _installed_guids(game_root)
    if any(cid not in guids for cid in requested):
        raise CosmeticArtworkError("Requested cosmetic is not in the installed catalog.")
    paths = _catalog_sprite_paths(game_root, guids)
    if set(paths) != set(guids):
        raise CosmeticArtworkError("Sprite catalog did not cover all cosmetic identities.")
    # Build the complete strict matching index, but only decode selected Sprites.
    bundles = _find_unique_bundle_paths(game_root, paths)
    by_bundle: dict[Path, list[int]] = defaultdict(list)
    for cid in requested:
        by_bundle[bundles[cid]].append(cid)
    catalog = game_root / "REPO_Data" / "StreamingAssets" / "aa" / "catalog.bin"
    level0 = game_root / "REPO_Data" / "level0"
    managed = game_root / "REPO_Data" / "Managed" / "Assembly-CSharp.dll"
    from repo_save_editor.services.game.discovery import APP_MANIFEST_NAME

    manifest = game_root.parent.parent / APP_MANIFEST_NAME
    input_paths = tuple(dict.fromkeys((catalog, level0, managed, manifest, *metadata_paths)))
    watches_common = tuple(_watch(path, game_root.parent.parent.parent) for path in input_paths)
    output: dict[int, DecodedCosmeticArtwork] = {}
    total_bytes = 0
    import UnityPy

    for bundle_path, ids in by_bundle.items():
        source_watches = watches_common + (_watch(bundle_path, game_root),)
        if len(source_watches) > 8:
            raise CosmeticArtworkError("Too many source files for the presentation watch budget.")
        expected: dict[str, int] = {paths[cid]: cid for cid in ids}
        env = UnityPy.load(str(bundle_path))
        try:
            matches: dict[int, list[Any]] = defaultdict(list)
            for container_path, pointer in env.container.items():
                if getattr(getattr(pointer, "type", None), "name", None) != "Sprite":
                    continue
                cid = expected.get(normalize_asset_path(container_path))
                if cid is not None:
                    matches[cid].append(pointer)
            for cid in ids:
                if len(matches[cid]) != 1:
                    raise CosmeticArtworkError("Sprite count changed during source preparation.")
                sprite = _sprite_pointer_object(matches[cid][0])
                png, width, height = _png_from_sprite(sprite)
                total_bytes += len(png)
                if total_bytes > MAX_TOTAL_PNG_BYTES:
                    raise CosmeticArtworkError("Decoded cosmetic batch exceeds the memory bound.")
                if any(_watch(w.path, game_root.parent.parent.parent) != w for w in source_watches):
                    raise CosmeticArtworkError("Installed artwork changed while decoding.")
                output[cid] = DecodedCosmeticArtwork(
                    cosmetic_id=cid,
                    asset_guid=guids[cid],
                    asset_path=paths[cid],
                    png=png,
                    width=width,
                    height=height,
                    source_identity=_source_identity(
                        game_root.parent.parent.parent, cid, guids[cid], paths[cid], source_watches
                    ),
                    watches=source_watches,
                )
                if on_decoded is not None:
                    on_decoded(output[cid])
        finally:
            close = getattr(env, "close", None)
            if callable(close):
                close()
    return tuple(output[cid] for cid in requested)


__all__ = [
    "ArtworkWatch", "CosmeticArtworkError", "DecodedCosmeticArtwork",
    "normalize_asset_path", "prepare_installed_cosmetic_artwork",
]
