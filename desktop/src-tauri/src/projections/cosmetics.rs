//! Validate the public MetaSave projection; Python owns catalog and ownership semantics.
use super::{artwork::valid_icon_key, saves};
use crate::error::{json, BackendError};
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
    can_clear_presets: bool,
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
        "../../../../tools/capabilities/evidence/cosmetics.v2.json"
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
                || (cosmetic.mutation_eligible && !proven.contains(&cosmetic.id))
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
#[path = "../../tests/unit/projections/cosmetics.rs"]
mod tests;
