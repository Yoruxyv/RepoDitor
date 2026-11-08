"""Installed baked artwork identities, independent of save mutation capabilities.

Only a reviewed Steam build and assembly may supply mappings. The disposable JSON
cache contains source identities and canonical hash inputs, never game artwork.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
from collections import Counter
from contextlib import suppress
from dataclasses import replace
from pathlib import Path, PurePosixPath
from typing import Final

from repo_save_editor.services.cosmetics.installed_catalog import (
    _catalog_payload,
    _find_cosmetic_vector,
    _find_unique_meta_manager,
    _parse_cached_catalog,
    _parse_cosmetic_metadata,
)
from repo_save_editor.services.cosmetics.installed_reader import (
    CosmeticCatalogResolver as _ArtworkResolver,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
)
from repo_save_editor.services.game.installed_build import (
    artwork_assembly_matches,
    owned_file,
    validated_installed_artwork_build,
)
from repo_save_editor.services.game.installed_build import artwork_installation as _installation
from repo_save_editor.services.items.installed_metadata import _resolve_mono_scripts
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_hash import unity_hash128
from repo_save_editor.services.unity_serialized import (
    MONO_BEHAVIOUR_CLASS_ID,
    parse_mono_behaviour_prefix,
    read_pptr,
)

# Preserve existing probe imports while installed-source ownership stays in installed_build.
__all__ = ["_installation", "discover_baked_artwork", "owned_file"]

MAX_CACHE_BYTES: Final = 1024 * 1024
MAX_IDENTITIES: Final = 2_000
SCHEMA: Final = 8
_SOURCE_NAMES: Final = (
    "REPO_Data/Managed/Assembly-CSharp.dll",
    "REPO_Data/level0",
    "REPO_Data/resources.assets",
    "REPO_Data/globalgamemanagers.assets",
    "REPO_Data/sharedassets0.assets",
)


def _watch(root: Path, path: Path) -> dict[str, str]:
    info = owned_file(root, path).stat()
    # libuv exposes the low 32 bits of the Windows volume serial number.
    device = info.st_dev & 0xFFFFFFFF if os.name == "nt" else info.st_dev
    return {
        "path": str(path),
        "size": str(info.st_size),
        "mtimeNs": str(info.st_mtime_ns),
        "device": str(device),
        "inode": str(info.st_ino),
    }


def _cosmetic_keys(
    root: Path,
) -> tuple[dict[str, str], set[Path], tuple[InstalledCosmeticMetadata, ...]]:
    with _ArtworkResolver(root / "REPO_Data") as resolver:
        level = resolver.open(root / "REPO_Data/level0")
        record, prefix, _ = _find_unique_meta_manager(resolver, level)
        pointers = _find_cosmetic_vector(resolver, level, record, prefix)
        if len(pointers) > MAX_IDENTITIES:
            raise ValueError("Too many cosmetic identities.")
        keys: dict[str, str] = {}
        catalog: list[InstalledCosmeticMetadata] = []
        paths: set[Path] = {level.path}
        for cosmetic_id, pointer in enumerate(pointers):
            index, record = resolver.resolve(level, pointer)
            metadata, script_path = _parse_cosmetic_metadata(resolver, index, record, cosmetic_id)
            catalog.append(replace(metadata, icon_cache_key=None))
            prefix = parse_mono_behaviour_prefix(index, record)
            keys[str(cosmetic_id)] = prefix.name
            paths.update((index.path, script_path))
        return keys, paths, tuple(catalog)


def _item_keys(root: Path) -> dict[str, str]:
    """Use Item.name and PrefabRef.prefabName, authored from Object.name by SetPrefab."""
    with (
        ArtworkFileIndex(root / "REPO_Data/resources.assets") as resources,
        ArtworkFileIndex(root / "REPO_Data/globalgamemanagers.assets") as scripts_index,
    ):
        if resources.unity_version != SUNSTONE_UNITY_VERSION:
            raise ValueError("Unsupported baked artwork Unity version.")
        records = tuple(resources.iter_records(frozenset({MONO_BEHAVIOUR_CLASS_ID})))
        prefixes = {r.path_id: parse_mono_behaviour_prefix(resources, r) for r in records}
        scripts = _resolve_mono_scripts(resources, scripts_index, prefixes.values())
        definitions: list[tuple[str, str]] = []
        for record in records:
            prefix = prefixes[record.path_id]
            if scripts[prefix.script.path_id].class_name != "Item" or prefix.name.startswith(
                "Item Upgrade "
            ):
                continue
            reader = resources.object_reader(record)
            reader.skip(prefix.field_offset)
            status = reader.i32()
            disabled = reader.u8()
            reader.align4()
            reader.aligned_string()  # itemName
            read_pptr(reader)  # itemNameLocalized
            reader.aligned_string()  # description
            reader.skip(16)  # itemType / emojiIcon / itemVolume / itemSecretShopType
            read_pptr(reader)  # colorPreset
            prefab_name = reader.aligned_string()
            resource_path = reader.aligned_string()
            bundle = read_pptr(reader)
            if (
                status not in (0, 1, 2)
                or disabled not in (0, 1)
                or bundle.file_id != 0
                or bundle.path_id != 0
                or not prefab_name
                or not resource_path.startswith("Items/")
                or PurePosixPath(resource_path).name != prefab_name
                or any(part in ("", ".", "..") for part in resource_path.split("/"))
            ):
                continue
            definitions.append((prefix.name, prefab_name))
        counts = Counter(name for name, _ in definitions)
        return {name: name + "|" + prefab for name, prefab in definitions if counts[name] == 1}


def _supported_keys(keys: dict[str, str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for identity, key in keys.items():
        try:
            unity_hash128(key)
        except ValueError:
            continue
        result[identity] = key
    counts = Counter(unity_hash128(key) for key in result.values())
    return {identity: key for identity, key in result.items() if counts[unity_hash128(key)] == 1}


def _cache_path(cache_dir: Path | None) -> Path:
    if cache_dir is None:
        local = os.environ.get("LOCALAPPDATA")
        cache_dir = Path(local) / "RepoDitor/cache" if local else Path.home() / ".cache/repoditor"
    return cache_dir / "baked-artwork.json"


def _cached_keys(
    path: Path,
    root: Path,
    library: Path,
) -> (
    tuple[dict[str, dict[str, str]], list[dict[str, str]], tuple[InstalledCosmeticMetadata, ...]]
    | None
):
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_CACHE_BYTES or path.is_symlink():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["schema"] != SCHEMA or data["root"] != str(root):
            return None
        files = data["sources"]
        if not isinstance(files, list) or not 5 <= len(files) <= 16:
            return None
        if any(_watch(library, Path(w["path"])) != w for w in files):
            return None
        required = {root / name for name in _SOURCE_NAMES} | {
            library / "steamapps" / APP_MANIFEST_NAME,
        }
        if not required.issubset({Path(w["path"]) for w in files}):
            return None
        keys = data["keys"]
        if not isinstance(keys, dict) or set(keys) != {"item", "cosmetic"}:
            return None
        for domain, rows in keys.items():
            if not isinstance(rows, dict) or len(rows) > MAX_IDENTITIES:
                return None
            if (
                any(
                    not isinstance(identity, str)
                    or not isinstance(key, str)
                    or (
                        domain == "cosmetic"
                        and (
                            not identity.isascii()
                            or not identity.isdecimal()
                            or str(int(identity)) != identity
                            or int(identity) >= MAX_IDENTITIES
                        )
                    )
                    or (
                        domain == "item"
                        and (not identity.startswith("Item ") or not key.startswith(identity + "|"))
                    )
                    for identity, key in rows.items()
                )
                or _supported_keys(rows) != rows
            ):
                return None
        catalog = _parse_cached_catalog(data["cosmeticCatalog"])
        if catalog is None or len(catalog) > MAX_IDENTITIES:
            return None
        if not set(keys["cosmetic"]).issubset({str(entry.cosmetic_id) for entry in catalog}):
            return None
        return keys, files, catalog
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def _persist(path: Path, payload: dict[str, object]) -> None:
    temporary: Path | None = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, separators=(",", ":"))
        temporary.replace(path)
    except OSError:
        pass  # Disposable metadata must not block source artwork.
    finally:
        if temporary is not None:
            with suppress(OSError):
                temporary.unlink(missing_ok=True)


def discover_baked_artwork(
    game_dir: Path | None = None,
    *,
    cache_dir: Path | None = None,
) -> dict[str, object] | None:
    """Return trusted source paths and deterministic mappings; never read/write PNGs."""
    try:
        installation = _installation(game_dir)
        if installation is None:
            return None
        build = validated_installed_artwork_build(installation)
        if build is None:
            return None
        root = installation.root.resolve(strict=True)
        library = root.parents[2]
        assembly = owned_file(library, root / _SOURCE_NAMES[0])
        if assembly.stat().st_size > 32 * 1024 * 1024:
            return None
        assembly_watch = _watch(library, assembly)
        with assembly.open("rb") as handle:
            assembly_bytes = handle.read(32 * 1024 * 1024 + 1)
        if (
            len(assembly_bytes) > 32 * 1024 * 1024
            or not artwork_assembly_matches(
                build.build_id, hashlib.sha256(assembly_bytes).hexdigest()
            )
            or _watch(library, assembly) != assembly_watch
        ):
            return None
        path = _cache_path(cache_dir)
        cached = _cached_keys(path, root, library)
        if cached is None:
            sources = {root / name for name in _SOURCE_NAMES} | {build.manifest_path}
            initial = [_watch(library, p) for p in sorted(sources)]
            cosmetics, paths, catalog = _cosmetic_keys(root)
            keys = {
                "item": _supported_keys(_item_keys(root)),
                "cosmetic": _supported_keys(cosmetics),
            }
            if not paths.issubset(sources):
                return None
            watches = [_watch(library, p) for p in sorted(sources)]
            if any(_watch(library, Path(w["path"])) != w for w in initial):
                return None
            _persist(
                path,
                {
                    "schema": SCHEMA,
                    "root": str(root),
                    "keys": keys,
                    "sources": watches,
                    "cosmeticCatalog": _catalog_payload(catalog),
                },
            )
        else:
            keys, watches, catalog = cached
        return {
            "root": str(root),
            "sources": watches,
            "cosmeticCatalog": _catalog_payload(catalog),
            "item": {
                identity: unity_hash128(key) + ".png" for identity, key in keys["item"].items()
            },
            "cosmetic": {
                identity: unity_hash128(key) + ".png" for identity, key in keys["cosmetic"].items()
            },
        }
    except (OSError, ValueError, RuntimeError, KeyError, OverflowError):
        return None
