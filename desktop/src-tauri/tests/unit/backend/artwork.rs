use super::*;
use crate::projections::upgrades;
use serde_json::json;

fn upgrades(count: usize) -> Vec<Upgrade> {
    let rows: Vec<_> = (0..count).map(|i| json!({"key":format!("playerUpgradeTest{i}"),"label":"Test","presentationSource":"alias","gameplayCap":null,"iconKey":null,"values":[]})).collect();
    upgrades::parse(&serde_json::to_vec(&json!({"ok":true,"upgrades":rows})).unwrap()).unwrap()
}
fn png() -> Vec<u8> {
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[255, 0, 0, 255])
            .unwrap();
    }
    output
}
#[test]
fn scopes_tokens_to_current_save_and_revokes_inflight_work() {
    let mut registry = Registry::default();
    let mut rows = upgrades(20);
    registry.register("save", None, Some(&"a".repeat(64)), &mut rows);
    assert!(rows.iter().all(|row| row.icon_token.is_none()));
    registry.open("save");
    registry.register(
        "save",
        registry.generation("save"),
        Some(&"a".repeat(64)),
        &mut rows,
    );
    assert_eq!(registry.entries.len(), MAX_IMAGES);
    assert!(rows[MAX_IMAGES].icon_token.is_none());
    let token = rows[0].icon_token.as_ref().unwrap().clone();
    assert!(valid_token(&token));
    for bad in [
        "../file",
        "map:token",
        "https://example.test",
        "upgrade-artwork:forged",
    ] {
        assert!(!valid_token(bad));
        assert!(registry.begin(bad).is_err());
    }
    assert!(registry
        .begin(&format!("upgrade-artwork:{}", "0".repeat(32)))
        .is_err());
    let (_, fingerprint, key, cancelled) = registry.begin(&token).unwrap();
    assert_eq!(fingerprint, "a".repeat(64));
    assert_eq!(key, rows[0].key);
    assert!(registry.begin(&token).is_err());
    registry.cancel(&token);
    assert!(cancelled.load(Ordering::SeqCst));
    assert!(!registry.finish(&token, &cancelled));
    let (_, _, _, current) = registry.begin(&token).unwrap();
    registry.open("other");
    assert!(current.load(Ordering::SeqCst));
    assert!(!registry.finish(&token, &current));
    assert!(registry.begin(&token).is_err());
}
#[test]
fn stale_lists_cannot_register_and_refresh_revokes_old_tokens() {
    let mut registry = Registry::default();
    registry.open("save");
    let generation = registry.generation("save");
    registry.open("other");
    let mut rows = upgrades(1);
    registry.register("save", generation, Some(&"a".repeat(64)), &mut rows);
    assert!(rows[0].icon_token.is_none());
    registry.open("save");
    let generation = registry.generation("save");
    registry.register("save", generation, Some(&"a".repeat(64)), &mut rows);
    let old = rows[0].icon_token.clone().unwrap();
    registry.register("save", generation, Some(&"b".repeat(64)), &mut rows);
    assert_ne!(rows[0].icon_token.as_deref(), Some(old.as_str()));
    assert!(registry.begin(&old).is_err());
}
#[test]
fn validates_png_pixels_dimensions_revision_and_drops_untrusted_paths() {
    let token = format!("upgrade-artwork:{}", "a".repeat(32));
    let raw = json!({"ok":true,"artwork":{"upgradeKey":"playerUpgradeHealth","sourceIdentity":"a".repeat(64),"width":1,"height":1,"pngBase64": STANDARD.encode(png())}});
    let bytes = serde_json::to_vec(&raw).unwrap();
    let result =
        serde_json::to_value(parse(&bytes, "playerUpgradeHealth", &token).unwrap()).unwrap();
    assert!(result["dataUrl"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert_eq!(result["token"], token);
    for (field, value) in [
        ("width", json!(2049)),
        ("width", json!(2)),
        ("sourceIdentity", json!("../path")),
        ("upgradeKey", json!("other")),
        ("path", json!("C:/private/game/file")),
        ("pngBase64", json!("A".repeat(MAX_PNG * 2))),
        ("pngBase64", json!(STANDARD.encode(b"not PNG"))),
    ] {
        let mut changed = raw.clone();
        changed["artwork"][field] = value;
        assert!(
            parse(
                &serde_json::to_vec(&changed).unwrap(),
                "playerUpgradeHealth",
                &token
            )
            .is_err(),
            "{field}"
        );
    }
    let mut trailing = png();
    trailing.extend_from_slice(b"unexpected payload");
    let mut with_trailer = raw.clone();
    with_trailer["artwork"]["pngBase64"] = json!(STANDARD.encode(trailing));
    assert!(parse(
        &serde_json::to_vec(&with_trailer).unwrap(),
        "playerUpgradeHealth",
        &token
    )
    .is_err());
    let mut corrupt = png();
    corrupt[45] ^= 255;
    let mut changed = raw;
    changed["artwork"]["pngBase64"] = json!(STANDARD.encode(corrupt));
    assert!(parse(
        &serde_json::to_vec(&changed).unwrap(),
        "playerUpgradeHealth",
        &token
    )
    .is_err());
    assert!(parse(
        br#"{"ok":true,"artwork":null}"#,
        "playerUpgradeHealth",
        &token
    )
    .unwrap()
    .is_none());
}
