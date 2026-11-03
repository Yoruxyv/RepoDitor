//! Validate the existing Python game-status contract without process details.
use crate::error::BackendError;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Running,
    NotRunning,
    Unknown,
}
#[derive(Serialize, Debug)]
pub struct GameState {
    status: Status,
    running: bool,
}
#[derive(Deserialize)]
struct PythonState {
    ok: bool,
    status: Status,
    running: bool,
}
pub fn parse(bytes: &[u8]) -> Result<GameState, BackendError> {
    let raw: serde_json::Value = crate::error::json(bytes)?;
    let state: PythonState = serde_json::from_value(raw).map_err(|_| BackendError::Invalid)?;
    if !state.ok || state.running != (state.status == Status::Running) {
        return Err(BackendError::Invalid);
    }
    Ok(GameState {
        status: state.status,
        running: state.running,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_is_distinct_and_process_details_are_dropped() {
        for status in ["running", "not_running", "unknown"] {
            let bytes=serde_json::to_vec(&serde_json::json!({"ok":true,"status":status,"running":status=="running","processes":["private"]})).unwrap();
            let value = serde_json::to_value(parse(&bytes).unwrap()).unwrap();
            assert_eq!(value["status"], status);
            assert!(value.get("processes").is_none());
        }
    }
    #[test]
    fn rejects_missing_unrecognized_and_inconsistent_game_states() {
        for raw in [
            serde_json::json!({"ok":true,"status":"unknown","running":true}),
            serde_json::json!({"ok":true,"status":"closed","running":false}),
            serde_json::json!({"ok":true,"status":"not_running","running":0}),
            serde_json::json!({"ok":false,"status":"not_running","running":false}),
            serde_json::json!({"ok":true,"running":false}),
        ] {
            assert_eq!(
                parse(&serde_json::to_vec(&raw).unwrap()).unwrap_err(),
                BackendError::Invalid
            );
        }
        assert_eq!(parse(b"{}\n{}").unwrap_err(), BackendError::Malformed);
    }
}
