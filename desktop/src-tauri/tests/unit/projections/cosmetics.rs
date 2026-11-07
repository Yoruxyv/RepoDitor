use super::*;
use serde_json::json;

fn unknown(id: i64) -> Value {
    json!({"id":id,"displayName":format!("Cosmetic #{id}"),"type":null,"rarity":null,"status":null,
            "owned":true,"known":false,"state":"unknown","mutationEligible":false,
            "removalBlockedReason":"Preserved read-only","iconKey":null})
}
fn response(count: usize) -> Value {
    let evidence: Value = serde_json::from_str(include_str!(
        "../../../../../tools/capabilities/evidence/cosmetics.v2.json"
    ))
    .unwrap();
    let proven = evidence
        .pointer("/installedCatalog/exactIds")
        .unwrap()
        .as_array()
        .unwrap();
    let mut cosmetics: Vec<Value> = (0..count).map(|id| {
            let eligible = proven.contains(&json!(id));
            json!({"id":id,"displayName":format!("Installed {id}"),"type":-1,"rarity":7,"status":-2,
                "owned":id==0,"known":true,"state":if id==0 {"owned"} else {"locked"},
                "mutationEligible":eligible,"removalBlockedReason":if eligible {Value::Null} else {json!("Outside policy")},
                "iconKey":null,"iconToken":"https://untrusted","privateField":"must not leak"})
        }).collect();
    cosmetics.extend([unknown(-7), unknown(999)]);
    json!({"ok":true,"cosmetics":{"fingerprint":"a".repeat(64),"catalogAvailable":count>0,
            "knownCatalogCount":count,"knownOwnedCount":usize::from(count>0),"knownLockedCount":count.saturating_sub(1),
            "savedPresetCount":2,"unknownOwnedIds":[-7,999],
            "capabilities":{"canReadCosmetics":true,"canUnlockCosmetic":count>0,"canUnlockAll":count>0,"canRemoveOwnership":count>0,"canClearPresets":true},
            "cosmetics":cosmetics,"rawMetaSave":{"secret":"not public"}}})
}
fn decode(raw: Value) -> Result<Cosmetics, BackendError> {
    parse(&serde_json::to_vec(&raw).unwrap())
}

#[test]
fn preserves_partial_missing_future_and_unknown_catalogs_without_artwork_or_private_fields() {
    for count in [0, 1, 3, 559] {
        let value = serde_json::to_value(decode(response(count)).unwrap()).unwrap();
        assert_eq!(value["knownCatalogCount"], count);
        assert_eq!(value["unknownOwnedIds"], json!([-7, 999]));
        assert_eq!(value["savedPresetCount"], 2);
        assert!(value.get("rawMetaSave").is_none());
        for item in value["cosmetics"].as_array().unwrap() {
            assert!(item["iconToken"].is_null());
            assert!(item.get("iconKey").is_none());
            assert!(item.get("privateField").is_none());
        }
        if count == 559 {
            assert_eq!(value["cosmetics"][558]["mutationEligible"], false);
        }
    }
    let mut empty = response(0);
    empty["cosmetics"]["cosmetics"] = json!([]);
    empty["cosmetics"]["unknownOwnedIds"] = json!([]);
    assert!(decode(empty).is_ok());
}

#[test]
fn readable_catalog_may_deny_all_mutations_without_expanding_the_proven_set() {
    let mut raw = response(558);
    for row in raw["cosmetics"]["cosmetics"].as_array_mut().unwrap() {
        row["mutationEligible"] = json!(false);
        row["removalBlockedReason"] = json!("Installed build is not approved for mutation");
    }
    for field in [
        "canUnlockCosmetic",
        "canUnlockAll",
        "canRemoveOwnership",
        "canClearPresets",
    ] {
        raw["cosmetics"]["capabilities"][field] = json!(false);
    }
    assert!(decode(raw.clone()).is_ok());
    raw["cosmetics"]["cosmetics"][557]["mutationEligible"] = json!(true);
    assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid);
}

#[test]
fn preset_clearing_is_required_boolean_authority_independent_of_ownership() {
    let raw = response(0);
    assert!(decode(raw.clone()).is_ok());
    for bad in [Value::Null, json!(1), json!("true")] {
        let mut value = raw.clone();
        value["cosmetics"]["capabilities"]["canClearPresets"] = bad;
        assert!(decode(value).is_err());
    }
    let mut absent = raw;
    absent["cosmetics"]["capabilities"]
        .as_object_mut()
        .unwrap()
        .remove("canClearPresets");
    assert!(decode(absent).is_err());
}

#[test]
fn preserves_signed_safe_metadata_whole_json_numbers_and_blocked_eligible_entries() {
    for value in [
        json!(-9007199254740991i64),
        json!(0.0),
        json!(9007199254740991i64),
    ] {
        let mut raw = response(1);
        raw["cosmetics"]["cosmetics"][0]["type"] = value;
        raw["cosmetics"]["cosmetics"][0]["removalBlockedReason"] = json!("Equipped cosmetic");
        assert!(decode(raw).is_ok());
    }
    let mut raw = response(0);
    raw["cosmetics"]["cosmetics"] = json!([unknown(-9007199254740991), unknown(9007199254740991)]);
    raw["cosmetics"]["unknownOwnedIds"] = json!([-9007199254740991i64, 9007199254740991i64]);
    raw["cosmetics"]["savedPresetCount"] = json!(9007199254740991i64);
    assert!(decode(raw).is_ok());
}

#[test]
fn frozen_policy_matches_both_existing_generated_consumers() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../../../../../tools/capabilities/evidence/cosmetics.v2.json"
    ))
    .unwrap();
    let expected: Vec<i64> = evidence
        .pointer("/installedCatalog/exactIds")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_i64().unwrap())
        .collect();
    for generated in [
        include_str!("../../../../python/repo_save_editor/services/cosmetics/known_cosmetics.py"),
        include_str!("../../../../electron/ipc/known-cosmetics.cts"),
    ] {
        let actual: Vec<i64> = generated
            .lines()
            .filter_map(|line| line.trim().trim_end_matches(',').parse().ok())
            .collect();
        assert_eq!(actual, expected);
    }
}

#[test]
fn rejects_bad_counts_capabilities_fingerprints_and_unknown_order() {
    for (field, value) in [
        ("fingerprint", json!("A".repeat(64))),
        ("fingerprint", json!("a".repeat(63))),
        ("fingerprint", json!(format!("{}\n", "a".repeat(64)))),
        ("catalogAvailable", json!(false)),
        ("catalogAvailable", json!(1)),
        ("knownCatalogCount", json!(-1)),
        ("knownOwnedCount", json!(0)),
        ("knownLockedCount", json!(5)),
        ("savedPresetCount", json!(-1)),
        ("savedPresetCount", json!(9007199254740992i64)),
        ("savedPresetCount", json!(1.5)),
        ("unknownOwnedIds", json!([999, -7])),
        ("unknownOwnedIds", json!([-7, -7])),
        ("unknownOwnedIds", json!([-7, true])),
        ("cosmetics", Value::Null),
    ] {
        let mut raw = response(3);
        raw["cosmetics"][field] = value;
        assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
    }
    for field in [
        "canReadCosmetics",
        "canUnlockCosmetic",
        "canUnlockAll",
        "canRemoveOwnership",
    ] {
        for value in [json!(false), json!(1), Value::Null] {
            let mut raw = response(3);
            raw["cosmetics"]["capabilities"][field] = value;
            assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
        }
    }
}

#[test]
fn rejects_invalid_rows_missing_fields_and_duplicate_identities() {
    for (field, value) in [
        ("id", json!(1)),
        ("id", json!(true)),
        ("type", Value::Null),
        ("type", json!(9007199254740992i64)),
        ("rarity", json!(1.5)),
        ("status", json!(false)),
        ("state", json!("locked")),
        ("known", json!(false)),
        ("mutationEligible", json!(false)),
        ("displayName", json!("\u{feff} ")),
        ("iconKey", json!("../private.png")),
        ("removalBlockedReason", json!(" ")),
    ] {
        let mut raw = response(3);
        raw["cosmetics"]["cosmetics"][0][field] = value;
        assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
    }
    for (field, value) in [
        ("owned", json!(false)),
        ("displayName", json!("Invented")),
        ("state", json!("owned")),
        ("type", json!(0)),
        ("mutationEligible", json!(true)),
        ("removalBlockedReason", Value::Null),
    ] {
        let mut raw = response(0);
        raw["cosmetics"]["cosmetics"][0][field] = value;
        assert_eq!(
            decode(raw).unwrap_err(),
            BackendError::Invalid,
            "unknown {field}"
        );
    }
    for field in [
        "id",
        "displayName",
        "type",
        "rarity",
        "status",
        "owned",
        "known",
        "state",
        "mutationEligible",
        "removalBlockedReason",
        "iconKey",
    ] {
        let mut raw = response(3);
        raw["cosmetics"]["cosmetics"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert_eq!(
            decode(raw).unwrap_err(),
            BackendError::Invalid,
            "missing {field}"
        );
    }
    let mut raw = response(0);
    raw["cosmetics"]["cosmetics"][1] = raw["cosmetics"]["cosmetics"][0].clone();
    raw["cosmetics"]["unknownOwnedIds"] = json!([-7, -7]);
    assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid);
}

#[test]
fn validates_framing_and_allows_only_sanitized_established_cosmetics_errors() {
    for raw in [
        json!(null),
        json!([]),
        json!({"ok":1}),
        json!({"ok":true}),
        json!({"ok":false}),
        json!({"ok":false,"error":{"code":"save_corrupt","message":"private"}}),
    ] {
        assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid);
    }
    for code in [
        "meta_missing",
        "save_missing",
        "save_decrypt_failed",
        "save_unsupported",
        "backend_unavailable",
        "game_running",
        "game_status_unknown",
        "invalid_request",
        "save_stale",
        "save_validation_failed",
        "backup_failed",
        "save_write_failed",
        "save_verification_failed",
    ] {
        let public = serde_json::to_value(crate::error::Outcome::for_service(
            decode(json!({"ok":false,"error":{"code":code,"message":"private path"}})),
            crate::error::Service::Cosmetics,
        ))
        .unwrap();
        assert_eq!(public["error"]["code"], code);
        assert!(!public.to_string().contains("private"));
    }
    assert_eq!(parse(b" ").unwrap_err(), BackendError::Empty);
    assert_eq!(parse(b"{").unwrap_err(), BackendError::Malformed);
}
