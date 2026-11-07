"""Fail packaging when the frozen Python and compiled Rust fixture anchors disagree."""

import re
from pathlib import Path

from repo_save_editor.services.cosmetics.admission import fixture_manifest
from repo_save_editor.services.cosmetics.synthetic_fixture import PIN

ROOT = Path(__file__).resolve().parents[3]

fixture_manifest()
rust = (ROOT / "desktop/src-tauri/src/synthetic/meta_anchor.rs").read_text(encoding="utf-8")
match = re.search(r'pub const PIN: &str = "([0-9a-f]{64})";', rust)
if match is None or match.group(1) != PIN:
    raise SystemExit("MetaSave fixture anchors disagree; packaging refused.")
