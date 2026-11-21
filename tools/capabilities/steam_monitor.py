"""Observe Steam's public build and maintain one review issue; never approve compatibility."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

APP_ID = "3241660"
# Independent artwork review baseline; tests require it to match the admitted artwork builds.
REVIEWED_ARTWORK_BUILD = "26407089"
SOURCE = "Valve SteamCMD: depots.branches.public.buildid (anonymous, metadata only)"
MAX_BYTES = 1024 * 1024
MAX_TOKENS = 20_000
ISSUE_TITLE = "R.E.P.O. public Steam build compatibility review"
START = "<!-- repoditor-steam-public-monitor:start -->"
END = "<!-- repoditor-steam-public-monitor:end -->"
TOKEN = re.compile(r'\s*("(?:[^"\\]|\\.)*"|[{}])')
CONSOLE_LINE = re.compile(
    r"(?:Unloading Steam API\.\.\.OK|(?:Redirecting stderr to|Logging directory:) '[^\r\n]*'|"
    r"\[(?:\s*[0-9]{1,3}%|----)\] [^\r\n]*)"
)
GitHubRequest = Callable[[str, str, dict[str, object] | None], object]


def _build_id(value: object) -> str:
    if (
        not isinstance(value, str)
        or re.fullmatch(r"[1-9][0-9]{0,9}", value) is None
        or int(value) > 0xFFFFFFFF
    ):
        raise ValueError("Invalid Steam build identity.")
    return value


def _fields(tokens: Iterator[str]) -> dict[str, object]:
    fields: dict[str, object] = {}
    seen: set[str] = set()
    for key in tokens:
        if key == "}":
            return fields
        if not key.startswith('"'):
            raise ValueError("Invalid Steam metadata key.")
        name = json.loads(key)
        if name.casefold() in seen:
            raise ValueError("Repeated Steam metadata key.")
        seen.add(name.casefold())
        value = next(tokens)
        if value == "{":
            fields[name] = _fields(tokens)
        elif value.startswith('"'):
            fields[name] = json.loads(value)
        else:
            raise ValueError("Invalid Steam metadata value.")
    raise ValueError("Incomplete Steam metadata.")


def public_build(payload: bytes) -> str:
    """Read only the exact app/public branch from bounded SteamCMD KeyValues output."""
    if len(payload) > MAX_BYTES:
        raise ValueError("Steam metadata exceeds the byte limit.")
    text = payload.decode("utf-8", errors="strict")
    headers = list(re.finditer(r'(?m)^"([0-9]+)"\s*\{', text))
    if len(headers) != 1 or headers[0][1] != APP_ID:
        raise ValueError("Steam metadata app identity is missing or ambiguous.")
    position = headers[0].end()
    depth = 1
    tokens: list[str] = []
    while depth:
        match = TOKEN.match(text, position)
        if match is None or len(tokens) >= MAX_TOKENS:
            raise ValueError("Invalid or excessive Steam metadata tokens.")
        lexeme = match[1]
        depth += int(lexeme == "{") - int(lexeme == "}")
        if depth > 16:
            raise ValueError("Steam metadata exceeds the nesting limit.")
        tokens.append(lexeme)
        position = match.end()
    if any(
        CONSOLE_LINE.fullmatch(line.strip()) is None
        for line in text[position:].splitlines()
        if line.strip()
    ):
        raise ValueError("Unexpected trailing Steam metadata.")
    value: object = _fields(iter(tokens))
    for field in ("depots", "branches", "public"):
        if not isinstance(value, dict) or field not in value:
            raise ValueError("Steam public branch is unavailable.")
        value = value[field]
    if not isinstance(value, dict) or value.get("pwdrequired", "0") != "0":
        raise ValueError("Steam public branch is unavailable.")
    return _build_id(value.get("buildid"))


def observe(payload: bytes) -> dict[str, str]:
    """Report UNKNOWN on invalid metadata without implying compatibility or an update."""
    report = {
        "state": "UNKNOWN",
        "build": "",
        "reviewedBuild": REVIEWED_ARTWORK_BUILD,
        "checkedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": SOURCE,
    }
    try:
        report["build"] = public_build(payload)
    except (ValueError, UnicodeError, StopIteration):
        report["reason"] = "Steam public metadata is unavailable or invalid."
        return report
    report["state"] = "UNCHANGED" if report["build"] == REVIEWED_ARTWORK_BUILD else "CHANGED"
    return report


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args: object, **_kwargs: object) -> None:
        return None


def _github(method: str, path: str, payload: dict[str, object] | None) -> object:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("GitHub notification credentials are unavailable.")
    request = Request(
        "https://api.github.com/repos/Yoruxyv/RepoDitor" + path,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "RepoDitor-Steam-build-monitor",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with build_opener(_NoRedirect()).open(request, timeout=10) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("GitHub response exceeds the byte limit.")
    result: object = json.loads(body)
    return result


def _existing_issue(request: GitHubRequest) -> dict[str, object] | None:
    candidates: list[dict[str, object]] = []
    for page in range(1, 4):
        issues = request("GET", f"/issues?state=all&per_page=100&page={page}", None)
        if not isinstance(issues, list) or len(issues) > 100:
            raise ValueError("Invalid GitHub issue response.")
        for issue in issues:
            if not isinstance(issue, dict):
                raise TypeError("Invalid GitHub issue entry.")
            if (
                "pull_request" not in issue
                and issue.get("title") == ISSUE_TITLE
                and isinstance(issue.get("user"), dict)
                and issue["user"].get("login") == "github-actions[bot]"
                and isinstance(issue.get("body"), str)
                and START in issue["body"]
            ):
                candidates.append(issue)
        if len(issues) < 100:
            break
    else:
        raise ValueError("Issue history exceeds the bounded deduplication scan.")
    if len(candidates) > 1:
        raise ValueError("Ambiguous compatibility review issues.")
    return candidates[0] if candidates else None


def notify(build: str, checked_at: str, request: GitHubRequest = _github) -> str:
    """Create/update one bot-owned issue block, without repeating an observed notification."""
    _build_id(build)
    checked = datetime.fromisoformat(checked_at)
    if checked.tzinfo is None or checked.utcoffset() != UTC.utcoffset(checked):
        raise ValueError("Invalid observation timestamp.")
    if build == REVIEWED_ARTWORK_BUILD:
        return "UNCHANGED"
    marker = f"<!-- public-build:{build};reviewed-artwork:{REVIEWED_ARTWORK_BUILD} -->"
    block = f"""{START}
{marker}
Detected public Steam build: `{build}`
Latest independently reviewed artwork build: `{REVIEWED_ARTWORK_BUILD}`
Observed at: {checked.isoformat(timespec="seconds")}
Source: {SOURCE}

This is a compatibility-review notification, not artwork or save-mutation approval.

Local verification (read-only installed files; synthetic save tests only):
1. Verify the installed public appmanifest for app `{APP_ID}` and record its exact build.
2. Run `uv run --locked python -m tools.capabilities status --game-dir <game-root>`.
3. Follow [game-update verification](https://github.com/Yoruxyv/RepoDitor/blob/main/docs/maintenance/game-update-capabilities.md): verify source/assembly hashes, canonical artwork mappings and bounded decoding independently for Cosmetics, Upgrades/Items and Maps.
4. Run the synthetic artwork and save-safety regressions. Review mutation evidence separately; do not change allowlists or hashes automatically.
{END}"""
    issue = _existing_issue(request)
    if issue is None:
        request("POST", "/issues", {"title": ISSUE_TITLE, "body": block})
        return "CREATED"
    body = issue["body"]
    number = issue.get("number")
    if (
        not isinstance(body, str)
        or body.count(START) != 1
        or body.count(END) != 1
        or body.index(END) < body.index(START)
        or type(number) is not int
        or number <= 0
        or issue.get("state") not in ("open", "closed")
    ):
        raise ValueError("Invalid compatibility review issue.")
    before, _, remainder = body.partition(START)
    generated, _, after = remainder.partition(END)
    if marker in generated:
        return "ALREADY_NOTIFIED"
    request("PATCH", f"/issues/{number}", {"body": before + block + after, "state": "open"})
    return "UPDATED"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    detect = subparsers.add_parser("detect")
    detect.add_argument("metadata", type=Path)
    publish = subparsers.add_parser("notify")
    publish.add_argument("build")
    publish.add_argument("checked_at")
    args = parser.parse_args()
    try:
        if args.command == "detect":
            with args.metadata.open("rb") as handle:
                report = observe(handle.read(MAX_BYTES + 1))
        else:
            report = {"state": notify(args.build, args.checked_at)}
    except (OSError, URLError, ValueError, TypeError):
        report = {"state": "UNKNOWN", "reason": "Metadata or notification service is unavailable."}
    sys.stdout.write(json.dumps(report) + "\n")
    return int(report["state"] == "UNKNOWN")


if __name__ == "__main__":
    raise SystemExit(main())
