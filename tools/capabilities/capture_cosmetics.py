"""Independent, read-only UnityPy cosmetic evidence capture.

Run in an isolated UnityPy[ttgen] research environment, not the desktop backend.
No production vector scanner, metadata parser, image decoder or cache is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from importlib import import_module
from importlib.metadata import version
from pathlib import Path
from typing import Any

from repo_save_editor.services.game.discovery import read_steam_app_manifest
from tools.capabilities.schema import CURRENT_COSMETICS_BUILD_ID, CURRENT_COSMETICS_UNITY_VERSION

SOURCE_FILES = (
    "REPO_Data/level0",
    "REPO_Data/globalgamemanagers.assets",
    "REPO_Data/sharedassets0.assets",
    "REPO_Data/Managed/Assembly-CSharp.dll",
)


def _hashes(root: Path) -> dict[str, str]:
    result = {}
    for relative in SOURCE_FILES:
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("Oracle source escapes the installation.")
        with path.open("rb") as handle:
            result[relative] = hashlib.file_digest(handle, "sha256").hexdigest()
    return result


def capture(game_root: Path) -> dict[str, Any]:
    """Capture the reviewed current layout, failing on ambiguous or changing input."""
    root = game_root.resolve(strict=True)
    manifest = read_steam_app_manifest(root.parent.parent / "appmanifest_3241660.acf")
    if manifest.build_id != CURRENT_COSMETICS_BUILD_ID:
        raise ValueError("This independent capture has only reviewed build 26294889.")
    before = _hashes(root)
    unity = import_module("UnityPy")
    generator = import_module("UnityPy.helpers.TypeTreeGenerator").TypeTreeGenerator(
        CURRENT_COSMETICS_UNITY_VERSION
    )
    generator.load_local_game(str(root))
    pointer_type = import_module("UnityPy.classes").PPtr
    env = unity.load(str(root / "REPO_Data/level0"))
    try:
        managers = []
        for obj in env.objects:
            if obj.type.name != "MonoBehaviour":
                continue
            file_id, path_id = struct.unpack_from("<iq", obj.get_raw_data(), 16)
            script = (
                pointer_type(m_FileID=file_id, m_PathID=path_id, assetsfile=obj.assets_file)
                .deref()
                .parse_as_object()
            )
            if script.m_ClassName == "MetaManager":
                managers.append(obj)
        if len(managers) != 1:
            raise ValueError("Expected exactly one typed MetaManager.")
        manager = managers[0]
        if manager.assets_file.unity_version != CURRENT_COSMETICS_UNITY_VERSION:
            raise ValueError("Unexpected serialized Unity header.")
        tree = manager.read_typetree(
            nodes=generator.get_nodes_up("Assembly-CSharp", "MetaManager"), check_read=True
        )
        vector = tree["cosmeticAssets"]
        if not isinstance(vector, list) or not 0 < len(vector) <= 2000:
            raise ValueError("Cosmetic vector is empty or exceeds the inspection bound.")
        catalog = []
        nodes = generator.get_nodes_up("Assembly-CSharp", "CosmeticAsset")
        for cosmetic_id, pointer in enumerate(vector):
            target = pointer_type(**pointer, assetsfile=manager.assets_file).deref()
            if target.type.name != "MonoBehaviour":
                raise ValueError("Cosmetic target has an unexpected Unity class.")
            entry = target.read_typetree(nodes=nodes, check_read=True)
            catalog.append(
                {
                    "id": cosmetic_id,
                    "serializedFile": target.assets_file.name,
                    "pathId": target.path_id,
                    "sourceFileId": pointer["m_FileID"],
                    "assetName": entry["assetName"],
                    "type": entry["type"],
                    "rarity": entry["rarity"],
                    "status": entry["status"],
                }
            )
        targets = {(entry["serializedFile"], entry["pathId"]) for entry in catalog}
        if len(targets) != len(catalog) or any(entry["pathId"] == 0 for entry in catalog):
            raise ValueError("Duplicate or null cosmetic target.")
        after = _hashes(root)
        if before != after:
            raise ValueError("Installed sources changed during capture.")
        return {
            "schema": "repoditor-cosmetic-gate2-unitypy-oracle-v1",
            "researchOnly": True,
            "independentOracle": True,
            "steam": {
                "appId": "3241660",
                "buildId": manifest.build_id,
                "manifest": "appmanifest_3241660.acf",
            },
            "unity": {
                "unityPyVersion": version("UnityPy"),
                "unityVersion": CURRENT_COSMETICS_UNITY_VERSION,
                "serializedFileVersion": manager.assets_file.header.version,
            },
            "metaManager": {
                "serializedFile": "REPO_Data/level0",
                "pathId": manager.path_id,
                "cosmeticAssetsCount": len(catalog),
                "rawCosmeticVector": vector,
            },
            "catalog": catalog,
            "validation": {
                "count": len(catalog),
                "indexesContiguous": True,
                "duplicateTargetCount": 0,
                "nullPointerCount": 0,
            },
            "fileHashes": after,
        }
    finally:
        close = getattr(env, "close", None)
        if callable(close):
            close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(args.game_dir.resolve()):
        parser.error("Evidence output must be outside the installed game.")
    result = capture(args.game_dir)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
