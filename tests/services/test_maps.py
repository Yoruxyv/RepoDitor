from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from repo_save_editor.services.maps import (
    MapDiscoveryError,
    discover_installed_maps,
    discover_map_families,
    find_installed_catalog,
    get_map_display_name,
    load_map_catalog,
)


def _write_catalog(path: Path, keys: list[str]) -> None:
    key_blob = b"\x00".join(key.encode() for key in keys)
    payload = {
        "m_LocatorId": "AddressablesMainContentCatalog",
        "m_KeyDataString": base64.b64encode(key_blob).decode(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_discover_map_families_uses_loading_graphics_and_excludes_special_levels(
    tmp_path: Path,
):
    catalog = tmp_path / "catalog.json"
    _write_catalog(
        catalog,
        [
            "Level/Arctic/Loading Graphics/level arctic 01",
            "Level/Manor/Loading Graphics/level manor 01",
            "Level/Museum/Loading Graphics/level museum 01",
            "Level/Wizard/Loading Graphics/level wizard 01",
            "Level/Arena/Loading Graphics/level arena 01",
            "Level/Shop/Loading Graphics/level shop 01",
            "Level/Lobby/Start Room/Start Room - Lobby",
        ],
    )

    assert discover_map_families(catalog) == ("Arctic", "Manor", "Museum", "Wizard")


def test_unknown_future_map_is_discovered_without_hardcoding(tmp_path: Path):
    catalog = tmp_path / "catalog.json"
    _write_catalog(
        catalog,
        [
            "Level/Manor/Loading Graphics/level manor 01",
            "Level/Hospital/Loading Graphics/level hospital 01",
        ],
    )

    result = load_map_catalog(catalog)
    by_internal_name = {game_map.internal_name: game_map for game_map in result.maps}

    assert by_internal_name["Manor"].display_name == "Headman Manor"
    assert by_internal_name["Manor"].known_label is True
    assert by_internal_name["Hospital"].display_name == "Hospital"
    assert by_internal_name["Hospital"].known_label is False


def test_known_map_labels_are_presentation_metadata_only():
    assert get_map_display_name("Arctic") == "McJannek Station"
    assert get_map_display_name("UnknownFutureMap") == "UnknownFutureMap"


def test_explicit_game_directory_finds_catalog(tmp_path: Path):
    catalog = tmp_path / "REPO_Data/StreamingAssets/aa/catalog.json"
    _write_catalog(catalog, ["Level/Wizard/Loading Graphics/level wizard 01"])

    assert find_installed_catalog(tmp_path) == catalog
    result = discover_installed_maps(tmp_path)

    assert result is not None
    assert [game_map.internal_name for game_map in result.maps] == ["Wizard"]


def test_invalid_catalog_reports_discovery_error(tmp_path: Path):
    catalog = tmp_path / "catalog.json"
    catalog.write_text('{"m_KeyDataString":"not base64***"}', encoding="utf-8")

    with pytest.raises(MapDiscoveryError, match="invalid base64"):
        discover_map_families(catalog)
