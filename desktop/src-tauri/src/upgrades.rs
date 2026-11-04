//! Validate Python's dynamic upgrade DTOs; optional artwork never crosses as a URL.
use crate::{
    artwork::valid_icon_key,
    error::{json, BackendError},
    players, saves,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum PresentationSource {
    Installed,
    Alias,
    Humanized,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerValue {
    player_id: String,
    value: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upgrade {
    key: String,
    label: String,
    presentation_source: PresentationSource,
    #[serde(deserialize_with = "nullable_integer")]
    gameplay_cap: Option<i64>,
    #[serde(skip_serializing)]
    icon_key: Value,
    #[serde(skip_deserializing)]
    icon_token: Option<String>,
    values: Vec<PlayerValue>,
}

// Null is valid presentation metadata; omission is a malformed DTO.
fn nullable_integer<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    Option::<i64>::deserialize(deserializer)
}

pub fn parse(bytes: &[u8]) -> Result<Vec<Upgrade>, BackendError> {
    let mut raw = json(bytes)?;
    if raw.get("ok") == Some(&Value::Bool(false)) {
        return Err(saves::read_error(&raw)?);
    }
    if raw.get("ok") != Some(&Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let upgrades: Vec<Upgrade> =
        serde_json::from_value(raw.get_mut("upgrades").ok_or(BackendError::Invalid)?.take())
            .map_err(|_| BackendError::Invalid)?;
    let mut keys = HashSet::new();
    let mut expected_players = None;
    for upgrade in &upgrades {
        if !saves::valid_upgrade_key(&upgrade.key)
            || !keys.insert(&upgrade.key)
            || upgrade.label.trim().is_empty()
            || upgrade
                .gameplay_cap
                .is_some_and(|cap| !(0..=9_007_199_254_740_991).contains(&cap))
            || !valid_icon_key(&upgrade.icon_key)
        {
            return Err(BackendError::Invalid);
        }
        let mut ids = HashSet::new();
        for entry in &upgrade.values {
            if !players::valid_id(&entry.player_id)
                || !ids.insert(&entry.player_id)
                || !(0..=9_007_199_254_740_991).contains(&entry.value)
            {
                return Err(BackendError::Invalid);
            }
        }
        if expected_players
            .as_ref()
            .is_some_and(|expected| expected != &ids)
        {
            return Err(BackendError::Invalid);
        }
        expected_players = Some(ids);
    }
    Ok(upgrades)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn response() -> Value {
        json!({"ok":true,"upgrades":[{"key":"playerUpgradeFutureBoost","label":"Future Boost","presentationSource":"humanized","gameplayCap":10,"iconKey":"boost.png","iconToken":"untrusted","values":[{"playerId":"111","value":2147483648i64},{"playerId":"222","value":0}]}]})
    }
    fn decode(raw: Value) -> Result<Vec<Upgrade>, BackendError> {
        parse(&serde_json::to_vec(&raw).unwrap())
    }
    #[test]
    fn preserves_dynamic_keys_and_values_above_caps_without_artwork_authority() {
        let value = serde_json::to_value(decode(response()).unwrap()).unwrap();
        assert_eq!(value[0]["key"], "playerUpgradeFutureBoost");
        assert_eq!(value[0]["values"][0]["value"], 2147483648i64);
        assert_eq!(value[0]["gameplayCap"], 10);
        assert!(value[0]["iconToken"].is_null());
        assert!(value[0].get("iconKey").is_none());
        assert!(decode(json!({"ok":true,"upgrades":[]})).unwrap().is_empty());
        for source in ["installed", "alias", "humanized"] {
            let mut raw = response();
            raw["upgrades"][0]["presentationSource"] = json!(source);
            raw["upgrades"][0]["gameplayCap"] = Value::Null;
            assert!(decode(raw).is_ok());
        }
    }
    #[test]
    fn rejects_invalid_and_missing_presentation_metadata() {
        for (field, value) in [
            ("key", json!("playerUpgrade")),
            ("key", json!("other")),
            ("key", json!("playerUpgrade\0X")),
            ("key", json!(format!("playerUpgrade{}", "x".repeat(512)))),
            ("label", json!(" ")),
            ("presentationSource", json!("invented")),
            ("gameplayCap", json!(-1)),
            ("gameplayCap", json!(1.5)),
            ("gameplayCap", json!(9007199254740992i64)),
            ("iconKey", json!("../boost.png")),
            ("iconKey", json!("A.png")),
            ("iconKey", json!("..png")),
            ("iconKey", json!(".png")),
            ("iconKey", json!(format!("{}.png", "a".repeat(257)))),
        ] {
            let mut raw = response();
            raw["upgrades"][0][field] = value;
            assert_eq!(decode(raw).unwrap_err(), BackendError::Invalid, "{field}");
        }
        for field in [
            "key",
            "label",
            "presentationSource",
            "gameplayCap",
            "iconKey",
            "values",
        ] {
            let mut raw = response();
            raw["upgrades"][0].as_object_mut().unwrap().remove(field);
            assert!(decode(raw).is_err(), "{field}");
        }
        assert_eq!(parse(b"{").unwrap_err(), BackendError::Malformed);
        assert_eq!(parse(b" ").unwrap_err(), BackendError::Empty);
    }
    #[test]
    fn rejects_duplicate_keys_invalid_values_and_inconsistent_players() {
        for entry in [
            json!({"playerId":"unknown","value":0}),
            json!({"playerId":"111","value":-1}),
            json!({"playerId":"111","value":9007199254740992i64}),
            json!({"playerId":"111","value":true}),
            json!({"playerId":"111"}),
        ] {
            let mut raw = response();
            raw["upgrades"][0]["values"][0] = entry;
            assert!(decode(raw).is_err());
        }
        let mut raw = response();
        raw["upgrades"][0]["values"][1]["playerId"] = json!("111");
        assert!(decode(raw).is_err());
        let mut raw = response();
        let mut second = raw["upgrades"][0].clone();
        raw["upgrades"].as_array_mut().unwrap().push(second.clone());
        assert!(decode(raw.clone()).is_err());
        second["key"] = json!("playerUpgradeAnother");
        second["values"] = json!([]);
        raw["upgrades"][1] = second;
        assert!(decode(raw).is_err());
    }
    #[test]
    fn read_failures_are_allowlisted_and_sanitized() {
        for code in [
            "invalid_request",
            "save_missing",
            "save_corrupt",
            "save_decrypt_failed",
            "save_unsupported",
            "backend_unavailable",
        ] {
            let result = crate::error::Outcome::<Vec<Upgrade>>::for_service(
                decode(json!({"ok":false,"error":{"code":code,"message":"private path"}})),
                crate::error::Service::Upgrade,
            );
            let value = serde_json::to_value(result).unwrap();
            assert_eq!(value["error"]["code"], code);
            assert!(!value.to_string().contains("private"));
        }
        assert!(decode(
            json!({"ok":false,"error":{"code":"save_write_failed","message":"private"}})
        )
        .is_err());
    }
}
