from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Never, Self
from urllib.error import URLError
from urllib.request import Request

import pytest

from repo_save_editor.services.game import installed_build
from tools.capabilities import steam_monitor as monitor
from tools.capabilities.schema import CapabilityDataError

CHECKED_AT = "2026-11-08T06:00:00+00:00"
REVIEWED_WRITE_BUILD = "26813769"
EARLIER_REVIEWED_WRITE_BUILD = "26732417"
NEW_BUILD = "26813770"


def metadata(
    build: str = REVIEWED_WRITE_BUILD,
    *,
    app: str = monitor.APP_ID,
    branch: str = "public",
) -> bytes:
    return (
        f'Console startup\n"{app}"\n{{\n"depots" {{ "branches" {{ '
        f'"{branch}" {{ "buildid" "{build}" }} '
        '"private-beta" { "buildid" "99999999" } } } }\nUnloading Steam API...OK\n'
    ).encode()


@pytest.mark.parametrize(
    ("build", "state"),
    [
        (REVIEWED_WRITE_BUILD, "UNCHANGED"),
        (EARLIER_REVIEWED_WRITE_BUILD, "UNCHANGED"),
        (NEW_BUILD, "CHANGED"),
        (monitor.REVIEWED_ARTWORK_BUILD, "CHANGED"),
    ],
)
def test_only_exact_public_branch_is_compared_to_the_write_review(build: str, state: str) -> None:
    result = monitor.observe(metadata(build))
    assert result["state"] == state
    assert result["build"] == build
    assert (
        result["reviewedWriteBuilds"] == f"{EARLIER_REVIEWED_WRITE_BUILD}, {REVIEWED_WRITE_BUILD}"
    )
    assert result["reviewedArtworkBuild"] == monitor.REVIEWED_ARTWORK_BUILD
    assert "anonymous" in result["source"]
    assert result["checkedAt"].endswith("+00:00")


def test_monitor_baseline_tracks_the_latest_artwork_review_without_changing_admission() -> None:
    assert (
        max(installed_build._UNITY6_ARTWORK_ASSEMBLIES, key=int) == monitor.REVIEWED_ARTWORK_BUILD
    )
    assert installed_build.artwork_assembly_sha256(monitor.REVIEWED_ARTWORK_BUILD) is not None
    assert monitor.REVIEWED_ARTWORK_BUILD != installed_build.VALIDATED_BUILD_ID


@pytest.mark.parametrize(
    "payload",
    [
        b"ERROR! private network details",
        metadata(app="123"),
        metadata(branch="beta"),
        metadata()[:-50],
        metadata() + b'"another" {}',
        metadata() + metadata(),
        metadata().replace(b'"buildid"', b'"buildid" "1" "buildid"', 1),
        metadata().replace(b'"public"', b'"Public" {} "public"', 1),
        metadata().replace(b'"buildid"', b'"pwdrequired" "1" "buildid"', 1),
        metadata().replace(b'"buildid"', b'"bad\\q" "oops" "buildid"', 1),
        b"\xff" + metadata(),
        b"x" * (monitor.MAX_BYTES + 1),
        b'"3241660" {' + b'"nested" {' * 17 + b"}" * 18,
    ],
    ids=lambda _payload: "invalid-metadata",
)
def test_invalid_incomplete_ambiguous_or_wrong_branch_metadata_is_unknown(payload: bytes) -> None:
    result = monitor.observe(payload)
    assert result["state"] == "UNKNOWN"
    assert result["failure"] == "metadata"
    assert result["build"] == ""
    assert "private" not in json.dumps(result)


@pytest.mark.parametrize(
    "build", ["", "0", "-1", "1.5", "true", "4294967296", "\uff10\uff10\uff11", "01"]
)
def test_invalid_build_numbers_never_trigger_review(build: str) -> None:
    assert monitor.observe(metadata(build))["state"] == "UNKNOWN"


def test_console_footer_buffering_does_not_turn_valid_metadata_into_a_failure() -> None:
    payload = metadata() + (
        b"Redirecting stderr to '/tmp/steam/logs/stderr.txt'\n"
        b"Logging directory: '/tmp/steam/logs'\n"
        b"[  0%] Checking for available updates...\n[----] Verifying installation...\n"
    )
    assert monitor.observe(payload)["state"] == "UNCHANGED"


def test_cold_steamcmd_probe_accepts_interleaved_shutdown_and_bootstrap_output() -> None:
    # A fresh Valve client printed these lines after the public BuildID record.
    payload = metadata(NEW_BUILD).removesuffix(b"Unloading Steam API...OK\n") + (
        b"Unloading Steam API...CWorkThreadPool::~CWorkThreadPool: work complete queue not empty, "
        b"1 items discarded.\r\n"
        b"OK\r\n"
        b"CWorkThreadPool::~CWorkThreadPool: work processing queue not empty: 2 items discarded.\r\n"
        b"87 of 30,203 KB)...\r\n"
        b'ILocalize::AddFile() failed to load file "public/steambootstrapper_english.txt".\r\n'
    )
    report = monitor.observe(payload)
    assert (report["state"], report["build"]) == ("CHANGED", NEW_BUILD)
    assert monitor.observe(payload + b'"another" {}')["failure"] == "metadata"


def test_unexpected_trailer_preview_redacts_paths_arguments_and_identifiers() -> None:
    result = monitor.observe(
        metadata() + b"Unknown Steam line '/tmp/private' https://example.test "
        b"token=private 012345678901234567890123456789"
    )
    assert result["failure"] == "metadata"
    assert "Unknown Steam line" in result["reason"]
    assert "private" not in result["reason"]
    assert "example.test" not in result["reason"]
    assert "0123456789" not in result["reason"]


@pytest.mark.parametrize(
    ("payload", "client_exit", "failure", "reason"),
    [
        (b"", 0, "unavailable", "did not return"),
        (
            b"Connecting anonymously to Steam Public...FAILED (No Connection)\n",
            0,
            "unavailable",
            "did not return",
        ),
        (b"No app info for AppID 3241660\n", 0, "unavailable", "did not return"),
        (b"[----] Checking for updates...", 124, "unavailable", "deadline"),
        (b"ERROR! private transport detail", 1, "client", "status 1"),
        (b"unexpected nonempty console record", 0, "metadata", "app identity"),
        (metadata(app="123") + b"No app info for AppID 3241660\n", 0, "metadata", "app identity"),
        (b' "3241660" {\nNo app info for AppID 3241660\n', 0, "metadata", "app identity"),
    ],
)
def test_detect_only_allows_unavailable_observations_when_requested(
    payload: bytes,
    client_exit: int,
    failure: str,
    reason: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    capture = tmp_path / "metadata.log"
    capture.write_bytes(payload)
    args = ["monitor", "detect", str(capture), "--client-exit", str(client_exit)]
    for extra in ([], ["--allow-unavailable"]):
        monkeypatch.setattr("sys.argv", args + extra)
        assert monitor.main() == (0 if extra and failure == "unavailable" else 1)
        report = json.loads(capsys.readouterr().out)
        assert report["state"] == "UNKNOWN"
        assert report["build"] == ""
        assert report["failure"] == failure
        assert reason in report["reason"]
        assert report["clientExitCode"] == str(client_exit)
        assert report["metadataBytes"] == str(len(payload))
        assert "private" not in json.dumps(report)


def test_excessive_metadata_tokens_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(monitor, "MAX_TOKENS", 5)
    assert monitor.observe(metadata())["state"] == "UNKNOWN"


class IssueFixture:
    def __init__(self) -> None:
        self.issues: list[dict[str, object]] = []
        self.calls: list[tuple[str, str, dict[str, object] | None]] = []
        self.lose_response = False

    def request(self, method: str, path: str, payload: dict[str, object] | None) -> object:
        self.calls.append((method, path, payload))
        if method == "GET":
            return self.issues
        assert payload is not None
        if method == "POST":
            issue = {
                **payload,
                "number": 7,
                "state": "open",
                "user": {"login": "github-actions[bot]"},
            }
            self.issues.append(issue)
            if self.lose_response:
                raise URLError("private transport detail")
            return issue
        assert method == "PATCH"
        assert path == "/issues/7"
        self.issues[0].update(payload)
        return self.issues[0]


@pytest.mark.parametrize("build", [EARLIER_REVIEWED_WRITE_BUILD, REVIEWED_WRITE_BUILD])
def test_reviewed_build_never_requests_issue_write_authority(build: str) -> None:
    def forbidden(*_args: object) -> object:
        pytest.fail("Unchanged metadata attempted a GitHub request")

    assert monitor.notify(build, CHECKED_AT, forbidden) == "UNCHANGED"


def test_invalid_write_review_cannot_generate_a_build_notification(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    def unavailable() -> Never:
        raise CapabilityDataError("Stale review")

    monkeypatch.setattr(monitor, "read_review", unavailable)
    capture = tmp_path / "metadata.log"
    capture.write_bytes(b"")
    monkeypatch.setattr("sys.argv", ["monitor", "detect", str(capture), "--allow-unavailable"])
    assert monitor.main() == 1
    report = json.loads(capsys.readouterr().out)
    assert (report["state"], report["failure"], report["build"]) == ("UNKNOWN", "review", "")
    with pytest.raises(CapabilityDataError):
        monitor.notify(NEW_BUILD, CHECKED_AT, IssueFixture().request)


def test_one_issue_is_created_deduplicated_updated_and_reopened_with_human_notes_preserved() -> (
    None
):
    github = IssueFixture()
    observation = monitor.observe(metadata(NEW_BUILD))
    assert observation["state"] == "CHANGED"
    assert (
        monitor.notify(observation["build"], observation["checkedAt"], github.request) == "CREATED"
    )
    body = github.issues[0]["body"]
    assert isinstance(body, str)
    assert NEW_BUILD in body
    assert (
        f"Reviewed write builds: `{EARLIER_REVIEWED_WRITE_BUILD}`, `{REVIEWED_WRITE_BUILD}`" in body
    )
    assert monitor.REVIEWED_ARTWORK_BUILD in body
    assert "not artwork or save-mutation approval" in body
    assert observation["checkedAt"] in body
    github.issues[0]["body"] = "Human introduction\n" + body + "\nHuman notes"
    github.issues[0]["state"] = "closed"
    assert monitor.notify(NEW_BUILD, CHECKED_AT, github.request) == "ALREADY_NOTIFIED"
    assert github.issues[0]["state"] == "closed"
    assert monitor.notify("26407091", CHECKED_AT, github.request) == "UPDATED"
    assert len(github.issues) == 1
    assert github.issues[0].get("state") == "open"
    updated_body = github.issues[0]["body"]
    assert isinstance(updated_body, str)
    assert updated_body.startswith("Human introduction\n")
    assert updated_body.endswith("\nHuman notes")
    assert sum(method == "POST" for method, _, _ in github.calls) == 1
    assert sum(method == "PATCH" for method, _, _ in github.calls) == 1


def test_existing_artwork_monitor_issue_deduplicates_the_same_build() -> None:
    github = IssueFixture()
    github.issues.append(
        {
            "number": 7,
            "title": monitor.ISSUE_TITLE,
            "body": f"{monitor.START}\n<!-- public-build:{NEW_BUILD};reviewed-artwork:26407089 -->\n{monitor.END}",
            "state": "closed",
            "user": {"login": "github-actions[bot]"},
        }
    )
    assert monitor.notify(NEW_BUILD, CHECKED_AT, github.request) == "ALREADY_NOTIFIED"
    assert [method for method, _, _ in github.calls] == ["GET"]


def test_lost_creation_response_does_not_duplicate_the_next_notification() -> None:
    github = IssueFixture()
    github.lose_response = True
    with pytest.raises(URLError):
        monitor.notify(NEW_BUILD, CHECKED_AT, github.request)
    assert monitor.notify(NEW_BUILD, CHECKED_AT, github.request) == "ALREADY_NOTIFIED"
    assert len(github.issues) == 1


def test_foreign_issues_cannot_claim_the_monitor_identity() -> None:
    github = IssueFixture()
    github.issues.append(
        {"title": monitor.ISSUE_TITLE, "body": monitor.START, "user": {"login": "someone"}}
    )
    assert monitor.notify(NEW_BUILD, CHECKED_AT, github.request) == "CREATED"


@pytest.mark.parametrize("kind", ["duplicate", "missing_end", "invalid_number", "invalid_state"])
def test_ambiguous_or_damaged_existing_issue_fails_closed_without_writing(kind: str) -> None:
    github = IssueFixture()
    monitor.notify(NEW_BUILD, CHECKED_AT, github.request)
    if kind == "duplicate":
        github.issues.append(github.issues[0].copy())
    elif kind == "missing_end":
        github.issues[0]["body"] = monitor.START
    elif kind == "invalid_number":
        github.issues[0]["number"] = True
    else:
        github.issues[0]["state"] = "unknown"
    github.calls.clear()
    with pytest.raises(ValueError, match="compatibility review issue"):
        monitor.notify("26407091", CHECKED_AT, github.request)
    assert all(method == "GET" for method, _, _ in github.calls)


def test_issue_deduplication_scan_has_a_finite_page_budget() -> None:
    calls: list[tuple[str, str]] = []

    def full_page(method: str, path: str, _payload: dict[str, object] | None) -> object:
        calls.append((method, path))
        return [{}] * 100

    with pytest.raises(ValueError, match="bounded"):
        monitor.notify(NEW_BUILD, CHECKED_AT, full_page)
    assert len(calls) == 3
    assert all(method == "GET" for method, _ in calls)


@pytest.mark.parametrize(
    "timestamp", ["private", "2026-11-08T06:00:00", "2026-11-08T06:00:00+01:00"]
)
def test_invalid_timestamps_cannot_be_interpolated_into_issue_content(timestamp: str) -> None:
    github = IssueFixture()
    with pytest.raises(ValueError, match=r"timestamp|isoformat"):
        monitor.notify(NEW_BUILD, timestamp, github.request)
    assert not github.calls


def test_network_failure_is_unknown_and_sanitized_at_the_cli(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.argv", ["monitor", "notify", NEW_BUILD, CHECKED_AT])

    def offline(*_args: object) -> str:
        raise URLError("private token or profile detail")

    monkeypatch.setattr(monitor, "notify", offline)
    assert monitor.main() == 1
    report = json.loads(capsys.readouterr().out)
    assert report["state"] == "UNKNOWN"
    assert "private" not in json.dumps(report)


@pytest.mark.parametrize("oversized", [False, True])
def test_github_transport_keeps_credentials_on_the_fixed_host_and_bounds_responses(
    monkeypatch: pytest.MonkeyPatch, oversized: bool
) -> None:
    calls: list[Request] = []

    class Response:
        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self, limit: int) -> bytes:
            assert limit == monitor.MAX_BYTES + 1
            return b"x" * limit if oversized else b"[]"

    def open_request(request: Request, *, timeout: int) -> Response:
        calls.append(request)
        assert request.full_url == "https://api.github.com/repos/Yoruxyv/RepoDitor/issues"
        assert timeout == 10
        return Response()

    monkeypatch.setenv("GITHUB_TOKEN", "synthetic-test-credential")
    monkeypatch.setattr(
        monitor, "build_opener", lambda _handler: SimpleNamespace(open=open_request)
    )
    if oversized:
        with pytest.raises(ValueError, match="byte limit"):
            monitor._github("GET", "/issues", None)
    else:
        assert monitor._github("GET", "/issues", None) == []
    assert len(calls) == 1
    redirect: Callable[..., object] = monitor._NoRedirect().redirect_request
    assert redirect(None, None, 302, "", {}, "https://example.com") is None


def test_missing_capture_or_credentials_remain_unknown_without_a_notification(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "sys.argv", ["monitor", "detect", str(tmp_path / "missing.log"), "--allow-unavailable"]
    )
    assert monitor.main() == 1
    report = json.loads(capsys.readouterr().out)
    assert (report["state"], report["failure"]) == ("UNKNOWN", "capture")
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    with pytest.raises(ValueError, match="credentials"):
        monitor._github("GET", "/issues", None)


@pytest.mark.parametrize("response", [{}, [None]])
def test_invalid_issue_responses_cannot_start_a_write(response: object) -> None:
    calls: list[tuple[str, str]] = []

    def invalid(method: str, path: str, _payload: dict[str, object] | None) -> object:
        calls.append((method, path))
        return response

    with pytest.raises((ValueError, TypeError), match="Invalid GitHub issue"):
        monitor.notify(NEW_BUILD, CHECKED_AT, invalid)
    assert len(calls) == 1
    assert calls[0][0] == "GET"
