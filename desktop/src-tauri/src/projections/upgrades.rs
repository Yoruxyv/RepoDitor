//! Validate Python's dynamic upgrade DTOs; optional artwork never crosses as a URL.
use super::{artwork::valid_icon_key, players, saves};
use crate::error::{json, BackendError};
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
    pub(crate) key: String,
    label: String,
    presentation_source: PresentationSource,
    #[serde(deserialize_with = "nullable_integer")]
    gameplay_cap: Option<i64>,
    #[serde(skip_serializing)]
    icon_key: Value,
    #[serde(skip_deserializing)]
    pub(crate) icon_token: Option<String>,
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
#[path = "../../tests/unit/projections/upgrades.rs"]
mod tests;
