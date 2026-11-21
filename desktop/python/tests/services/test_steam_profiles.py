from datetime import UTC, datetime, timedelta
from email.message import Message
from email.utils import format_datetime
from types import SimpleNamespace
from urllib.error import HTTPError, URLError

import pytest

from repo_save_editor.services.player import profiles
from repo_save_editor.services.player.profiles import (
    STEAM_AVATAR_HOSTS,
    _fetch_profile,
    get_steam_avatar,
    get_steam_avatar_url,
    is_plausible_steam_id,
)

STEAM_ID = "76561197960287930"
AVATAR_URL = "https://avatars.fastly.steamstatic.com/avatar.jpg"


def test_plausible_steam_id_range() -> None:
    assert is_plausible_steam_id(STEAM_ID)
    assert not is_plausible_steam_id("111")
    assert not is_plausible_steam_id("76561197960287930x")


def test_avatar_lookup_accepts_only_the_expected_https_host() -> None:
    def fetch_profile(url: str, timeout: float) -> bytes:
        assert url == f"https://steamcommunity.com/profiles/{STEAM_ID}/?xml=1"
        assert timeout == 1.5
        return f"<profile><avatarMedium>{AVATAR_URL}</avatarMedium></profile>".encode()

    assert get_steam_avatar_url(STEAM_ID, fetch_profile=fetch_profile) == AVATAR_URL
    for host in STEAM_AVATAR_HOSTS:
        url = f"https://{host}/avatar.jpg"
        assert (
            get_steam_avatar_url(
                STEAM_ID,
                fetch_profile=lambda _url, _timeout, avatar_url=url: (
                    f"<profile><avatarMedium>{avatar_url}</avatarMedium></profile>".encode()
                ),
            )
            == url
        )
    assert (
        get_steam_avatar_url(
            STEAM_ID,
            fetch_profile=lambda _url, _timeout: (
                b"<profile><avatarMedium>https://example.com/avatar.jpg</avatarMedium></profile>"
            ),
        )
        is None
    )
    assert (
        get_steam_avatar_url(
            STEAM_ID,
            fetch_profile=lambda _url, _timeout: (
                b"<profile><avatarMedium>"
                b"https://avatars.fastly.steamstatic.com.example.com/avatar.jpg"
                b"</avatarMedium></profile>"
            ),
        )
        is None
    )


def test_avatar_lookup_fails_softly_without_network_for_invalid_ids() -> None:
    def fail_if_called(_url: str, _timeout: float) -> bytes:
        raise AssertionError("invalid IDs must not reach the network")

    assert get_steam_avatar_url("111", fetch_profile=fail_if_called) is None


def test_avatar_lookup_falls_back_for_expected_remote_failures() -> None:
    def timeout(_url: str, _seconds: float) -> bytes:
        raise TimeoutError

    assert get_steam_avatar_url(STEAM_ID, fetch_profile=timeout) is None

    def offline(_url: str, _seconds: float) -> bytes:
        raise OSError

    assert get_steam_avatar_url(STEAM_ID, fetch_profile=offline) is None
    assert get_steam_avatar_url(STEAM_ID, fetch_profile=lambda *_: b"not xml") is None
    assert get_steam_avatar_url(STEAM_ID, fetch_profile=lambda *_: b"<profile />") is None


def test_avatar_lookup_never_breaks_players_for_unexpected_remote_failures() -> None:
    def unexpected_failure(_url: str, _seconds: float) -> bytes:
        raise RuntimeError("unexpected remote failure")

    assert get_steam_avatar_url(STEAM_ID, fetch_profile=unexpected_failure) is None


def test_profile_fetch_rejects_unsafe_urls_before_network() -> None:
    for url in (
        "http://steamcommunity.com/profiles/76561197960287930/?xml=1",
        "https://example.com/profiles/76561197960287930/?xml=1",
        "https://user:pass@steamcommunity.com/profiles/76561197960287930/?xml=1",
        "https://steamcommunity.com:444/profiles/76561197960287930/?xml=1",
    ):
        with pytest.raises(ValueError, match=r"^Steam profile URL is not allowed\.$"):
            _fetch_profile(url, 1.5)


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, 60_000),
        ("invalid", 60_000),
        ("0", 60_000),
        ("-1", 60_000),
        ("1", 30_000),
        ("45", 45_000),
        ("300", 300_000),
        ("301", None),
        ("9" * 129, None),
    ],
)
def test_rate_limit_retry_is_bounded_without_exposing_http_errors(header, expected):
    headers = Message()
    if header is not None:
        headers["Retry-After"] = header

    def limited(_url, _timeout):
        raise HTTPError("https://steamcommunity.com", 429, "private profile detail", headers, None)

    result = get_steam_avatar(STEAM_ID, fetch_profile=limited)
    assert result.url is None
    assert result.status == "transient"
    assert result.retry_after_ms == expected
    assert "private" not in repr(result)


def test_http_date_retry_after_uses_a_finite_budget(monkeypatch):
    now = datetime(2026, 1, 1, tzinfo=UTC)
    monkeypatch.setattr(profiles, "datetime", SimpleNamespace(now=lambda _tz: now))
    assert (
        profiles._retry_delay(format_datetime(now + timedelta(seconds=90), usegmt=True)) == 90_000
    )
    assert profiles._retry_delay(format_datetime(now + timedelta(seconds=301), usegmt=True)) is None


@pytest.mark.parametrize("code", [301, 302, 401, 403, 404])
def test_unavailable_profiles_and_redirects_never_request_retry(code):
    def missing(_url, _timeout):
        raise HTTPError("https://steamcommunity.com", code, "private", Message(), None)

    result = get_steam_avatar(STEAM_ID, fetch_profile=missing)
    assert result.status == "unavailable"
    assert result.retry_after_ms is None
    assert result.url is None


@pytest.mark.parametrize("failure", [TimeoutError(), URLError("offline"), ConnectionResetError()])
def test_transient_transport_errors_request_only_the_conservative_delay(failure):
    def failed(_url, _timeout):
        raise failure

    result = get_steam_avatar(STEAM_ID, fetch_profile=failed)
    assert (result.status, result.retry_after_ms, result.url) == ("transient", 60_000, None)


def test_profile_redirect_policy_never_follows_another_location():
    handler = profiles._NoProfileRedirect()
    for url in [
        "https://example.com",
        "http://steamcommunity.com",
        "https://steamcommunity.com/login",
    ]:
        assert handler.redirect_request(None, None, 302, "", Message(), url) is None


def test_avatar_lookup_rejects_xml_entities_fail_softly() -> None:
    hostile_xml = (
        b'<!DOCTYPE profile [<!ENTITY payload "unsafe">]>'
        b"<profile><avatarMedium>&payload;</avatarMedium></profile>"
    )

    assert (
        get_steam_avatar_url(
            STEAM_ID,
            fetch_profile=lambda _url, _timeout: hostile_xml,
        )
        is None
    )
