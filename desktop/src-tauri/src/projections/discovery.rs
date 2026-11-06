//! Python discovery framing/DTO validation; discovery semantics remain in Python.
use crate::error::BackendError;
use chrono::DateTime;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SaveRootStatus {
    Available,
    Missing,
    Unreadable,
    Unavailable,
}
#[derive(Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum GameStatus {
    Found,
    SteamNotFound,
    GameNotFound,
    DiscoveryError,
}

#[derive(Default, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum HealthWriteStatus {
    #[default]
    Unknown,
    Unsupported,
}

#[derive(Default, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct HealthWriteCompatibility {
    build_id: Option<String>,
    status: HealthWriteStatus,
    supported: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonSave {
    id: String,
    display_name: String,
    path: String,
    last_modified: String,
    file_size: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonEnvironment {
    ok: bool,
    #[serde(deserialize_with = "nullable_string")]
    save_root: Option<String>,
    save_root_status: SaveRootStatus,
    save_root_detected: bool,
    save_count: usize,
    saves: Vec<PythonSave>,
    #[serde(deserialize_with = "nullable_string")]
    game_root: Option<String>,
    game_status: GameStatus,
    game_detected: bool,
    #[serde(default)]
    health_write_compatibility: HealthWriteCompatibility,
}
fn nullable_string<'de, D: serde::Deserializer<'de>>(value: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(value)
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummary {
    pub id: String,
    name: String,
    path: String,
    modified_at: String,
    size_bytes: u64,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentDiscovery {
    save_root: Option<String>,
    save_root_status: SaveRootStatus,
    save_root_detected: bool,
    game_root: Option<String>,
    game_status: GameStatus,
    game_detected: bool,
    health_write_compatibility: HealthWriteCompatibility,
    pub saves: Vec<SaveSummary>,
}

pub fn parse(bytes: &[u8]) -> Result<EnvironmentDiscovery, BackendError> {
    let value = crate::error::json(bytes)?;
    let value: PythonEnvironment =
        serde_json::from_value(value).map_err(|_| BackendError::Invalid)?;
    let invalid = || BackendError::Invalid;
    if !value.ok
        || value.save_count != value.saves.len()
        || (value.save_root_status == SaveRootStatus::Unavailable) != value.save_root.is_none()
        || value.save_root_detected != (value.save_root_status == SaveRootStatus::Available)
        || (value.save_root_status != SaveRootStatus::Available && !value.saves.is_empty())
        || value.game_detected != (value.game_status == GameStatus::Found)
        || value.game_detected != value.game_root.is_some()
        || value.health_write_compatibility.supported
        || (value.health_write_compatibility.status == HealthWriteStatus::Unknown)
            != value.health_write_compatibility.build_id.is_none()
        || value
            .health_write_compatibility
            .build_id
            .as_ref()
            .is_some_and(|id| {
                !value.game_detected || id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit())
            })
        || value
            .save_root
            .as_ref()
            .is_some_and(|p| p.trim().is_empty())
        || value
            .game_root
            .as_ref()
            .is_some_and(|p| p.trim().is_empty())
    {
        return Err(invalid());
    }
    let mut saves = Vec::with_capacity(value.saves.len());
    for save in value.saves {
        if save.id.trim().is_empty()
            || save.display_name.trim().is_empty()
            || save.path.trim().is_empty()
            || save.file_size > 9_007_199_254_740_991
            || DateTime::parse_from_rfc3339(&save.last_modified).is_err()
        {
            return Err(invalid());
        }
        saves.push(SaveSummary {
            id: save.id,
            name: save.display_name,
            path: save.path,
            modified_at: save.last_modified,
            size_bytes: save.file_size,
        });
    }
    Ok(EnvironmentDiscovery {
        save_root: value.save_root,
        save_root_status: value.save_root_status,
        save_root_detected: value.save_root_detected,
        game_root: value.game_root,
        game_status: value.game_status,
        game_detected: value.game_detected,
        health_write_compatibility: value.health_write_compatibility,
        saves,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn environment() -> serde_json::Value {
        serde_json::json!({"ok":true,"saveRoot":"C:/fixture/saves","saveRootStatus":"available",
            "saveRootDetected":true,"saveCount":1,"saves":[{"id":"fixture","displayName":"Example",
            "path":"C:/fixture/saves/example.es3","lastModified":"2026-11-03T00:00:00+00:00","fileSize":123}],
            "gameRoot":null,"gameStatus":"steam_not_found","gameDetected":false})
    }
    #[test]
    fn projects_only_the_existing_renderer_contract() {
        let mut raw = environment();
        raw["gameDiscoveryIssues"] = serde_json::json!([{"path":"private diagnostic"}]);
        let result =
            serde_json::to_value(parse(&serde_json::to_vec(&raw).unwrap()).unwrap()).unwrap();
        assert_eq!(result["saves"][0]["name"], "Example");
        assert_eq!(result["saves"][0]["sizeBytes"], 123);
        assert!(result.get("gameDiscoveryIssues").is_none());
        assert_eq!(
            result["healthWriteCompatibility"],
            serde_json::json!({
                "buildId":null,"status":"unknown","supported":false
            })
        );
    }
    #[test]
    fn health_build_metadata_cannot_admit_writes() {
        let mut raw = environment();
        raw["gameDetected"] = serde_json::json!(true);
        raw["gameRoot"] = serde_json::json!("C:/fixture/game");
        raw["gameStatus"] = serde_json::json!("found");
        let unsupported =
            serde_json::json!({"buildId":"23363152","status":"unsupported","supported":false});
        raw["healthWriteCompatibility"] = unsupported.clone();
        assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_ok());
        for (key, value) in [
            ("supported", serde_json::json!(true)),
            ("status", serde_json::json!("supported")),
            ("buildId", serde_json::Value::Null),
            ("buildId", serde_json::json!("../game")),
            ("status", serde_json::json!("unknown")),
        ] {
            let mut bad = unsupported.clone();
            bad[key] = value;
            raw["healthWriteCompatibility"] = bad;
            assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_err());
        }
    }
    #[test]
    fn rejects_missing_wrong_and_inconsistent_fields() {
        for (key, value) in [
            ("ok", serde_json::json!(false)),
            ("saveCount", serde_json::json!(2)),
            ("saveRoot", serde_json::Value::Null),
            ("saveRootDetected", serde_json::json!(false)),
            ("saveRootStatus", serde_json::json!("missing")),
            ("gameRoot", serde_json::json!("C:/game")),
            ("gameStatus", serde_json::json!("found")),
            ("saves", serde_json::json!({})),
        ] {
            let mut raw = environment();
            raw[key] = value;
            assert_eq!(
                parse(&serde_json::to_vec(&raw).unwrap()).unwrap_err(),
                BackendError::Invalid
            );
        }
        for key in ["saveRoot", "gameRoot", "saveRootStatus"] {
            let mut raw = environment();
            raw.as_object_mut().unwrap().remove(key);
            assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_err());
        }
    }
    #[test]
    fn rejects_bad_save_metadata_and_framing() {
        for (key, value) in [
            ("id", serde_json::json!(" ")),
            ("displayName", serde_json::Value::Null),
            ("path", serde_json::json!("")),
            ("lastModified", serde_json::json!("invalid")),
            ("fileSize", serde_json::json!(-1)),
            ("fileSize", serde_json::json!(9_007_199_254_740_992u64)),
        ] {
            let mut raw = environment();
            raw["saves"][0][key] = value;
            assert!(parse(&serde_json::to_vec(&raw).unwrap()).is_err());
        }
        assert_eq!(parse(b" \n").unwrap_err(), BackendError::Empty);
        assert_eq!(parse(b"not-json").unwrap_err(), BackendError::Malformed);
    }
}
