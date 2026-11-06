use super::*;
const SAVE: &str = "REPO_SAVE_2026_08_08_10_20_30";
#[test]
fn upgrade_intent_rejects_forged_duplicate_and_oversized_entries() {
    let raw =
        json!({"upgrades":[{"playerId":"111","key":"playerUpgradeStrength","before":2,"value":3}]});
    let intent: UpgradeIntent = serde_json::from_value(raw.clone()).unwrap();
    assert!(valid_upgrade_intent(&intent));
    for (key, value) in [
        ("playerId", json!("../111")),
        ("key", json!("arbitrary")),
        ("key", json!("playerUpgrade")),
        ("key", json!("playerUpgrade\0X")),
        ("before", json!(-1)),
        ("value", json!(-1)),
        ("value", json!(2_147_483_648i64)),
    ] {
        let mut bad = raw.clone();
        bad["upgrades"][0][key] = value;
        let intent: UpgradeIntent = serde_json::from_value(bad).unwrap();
        assert!(!valid_upgrade_intent(&intent));
    }
    let duplicate = json!({"upgrades":[raw["upgrades"][0],raw["upgrades"][0]]});
    assert!(!valid_upgrade_intent(
        &serde_json::from_value(duplicate).unwrap()
    ));
    let mut forged = raw.clone();
    forged["upgrades"][0]["path"] = json!("private");
    assert!(serde_json::from_value::<UpgradeIntent>(forged).is_err());
    let mut large = raw;
    large["upgrades"] = json!((0..10).map(|n| json!({"playerId":n.to_string(),"key":format!("playerUpgrade{}", "X".repeat(400)),"before":0,"value":1})).collect::<Vec<_>>());
    assert!(!valid_upgrade_intent(
        &serde_json::from_value(large).unwrap()
    ));
}
#[test]
fn pending_ui_state_is_bounded_and_does_not_accept_paths_or_forged_identities() {
    let raw = json!({"ok":true,"state":"pending","pending":{"operationId":"a".repeat(32),"fingerprint":"b".repeat(64),"intent":{"playerId":"111","health":17,"before":80}}});
    assert!(parse_state(&serde_json::to_vec(&raw).unwrap(), SAVE).is_ok());
    for (path, value) in [
        ("operationId", json!("../operation")),
        ("fingerprint", json!("bad")),
    ] {
        let mut bad = raw.clone();
        bad["pending"][path] = value;
        assert!(parse_state(&serde_json::to_vec(&bad).unwrap(), SAVE).is_err());
    }
    for (key, value) in [
        ("playerId", json!("../111")),
        ("health", json!(true)),
        ("health", json!(-1)),
        ("before", json!(-1)),
    ] {
        let mut bad = raw.clone();
        bad["pending"]["intent"][key] = value;
        assert!(parse_state(&serde_json::to_vec(&bad).unwrap(), SAVE).is_err());
    }
    assert!(parse_state(br#"{"ok":true,"state":"success"}"#, SAVE).is_err());
}
#[test]
fn canonical_projection_reuses_read_validators_and_matches_the_reconciled_fingerprint() {
    let raw = json!({"opened":{"ok":true,"session":{"id":SAVE,"displayName":"Synthetic","path":"E:/synthetic/save.es3","lastModified":"2026-11-04T00:00:00+00:00","fingerprint":"b".repeat(64),"level":5,"currency":12,"playerCount":1,"resumeLocation":"Normal","private":"excluded"},"requiredUpgradeVisualKeys":[]},"players":[{"id":"111","name":"Alpha","health":17,"maxHealth":100,"private":"excluded"}]});
    let mut raw = raw;
    raw["upgrades"] = json!([]);
    let public =
        serde_json::to_value(canonical(&raw, SAVE, Some(&"b".repeat(64))).unwrap()).unwrap();
    assert_eq!(public["opened"]["session"]["name"], "Synthetic");
    assert!(!public.to_string().contains("excluded"));
    assert!(canonical(&raw, SAVE, Some(&"c".repeat(64))).is_err());
    assert!(canonical(&raw, "REPO_SAVE_2026_08_08_10_20_31", None).is_err());
    let mut bad = raw;
    bad["players"][0]["id"] = json!("../111");
    assert!(canonical(&bad, SAVE, None).is_err());
}
#[test]
fn rejects_forged_outcome_and_private_reason() {
    let op = "a".repeat(32);
    let raw = json!({"ok":true,"transaction":{"operationId":op,"status":"applied","fingerprint":"b".repeat(64),"backupAvailable":true,"reason":null}});
    assert!(parse(
        &serde_json::to_vec(&raw).unwrap(),
        &op,
        "REPO_SAVE_2026_08_08_10_20_30"
    )
    .is_ok());
    for (key, value) in [
        ("status", json!("success")),
        ("fingerprint", json!("bad")),
        ("reason", json!("private path")),
        ("operationId", json!("b".repeat(32))),
    ] {
        let mut bad = raw.clone();
        bad["transaction"][key] = value;
        assert!(parse(
            &serde_json::to_vec(&bad).unwrap(),
            &op,
            "REPO_SAVE_2026_08_08_10_20_30"
        )
        .is_err());
    }
}
