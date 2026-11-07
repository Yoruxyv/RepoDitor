"""Generate only the source-pinned, disposable MetaSave catalog fixture."""

import runpy
import sys
from pathlib import Path


def create(home: Path) -> Path:
    library = home / "SteamLibrary"
    game = library / "steamapps/common/RepoDitor E2E Install"
    previous = sys.argv
    try:
        sys.argv = [str(Path(__file__))]
        generator = runpy.run_path(str(Path(__file__).with_name("create-cosmetic-game-assets.py")))
    finally:
        sys.argv = previous
    build = generator["_build_catalog"]
    build.__globals__["UNITY_VERSION"] = "6000.3.17f1"
    build.__globals__["COSMETIC_COUNT"] = 28
    build(game)
    manifest = library / "steamapps/appmanifest_3241660.acf"
    manifest.write_text(
        '"AppState" { "appid" "3241660" "installdir" "RepoDitor E2E Install" '
        '"buildid" "26294889" }\n',
        encoding="utf-8",
        newline="\n",
    )
    assembly = game / "REPO_Data/Managed/Assembly-CSharp.dll"
    assembly.parent.mkdir(exist_ok=True)
    assembly.write_bytes(b"RepoDitor synthetic cosmetics assembly v1\n")
    catalog = game / "REPO_Data/StreamingAssets/aa/catalog.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_bytes(b"{}")
    return game


if __name__ == "__main__":
    create(Path(sys.argv[1]))
