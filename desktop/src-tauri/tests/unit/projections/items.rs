use super::*;
use serde_json::json;
fn response() -> Value {
    let domains:Vec<_>=["items","currentCharge","batteryUpgrades","purchasedUpgrades","purchasedItems","purchasedItemsTotal"].iter().map(|key|json!({"key":key,"label":key,"status":"partially_confirmed","entryCount":null,"capabilities":{"canRead":true,"canEdit":false,"canAdd":false,"canDelete":false,"canDuplicate":false,"canRefillToFull":*key=="currentCharge"}})).collect();
    json!({"ok":true,"advanced":{"domains":domains,"items":[{"saveKey":"Item Future Tool/1","name":"Future Tool","instanceId":"1","isUpgrade":false,"storedCharge":99,"chargeState":"stored","rechargeCapability":"rechargeable","canRefillToFull":true,"iconKey":null,"iconToken":"untrusted","rawValue":123}],"unlinkedChargeEntryCount":2,"rawSave":"private"},"rechargeEvidence":{"installationRoot":"private"}})
}
fn decode(raw: Value) -> Result<Advanced, BackendError> {
    parse(&serde_json::to_vec(&raw).unwrap())
}
#[test]
fn preserves_evidence_nullable_counts_and_signed_charge_without_artwork_or_write_evidence() {
    for (charge, recharge, value, can_refill) in [
        ("stored", "rechargeable", json!(99), true),
        ("stored", "unknown", json!(-9_007_199_254_740_991i64), false),
        (
            "stored",
            "not_rechargeable",
            json!(9_007_199_254_740_991i64),
            false,
        ),
        ("default_full", "rechargeable", Value::Null, false),
        ("not_applicable", "not_rechargeable", Value::Null, false),
        ("unknown", "unknown", Value::Null, false),
    ] {
        let mut raw = response();
        let item = &mut raw["advanced"]["items"][0];
        item["chargeState"] = json!(charge);
        item["rechargeCapability"] = json!(recharge);
        item["storedCharge"] = value;
        item["canRefillToFull"] = json!(can_refill);
        let output = serde_json::to_value(decode(raw).unwrap()).unwrap();
        assert_eq!(output["domains"].as_array().unwrap().len(), 6);
        assert_eq!(output["items"][0]["chargeState"], charge);
        assert!(output["items"][0]["iconToken"].is_null());
        for field in ["iconKey", "upgradeVisualKey", "rawValue"] {
            assert!(output["items"][0].get(field).is_none());
        }
        assert!(!output.to_string().contains("private"));
        assert!(!output.to_string().contains("rechargeEvidence"));
    }
    for status in ["confirmed", "partially_confirmed", "unknown"] {
        let mut raw = response();
        raw["advanced"]["domains"][0]["status"] = json!(status);
        assert!(decode(raw).is_ok());
    }
    let mut raw = response();
    raw["advanced"]["items"] = json!([]);
    assert!(decode(raw).is_ok());
}
#[test]
fn requires_all_six_unique_domains_and_well_typed_capabilities() {
    for (field, value) in [
        ("key", json!("other")),
        ("label", json!(" ")),
        ("status", json!("guessed")),
        ("entryCount", json!(-1)),
        ("entryCount", json!(9_007_199_254_740_992i64)),
        ("entryCount", json!(false)),
    ] {
        let mut raw = response();
        raw["advanced"]["domains"][0][field] = value;
        assert!(decode(raw).is_err());
    }
    for key in [
        "canEdit",
        "canAdd",
        "canDelete",
        "canDuplicate",
        "canRefillToFull",
    ] {
        let mut raw = response();
        raw["advanced"]["domains"][0]["capabilities"][key] = json!(true);
        assert!(decode(raw).is_err());
    }
    let mut raw = response();
    raw["advanced"]["domains"][0]["capabilities"]["canRead"] = json!(1);
    assert!(decode(raw).is_err());
    let mut raw = response();
    raw["advanced"]["domains"][0] = raw["advanced"]["domains"][1].clone();
    assert!(decode(raw).is_err());
    let mut raw = response();
    raw["advanced"]["domains"].as_array_mut().unwrap().pop();
    assert!(decode(raw).is_err());
    let mut raw = response();
    raw["advanced"]["domains"][1]["capabilities"]["canRead"] = json!(false);
    assert!(decode(raw).is_err());
    for field in ["entryCount", "capabilities"] {
        let mut raw = response();
        raw["advanced"]["domains"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(decode(raw).is_err());
    }
}
#[test]
fn rejects_malformed_ambiguous_and_inconsistent_item_metadata() {
    for (field, value) in [
        ("saveKey", json!("../save")),
        ("saveKey", json!("Item Other/1")),
        ("instanceId", json!("2")),
        ("instanceId", json!("")),
        ("instanceId", json!("../1")),
        ("name", json!(" ")),
        ("isUpgrade", json!("yes")),
        ("storedCharge", json!(true)),
        ("storedCharge", json!(1.5)),
        ("storedCharge", json!(9_007_199_254_740_992i64)),
        ("chargeState", json!("guessed")),
        ("rechargeCapability", json!("guessed")),
        ("canRefillToFull", json!(1)),
        ("iconKey", json!("../secret.png")),
        ("iconKey", json!("https://secret.png")),
        ("upgradeVisualKey", json!("playerUpgradeHealth")),
    ] {
        let mut raw = response();
        raw["advanced"]["items"][0][field] = value;
        assert!(decode(raw).is_err(), "{field}");
    }
    for field in [
        "storedCharge",
        "iconKey",
        "saveKey",
        "instanceId",
        "chargeState",
    ] {
        let mut raw = response();
        raw["advanced"]["items"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(decode(raw).is_err(), "missing {field}");
    }
    let mut raw = response();
    let item = raw["advanced"]["items"][0].clone();
    raw["advanced"]["items"] = json!([item, item]);
    assert!(decode(raw).is_err());
    for (state, capability, charge, refill) in [
        ("stored", "rechargeable", Value::Null, true),
        ("unknown", "unknown", json!(1), false),
        ("default_full", "unknown", Value::Null, false),
        ("not_applicable", "rechargeable", Value::Null, false),
        ("unknown", "rechargeable", Value::Null, true),
        ("stored", "unknown", json!(1), true),
    ] {
        let mut raw = response();
        let item = &mut raw["advanced"]["items"][0];
        item["chargeState"] = json!(state);
        item["rechargeCapability"] = json!(capability);
        item["storedCharge"] = charge;
        item["canRefillToFull"] = json!(refill);
        assert!(decode(raw).is_err());
    }
    let mut raw = response();
    raw["advanced"]["domains"][1]["capabilities"]["canRefillToFull"] = json!(false);
    assert!(decode(raw).is_err());
}
#[test]
fn validates_optional_upgrade_artwork_and_exact_instance_identity() {
    let mut raw = response();
    let item = &mut raw["advanced"]["items"][0];
    item["isUpgrade"] = json!(true);
    item["upgradeVisualKey"] = json!("playerUpgradeHealth");
    item["iconKey"] = json!("health.png");
    assert!(decode(raw.clone()).is_ok());
    for key in [
        "playerUpgrade".to_string(),
        "playerUpgrade\0X".to_string(),
        format!("playerUpgrade{}", "x".repeat(512)),
    ] {
        let mut broken = raw.clone();
        broken["advanced"]["items"][0]["upgradeVisualKey"] = json!(key);
        assert!(decode(broken).is_err());
    }
    let mut raw = response();
    let mut second = raw["advanced"]["items"][0].clone();
    second["instanceId"] = json!("2");
    second["saveKey"] = json!("Item Future Tool/2");
    raw["advanced"]["items"]
        .as_array_mut()
        .unwrap()
        .push(second);
    assert!(decode(raw).is_ok());
}
#[test]
fn bounds_frames_counts_and_sanitized_failures() {
    assert!(parse(&vec![b' '; STDOUT_LIMIT + 1]).is_err());
    for value in [json!(-1), json!(9_007_199_254_740_992i64), Value::Null] {
        let mut raw = response();
        raw["advanced"]["unlinkedChargeEntryCount"] = value;
        assert!(decode(raw).is_err());
    }
    for field in ["domains", "items", "unlinkedChargeEntryCount"] {
        let mut raw = response();
        raw["advanced"].as_object_mut().unwrap().remove(field);
        assert!(decode(raw).is_err());
    }
    assert!(decode(json!({"ok":true})).is_err());
    assert_eq!(parse(b"{").unwrap_err(), BackendError::Malformed);
    assert_eq!(parse(b" ").unwrap_err(), BackendError::Empty);
    for code in [
        "invalid_request",
        "save_missing",
        "save_corrupt",
        "save_decrypt_failed",
        "save_unsupported",
        "backend_unavailable",
    ] {
        let output = crate::error::Outcome::<Advanced>::for_service(
            decode(json!({"ok":false,"error":{"code":code,"message":"private path"}})),
            crate::error::Service::Items,
        );
        let value = serde_json::to_value(output).unwrap();
        assert_eq!(value["error"]["code"], code);
        assert!(!value.to_string().contains("private"));
    }
    assert!(
        decode(json!({"ok":false,"error":{"code":"save_write_failed","message":"private"}}))
            .is_err()
    );
}
