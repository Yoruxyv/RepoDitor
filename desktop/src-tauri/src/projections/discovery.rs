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
#[path = "../../tests/unit/projections/discovery.rs"]
mod tests;
