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
#[path = "../../tests/unit/projections/game.rs"]
mod tests;
