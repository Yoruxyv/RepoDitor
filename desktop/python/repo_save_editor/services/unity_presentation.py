"""Bounded installed Unity layouts for read-only presentation."""

from __future__ import annotations

from re import fullmatch

from repo_save_editor.services.unity_artwork import ArtworkFileIndex
from repo_save_editor.services.unity_serialized import (
    MAX_TYPES,
    TARGET_PLATFORM,
    UNITY_VERSION,
    UnityMetadataError,
    _Reader,
)


def is_sunstone_layout(version: str) -> bool:
    """Recognize the Unity release family whose structures the readers validate."""
    return fullmatch(r"6000\.3\.[0-9]{1,3}f[0-9]{1,3}", version) is not None


class PresentationFileIndex(ArtworkFileIndex):
    """Share format-22 bounds without expanding the evidence-pinned reader."""

    def __enter__(self) -> PresentationFileIndex:
        return self

    def _parse_types(self, reader: _Reader) -> None:
        self.unity_version = reader.cstring(maximum=64)
        if self.unity_version != UNITY_VERSION and not is_sunstone_layout(self.unity_version):
            raise UnityMetadataError("Unsupported presentation Unity version.")
        if reader.i32() != TARGET_PLATFORM:
            raise UnityMetadataError("Unsupported presentation target platform.")
        enable_type_tree = reader.u8()
        if enable_type_tree not in (0, 1):
            raise UnityMetadataError("Serialized-file type-tree flag is malformed.")
        self.enable_type_tree = bool(enable_type_tree)
        type_count = reader.i32()
        if not 0 < type_count <= MAX_TYPES:
            raise UnityMetadataError("Serialized type count is outside the supported bound.")
        self.types = tuple(
            self._skip_serialized_type(reader, ref_type=False) for _ in range(type_count)
        )
