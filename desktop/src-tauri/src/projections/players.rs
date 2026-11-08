//! Validate the Python player projection without interpreting save fields.
use crate::error::{json, BackendError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    id: String,
    name: String,
    health: i64,
    max_health: i64,
}

pub fn parse(bytes: &[u8]) -> Result<Vec<Player>, BackendError> {
    let mut raw = json(bytes)?;
    if raw.get("ok") == Some(&serde_json::Value::Bool(false)) {
        return Err(super::saves::read_error(&raw)?);
    }
    if raw.get("ok") != Some(&serde_json::Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let players: Vec<Player> =
        serde_json::from_value(raw.get_mut("players").ok_or(BackendError::Invalid)?.take())
            .map_err(|_| BackendError::Invalid)?;
    let mut seen = HashSet::new();
    for player in &players {
        if !valid_id(&player.id)
            || !seen.insert(&player.id)
            || player.name.trim().is_empty()
            || !(0..=9_007_199_254_740_991).contains(&player.health)
            || !(100..=9_007_199_254_740_991).contains(&player.max_health)
        {
            return Err(BackendError::Invalid);
        }
    }
    Ok(players)
}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit())
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum AvatarStatus {
    Available,
    Unavailable,
    Transient,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Avatar {
    player_id: String,
    avatar_url: Option<String>,
    status: AvatarStatus,
    retry_after_ms: Option<u32>,
}

pub fn parse_avatar(bytes: &[u8], expected: &str) -> Result<Avatar, BackendError> {
    let mut raw = json(bytes)?;
    if raw.get("ok") == Some(&serde_json::Value::Bool(false)) {
        return Err(super::saves::read_error(&raw)?);
    }
    if raw.get("ok") != Some(&serde_json::Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let avatar: Avatar =
        serde_json::from_value(raw.get_mut("avatar").ok_or(BackendError::Invalid)?.take())
            .map_err(|_| BackendError::Invalid)?;
    if avatar.player_id != expected
        || !valid_id(expected)
        || (avatar.status == AvatarStatus::Available) != avatar.avatar_url.is_some()
        || avatar.retry_after_ms.is_some_and(|delay| {
            avatar.status != AvatarStatus::Transient || !(30_000..=300_000).contains(&delay)
        })
    {
        return Err(BackendError::Invalid);
    }
    if let Some(raw) = &avatar.avatar_url {
        let url = tauri::Url::parse(raw).map_err(|_| BackendError::Invalid)?;
        if raw.len() > 2048
            || url.scheme() != "https"
            || !matches!(
                url.host_str(),
                Some("avatars.akamai.steamstatic.com" | "avatars.fastly.steamstatic.com")
            )
            || !url.username().is_empty()
            || url.password().is_some()
            || !matches!(url.port(), None | Some(443))
        {
            return Err(BackendError::Invalid);
        }
    }
    Ok(avatar)
}

#[cfg(test)]
#[path = "../../tests/unit/projections/players.rs"]
mod tests;
