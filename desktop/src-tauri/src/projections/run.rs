//! Validate Python's Run projection without interpreting raw save values.
use super::saves;
use crate::error::{json, BackendError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
enum StatKey {
    Level,
    Currency,
    Lives,
    TotalHaul,
}

#[derive(Debug, Deserialize, Serialize)]
struct Stat {
    key: StatKey,
    label: String,
    value: i64,
}

#[derive(Debug, Deserialize, Serialize)]
struct Resume {
    value: String,
    options: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    stats: Vec<Stat>,
    resume_location: Resume,
}

pub fn parse(bytes: &[u8]) -> Result<RunState, BackendError> {
    let mut raw = json(bytes)?;
    if raw.get("ok") == Some(&Value::Bool(false)) {
        return Err(saves::read_error(&raw)?);
    }
    if raw.get("ok") != Some(&Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let run: RunState =
        serde_json::from_value(raw.get_mut("run").ok_or(BackendError::Invalid)?.take())
            .map_err(|_| BackendError::Invalid)?;
    let mut keys = HashSet::new();
    for stat in &run.stats {
        if !keys.insert(&stat.key)
            || stat.label.trim().is_empty()
            || !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&stat.value)
            || (stat.key == StatKey::Level && stat.value < 1)
        {
            return Err(BackendError::Invalid);
        }
    }
    let resume = &run.resume_location;
    let mut options = HashSet::new();
    if resume.value.trim().is_empty()
        || !resume
            .options
            .iter()
            .all(|option| !option.trim().is_empty() && options.insert(option))
        || !options.contains(&resume.value)
    {
        return Err(BackendError::Invalid);
    }
    Ok(run)
}

#[cfg(test)]
#[path = "../../tests/unit/projections/run.rs"]
mod tests;
