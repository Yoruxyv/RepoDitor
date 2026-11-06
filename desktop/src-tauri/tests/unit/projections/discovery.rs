use super::*;
fn environment() -> serde_json::Value {
    serde_json::json!({"ok":true,"saveRoot":"C:/fixture/saves","saveRootStatus":"available",
            "saveRootDetected":true,"saveCount":1,"saves":[{"id":"fixture","displayName":"Example",
            "path":"C:/fixture/saves/example.es3","lastModified":"2026-11-03T00:00:00+00:00","fileSize":123}],
            "gameRoot":null,"gameStatus":"steam_not_found","gameDetected":false})
}
#[test]
fn projects_only_the_existing_renderer_contract() {
    let mut raw = environment();
    raw["gameDiscoveryIssues"] = serde_json::json!([{"path":"private diagnostic"}]);
    let result = serde_json::to_value(parse(&serde_json::to_vec(&raw).unwrap()).unwrap()).unwrap();
    assert_eq!(result["saves"][0]["name"], "Example");
    assert_eq!(result["saves"][0]["sizeBytes"], 123);
    assert!(result.get("gameDiscoveryIssues").is_none());
    assert_eq!(
        result["healthWriteCompatibility"],
        serde_json::json!({
            "buildId":null,"status":"unknown","supported":false
        })
    );
}
#[test]
fn health_build_metadata_cannot_admit_writes() {
    let mut raw = environment();
    raw["gameDetected"] = serde_json::json!(true);
    raw["gameRoot"] = serde_json::json!("C:/fixture/game");
    raw["gameStatus"] = serde_json::json!("found");
    let unsupported =
        serde_json::json!({"buildId":"23363152","status":"unsupported","supported":false});
    raw["healthWriteCompatibility"] = unsupported.clone();
    assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_ok());
    for (key, value) in [
        ("supported", serde_json::json!(true)),
        ("status", serde_json::json!("supported")),
        ("buildId", serde_json::Value::Null),
        ("buildId", serde_json::json!("../game")),
        ("status", serde_json::json!("unknown")),
    ] {
        let mut bad = unsupported.clone();
        bad[key] = value;
        raw["healthWriteCompatibility"] = bad;
        assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_err());
    }
}
#[test]
fn rejects_missing_wrong_and_inconsistent_fields() {
    for (key, value) in [
        ("ok", serde_json::json!(false)),
        ("saveCount", serde_json::json!(2)),
        ("saveRoot", serde_json::Value::Null),
        ("saveRootDetected", serde_json::json!(false)),
        ("saveRootStatus", serde_json::json!("missing")),
        ("gameRoot", serde_json::json!("C:/game")),
        ("gameStatus", serde_json::json!("found")),
        ("saves", serde_json::json!({})),
    ] {
        let mut raw = environment();
        raw[key] = value;
        assert_eq!(
            parse(&serde_json::to_vec(&raw).unwrap()).unwrap_err(),
            BackendError::Invalid
        );
    }
    for key in ["saveRoot", "gameRoot", "saveRootStatus"] {
        let mut raw = environment();
        raw.as_object_mut().unwrap().remove(key);
        assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_err());
    }
}
#[test]
fn rejects_bad_save_metadata_and_framing() {
    for (key, value) in [
        ("id", serde_json::json!(" ")),
        ("displayName", serde_json::Value::Null),
        ("path", serde_json::json!("")),
        ("lastModified", serde_json::json!("invalid")),
        ("fileSize", serde_json::json!(-1)),
        ("fileSize", serde_json::json!(9_007_199_254_740_992u64)),
    ] {
        let mut raw = environment();
        raw["saves"][0][key] = value;
        assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_err());
    }
    assert_eq!(parse(b" \n").unwrap_err(), BackendError::Empty);
    assert_eq!(parse(b"not-json").unwrap_err(), BackendError::Malformed);
}
