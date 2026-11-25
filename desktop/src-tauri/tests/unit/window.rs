use super::allowed_navigation;

#[test]
fn only_project_and_single_release_tag_urls_reach_the_system_browser_handoff() {
    for url in [
        "https://github.com/Yoruxyv/RepoDitor/",
        "https://github.com/Yoruxyv/RepoDitor?x=1",
        "https://github.com/Yoruxyv/RepoDitor#readme",
        "https://github.com/Yoruxyv/RepoDitor/issues",
        "http://github.com/Yoruxyv/RepoDitor",
        "https://github.com@example.com/Yoruxyv/RepoDitor",
        "https://github.com.evil.example/Yoruxyv/RepoDitor",
        "https://github.com/Yoruxyv/RepoDitor/releases/download/v0.3.0/setup.exe",
        "https://github.com/Yoruxyv/RepoDitor/releases?redirect=other",
        "https://github.com/Yoruxyv/RepoDitor/releases/tag/v0.3.0/asset",
        "https://github.com/Yoruxyv/RepoDitor/releases/tag/v0.3.0?redirect=other",
        "https://github.com/Yoruxyv/RepoDitor/releases/tag/v0.3.0#changes",
        "https://github.com/Yoruxyv/RepoDitor/releases/tag/v0.3.0%2Fother",
        "https://github.com:444/Yoruxyv/RepoDitor/releases/tag/v0.3.0",
        "https://github.com/other/RepoDitor/releases/tag/v0.3.0",
        "file:///RepoDitor",
        "https://example.com/",
    ] {
        let url = url.parse().unwrap();
        super::handle_project_window(&url, |target| panic!("unexpected handoff: {target}"));
        assert!(!allowed_navigation(&url));
    }
    for expected in [
        "https://github.com/Yoruxyv/RepoDitor",
        "https://github.com/Yoruxyv/RepoDitor/releases",
        "https://github.com/Yoruxyv/RepoDitor/releases/tag/v0.3.0",
    ] {
        let url = expected.parse().unwrap();
        let mut opened = None;
        super::handle_project_window(&url, |target| opened = Some(target.to_owned()));
        assert_eq!(opened.as_deref(), Some(expected));
        assert!(!allowed_navigation(&url));
    }
}

#[cfg(all(windows, feature = "native-ui-test"))]
#[test]
fn browser_arguments_require_explicit_test_admission_and_preserve_defaults() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../startup.test.conf.json")).unwrap();
    let window = &config["app"]["windows"][0];
    assert_eq!(window["create"], false);
    assert!(config["app"].get("security").is_none());
    let template = window["additionalBrowserArgs"].as_str().unwrap();
    let arguments = super::ui_test_args(template, "1", "54321").unwrap();
    assert!(arguments.contains("--remote-debugging-port=54321"));
    assert!(arguments.contains("--remote-debugging-address=127.0.0.1"));
    assert!(arguments.contains("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"));
    assert!(arguments.contains("--autoplay-policy=no-user-gesture-required"));
    for port in ["", "0", "80", "65536", "54321 --other-argument"] {
        assert!(super::ui_test_args(template, "1", port).is_err());
    }
    assert!(super::ui_test_args(template, "0", "54321").is_err());
    assert!(super::ui_test_args("missing placeholder", "1", "54321").is_err());
}

#[test]
fn navigation_is_limited_to_the_preview_page_and_origin() {
    for url in [
        "http://tauri.localhost/tauri.html",
        "tauri://localhost/tauri.html",
    ] {
        assert!(allowed_navigation(&url.parse().unwrap()));
    }
    for url in [
        "https://example.com/tauri.html",
        "http://tauri.localhost:9000/tauri.html",
        "tauri://localhost:9000/tauri.html",
        "http://tauri.localhost/other.html",
        "http://127.0.0.1:5173/tauri.html",
        "file:///tauri.html",
    ] {
        assert!(!allowed_navigation(&url.parse().unwrap()), "{url}");
    }
    assert_eq!(
        allowed_navigation(&"http://127.0.0.1:1420/tauri.html".parse().unwrap()),
        cfg!(debug_assertions)
    );
}
