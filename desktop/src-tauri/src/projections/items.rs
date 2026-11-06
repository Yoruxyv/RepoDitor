//! Validate the Python Items projection; recharge evidence and artwork stay private.
use super::{artwork, saves};
use crate::{
    backend::process::STDOUT_LIMIT,
    error::{json, BackendError},
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashSet;

const SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
enum DomainKey {
    Items,
    CurrentCharge,
    BatteryUpgrades,
    PurchasedUpgrades,
    PurchasedItems,
    PurchasedItemsTotal,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Evidence {
    Confirmed,
    PartiallyConfirmed,
    Unknown,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    can_read: bool,
    can_edit: bool,
    can_add: bool,
    can_delete: bool,
    can_duplicate: bool,
    can_refill_to_full: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Domain {
    key: DomainKey,
    label: String,
    status: Evidence,
    #[serde(deserialize_with = "nullable_integer")]
    entry_count: Option<i64>,
    capabilities: Capabilities,
}
#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Charge {
    Stored,
    DefaultFull,
    NotApplicable,
    Unknown,
}
#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Recharge {
    Rechargeable,
    NotRechargeable,
    Unknown,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    save_key: String,
    name: String,
    instance_id: String,
    is_upgrade: bool,
    #[serde(deserialize_with = "nullable_integer")]
    stored_charge: Option<i64>,
    charge_state: Charge,
    recharge_capability: Recharge,
    can_refill_to_full: bool,
    #[serde(skip_serializing)]
    icon_key: Value,
    #[serde(default, skip_serializing)]
    upgrade_visual_key: Option<String>,
    #[serde(skip_deserializing)]
    icon_token: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advanced {
    domains: Vec<Domain>,
    items: Vec<Item>,
    unlinked_charge_entry_count: i64,
}

fn nullable_integer<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    Option::<i64>::deserialize(deserializer)
}

pub fn parse(bytes: &[u8]) -> Result<Advanced, BackendError> {
    // The frame bounds every array/string without imposing a separate item catalog/size limit.
    if bytes.len() > STDOUT_LIMIT {
        return Err(BackendError::Invalid);
    }
    let mut raw = json(bytes)?;
    if raw.get("ok") == Some(&Value::Bool(false)) {
        return Err(saves::read_error(&raw)?);
    }
    if raw.get("ok") != Some(&Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let advanced: Advanced =
        serde_json::from_value(raw.get_mut("advanced").ok_or(BackendError::Invalid)?.take())
            .map_err(|_| BackendError::Invalid)?;
    let mut domains = HashSet::new();
    if advanced.domains.len() != 6
        || !(0..=SAFE_INTEGER).contains(&advanced.unlinked_charge_entry_count)
    {
        return Err(BackendError::Invalid);
    }
    for domain in &advanced.domains {
        let caps = &domain.capabilities;
        if !domains.insert(&domain.key)
            || domain.label.trim().is_empty()
            || domain
                .entry_count
                .is_some_and(|value| !(0..=SAFE_INTEGER).contains(&value))
            || caps.can_edit
            || caps.can_add
            || caps.can_delete
            || caps.can_duplicate
            || (caps.can_refill_to_full
                && (domain.key != DomainKey::CurrentCharge || !caps.can_read))
        {
            return Err(BackendError::Invalid);
        }
    }
    let mut identities = HashSet::new();
    let refill_supported = advanced.domains.iter().any(|domain| {
        domain.key == DomainKey::CurrentCharge && domain.capabilities.can_refill_to_full
    });
    for item in &advanced.items {
        if !identities.insert(&item.save_key)
            || item.name.trim().is_empty()
            || item.instance_id.is_empty()
            || !item.instance_id.bytes().all(|b| b.is_ascii_digit())
            || item.save_key != format!("Item {}/{}", item.name, item.instance_id)
            || item
                .stored_charge
                .is_some_and(|value| !(-SAFE_INTEGER..=SAFE_INTEGER).contains(&value))
            || (item.charge_state == Charge::Stored) != item.stored_charge.is_some()
            || (item.charge_state == Charge::DefaultFull
                && item.recharge_capability != Recharge::Rechargeable)
            || (item.charge_state == Charge::NotApplicable
                && item.recharge_capability != Recharge::NotRechargeable)
            || (item.can_refill_to_full
                && (item.charge_state != Charge::Stored
                    || item.recharge_capability != Recharge::Rechargeable))
            || (item.can_refill_to_full && !refill_supported)
            || !artwork::valid_icon_key(&item.icon_key)
            || item
                .upgrade_visual_key
                .as_ref()
                .is_some_and(|key| !item.is_upgrade || !saves::valid_upgrade_key(key))
        {
            return Err(BackendError::Invalid);
        }
    }
    Ok(advanced)
}

#[cfg(test)]
mod tests {
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
        assert!(decode(
            json!({"ok":false,"error":{"code":"save_write_failed","message":"private"}})
        )
        .is_err());
    }
}
