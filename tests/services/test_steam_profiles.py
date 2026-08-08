from repo_save_editor.services.steam_profiles import (
    STEAM_AVATAR_HOST,
    get_steam_avatar_url,
    is_plausible_steam_id,
)

STEAM_ID = "76561197960287930"
AVATAR_URL = f"https://{STEAM_AVATAR_HOST}/avatar.jpg"


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
    assert (
        get_steam_avatar_url(
            STEAM_ID,
            fetch_profile=lambda _url, _timeout: (
                b"<profile><avatarMedium>https://example.com/avatar.jpg</avatarMedium></profile>"
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
