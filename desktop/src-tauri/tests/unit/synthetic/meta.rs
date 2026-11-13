use super::*;

fn fixture() -> Value {
    let manifest: Value = serde_json::from_str(meta_anchor::manifest()).unwrap();
    let cosmetics: Vec<Value> = manifest["catalog"].as_array().unwrap().iter().map(|c| {
        let owned=c["id"]==27;
        json!({"id":c["id"],"displayName":c["assetName"],"type":c["type"],"rarity":c["rarity"],"status":c["status"],"owned":owned,"known":true,"state":if owned{"owned"}else{"locked"},"mutationEligible":true,"removalBlockedReason":null,"iconKey":null})
    }).collect();
    json!({"ok":true,"state":"idle","namespace":"c".repeat(64),"pending":null,
        "admission":{"manifest":meta_anchor::PIN,"identity":"repoditor-synthetic-meta-v1","build":"26294889","digest":"b".repeat(64)},
        "view":{"fingerprint":"a".repeat(64),"catalogAvailable":true,"knownCatalogCount":28,"knownOwnedCount":1,"knownLockedCount":27,"savedPresetCount":0,"unknownOwnedIds":[],
            "capabilities":{"canReadCosmetics":true,"canUnlockCosmetic":true,"canUnlockAll":true,"canRemoveOwnership":true,"canClearPresets":true},"cosmetics":cosmetics}})
}
fn decode(value: Value) -> std::result::Result<State, BackendError> {
    parse_state(&serde_json::to_vec(&value).unwrap())
}

#[test]
fn only_source_pinned_admission_can_issue_independent_mutation_authority() {
    let mut state = decode(fixture()).unwrap();
    let mut session = Session::default();
    session.issue(&mut state);
    let grant = session.mutation.as_ref().unwrap();
    assert!(grant.token.starts_with("meta-"));
    assert_eq!(grant.namespace, "c".repeat(64));
    assert_eq!(grant.fingerprint, "a".repeat(64));
    assert!(session.recovery.is_none());
    let mut other_host = Session::default();
    let mut other_state = decode(fixture()).unwrap();
    other_host.issue(&mut other_state);
    assert_ne!(state.session, other_state.session);
    for (key, bad) in [
        ("manifest", "f".repeat(64)),
        ("identity", "other".into()),
        ("build", "23363152".into()),
    ] {
        let mut raw = fixture();
        raw["admission"][key] = json!(bad);
        assert!(decode(raw).is_err());
    }
}
#[test]
fn recovery_only_authority_survives_missing_catalog_and_never_issues_a_mutator() {
    let mut raw = fixture();
    raw["state"] = json!("pending");
    raw["admission"] = Value::Null;
    raw["pending"] = json!({"operationId":"d".repeat(32),"status":"applied","fingerprint":"a".repeat(64),"backupAvailable":true,"proof":"e".repeat(64),"intent":null});
    let mut state = decode(raw).unwrap();
    let mut session = Session::default();
    session.issue(&mut state);
    assert!(session.mutation.is_none());
    assert!(state.session.is_none());
    let grant = session.recovery.as_ref().unwrap();
    assert!(grant.token.ends_with("-recovery"));
    assert_eq!(grant.operation, "d".repeat(32));
    assert_eq!(grant.proof, "e".repeat(64));
    let old = grant.token.clone();
    session.issue(&mut state);
    assert_ne!(session.recovery.unwrap().token, old);
}
#[test]
fn recovery_requires_settled_identity_and_only_issues_current_pinned_admission() {
    let id = "d".repeat(32);
    let mut raw = fixture();
    raw["operationId"] = json!(id);
    raw["status"] = json!("applied");
    raw["fingerprint"] = raw["view"]["fingerprint"].clone();
    raw["backupAvailable"] = json!(true);
    let parse = |raw: &Value| parse_recovery(&serde_json::to_vec(raw).unwrap(), &id);
    for (key, bad) in [
        ("operationId", json!("e".repeat(32))),
        ("fingerprint", json!("e".repeat(64))),
        ("namespace", Value::Null),
        ("state", json!("pending")),
        ("pending", json!({"operationId": id})),
    ] {
        let mut unrelated = raw.clone();
        unrelated[key] = bad;
        assert!(parse(&unrelated).is_err());
    }
    raw["admission"]["build"] = json!("26407089");
    assert!(parse(&raw).is_err());
    raw["admission"] = fixture()["admission"].clone();
    let mut session = Session::default();
    let mut fresh = parse(&raw).unwrap().fresh.unwrap();
    session.publish_recovery(0, &mut fresh);
    assert!(fresh.session.is_some());
    let token = session.mutation.as_ref().unwrap().token.clone();
    let mut superseded = parse(&raw).unwrap().fresh.unwrap();
    session.publish_recovery(0, &mut superseded);
    assert!(superseded.session.is_none());
    assert!(superseded.admission.is_none());
    assert_eq!(session.mutation.as_ref().unwrap().token, token);
    raw["admission"] = Value::Null;
    let mut read_only = parse(&raw).unwrap().fresh.unwrap();
    session.publish_recovery(1, &mut read_only);
    assert!(read_only.session.is_none());
    assert!(session.mutation.is_none());
    assert!(session.recovery.is_none());
}

#[test]
fn blocked_state_revokes_all_previous_authority() {
    let mut state = decode(fixture()).unwrap();
    let mut session = Session::default();
    session.issue(&mut state);
    session.issue(&mut disabled("blocked"));
    assert!(session.mutation.is_none());
    assert!(session.recovery.is_none());
}
#[test]
fn exact_action_union_rejects_unknown_duplicate_sparse_ineligible_and_mixed_payloads() {
    for ids in [
        json!([0, 2]),
        json!([0, 0]),
        json!([999]),
        json!([true]),
        json!([1.5]),
        json!([-1]),
    ] {
        let raw =
            json!({"metaCosmetics":{"action":"unlockIds","ids":ids,"admission":"b".repeat(64)}});
        let valid = serde_json::from_value::<Intent>(raw).is_ok_and(|i| i.valid());
        assert_eq!(valid, ids == json!([0, 2]));
    }
    for raw in [
        json!({"metaCosmetics":{"action":"equip","admission":"b".repeat(64)}}),
        json!({"metaCosmetics":{"action":"unlockAll","ids":[0],"admission":"b".repeat(64)}}),
        json!({"metaCosmetics":{"action":"unlockAll","admission":"b".repeat(64)},"health":[]}),
    ] {
        assert!(serde_json::from_value::<Intent>(raw).is_err());
    }
}
#[test]
fn pending_and_results_require_fingerprint_backup_and_explicit_validated_view() {
    let mut raw = fixture();
    raw["state"] = json!("pending");
    raw["pending"] = json!({"operationId":"d".repeat(32),"status":"applied","fingerprint":"f".repeat(64),"backupAvailable":true,"proof":"e".repeat(64),"intent":null});
    assert!(decode(raw).is_err());
    let id = "d".repeat(32);
    let result = json!({"ok":true,"operationId":id,"status":"applied","fingerprint":"a".repeat(64),"backupAvailable":true,"view":fixture()["view"]});
    assert!(parse_result(&serde_json::to_vec(&result).unwrap(), &id).is_ok());
    for key in ["fingerprint", "view", "backupAvailable"] {
        let mut bad = result.clone();
        bad[key] = Value::Null;
        assert!(parse_result(&serde_json::to_vec(&bad).unwrap(), &id).is_err());
    }
}
