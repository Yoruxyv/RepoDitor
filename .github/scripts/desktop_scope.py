"""Decide whether the checked-out tree needs Desktop CI."""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

_INDEPENDENT_FILES = {
    b".github/workflows/links.yml",
    b".github/workflows/steam-build-monitor.yml",
    b".github/workflows/web.yml",
    b"CODE_OF_CONDUCT.md",
    b"CONTRIBUTING.md",
    b"SECURITY.md",
}
_SHARED_WEB_SNAPSHOTS = {
    b"web/src/features/cosmetics/known-cosmetics.v1.json",
    b"web/src/features/recharge/recharge-capabilities.v1.json",
}


def _independent(path: bytes) -> bool:
    return (
        path in _INDEPENDENT_FILES
        or path.startswith(b".github/links/")
        or (path.startswith(b"web/") and path not in _SHARED_WEB_SNAPSHOTS)
        or (path.startswith(b"docs/") and path.endswith(b".md"))
        or (b"/" not in path and path.startswith(b"README.") and path.endswith(b".md"))
    )


def desktop_scope(event: str, base: str) -> tuple[bool, str]:
    if event not in {"pull_request", "push"}:
        return True, "Full Desktop validation for manual or reusable runs."
    if re.fullmatch(r"[0-9a-f]{40}", base) is None or base == "0" * 40:
        return True, "No usable comparison base. Running full Desktop validation."
    git = shutil.which("git")
    if not git:
        return True, "Git unavailable. Running full Desktop validation."
    try:
        # The only input argument is a validated hexadecimal object ID, passed without a shell.
        changed = subprocess.run(  # noqa: S603
            [
                str(Path(git).resolve()),
                "diff",
                "--no-renames",
                "--name-only",
                "-z",
                base,
                "HEAD",
                "--",
            ],
            check=True,
            stdout=subprocess.PIPE,
            timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return True, "Comparison unavailable. Running full Desktop validation."
    paths = changed.split(b"\0")[:-1]
    if not paths or any(not _independent(path) for path in paths):
        return True, "Desktop, shared, or unclassified changes require Desktop validation."
    return False, "Only independent Web or documentation changes. Desktop jobs are out of scope."


if __name__ == "__main__":
    required, reason = desktop_scope(os.environ["GITHUB_EVENT_NAME"], os.environ["BASE_SHA"])
    sys.stdout.write(f"{reason}\n")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write(f"desktop={str(required).lower()}\n")
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as summary:
        summary.write(f"{reason}\n")
