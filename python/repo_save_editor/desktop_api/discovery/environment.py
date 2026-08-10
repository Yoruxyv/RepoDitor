"""Renderer-safe adaptation of Python environment discovery results."""

from __future__ import annotations

from repo_save_editor.services.game.discovery import (
    GameDiscoveryResult,
    discover_game_installation,
)
from repo_save_editor.services.saves.discovery import (
    SaveDiscoveryResult,
    discover_saves,
)


def serialize_environment(
    save_result: SaveDiscoveryResult,
    game_result: GameDiscoveryResult,
) -> dict[str, object]:
    """Adapt domain discovery results to the desktop process protocol."""
    installation = game_result.installation
    return {
        "ok": True,
        "saveRoot": str(save_result.root),
        "saveRootStatus": save_result.status.value,
        "saveRootDetected": save_result.root_detected,
        "saveCount": len(save_result.saves),
        "skippedSaveEntries": len(save_result.skipped_entries),
        "saves": [
            {
                "id": save.identifier,
                "displayName": save.display_name,
                "path": str(save.path),
                "lastModified": save.modified_at.isoformat(),
                "fileSize": save.file_size,
            }
            for save in save_result.saves
        ],
        "gameStatus": game_result.status.value,
        "gameDetected": game_result.game_detected,
        "gameRoot": None if installation is None else str(installation.root),
        "gameCatalogPath": None if installation is None else str(installation.catalog_path),
        "steamLibraryRoots": [str(path) for path in game_result.library_roots],
        "gameDiscoveryIssues": [
            {
                "code": issue.code.value,
                "path": str(issue.path),
            }
            for issue in game_result.issues
        ],
    }


def discover_environment() -> dict[str, object]:
    """Discover local saves and the validated R.E.P.O. installation."""
    return serialize_environment(
        discover_saves(),
        discover_game_installation(),
    )
