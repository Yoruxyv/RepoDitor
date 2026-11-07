use super::*;
const SAVE: &str = "REPO_SAVE_2026_08_08_10_20_30";
#[test]
fn refill_intents_bind_exact_keys_and_never_accept_numeric_writes() {
    let raw = json!({"refillToFull":[{"saveKey":"Item Tool/1","before":99},{"saveKey":"Item Tool/2","before":-2}]});
    assert!(valid_refill_intent(
        &serde_json::from_value(raw.clone()).unwrap()
    ));
    for (key, value) in [
        ("saveKey", json!("../file")),
        ("saveKey", json!("Item Tool/١")),
        ("before", json!(true)),
        ("before", json!(1.5)),
        ("before", json!(9_007_199_254_740_992i64)),
        ("value", json!(100)),
    ] {
        let mut bad = raw.clone();
        bad["refillToFull"][1][key] = value;
        assert!(serde_json::from_value::<RefillIntent>(bad)
            .map(|i| !valid_refill_intent(&i))
            .unwrap_or(true));
    }
    for edits in [
        json!([]),
        json!([raw["refillToFull"][0], raw["refillToFull"][0]]),
        json!((0..100)
            .map(|n| json!({"saveKey":format!("Item Tool/{n}"),"before":1}))
            .collect::<Vec<_>>()),
    ] {
        assert!(!valid_refill_intent(
            &serde_json::from_value(json!({"refillToFull":edits})).unwrap()
        ));
    }
    let state = json!({"ok":true,"state":"pending","pending":{"operationId":"a".repeat(32),"fingerprint":"b".repeat(64),"intent":raw}});
    assert!(parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).is_ok());
}
#[test]
fn refill_unicode_byte_boundary_matches_the_durable_contract() {
    for delta in [-1i32, 0, 1] {
        let mut intent = RefillIntent {
            refill_to_full: (0..35)
                .map(|n| RefillEdit {
                    save_key: format!("Item 🧪/{n}"),
                    before: 1,
                })
                .collect(),
        };
        let target = (2048 + delta) as usize;
        for index in 0..intent.refill_to_full.len() {
            let size = serde_json::to_vec(&intent).unwrap().len();
            let padding = (target - size).min(50);
            let edit = &mut intent.refill_to_full[index];
            edit.save_key = edit
                .save_key
                .replace('/', &format!("{}/", "x".repeat(padding)));
        }
        assert_eq!(serde_json::to_vec(&intent).unwrap().len(), target);
        assert_eq!(valid_refill_intent(&intent), delta <= 0);
    }
}
#[test]
fn health_batches_reject_forged_duplicate_oversized_and_partial_intents() {
    let raw = json!({"health":[{"playerId":"111","before":80,"value":17},{"playerId":"222","before":0,"value":42}]});
    assert!(valid_health_batch_intent(
        &serde_json::from_value(raw.clone()).unwrap()
    ));
    for (key, value) in [
        ("playerId", json!("../222")),
        ("before", json!(-1)),
        ("before", json!(9_007_199_254_740_992i64)),
        ("before", json!(true)),
        ("value", json!(true)),
        ("value", json!(1.5)),
        ("value", json!(-1)),
        ("value", json!(2_147_483_648i64)),
        ("value", json!(0)),
        ("field", json!("currency")),
    ] {
        let mut bad = raw.clone();
        bad["health"][1][key] = value;
        assert!(serde_json::from_value::<HealthBatchIntent>(bad)
            .map(|i| !valid_health_batch_intent(&i))
            .unwrap_or(true));
    }
    for edits in [
        json!([]),
        json!([raw["health"][0], raw["health"][0]]),
        json!((0..100)
            .map(|n| json!({"playerId":n.to_string(),"before":0,"value":1}))
            .collect::<Vec<_>>()),
    ] {
        assert!(!valid_health_batch_intent(
            &serde_json::from_value(json!({"health":edits})).unwrap()
        ));
    }
    let mut state = json!({"ok":true,"state":"pending","pending":{"operationId":"a".repeat(32),"fingerprint":"b".repeat(64),"intent":raw}});
    assert!(parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).is_ok());
    state["pending"]["intent"]["health"][1]["value"] = json!(true);
    assert!(parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).is_err());
}
#[test]
fn health_batch_byte_boundary_matches_the_python_receipt_budget() {
    for delta in [-1i32, 0, 1] {
        let mut intent = HealthBatchIntent {
            health: (0..40)
                .map(|n| HealthEdit {
                    player_id: n.to_string(),
                    before: 0,
                    value: 1,
                })
                .collect(),
        };
        let target = (2048 + delta) as usize;
        for index in 0..intent.health.len() {
            let size = serde_json::to_vec(&intent).unwrap().len();
            let edit = &mut intent.health[index];
            let padding = (target - size).min(20 - edit.player_id.len());
            edit.player_id = format!("{}{}", "0".repeat(padding), edit.player_id);
        }
        assert_eq!(serde_json::to_vec(&intent).unwrap().len(), target);
        assert_eq!(valid_health_batch_intent(&intent), delta <= 0);
    }
}
#[test]
fn run_intent_preserves_signed_boundaries_and_rejects_forged_values() {
    let raw = json!({"run":[{"field":"currency","before":-9_007_199_254_740_991i64,"value":-2_147_483_648i64},{"field":"level","before":5,"value":2_147_483_648i64},{"field":"resumeLocation","before":"Unknown (9)","value":"Shop / Service Station"}]});
    assert!(valid_run_intent(
        &serde_json::from_value(raw.clone()).unwrap()
    ));
    for (key, value) in [
        ("field", json!("../save")),
        ("before", json!(9_007_199_254_740_992i64)),
        ("value", json!(true)),
        ("value", json!(1.5)),
        ("value", json!("4")),
        ("value", json!(-2_147_483_649i64)),
        ("value", json!(2_147_483_648i64)),
    ] {
        let mut bad = raw.clone();
        bad["run"][0][key] = value;
        assert!(!valid_run_intent(&serde_json::from_value(bad).unwrap()));
    }
    let mut bad = raw.clone();
    bad["run"][2]["value"] = json!("Unknown (99)");
    assert!(!valid_run_intent(&serde_json::from_value(bad).unwrap()));
    let mut bad = raw.clone();
    bad["run"][0]["path"] = json!("private");
    assert!(serde_json::from_value::<RunIntent>(bad).is_err());
    let mut bad = raw.clone();
    bad["run"] = json!([raw["run"][0], raw["run"][0]]);
    assert!(!valid_run_intent(&serde_json::from_value(bad).unwrap()));
    let mut state = json!({"ok":true,"state":"pending","pending":{"operationId":"a".repeat(32),"fingerprint":"b".repeat(64),"intent":raw}});
    assert!(parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).is_ok());
    state["pending"]["intent"]["run"][0]["value"] = json!(true);
    assert!(parse_state(&serde_json::to_vec(&state).unwrap(), SAVE).is_err());
}
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
