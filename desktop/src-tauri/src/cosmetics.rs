//! Validate the public MetaSave projection; Python owns catalog and ownership semantics.
use crate::{
    artwork::valid_icon_key,
    error::{json, BackendError},
    saves,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Number, Value};
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cosmetics {
    fingerprint: String,
    catalog_available: bool,
    #[serde(deserialize_with = "safe_integer")]
    known_catalog_count: i64,
    #[serde(deserialize_with = "safe_integer")]
    known_owned_count: i64,
    #[serde(deserialize_with = "safe_integer")]
    known_locked_count: i64,
    #[serde(deserialize_with = "safe_integer")]
    saved_preset_count: i64,
    #[serde(deserialize_with = "safe_ids")]
    unknown_owned_ids: Vec<i64>,
    capabilities: Capabilities,
    cosmetics: Vec<Cosmetic>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    can_read_cosmetics: bool,
    can_unlock_cosmetic: bool,
    can_unlock_all: bool,
    can_remove_ownership: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cosmetic {
    #[serde(deserialize_with = "safe_integer")]
    id: i64,
    display_name: String,
    #[serde(rename = "type", deserialize_with = "nullable_integer")]
    cosmetic_type: Option<i64>,
    #[serde(deserialize_with = "nullable_integer")]
    rarity: Option<i64>,
    #[serde(deserialize_with = "nullable_integer")]
    status: Option<i64>,
    owned: bool,
    known: bool,
    state: String,
    mutation_eligible: bool,
    #[serde(deserialize_with = "nullable_string")]
    removal_blocked_reason: Option<String>,
    #[serde(skip_serializing)]
    icon_key: Value,
    #[serde(skip_deserializing)]
    icon_token: Option<String>,
}

fn integer<E: serde::de::Error>(value: Number) -> Result<i64, E> {
    value
        .as_f64()
        .filter(|n| n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0)
        .map(|n| n as i64)
        .ok_or_else(|| E::custom("Expected a JavaScript-safe integer"))
}
fn safe_integer<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    integer(Number::deserialize(deserializer)?)
}
fn nullable_integer<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    Option::<Number>::deserialize(deserializer)?
        .map(integer)
        .transpose()
}
fn safe_ids<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<i64>, D::Error> {
    Vec::<Number>::deserialize(deserializer)?
        .into_iter()
        .map(integer)
        .collect()
}
fn nullable_string<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
fn nonblank(value: &str) -> bool {
    !value
        .trim_matches(|c: char| (c.is_whitespace() && c != '\u{0085}') || c == '\u{feff}')
        .is_empty()
}

pub fn parse(bytes: &[u8]) -> Result<Cosmetics, BackendError> {
    let mut raw = json(bytes)?;
    if raw.get("ok") == Some(&Value::Bool(false)) {
        if !matches!(
            raw.pointer("/error/code").and_then(Value::as_str),
            Some(
                "invalid_request"
                    | "game_running"
                    | "game_status_unknown"
                    | "save_missing"
                    | "meta_missing"
                    | "save_decrypt_failed"
                    | "save_unsupported"
                    | "backend_unavailable"
                    | "save_stale"
                    | "save_validation_failed"
                    | "backup_failed"
                    | "save_write_failed"
                    | "save_verification_failed"
            )
        ) {
            return Err(BackendError::Invalid);
        }
        return Err(saves::domain_error(&raw)?);
    }
    if raw.get("ok") != Some(&Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let view: Cosmetics = serde_json::from_value(
        raw.get_mut("cosmetics")
            .ok_or(BackendError::Invalid)?
            .take(),
    )
    .map_err(|_| BackendError::Invalid)?;
    if view.fingerprint.len() != 64
        || !view
            .fingerprint
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(BackendError::Invalid);
    }
    // Reuse the exact evidence behind Python/Electron's generated policy, never a catalog/range.
    let evidence: Value = serde_json::from_str(include_str!(
        "../../../tools/capabilities/evidence/cosmetics.v2.json"
    ))
    .map_err(|_| BackendError::Invalid)?;
    let proven: HashSet<i64> = evidence
        .pointer("/installedCatalog/exactIds")
        .and_then(Value::as_array)
        .ok_or(BackendError::Invalid)?
        .iter()
        .map(|id| id.as_i64().ok_or(BackendError::Invalid))
        .collect::<Result<_, _>>()?;
    let mut identities = HashSet::new();
    let mut known = 0;
    let mut owned = 0;
    let mut mutation_available = false;
    let mut unknown = Vec::new();
    for cosmetic in &view.cosmetics {
        if !identities.insert(cosmetic.id)
            || !nonblank(&cosmetic.display_name)
            || !valid_icon_key(&cosmetic.icon_key)
            || cosmetic
                .removal_blocked_reason
                .as_deref()
                .is_some_and(|reason| !nonblank(reason))
        {
            return Err(BackendError::Invalid);
        }
        if cosmetic.known {
            if cosmetic.id != known
                || cosmetic.cosmetic_type.is_none()
                || cosmetic.rarity.is_none()
                || cosmetic.status.is_none()
                || cosmetic.state != if cosmetic.owned { "owned" } else { "locked" }
                || cosmetic.mutation_eligible != proven.contains(&cosmetic.id)
                || (!cosmetic.mutation_eligible && cosmetic.removal_blocked_reason.is_none())
            {
                return Err(BackendError::Invalid);
            }
            known += 1;
            owned += i64::from(cosmetic.owned);
            mutation_available |= cosmetic.mutation_eligible;
        } else {
            if !cosmetic.owned
                || cosmetic.display_name != format!("Cosmetic #{}", cosmetic.id)
                || cosmetic.cosmetic_type.is_some()
                || cosmetic.rarity.is_some()
                || cosmetic.status.is_some()
                || cosmetic.state != "unknown"
                || cosmetic.mutation_eligible
                || cosmetic.removal_blocked_reason.is_none()
            {
                return Err(BackendError::Invalid);
            }
            unknown.push(cosmetic.id);
        }
    }
    if view.known_catalog_count < 0
        || view.known_owned_count < 0
        || view.known_locked_count < 0
        || view.saved_preset_count < 0
        || view.known_owned_count + view.known_locked_count != view.known_catalog_count
        || known != view.known_catalog_count
        || owned != view.known_owned_count
        || known - owned != view.known_locked_count
        || view.catalog_available != (known > 0)
        || view.unknown_owned_ids != unknown
        || !view.capabilities.can_read_cosmetics
        || view.capabilities.can_unlock_cosmetic != mutation_available
        || view.capabilities.can_unlock_all != mutation_available
        || view.capabilities.can_remove_ownership != mutation_available
    {
        return Err(BackendError::Invalid);
    }
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unknown(id: i64) -> Value {
        json!({"id":id,"displayName":format!("Cosmetic #{id}"),"type":null,"rarity":null,"status":null,
            "owned":true,"known":false,"state":"unknown","mutationEligible":false,
            "removalBlockedReason":"Preserved read-only","iconKey":null})
    }
    fn response(count: usize) -> Value {
        let evidence: Value = serde_json::from_str(include_str!(
            "../../../tools/capabilities/evidence/cosmetics.v2.json"
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
            "capabilities":{"canReadCosmetics":true,"canUnlockCosmetic":count>0,"canUnlockAll":count>0,"canRemoveOwnership":count>0},
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
        raw["cosmetics"]["cosmetics"] =
            json!([unknown(-9007199254740991), unknown(9007199254740991)]);
        raw["cosmetics"]["unknownOwnedIds"] = json!([-9007199254740991i64, 9007199254740991i64]);
        raw["cosmetics"]["savedPresetCount"] = json!(9007199254740991i64);
        assert!(decode(raw).is_ok());
    }

    #[test]
    fn frozen_policy_matches_both_existing_generated_consumers() {
        let evidence: Value = serde_json::from_str(include_str!(
            "../../../tools/capabilities/evidence/cosmetics.v2.json"
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
            include_str!("../../python/repo_save_editor/services/cosmetics/known_cosmetics.py"),
            include_str!("../../electron/ipc/known-cosmetics.cts"),
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
}
