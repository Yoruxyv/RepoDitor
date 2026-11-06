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
mod tests {
    use super::*;
    use serde_json::json;
    fn response() -> Value {
        json!({"ok":true,"run":{"stats":[{"key":"level","label":"Level","value":5},{"key":"currency","label":"Currency","value":-12}],"resumeLocation":{"value":"Unknown (9)","options":["Normal","Unknown (9)"]},"raw":"excluded"}})
    }
    fn decode(raw: Value) -> Result<RunState, BackendError> {
        parse(&serde_json::to_vec(&raw).unwrap())
    }
    #[test]
    fn preserves_subset_stats_signed_boundaries_and_observed_resume_options() {
        let value = serde_json::to_value(decode(response()).unwrap()).unwrap();
        assert_eq!(value["stats"][1]["value"], -12);
        assert_eq!(value["resumeLocation"]["value"], "Unknown (9)");
        assert!(value.get("raw").is_none());
        for key in ["currency", "lives", "totalHaul"] {
            for number in [
                -9_007_199_254_740_991i64,
                -2_147_483_649,
                0,
                2_147_483_648,
                9_007_199_254_740_991,
            ] {
                let mut raw = response();
                raw["run"]["stats"] = json!([{"key":key,"label":"Value","value":number}]);
                assert!(decode(raw).is_ok());
            }
        }
        let mut raw = response();
        raw["run"]["stats"] = json!([]);
        assert!(decode(raw).is_ok());
    }
    #[test]
    fn rejects_unknown_duplicate_missing_and_invalid_stats() {
        for stat in [
            json!({"key":"unknown","label":"X","value":1}),
            json!({"key":"level","label":"Level","value":0}),
            json!({"key":"level","label":"Level","value":-1}),
            json!({"key":"lives","label":" ","value":1}),
            json!({"key":"currency","label":"Currency","value":9007199254740992i64}),
            json!({"key":"currency","label":"Currency","value":-9007199254740992i64}),
            json!({"key":"currency","label":"Currency","value":1.5}),
            json!({"key":"currency","label":"Currency","value":true}),
            json!({"key":"currency","label":"Currency"}),
        ] {
            let mut raw = response();
            raw["run"]["stats"] = json!([stat]);
            assert!(decode(raw).is_err());
        }
        let mut raw = response();
        let first = raw["run"]["stats"][0].clone();
        raw["run"]["stats"] = json!([first, first]);
        assert!(decode(raw).is_err());
        for field in ["stats", "resumeLocation"] {
            let mut raw = response();
            raw["run"].as_object_mut().unwrap().remove(field);
            assert!(decode(raw).is_err());
        }
        assert!(decode(json!({"ok":true})).is_err());
        assert!(decode(json!({"ok":1,"run":{}})).is_err());
        assert_eq!(parse(b"{").unwrap_err(), BackendError::Malformed);
        assert_eq!(parse(b" ").unwrap_err(), BackendError::Empty);
    }
    #[test]
    fn rejects_malformed_resume_metadata_without_a_fixed_location_catalog() {
        for resume in [
            json!({"value":" ","options":[" "]}),
            json!({"value":"Normal","options":[]}),
            json!({"value":"Unknown (9)","options":["Normal"]}),
            json!({"value":"Normal","options":["Normal","Normal"]}),
            json!({"value":"Normal","options":["Normal",null]}),
            json!({"value":"Normal"}),
            json!({"options":["Normal"]}),
        ] {
            let mut raw = response();
            raw["run"]["resumeLocation"] = resume;
            assert!(decode(raw).is_err());
        }
    }
    #[test]
    fn allowlists_read_failures_and_sanitizes_diagnostics() {
        for code in [
            "invalid_request",
            "save_missing",
            "save_corrupt",
            "save_decrypt_failed",
            "save_unsupported",
            "backend_unavailable",
        ] {
            let result = crate::error::Outcome::<RunState>::for_service(
                decode(json!({"ok":false,"error":{"code":code,"message":"private path"}})),
                crate::error::Service::Run,
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
