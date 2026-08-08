"""Optional public Steam profile lookup for player avatars."""

from __future__ import annotations

from collections.abc import Callable
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree

STEAM_ID64_MIN = 76_561_197_960_265_728
STEAM_ID64_MAX = STEAM_ID64_MIN + 2**32 - 1
STEAM_AVATAR_HOSTS = frozenset(
    {
        "avatars.akamai.steamstatic.com",
        "avatars.fastly.steamstatic.com",
    }
)
MAX_PROFILE_BYTES = 256 * 1024


def is_plausible_steam_id(player_id: str) -> bool:
    """Return whether a save player ID can represent an individual Steam account."""
    return (
        len(player_id) == 17
        and player_id.isascii()
        and player_id.isdigit()
        and (STEAM_ID64_MIN <= int(player_id) <= STEAM_ID64_MAX)
    )


def _fetch_profile(url: str, timeout: float) -> bytes:
    request = Request(url, headers={"User-Agent": "RepoDitor/0.1"})
    with urlopen(request, timeout=timeout) as response:
        body = response.read(MAX_PROFILE_BYTES + 1)
    if len(body) > MAX_PROFILE_BYTES:
        raise ValueError("Steam profile response exceeded the size limit.")
    return body


def get_steam_avatar_url(
    player_id: str,
    *,
    timeout: float = 1.5,
    fetch_profile: Callable[[str, float], bytes] = _fetch_profile,
) -> str | None:
    """Return a safe public avatar URL, or ``None`` for any expected lookup failure."""
    if not is_plausible_steam_id(player_id):
        return None

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
            return None
        return avatar_url
    except (ElementTree.ParseError, OSError, TimeoutError, ValueError):
        return None
