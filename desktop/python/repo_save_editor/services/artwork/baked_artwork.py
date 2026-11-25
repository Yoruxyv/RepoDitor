"""Installed baked artwork identities, independent of save mutation capabilities.

Reviewed builds supply legacy mappings. The native Cosmetics path also accepts
structurally compatible, validated installed sources for presentation.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import stat
import tempfile
from collections import Counter
from collections.abc import Callable
from contextlib import suppress
from dataclasses import replace
from functools import lru_cache
from pathlib import Path
from typing import Final

from repo_save_editor.services.artwork.native_artwork_cache import (
    PNG_SLOTS,
    NativeArtworkCache,
    cacheable_png,
)

if os.name == "nt":
    import msvcrt

from repo_save_editor.services.cosmetics.installed_catalog import (
    MAX_OPEN_FILES,
    _catalog_payload,
    _find_cosmetic_vector,
    _find_unique_meta_manager,
    _parse_cached_catalog,
    _parse_cosmetic_metadata,
)
from repo_save_editor.services.cosmetics.installed_reader import CosmeticCatalogResolver
from repo_save_editor.services.cosmetics.installed_reader_native import (
    NativeCosmeticCatalogResolver,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
)
from repo_save_editor.services.game.installed_build import (
    ValidatedInstalledBuild,
    artwork_assembly_matches,
    artwork_assembly_sha256,
    installed_build_identity,
    owned_file,
    validated_installed_artwork_build,
)
from repo_save_editor.services.game.installed_build import artwork_installation as _installation
from repo_save_editor.services.items.installed_metadata import _resolve_mono_scripts
from repo_save_editor.services.items.runtime_metadata import read_sunstone_item_prefab
from repo_save_editor.services.unity_artwork import ArtworkFileIndex
from repo_save_editor.services.unity_hash import unity_hash128
from repo_save_editor.services.unity_presentation import (
    PresentationFileIndex,
    is_sunstone_layout,
    read_runtime_mono_prefix,
)
from repo_save_editor.services.unity_serialized import (
    MONO_BEHAVIOUR_CLASS_ID,
    UnityMetadataError,
    parse_mono_behaviour_prefix,
)

# Preserve existing probe imports while installed-source ownership stays in installed_build.
__all__ = ["_installation", "discover_baked_artwork", "owned_file"]

MAX_CACHE_BYTES: Final = 1024 * 1024
MAX_IDENTITIES: Final = 2_000
MAX_NATIVE_PNG: Final = 1024 * 1024
MAX_NATIVE_ITEM_BATCH: Final = 64
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
    *,
    native: bool = False,
) -> tuple[dict[str, str], set[Path], tuple[InstalledCosmeticMetadata, ...]]:
    resolver_type = NativeCosmeticCatalogResolver if native else CosmeticCatalogResolver
    with resolver_type(root / "REPO_Data") as resolver:
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


def _item_keys(root: Path, *, presentation: bool = False) -> dict[str, str]:
    """Use Item.name and PrefabRef.prefabName, authored from Object.name by SetPrefab."""
    index = PresentationFileIndex if presentation else ArtworkFileIndex
    with (
        index(root / "REPO_Data/resources.assets") as resources,
        index(root / "REPO_Data/globalgamemanagers.assets") as scripts_index,
    ):
        if (
            not is_sunstone_layout(resources.unity_version)
            or resources.unity_version != scripts_index.unity_version
        ):
            raise ValueError("Unsupported baked artwork Unity version.")
        records = tuple(resources.iter_records(frozenset({MONO_BEHAVIOUR_CLASS_ID})))
        prefixes = {r.path_id: read_runtime_mono_prefix(resources, r) for r in records}
        # Many objects reference the same script; validate each distinct file and path pair once.
        script_prefixes = {prefix.script: prefix for prefix in prefixes.values()}
        scripts = _resolve_mono_scripts(resources, scripts_index, script_prefixes.values())
        definitions: list[tuple[str, str]] = []
        for record in records:
            prefix = prefixes[record.path_id]
            if scripts[prefix.script.path_id].class_name != "Item" or prefix.name.startswith(
                "Item Upgrade "
            ):
                continue
            if (prefab := read_sunstone_item_prefab(resources, record, prefix)) is not None:
                definitions.append((prefix.name, prefab[1]))
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


def _reviewed_installation(
    game_dir: Path | None,
) -> tuple[Path, Path, ValidatedInstalledBuild, dict[str, str]] | None:
    installation = _installation(game_dir)
    if installation is None or (build := validated_installed_artwork_build(installation)) is None:
        return None
    root = installation.root.resolve(strict=True)
    library = root.parents[2]
    assembly = owned_file(library, root / _SOURCE_NAMES[0])
    assembly_watch = _watch(library, assembly)
    if int(assembly_watch["size"]) > 32 * 1024 * 1024:
        return None
    with assembly.open("rb") as handle:
        assembly_bytes = handle.read(32 * 1024 * 1024 + 1)
    if (
        len(assembly_bytes) > 32 * 1024 * 1024
        or not artwork_assembly_matches(build.build_id, hashlib.sha256(assembly_bytes).hexdigest())
        or _watch(library, assembly) != assembly_watch
    ):
        return None
    return root, library, build, assembly_watch


def discover_baked_artwork(
    game_dir: Path | None = None,
    *,
    cache_dir: Path | None = None,
) -> dict[str, object] | None:
    """Return trusted source paths and deterministic mappings; never read/write PNGs."""
    try:
        reviewed = _reviewed_installation(game_dir)
        if reviewed is None:
            return None
        root, library, build, _assembly_watch = reviewed
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


def _png_stamp(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


def _read_owned_png(library: Path, path: Path, stamp: tuple[int, ...]) -> bytes | None:
    png = _read_png_snapshot(path, stamp)
    if png is None or _png_stamp(owned_file(library, path).stat()) != stamp:
        return None
    return png


def _read_png_snapshot(path: Path, stamp: tuple[int, ...]) -> bytes | None:
    size = stamp[2]
    if not 57 <= size <= MAX_NATIVE_PNG:
        return None
    with path.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        if _png_stamp(opened) != stamp or not stat.S_ISREG(opened.st_mode):
            return None
        png = handle.read(size + 1)
        after = os.fstat(handle.fileno())
    if len(png) != size or _png_stamp(after) != stamp:
        return None
    return png


def read_baked_item_pngs(
    names: tuple[str, ...], *, expected_root: Path | None = None
) -> tuple[dict[str, tuple[bytes, str]], set[str], set[str]]:
    """Validate the installed Item mapping once for a bounded group of PNG reads."""
    if not 1 <= len(names) <= MAX_NATIVE_ITEM_BATCH:
        return {}, set(), set()
    try:
        reviewed = _presentation_installation()
        if reviewed is None:
            return {}, set(), set()
        root, library, build = reviewed
        if expected_root is not None and root != expected_root:
            return {}, set(), set()
        paths: tuple[Path, ...] = (
            build.manifest_path,
            root / "REPO_Data/resources.assets",
            root / "REPO_Data/globalgamemanagers.assets",
        )
        pinned = artwork_assembly_sha256(build.build_id) is not None
        if pinned:
            legacy = _reviewed_installation(None)
            if legacy is None or legacy[:3] != reviewed:
                return {}, set(), set()
            paths += (Path(legacy[3]["path"]),)
        sources = [installed_source_stamp(owned_file(library, path), path.stat()) for path in paths]
        keys = _supported_keys(_item_keys(root, presentation=not pinned))
        images = {}
        deferred: set[str] = set()
        missing: set[str] = set()
        remaining = 5 * 1024 * 1024  # Reserve room for base64 and JSON in the 8 MiB frame.
        for name in names:
            key = keys.get(name)
            if key is None:
                missing.add(name)
                continue
            filename = unity_hash128(key) + ".png"
            path = root / "REPO_Data/StreamingAssets/BakedIcons/Items" / filename
            try:
                stamp = _png_stamp(owned_file(library, path).stat())
                if remaining < stamp[2] <= MAX_NATIVE_PNG:
                    deferred.add(name)
                    continue
                png = _read_owned_png(library, path, stamp)
            except FileNotFoundError:
                missing.add(name)
                continue
            except (OSError, ValueError):
                continue
            if png is not None:
                identity = hashlib.sha256(json.dumps([sources, name, filename, stamp]).encode())
                identity.update(png)
                images[name] = (png, identity.hexdigest())
                remaining -= len(png)
        if [
            installed_source_stamp(owned_file(library, path), path.stat()) for path in paths
        ] == sources and _presentation_installation() == reviewed:
            return images, deferred, missing
    except (OSError, ValueError, RuntimeError, KeyError, OverflowError):
        return {}, set(), set()
    return {}, set(), set()


def _cosmetic_png(root: Path, key: str) -> Path:
    return root / "REPO_Data/StreamingAssets/BakedIcons/Cosmetics" / (key + ".png")


def _digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


@lru_cache(maxsize=1)
def _basic_info() -> Callable[[int, int, ctypes.Array[ctypes.c_longlong], int], int]:
    query = ctypes.WinDLL("kernel32", use_last_error=True).GetFileInformationByHandleEx
    query.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    query.restype = ctypes.c_int
    return query


def _change_time(path: Path, expected: tuple[int, ...] | None = None) -> int:
    if os.name != "nt":
        return path.stat().st_ctime_ns
    # FILE_BASIC_INFO includes NTFS ChangeTime, unlike Python's Windows st_ctime.
    info = (ctypes.c_longlong * 5)()
    with path.open("rb") as stream:
        if expected is not None and _png_stamp(os.fstat(stream.fileno())) != expected:
            raise ValueError("Artwork file changed during inspection")
        if not _basic_info()(msvcrt.get_osfhandle(stream.fileno()), 0, info, ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())
    return int(info[3])


def _png_revision(path: Path, stamp: tuple[int, ...]) -> str:
    return _digest([stamp, _change_time(path, stamp)])


@lru_cache(maxsize=1)
def _attribute_handles() -> tuple[Callable[..., int], Callable[..., int]]:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    open_file = kernel.CreateFileW
    open_file.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_void_p,
    ]
    open_file.restype = ctypes.c_void_p
    close = kernel.CloseHandle
    close.argtypes = [ctypes.c_void_p]
    return open_file, close


def installed_source_stamp(path: Path, expected: os.stat_result) -> tuple[object, ...]:
    """Read the physical identity and change time of one admitted installed source."""
    if os.name != "nt":
        return (*_png_stamp(expected), expected.st_ctime_ns)
    # Query metadata only. Opening hundreds of files for data can trigger cold AV scans.
    open_file, close = _attribute_handles()
    handle = open_file(str(path), 0x80, 7, None, 3, 0x02200000, None)
    if handle in (None, ctypes.c_void_p(-1).value):
        raise ctypes.WinError(ctypes.get_last_error())
    info = (ctypes.c_longlong * 5)()
    try:
        if not _basic_info()(handle, 0, info, ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        if info[3] <= 0 or info[4] & 0x400 or _png_stamp(path.lstat()) != _png_stamp(expected):
            raise ValueError("Artwork source identity changed.")
        return (*_png_stamp(expected), info[3])
    finally:
        close(handle)


def entry_artwork_revision(expected_root: Path | None = None) -> str | None:
    """Prove the installed inputs for warm Run artwork without opening Unity indexes."""
    try:
        reviewed = _presentation_installation()
        if reviewed is None:
            return None
        root, library, build = reviewed
        if expected_root is not None and root != expected_root:
            return None
        manifest = owned_file(library, build.manifest_path)
        manifest_revision = installed_source_stamp(manifest, manifest.stat())
        data = root / "REPO_Data"
        pending = [data]
        identities: dict[str, object] = {}
        while pending:
            path = pending.pop()
            # Upgrade stream references can target any owned descendant of REPO_Data.
            # shortcut: use a complete bounded file roster until decoders expose dependency proofs.
            if len(identities) >= 2048 or len(path.relative_to(data).parts) > 12:
                return None
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                return None
            identities[str(path)] = installed_source_stamp(path, info)
            if stat.S_ISDIR(info.st_mode):
                with os.scandir(path) as entries:
                    for entry in entries:
                        if len(identities) + len(pending) >= 2047:
                            return None
                        pending.append(Path(entry.path))
            elif not stat.S_ISREG(info.st_mode):
                return None
        if (
            installed_source_stamp(manifest, manifest.stat()) != manifest_revision
            or _presentation_installation() != reviewed
        ):
            return None
        return _digest([build.build_id, manifest_revision, identities])
    except (OSError, ValueError, OverflowError):
        return None


def _presentation_installation() -> tuple[Path, Path, ValidatedInstalledBuild] | None:
    installation = _installation(None)
    if installation is None or installation.steam_library_root is None:
        return None
    build = installed_build_identity(installation)
    if build is None:
        return None
    return installation.root, installation.steam_library_root, build


def _native_sources(
    root: Path,
    library: Path,
    build: ValidatedInstalledBuild,
) -> tuple[list[dict[str, str]], list[int]]:
    paths = {build.manifest_path, root / "REPO_Data/level0"}
    # External references resolve by basename. Include added and relocated source files.
    with os.scandir(root / "REPO_Data") as entries:
        for count, entry in enumerate(entries, 1):
            if count > MAX_OPEN_FILES:
                raise ValueError("Too many cosmetic sources.")
            info = entry.stat(follow_symlinks=False)
            if entry.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
                raise ValueError("Cosmetic sources may not contain reparse points.")
            if stat.S_ISREG(info.st_mode):
                paths.add(Path(entry.path))
    ordered = sorted(paths)
    return (
        [_watch(library, path) for path in ordered],
        [_change_time(path) for path in ordered],
    )


def _cosmetic_directory(library: Path, directory: Path) -> list[tuple[int, int, int]]:
    stamp = []
    current = library
    for part in ("", *directory.relative_to(library).parts):
        current = current / part
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Invalid Cosmetics directory")
        stamp.append((info.st_dev, info.st_ino, info.st_mtime_ns))
    if directory.resolve(strict=True) != directory:
        raise ValueError("Noncanonical Cosmetics directory")
    return stamp


def _bind_cosmetic_files(
    root: Path,
    library: Path,
    filenames: dict[str, str],
) -> dict[str, tuple[str, str]]:
    directory = _cosmetic_png(root, "").parent
    try:
        before = _cosmetic_directory(library, directory)
        mapped = {}
        for identity, key in filenames.items():
            path = directory / (key + ".png")
            try:
                info = path.lstat()
                if (
                    stat.S_ISREG(info.st_mode)
                    and not getattr(info, "st_file_attributes", 0) & 0x400
                    and 57 <= info.st_size <= MAX_NATIVE_PNG
                ):
                    mapped[identity] = (key, _png_revision(path, _png_stamp(info)))
            except (OSError, ValueError):
                continue
        return mapped if _cosmetic_directory(library, directory) == before else {}
    except (OSError, ValueError):
        return {}


def _read_native_catalog(
    cache: NativeArtworkCache | None,
    revision: str,
) -> tuple[tuple[InstalledCosmeticMetadata, ...], dict[str, str]] | None:
    try:
        data = cache.catalog(revision) if cache is not None else None
        if data is None:
            return None
        payload = json.loads(data)
        catalog = _parse_cached_catalog(payload["catalog"])
        filenames = payload["filenames"]
        if (
            catalog is None
            or len(catalog) > MAX_IDENTITIES
            or not isinstance(filenames, dict)
            or len(filenames) > len(catalog)
            or not set(filenames).issubset({str(row.cosmetic_id) for row in catalog})
            or any(
                not isinstance(key, str)
                or len(key) != 32
                or any(c not in "0123456789abcdef" for c in key)
                for key in filenames.values()
            )
            or len(set(filenames.values())) != len(filenames)
        ):
            if cache is not None:
                cache.note("catalog_metadata_invalid")
            return None
        return catalog, filenames
    except (ValueError, KeyError, TypeError):
        if cache is not None:
            cache.note("catalog_metadata_invalid")
        return None


def _cache_event(cache: NativeArtworkCache | None, event: str, count: int = 1) -> None:
    if cache is not None:
        cache.note(event, count)


def _file_binding(library: Path, path: Path, revision: str, png_revision: str) -> str | None:
    if _png_revision(path, _png_stamp(owned_file(library, path).stat())) != png_revision:
        return None
    return f"{revision}:{path.stem}:{png_revision}"


def _warm_pngs(
    cache: NativeArtworkCache,
    root: Path,
    library: Path,
    revision: str,
    mapped: dict[str, tuple[str, str]],
) -> dict[str, bytes]:
    previews = {}
    remaining = 384 * 1024
    for slot in range(PNG_SLOTS):
        entry = cache.png(slot)
        if entry is None or entry[0] not in mapped:
            if entry is not None:
                cache.note("source_changed")
            continue
        identity, frame = entry
        key, png_revision = mapped[identity]
        path = _cosmetic_png(root, key)
        try:
            binding = _file_binding(library, path, revision, png_revision)
            png = cache.unseal_png(identity, binding, frame) if binding is not None else None
            if png is None or len(png) > remaining:
                continue
            if _file_binding(library, path, revision, png_revision) != binding:
                cache.note("source_changed")
                continue
        except (OSError, ValueError):
            continue
        previews[identity] = png
        remaining -= len(png)
        if len(previews) == 8:
            break
    return previews


def native_cosmetic_catalog(
    cache: NativeArtworkCache | None = None,
    *,
    warm_artwork: bool = False,
    on_incompatible: Callable[[], None] | None = None,
) -> (
    tuple[
        tuple[InstalledCosmeticMetadata, ...],
        str,
        dict[str, tuple[str, str]],
        dict[str, bytes],
    ]
    | None
):
    """Read the authoritative catalog and bind eligible presentation artifacts."""
    try:
        reviewed = _presentation_installation()
        if reviewed is None:
            _cache_event(cache, "source_unavailable")
            return None
        root, library, build = reviewed
        before = _native_sources(root, library, build)
        if _presentation_installation() != reviewed:
            return None
        revision = _digest([build.build_id, before])
        if not all(before[1]):
            _cache_event(cache, "source_unavailable")
            cache = None
        cached = _read_native_catalog(cache, revision)
        if cached is None:
            _cache_event(cache, "catalog_scan")
            keys, paths, catalog = _cosmetic_keys(root, native=True)
            if not paths.issubset({Path(watch["path"]) for watch in before[0]}):
                return None
            filenames = {
                identity: unity_hash128(name) for identity, name in _supported_keys(keys).items()
            }
        else:
            catalog, filenames = cached
        mapped = _bind_cosmetic_files(root, library, filenames)
        previews = (
            _warm_pngs(cache, root, library, revision, mapped) if cache and warm_artwork else {}
        )
        if _native_sources(root, library, build) != before:
            _cache_event(cache, "source_changed")
            return None
        _cache_event(cache, "catalog_hit", int(cached is not None))
        _cache_event(cache, "thumbnail_hit", len(previews))
        if cache is not None and cached is None:
            cache.publish_catalog(
                revision,
                json.dumps(
                    {"catalog": _catalog_payload(catalog), "filenames": filenames},
                    separators=(",", ":"),
                ).encode(),
            )
        return catalog, revision, mapped, previews
    except (OSError, ValueError, RuntimeError, KeyError, OverflowError) as error:
        if on_incompatible is not None and isinstance(error, UnityMetadataError):
            on_incompatible()
        _cache_event(cache, "source_unavailable")
        return None


def read_bound_cosmetic_png(
    revision: str,
    key: str,
    png_revision: str,
    *,
    cache: NativeArtworkCache | None = None,
    identity: str = "",
) -> bytes | None:
    """Recheck the installed sources and one previously verified baked mapping."""
    return read_bound_cosmetic_pngs(revision, [(identity, key, png_revision)], cache).get(identity)


def read_bound_cosmetic_pngs(
    revision: str,
    members: list[tuple[str, str, str]],
    cache: NativeArtworkCache | None = None,
) -> dict[str, bytes]:
    """Validate one installed source snapshot around a bounded batch of baked mappings."""
    try:
        reviewed = _presentation_installation()
        if reviewed is None:
            return {}
        root, library, build = reviewed
        before = _native_sources(root, library, build)
        if (
            _digest([build.build_id, before]) != revision
            or _presentation_installation() != reviewed
        ):
            _cache_event(cache, "source_changed")
            return {}
        read: list[tuple[str, Path, str, bytes, str | None, bool]] = []
        for identity, key, png_revision in members:
            if len(key) != 32 or any(c not in "0123456789abcdef" for c in key):
                continue
            path = _cosmetic_png(root, key)
            try:
                stamp = _png_stamp(owned_file(library, path).stat())
                if _png_revision(path, stamp) != png_revision:
                    _cache_event(cache, "source_changed")
                    continue
                binding = f"{revision}:{key}:{png_revision}" if cache and all(before[1]) else None
                cached = (
                    cache.open_png(identity, binding) if cache and binding is not None else None
                )
                # The final binding check revalidates the owned path and its change time.
                png = cached if cached is not None else _read_png_snapshot(path, stamp)
                if png is not None:
                    read.append((identity, path, png_revision, png, binding, cached is not None))
            except (OSError, ValueError, RuntimeError, KeyError, OverflowError):
                _cache_event(cache, "source_unavailable")
        if _native_sources(root, library, build) != before:
            _cache_event(cache, "source_changed")
            return {}
        result: dict[str, bytes] = {}
        for identity, path, png_revision, png, binding, was_cached in read:
            try:
                current = _file_binding(library, path, revision, png_revision)
            except (OSError, ValueError):
                current = None
            if current is None:
                _cache_event(cache, "source_changed")
                continue
            _cache_event(cache, "thumbnail_hit" if was_cached else "thumbnail_read")
            if (
                cache is not None
                and binding is not None
                and not was_cached
                and (stripped := cacheable_png(png)) is not None
            ):
                cache.publish_png(identity, binding, stripped)
            result[identity] = png
        return result
    except (OSError, ValueError, RuntimeError, KeyError, OverflowError):
        _cache_event(cache, "source_unavailable")
        return {}
