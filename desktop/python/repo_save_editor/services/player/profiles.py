"""Optional public Steam profile lookup for player avatars."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from math import ceil
from typing import Literal, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from defusedxml import ElementTree

STEAM_ID64_MIN = 76_561_197_960_265_728
STEAM_ID64_MAX = STEAM_ID64_MIN + 2**32 - 1
STEAM_AVATAR_HOSTS = frozenset(
    {
        "avatars.akamai.steamstatic.com",
        "avatars.fastly.steamstatic.com",
    }
)
MAX_PROFILE_BYTES = 256 * 1024


@dataclass(frozen=True, slots=True)
class SteamAvatar:
    """Optional presentation result with a finite, sanitized retry policy."""

    url: str | None = None
    status: Literal["available", "unavailable", "transient"] = "unavailable"
    retry_after_ms: int | None = None


class _NoProfileRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args: object, **_kwargs: object) -> None:
        # The fixed profile endpoint needs no redirect; never expand its network scope.
        return None


def _retry_delay(value: str | None) -> int | None:
    if not value:
        return 60_000
    if len(value) > 128:
        return None
    try:
        seconds = (
            int(value)
            if value.isascii() and value.isdecimal()
            else ceil((parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds())
        )
    except (ValueError, TypeError, OverflowError):
        return 60_000
    # A server delay beyond our five-minute workspace budget forbids automatic retry.
    if seconds > 300:
        return None
    return max(30, seconds) * 1000 if seconds > 0 else 60_000


def is_plausible_steam_id(player_id: str) -> bool:
    """Return whether a save player ID can represent an individual Steam account."""
    return (
        len(player_id) == 17
        and player_id.isascii()
        and player_id.isdigit()
        and (STEAM_ID64_MIN <= int(player_id) <= STEAM_ID64_MAX)
    )


def _fetch_profile(url: str, timeout: float) -> bytes:
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "steamcommunity.com"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
    ):
        raise ValueError("Steam profile URL is not allowed.")

    # Ruff cannot infer the explicit HTTPS/host allowlist above.
    request = Request(  # noqa: S310
        url,
        headers={"User-Agent": "RepoDitor/0.1"},
    )
    with build_opener(_NoProfileRedirect()).open(request, timeout=timeout) as response:
        body = cast(bytes, response.read(MAX_PROFILE_BYTES + 1))

    if len(body) > MAX_PROFILE_BYTES:
        raise ValueError("Steam profile response exceeded the size limit.")
    return body


def get_steam_avatar(
    player_id: str,
    *,
    timeout: float = 1.5,
    fetch_profile: Callable[[str, float], bytes] = _fetch_profile,
) -> SteamAvatar:
    """Resolve one optional, allowlisted public Steam avatar URL.

    Args:
        player_id: Save-derived account identifier.
        timeout: Maximum profile-request duration in seconds.
        fetch_profile: Injectable bounded profile loader used by tests.

    Returns:
        A validated optional URL and sanitized retry information. Unavailable or
        invalid profiles never request retry; transient transport failures may.
    """
    if not is_plausible_steam_id(player_id):
        return SteamAvatar()

    profile_url = f"https://steamcommunity.com/profiles/{player_id}/?xml=1"
    try:
        root = ElementTree.fromstring(fetch_profile(profile_url, timeout))
        avatar_url = (root.findtext("avatarMedium") or "").strip()
        parsed = urlparse(avatar_url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in STEAM_AVATAR_HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
        ):
            return SteamAvatar()
        return SteamAvatar(avatar_url, "available")
    except HTTPError as error:
        if error.code in (408, 429) or 500 <= error.code <= 599:
            return SteamAvatar(
                None,
                "transient",
                _retry_delay(error.headers.get("Retry-After") if error.headers else None),
            )
        return SteamAvatar()
    except (TimeoutError, URLError, ConnectionError):
        return SteamAvatar(None, "transient", 60_000)
    # Avatar enrichment is optional: no remote response or parser failure may
    # terminate the desktop command and prevent the Players view from loading.
    except Exception:  # noqa: BLE001
        return SteamAvatar()


def get_steam_avatar_url(
    player_id: str,
    *,
    timeout: float = 1.5,
    fetch_profile: Callable[[str, float], bytes] = _fetch_profile,
) -> str | None:
    """Preserve the URL-only optional lookup contract for existing callers."""
    return get_steam_avatar(player_id, timeout=timeout, fetch_profile=fetch_profile).url
