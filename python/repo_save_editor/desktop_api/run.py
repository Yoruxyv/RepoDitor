"""Renderer-safe run-state reads for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.desktop_api.saves import DesktopSaveError, _failure, load_discovered_save
from repo_save_editor.services.run import (
    RESUME_LOCATION_OPTIONS,
    get_available_run_stats,
    get_resume_location_label,
)


def get_run_state(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Return friendly run values without exposing raw save structure."""
    try:
        _, data, _ = load_discovered_save(save_id, root)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    resume_location = get_resume_location_label(data)
    options = list(RESUME_LOCATION_OPTIONS)
    if resume_location not in options:
        options.append(resume_location)

    return {
        "ok": True,
        "run": {
            "stats": [
                {"key": key, "label": label, "value": value}
                for label, key, value in get_available_run_stats(data)
            ],
            "resumeLocation": {
                "value": resume_location,
                "options": options,
            },
        },
    }
