#[cfg(feature = "production-health")]
#[test]
fn save_retains_prepared_upgrade_tokens_even_when_the_entry_projection_is_not_cacheable() {
    use super::{artwork::Registry, bind_editor_entry, upgrades, Outcome};
    use serde_json::json;

    let before = "a".repeat(64);
    let after = "b".repeat(64);
    let revision = "c".repeat(64);
    let mut registry = Registry::default();
    registry.open("save", &before);
    let generation = registry.generation("save");
    let upgrades = json!({"ok": true, "upgrades": [{
        "key": "playerUpgradeStrength", "label": "Strength", "presentationSource": "installed",
        "gameplayCap": null, "iconKey": null, "values": [{"playerId": "111", "value": 2}]
    }]});
    let mut raw = json!({
        "ok": true, "fingerprint": before, "cacheRevision": null, "artworkRevision": revision,
        "upgrades": upgrades,
        "maps": {"ok": true, "available": false, "catalogPath": null, "maps": [],
                 "entryArtworkRevision": revision}
    });

    let (entry, _) = bind_editor_entry(&raw, &mut registry, "save", &before, generation).unwrap();
    let Outcome::Success { data: initial, .. } = entry.upgrades else {
        panic!("Upgrade projection should be available");
    };
    let token = initial[0].icon_token.as_ref().unwrap();
    raw["upgrades"]["upgrades"][0]["values"][0]["value"] = json!(7);
    let mut saved = upgrades::parse(&serde_json::to_vec(&raw["upgrades"]).unwrap()).unwrap();
    assert!(registry.retain_upgrade_artwork(
        "save",
        generation,
        &after,
        Some(&revision),
        &mut saved
    ));
    assert_eq!(saved[0].icon_token.as_ref(), Some(token));
    assert_eq!(
        serde_json::to_value(&saved).unwrap()[0]["values"][0]["value"],
        7
    );
}

#[test]
fn entry_source_proof_distinguishes_incompatible_responses_from_changed_bytes() {
    use super::{check_entry_fingerprint, BackendError};
    let expected = "a".repeat(64);
    let changed = "b".repeat(64);
    assert_eq!(check_entry_fingerprint(None, None), Ok(()));
    assert_eq!(
        check_entry_fingerprint(Some(&expected), Some(&expected)),
        Ok(())
    );
    assert_eq!(
        check_entry_fingerprint(Some(&expected), Some("bad")),
        Err(BackendError::Request)
    );
    for actual in [None, Some("not a digest"), Some(&"A".repeat(64))] {
        assert!(matches!(
            check_entry_fingerprint(actual, Some(&expected)),
            Err(BackendError::Domain {
                code: "save_source_unverified",
                ..
            })
        ));
    }
    assert!(matches!(
        check_entry_fingerprint(Some(&changed), Some(&expected)),
        Err(BackendError::Domain {
            code: "save_stale",
            ..
        })
    ));
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
        let expected = if key == "csp" {
            "connect-src ipc: http://ipc.localhost"
        } else {
            "connect-src ipc: http://ipc.localhost ws://127.0.0.1:1420"
        };
        assert_eq!(
            connect.trim(),
            format!("{expected} https://api.github.com/repos/Yoruxyv/RepoDitor/releases/latest")
        );
    }
    let html = include_str!("../../../tauri.html");
    let html_csp = security["devCsp"].as_str().unwrap().replacen(
        "script-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        1,
    );
    assert!(html.contains(&format!("content=\"{html_csp}\"")));
    let capabilities = security["capabilities"].as_array().unwrap();
    assert_eq!(capabilities.len(), 1);
    assert_eq!(capabilities[0]["windows"], serde_json::json!(["main"]));
    let permissions = capabilities[0]["permissions"].as_array().unwrap();
    assert!(permissions.contains(&serde_json::json!("allow-players-avatar")));
    assert!(permissions.contains(&serde_json::json!("allow-legacy-install-registered")));
    assert!(permissions.contains(&serde_json::json!("allow-open-installed-apps")));
    assert!(permissions.contains(&serde_json::json!("allow-upgrade-artwork-get")));
    assert!(permissions.contains(&serde_json::json!("allow-upgrade-artwork-cancel")));
    assert!(permissions.contains(&serde_json::json!("allow-item-artwork-get")));
    assert!(permissions.contains(&serde_json::json!("allow-item-artwork-cancel")));
    assert!(permissions.contains(&serde_json::json!("allow-map-artwork-get")));
    assert!(permissions.contains(&serde_json::json!("allow-map-artwork-cancel")));
    assert!(permissions.contains(&serde_json::json!("allow-cosmetic-artwork-get")));
    assert!(permissions.contains(&serde_json::json!("allow-cosmetic-artwork-cancel")));
    assert!(permissions.contains(&serde_json::json!("allow-editor-entry")));
    assert!(permissions.contains(&serde_json::json!("core:app:allow-version")));
    assert_eq!(permissions.len(), 23);
    assert!(!permissions.iter().any(|p| {
        let s = p.as_str().unwrap();
        s.contains("write") || s.contains("http") || s.contains("shell") || s.contains("fs:")
    }));
}
