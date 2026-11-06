use super::allowed_navigation;

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
