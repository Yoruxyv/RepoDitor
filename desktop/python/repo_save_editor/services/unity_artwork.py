"""Version-specific serialized headers for read-only installed artwork.

The historical capability reader is evidence-pinned. Artwork specializes only
its small type-header hook and inherits all record parsing, bounds and cleanup.
"""

from __future__ import annotations

from typing import Final

from repo_save_editor.services.unity_serialized import (
    MAX_TYPES,
    TARGET_PLATFORM,
    UNITY_VERSION,
    SerializedFileIndex,
    UnityMetadataError,
    _Reader,
)

SUNSTONE_UNITY_VERSION: Final = "6000.3.17f1"
RECT_TRANSFORM_CLASS_ID: Final = 224
SUPPORTED_ARTWORK_VERSIONS: Final = frozenset({UNITY_VERSION, SUNSTONE_UNITY_VERSION})


class ArtworkFileIndex(SerializedFileIndex):
    """Open reviewed artwork layouts without changing capability-reader acceptance."""

    def __enter__(self) -> ArtworkFileIndex:
        return self

    def _parse_types(self, reader: _Reader) -> None:
        # Keep this header explicit: never relabel a Unity 6 file as the legacy version.
        self.unity_version = reader.cstring(maximum=64)
        if self.unity_version not in SUPPORTED_ARTWORK_VERSIONS:
            raise UnityMetadataError(f"Unsupported Unity version {self.unity_version!r}.")
        target_platform = reader.i32()
        if target_platform != TARGET_PLATFORM:
            raise UnityMetadataError(f"Unsupported target platform {target_platform}.")
        enable_type_tree = reader.u8()
        if enable_type_tree not in (0, 1):
            raise UnityMetadataError("Serialized-file type-tree flag is malformed.")
        self.enable_type_tree = bool(enable_type_tree)
        type_count = reader.i32()
        if not 0 <= type_count <= MAX_TYPES:
            raise UnityMetadataError("Serialized type count is outside the supported bound.")
        types = [self._skip_serialized_type(reader, ref_type=False) for _ in range(type_count)]
        if not types:
            raise UnityMetadataError("Serialized file contains no object types.")
        self.types = tuple(types)
