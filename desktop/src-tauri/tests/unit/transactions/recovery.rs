use super::*;

pub(super) const SAVE: &str = "REPO_SAVE_2026_08_08_10_20_30";

#[test]
fn compatibility_state_rejects_unknown_operations_and_malformed_resume_evidence() {
    let mut state = json!({"ok": true, "state": "disabled", "compatibility": {
        "health": "incompatible", "upgrades": "incompatible", "run": "incompatible",
        "resume": "incompatible", "refillToFull": "incompatible"
    }});
    let parsed = parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).unwrap();
    assert!(!parsed.enabled);
    assert_eq!(parsed.compatibility["resume"], "incompatible");
    state["resumeAllowed"] = json!("forged");
    assert!(parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).is_err());
    state.as_object_mut().unwrap().remove("resumeAllowed");
    state["compatibility"]["unrecognizedOperation"] = json!("verified");
    assert!(parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).is_err());
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
    raw["run"] = json!({"stats":[{"key":"currency","label":"Currency","value":-19}],"resumeLocation":{"value":"Unknown (9)","options":["Normal","Unknown (9)"]}});
    assert_eq!(
        serde_json::to_value(canonical(&raw, SAVE, None).unwrap()).unwrap()["run"]["stats"][0]
            ["value"],
        -19
    );
    raw["run"]["stats"][0]["value"] = json!(9_007_199_254_740_993i64);
    assert!(serde_json::to_value(canonical(&raw, SAVE, None).unwrap()).unwrap()["run"].is_null());
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

#[test]
fn sharing_conflicts_and_unavailable_verification_remain_distinct() {
    let op = "a".repeat(32);
    for reason in ["save_in_use", "save_verification_unavailable"] {
        let raw = json!({"ok":true,"transaction":{"operationId":op,"status":"rejected","fingerprint":null,"backupAvailable":false,"reason":reason}});
        let transaction = parse(
            &serde_json::to_vec(&raw).unwrap(),
            &op,
            "REPO_SAVE_2026_08_08_10_20_30",
        )
        .unwrap();
        assert_eq!(transaction.status, "rejected");
        assert_eq!(transaction.reason.as_deref(), Some(reason));
    }
}
