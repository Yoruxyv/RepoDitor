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

#[test]
fn avatar_permission_and_image_policy_do_not_expand_other_native_authority() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let security = &config["app"]["security"];
    for key in ["csp", "devCsp"] {
        let csp = security[key].as_str().unwrap();
        let img = csp
            .split(';')
            .find(|p| p.trim().starts_with("img-src "))
            .unwrap();
        assert_eq!(img.trim(), "img-src 'self' data: https://avatars.akamai.steamstatic.com https://avatars.fastly.steamstatic.com");
        let connect = csp
            .split(';')
            .find(|p| p.trim().starts_with("connect-src "))
            .unwrap();
        assert!(!connect.contains("https:") && !connect.contains('*'));
    }
    let capabilities = security["capabilities"].as_array().unwrap();
    assert_eq!(capabilities.len(), 1);
    assert_eq!(capabilities[0]["windows"], serde_json::json!(["main"]));
    let permissions = capabilities[0]["permissions"].as_array().unwrap();
    assert!(permissions.contains(&serde_json::json!("allow-players-avatar")));
    assert!(permissions.contains(&serde_json::json!("allow-upgrade-artwork-get")));
    assert!(permissions.contains(&serde_json::json!("allow-upgrade-artwork-cancel")));
    assert_eq!(permissions.len(), 13);
    assert!(!permissions.iter().any(|p| {
        let s = p.as_str().unwrap();
        s.contains("write") || s.contains("http") || s.contains("shell") || s.contains("fs:")
    }));
}
