"""Trusted local icon-cache roots for Electron main only."""

from __future__ import annotations

from repo_save_editor.services.icon_cache import get_icon_cache_roots


def get_icon_roots() -> dict[str, object]:
    """Return fixed optional icon roots without exposing them to the renderer."""
    roots = get_icon_cache_roots()
    return {
        "ok": True,
        "roots": (
            None if roots is None else {"item": str(roots.items), "cosmetic": str(roots.cosmetics)}
        ),
    }


__all__ = ["get_icon_roots"]
