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
#[path = "../../tests/unit/projections/items.rs"]
mod tests;
