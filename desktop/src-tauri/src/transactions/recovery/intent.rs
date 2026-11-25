//! Bounded intent shapes for native requests and recovery projections.
use crate::projections::{players, saves};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthIntent {
    pub(super) player_id: String,
    pub(super) health: i64,
    pub(super) before: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthEdit {
    player_id: String,
    before: i64,
    value: i64,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HealthBatchIntent {
    health: Vec<HealthEdit>,
}

pub(super) fn valid_health_batch_intent(intent: &HealthBatchIntent) -> bool {
    let mut seen = std::collections::HashSet::new();
    !intent.health.is_empty()
        && intent.health.len() <= 512
        && intent.health.iter().all(|edit| {
            players::valid_id(&edit.player_id)
                && (0..=9_007_199_254_740_991).contains(&edit.before)
                && (0..=2_147_483_647).contains(&edit.value)
                && edit.before != edit.value
                && seen.insert(&edit.player_id)
        })
        && serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 2048)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpgradeEdit {
    player_id: String,
    key: String,
    value: i64,
    before: i64,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Intent {
    Health(HealthIntent),
    HealthBatch(HealthBatchIntent),
    Upgrades(UpgradeIntent),
    Run(RunIntent),
    Refill(RefillIntent),
    Mixed(MixedIntent),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MixedIntent {
    pub(super) mixed: Value,
}

pub(super) fn valid_mixed_intent(intent: &MixedIntent) -> bool {
    let Some(groups) = intent.mixed.as_object() else {
        return false;
    };
    if groups.len() != 4 || !serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 2048) {
        return false;
    }
    let mut populated = 0;
    for field in ["health", "upgrades", "run", "refillToFull"] {
        let Some(edits) = groups.get(field).and_then(Value::as_array) else {
            return false;
        };
        if edits.is_empty() {
            continue;
        }
        populated += 1;
        let group = json!({(field): edits});
        let valid = match field {
            "health" => serde_json::from_value::<HealthBatchIntent>(group)
                .is_ok_and(|i| valid_health_batch_intent(&i)),
            "upgrades" => serde_json::from_value::<UpgradeIntent>(group)
                .is_ok_and(|i| valid_upgrade_intent(&i)),
            "run" => serde_json::from_value::<RunIntent>(group).is_ok_and(|i| valid_run_intent(&i)),
            _ => {
                serde_json::from_value::<RefillIntent>(group).is_ok_and(|i| valid_refill_intent(&i))
            }
        };
        if !valid {
            return false;
        }
    }
    populated >= 2
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefillEdit {
    save_key: String,
    before: i64,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefillIntent {
    refill_to_full: Vec<RefillEdit>,
}
pub(super) fn valid_refill_intent(intent: &RefillIntent) -> bool {
    let mut seen = std::collections::HashSet::new();
    !intent.refill_to_full.is_empty()
        && intent.refill_to_full.len() <= 512
        && intent.refill_to_full.iter().all(|edit| {
            edit.save_key.rsplit_once('/').is_some_and(|(name, id)| {
                name.starts_with("Item ")
                    && name.len() > 5
                    && !name.contains(['\n', '\0'])
                    && !id.is_empty()
                    && id.bytes().all(|b| b.is_ascii_digit())
            }) && (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&edit.before)
                && seen.insert(&edit.save_key)
        })
        && serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 2048)
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeIntent {
    upgrades: Vec<UpgradeEdit>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RunEdit {
    field: String,
    before: Value,
    value: Value,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RunIntent {
    run: Vec<RunEdit>,
}
pub(super) fn valid_run_intent(intent: &RunIntent) -> bool {
    let mut seen = std::collections::HashSet::new();
    !intent.run.is_empty()
        && intent.run.len() <= 5
        && intent.run.iter().all(|edit| {
            edit.before != edit.value
                && seen.insert(&edit.field)
                && match edit.field.as_str() {
                    "resumeLocation" => {
                        edit.before.as_str().is_some_and(|s| s.len() <= 64)
                            && matches!(
                                edit.value.as_str(),
                                Some("Normal" | "Shop / Service Station")
                            )
                    }
                    "level" | "currency" | "lives" | "totalHaul" => {
                        let level = edit.field == "level";
                        edit.before.as_i64().is_some_and(|n| {
                            (if level { 1 } else { -9_007_199_254_740_991 }..=9_007_199_254_740_991)
                                .contains(&n)
                        }) && edit.value.as_i64().is_some_and(|n| {
                            (if level { 1 } else { -2_147_483_648 }..=if level {
                                2_147_483_648
                            } else {
                                2_147_483_647
                            })
                                .contains(&n)
                        })
                    }
                    _ => false,
                }
        })
        && serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 512)
}

pub(super) fn valid_upgrade_intent(intent: &UpgradeIntent) -> bool {
    let mut seen = std::collections::HashSet::new();
    !intent.upgrades.is_empty()
        && intent.upgrades.len() <= 512
        && intent.upgrades.iter().all(|edit| {
            players::valid_id(&edit.player_id)
                && saves::valid_upgrade_key(&edit.key)
                && (0..=2_147_483_647).contains(&edit.value)
                && (0..=9_007_199_254_740_991).contains(&edit.before)
                && edit.value != edit.before
                && seen.insert((&edit.player_id, &edit.key))
        })
        && serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 2048)
}

pub(super) fn valid_batch(field: &str, raw: &Value) -> bool {
    match field {
        "refillToFull" => {
            serde_json::from_value::<RefillIntent>(json!({"refillToFull":raw[field]}))
                .is_ok_and(|i| valid_refill_intent(&i))
        }
        "health" => serde_json::from_value::<HealthBatchIntent>(json!({"health":raw[field]}))
            .is_ok_and(|i| valid_health_batch_intent(&i)),
        "run" => serde_json::from_value::<RunIntent>(json!({"run":raw[field]}))
            .is_ok_and(|i| valid_run_intent(&i)),
        "upgrades" => serde_json::from_value::<UpgradeIntent>(json!({"upgrades":raw[field]}))
            .is_ok_and(|i| valid_upgrade_intent(&i)),
        "mixed" => valid_mixed_intent(&MixedIntent {
            mixed: raw[field].clone(),
        }),
        _ => false,
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/transactions/intent.rs"]
mod tests;
