use super::*;
const ID: &str = "REPO_SAVE_2026_08_08_10_20_30";
fn response() -> serde_json::Value {
    serde_json::json!({"ok":true,"session":{"id":ID,"displayName":"Example","path":"C:/fixture/save.es3",
            "lastModified":"2026-11-03T00:00:00+00:00","fingerprint":"a".repeat(64),"level":5,"currency":12,"playerCount":2,"resumeLocation":"Normal"},
            "requiredUpgradeVisualKeys":["playerUpgradeHealth"]})
}
fn decode(value: &serde_json::Value) -> Result<SaveOpenResult, BackendError> {
    parse(&serde_json::to_vec(value).unwrap(), ID)
}
#[test]
fn only_fixed_shape_opaque_save_ids_are_accepted() {
    assert!(valid_id(ID));
    for id in [
        "../save.es3",
        "C:/save.es3",
        "--help",
        "REPO_SAVE_2026_8_08_10_20_30",
        "REPO_SAVE_2026_08_08_10_20_30\n",
        &"x".repeat(20000),
    ] {
        assert!(!valid_id(id));
    }
}
#[test]
fn translates_session_without_leaking_extra_data_or_claiming_artwork() {
    let mut raw = response();
    raw["decrypted"] = serde_json::json!({"secret":"not public"});
    let value = serde_json::to_value(decode(&raw).unwrap()).unwrap();
    assert_eq!(value["session"]["name"], "Example");
    assert_eq!(value["session"]["currency"], 12);
    assert_eq!(value["presentationReadiness"], "unresolved");
    assert!(value.get("decrypted").is_none());
    raw["requiredUpgradeVisualKeys"] = serde_json::json!([]);
    assert_eq!(decode(&raw).unwrap().presentation_readiness, "ready");
}
#[test]
fn rejects_mismatched_ids_invalid_sessions_and_missing_fields() {
    for (field, value) in [
        ("id", serde_json::json!("REPO_SAVE_2026_08_08_10_20_31")),
        ("path", serde_json::json!(" ")),
        ("displayName", serde_json::Value::Null),
        ("lastModified", serde_json::json!("bad-date")),
        ("fingerprint", serde_json::json!("A".repeat(64))),
        ("level", serde_json::json!(0)),
        ("currency", serde_json::json!(1.5)),
        ("currency", serde_json::json!(9_007_199_254_740_992i64)),
        ("playerCount", serde_json::json!(-1)),
        ("resumeLocation", serde_json::json!("")),
    ] {
        let mut raw = response();
        raw["session"][field] = value;
        assert_eq!(decode(&raw).unwrap_err(), BackendError::Invalid, "{field}");
    }
    for field in ["id", "fingerprint", "currency", "resumeLocation"] {
        let mut raw = response();
        raw["session"].as_object_mut().unwrap().remove(field);
        assert!(decode(&raw).is_err());
    }
    assert_eq!(parse(b"", ID).unwrap_err(), BackendError::Empty);
    assert_eq!(parse(b"{", ID).unwrap_err(), BackendError::Malformed);
}
#[test]
fn bounds_and_validates_required_visual_keys() {
    for keys in [
        serde_json::json!(["bad"]),
        serde_json::json!(["playerUpgrade"]),
        serde_json::json!(["playerUpgradeX", "playerUpgradeX"]),
        serde_json::json!([null]),
        serde_json::json!(["playerUpgrade\0x"]),
        serde_json::json!([format!("playerUpgrade{}", "x".repeat(512))]),
        serde_json::json!(vec!["playerUpgradeX"; 513]),
    ] {
        let mut raw = response();
        raw["requiredUpgradeVisualKeys"] = keys;
        assert_eq!(decode(&raw).unwrap_err(), BackendError::Invalid);
    }
}
#[test]
fn preserves_missing_stale_failures_but_sanitizes_messages() {
    for code in [
        "save_missing",
        "save_stale",
        "save_corrupt",
        "backend_unavailable",
    ] {
        let raw = serde_json::json!({"ok":false,"error":{"code":code,"message":"private path and diagnostic"}});
        let result = crate::error::Outcome::<SaveOpenResult>::for_service(
            decode(&raw),
            crate::error::Service::Save,
        );
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["error"]["code"], code);
        assert!(!value.to_string().contains("private"));
    }
    for error in [
        serde_json::json!({"code":"new_unknown_code","message":"private"}),
        serde_json::json!({"code":"save_missing","message":null}),
    ] {
        assert_eq!(
            decode(&serde_json::json!({"ok":false,"error":error})).unwrap_err(),
            BackendError::Invalid
        );
    }
}
