import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_scope import desktop_scope


class DesktopScopeTests(unittest.TestCase):
    def test_documentation_and_independent_web_changes_skip_desktop(self) -> None:
        paths = [
            b"README.md",
            b"README.id.md",
            b"docs/maintenance/changes.md",
            b"web/src/app/new.ts",
            b".github/workflows/web.yml",
            b".github/links/report.py",
        ]
        for event in ("pull_request", "push"):
            with self.subTest(event=event):
                self.expect_scope(self.requirement(event, paths), False)

    def test_any_desktop_shared_or_unknown_file_requires_desktop(self) -> None:
        for path in (
            b"desktop/src-tauri/src/main.rs",
            b"desktop/python/repo_save_editor/services/game/write_evidence.py",
            b"desktop/installer/host/InstallerEngine.cs",
            b"compatibility/fixture.json",
            b"tools/capabilities/evidence/web-desktop-review.v1.json",
            b"web/src/features/cosmetics/known-cosmetics.v1.json",
            b"web/src/features/recharge/recharge-capabilities.v1.json",
            b"pyproject.toml",
            b"uv.lock",
            b"THIRD_PARTY_NOTICES.md",
            b".github/workflows/quality.yml",
            b".github/workflows/desktop-scope.yml",
            b".github/workflows/installer-lifecycle.yml",
            b".github/workflows/release.yml",
            b".github/scripts/desktop_scope.py",
            b"new-shared-config.json",
        ):
            with self.subTest(path=path):
                self.expect_scope(
                    self.requirement("pull_request", [b"web/src/index.ts", path]), True
                )

    def test_manual_dispatch_keeps_desktop_validation_without_a_diff(self) -> None:
        with patch("desktop_scope.subprocess.run") as git:
            self.expect_scope(desktop_scope("workflow_dispatch", "")[0], True)
            self.expect_scope(desktop_scope("workflow_call", "")[0], True)
            git.assert_not_called()

    def test_unavailable_or_empty_comparison_keeps_desktop_validation(self) -> None:
        with patch(
            "desktop_scope.subprocess.run", side_effect=subprocess.TimeoutExpired("git", 30)
        ):
            self.expect_scope(desktop_scope("push", "a" * 40)[0], True)
        self.expect_scope(desktop_scope("push", "0" * 40)[0], True)
        self.expect_scope(self.requirement("push", []), True)

    def test_move_from_desktop_into_web_includes_the_deleted_desktop_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            original = Path.cwd()
            try:
                os.chdir(tmp)
                self.git("init", "-q")
                Path("desktop").mkdir()
                Path("desktop/source.txt").write_text("same content", encoding="utf-8")
                self.git("add", ".")
                self.commit("base")
                base = self.git("rev-parse", "HEAD").strip()
                Path("web").mkdir()
                self.git("mv", "desktop/source.txt", "web/source.txt")
                self.commit("move")
                self.expect_scope(desktop_scope("pull_request", base)[0], True)
            finally:
                os.chdir(original)

    def git(self, *args: str) -> str:
        git = shutil.which("git")
        if not git:
            self.fail("Git is required to create the temporary repository.")
        # All arguments are fixed fixture literals. The command runs without a shell.
        return subprocess.run(  # noqa: S603
            [str(Path(git).resolve()), *args],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
            timeout=30,
        ).stdout

    def commit(self, title: str) -> None:
        self.git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--no-gpg-sign",
            "-qm",
            title,
        )

    def requirement(self, event: str, paths: list[bytes]) -> bool:
        output = b"".join(path + b"\0" for path in paths)
        with patch(
            "desktop_scope.subprocess.run", return_value=subprocess.CompletedProcess([], 0, output)
        ):
            return desktop_scope(event, "a" * 40)[0]

    def expect_scope(self, actual: bool, expected: bool) -> None:
        if actual is not expected:
            self.fail(f"Desktop scope returned {actual}. Expected {expected}.")
