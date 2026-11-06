//! Renderer-safe projections of Python's discovered-save open contract.
use crate::error::BackendError;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub fn valid_id(id: &str) -> bool {
    if id.len() != 29 {
        return false;
    }
    let Some(stamp) = id.strip_prefix("REPO_SAVE_") else {
        return false;
    };
    let fields: Vec<_> = stamp.split('_').collect();
    fields.len() == 6
        && fields
            .iter()
            .zip([4, 2, 2, 2, 2, 2])
            .all(|(s, n)| s.len() == n && s.bytes().all(|b| b.is_ascii_digit()))
}

pub(crate) fn valid_upgrade_key(key: &str) -> bool {
    key.starts_with("playerUpgrade")
        && key != "playerUpgrade"
        && key.len() <= 512
        && !key.contains('\0')
}

#[cfg(test)]
#[path = "../../tests/unit/projections/saves.rs"]
mod tests;

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveSession {
    id: String,
    #[serde(rename(deserialize = "displayName", serialize = "name"))]
    name: String,
    path: String,
    #[serde(rename(deserialize = "lastModified", serialize = "modifiedAt"))]
    modified_at: String,
    fingerprint: String,
    level: i64,
    currency: i64,
    player_count: i64,
    resume_location: String,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveOpenResult {
    session: SaveSession,
    required_upgrade_visual_keys: Vec<String>,
    presentation_readiness: &'static str,
}
#[cfg(feature = "synthetic-health-recovery")]
impl SaveOpenResult {
    pub fn fingerprint(&self) -> &str {
        &self.session.fingerprint
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonOpen {
    session: SaveSession,
    required_upgrade_visual_keys: Vec<String>,
}

pub fn parse(bytes: &[u8], requested: &str) -> Result<SaveOpenResult, BackendError> {
    let raw: serde_json::Value = crate::error::json(bytes)?;
    if raw.get("ok") == Some(&serde_json::Value::Bool(false)) {
        return Err(domain_error(&raw)?);
    }
    if raw.get("ok") != Some(&serde_json::Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let value: PythonOpen = serde_json::from_value(raw).map_err(|_| BackendError::Invalid)?;
    let session = &value.session;
    if session.id != requested
        || !valid_id(&session.id)
        || [&session.name, &session.path, &session.resume_location]
            .iter()
            .any(|s| s.trim().is_empty())
        || DateTime::parse_from_rfc3339(&session.modified_at).is_err()
        || session.fingerprint.len() != 64
        || !session
            .fingerprint
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || session.level < 1
        || session.player_count < 0
        || [session.level, session.currency, session.player_count]
            .iter()
            .any(|n| !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(n))
        || value.required_upgrade_visual_keys.len() > 512
    {
        return Err(BackendError::Invalid);
    }
    let mut seen = HashSet::new();
    for key in &value.required_upgrade_visual_keys {
        if !valid_upgrade_key(key) || !seen.insert(key) {
            return Err(BackendError::Invalid);
        }
    }
    // Artwork is not implemented in this host; never claim those visuals are ready.
    let readiness = if value.required_upgrade_visual_keys.is_empty() {
        "ready"
    } else {
        "unresolved"
    };
    Ok(SaveOpenResult {
        session: value.session,
        required_upgrade_visual_keys: value.required_upgrade_visual_keys,
        presentation_readiness: readiness,
    })
}

pub(super) fn domain_error(raw: &serde_json::Value) -> Result<BackendError, BackendError> {
    let error = raw.get("error").ok_or(BackendError::Invalid)?;
    if error
        .get("message")
        .and_then(|v| v.as_str())
        .is_none_or(|s| s.trim().is_empty())
    {
        return Err(BackendError::Invalid);
    }
    let (code, message) = match error.get("code").and_then(|v| v.as_str()) {
        Some("invalid_request") => ("invalid_request", "A valid discovered save ID is required."),
        Some("save_missing") => ("save_missing", "The selected save no longer exists."),
        Some("meta_missing") => ("meta_missing", "MetaSave.es3 was not found."),
        Some("save_corrupt") => ("save_corrupt", "The selected save is corrupted."),
        Some("save_decrypt_failed") => (
            "save_decrypt_failed",
            "The selected save could not be decrypted.",
        ),
        Some("save_unsupported") => (
            "save_unsupported",
            "The save format is unsupported or its size exceeds RepoDitor's experimental resource limits.",
        ),
        Some("backend_unavailable") => (
            "backend_unavailable",
            "The selected save could not be opened.",
        ),
        Some("save_stale") => (
            "save_stale",
            "The selected save changed. Open it again before saving.",
        ),
        Some("game_running") => ("game_running", "Close R.E.P.O. before saving."),
        Some("game_status_unknown") => (
            "game_status_unknown",
            "RepoDitor could not verify that R.E.P.O. is closed. Nothing was written.",
        ),
        Some("save_validation_failed") => (
            "save_validation_failed",
            "The save changes failed validation.",
        ),
        Some("backup_failed") => ("backup_failed", "The save backup could not be created."),
        Some("save_write_failed") => ("save_write_failed", "The save could not be written."),
        Some("save_verification_failed") => (
            "save_verification_failed",
            "The written save could not be verified.",
        ),
        _ => return Err(BackendError::Invalid),
    };
    Ok(BackendError::Domain { code, message })
}

pub(super) fn read_error(raw: &serde_json::Value) -> Result<BackendError, BackendError> {
    if !matches!(
        raw.pointer("/error/code").and_then(|v| v.as_str()),
        Some(
            "invalid_request"
                | "save_missing"
                | "save_corrupt"
                | "save_decrypt_failed"
                | "save_unsupported"
                | "backend_unavailable"
        )
    ) {
        return Err(BackendError::Invalid);
    }
    domain_error(raw)
}
