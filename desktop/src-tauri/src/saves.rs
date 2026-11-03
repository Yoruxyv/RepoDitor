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

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "REPO_SAVE_2026_08_08_10_20_30";
    fn response() -> serde_json::Value {
        serde_json::json!({"ok":true,"session":{"id":ID,"displayName":"Example","path":"C:/fixture/save.es3",
            "lastModified":"2026-11-03T00:00:00+00:00","fingerprint":"a".repeat(64),"level":5,"currency":12,"playerCount":2,"resumeLocation":"Normal"},
            "requiredUpgradeVisualKeys":["playerUpgradeHealth"]})
    }
    fn decode(value: &serde_json::Value) -> Result<SaveOpenResult, BackendError> {
        parse(&serde_json::to_vec(value).unwrap(), ID)
    }
    #[test]
    fn only_fixed_shape_opaque_save_ids_are_accepted() {
        assert!(valid_id(ID));
        for id in [
            "../save.es3",
            "C:/save.es3",
            "--help",
            "REPO_SAVE_2026_8_08_10_20_30",
            "REPO_SAVE_2026_08_08_10_20_30\n",
            &"x".repeat(20000),
        ] {
            assert!(!valid_id(id));
        }
    }
    #[test]
    fn translates_session_without_leaking_extra_data_or_claiming_artwork() {
        let mut raw = response();
        raw["decrypted"] = serde_json::json!({"secret":"not public"});
        let value = serde_json::to_value(decode(&raw).unwrap()).unwrap();
        assert_eq!(value["session"]["name"], "Example");
        assert_eq!(value["session"]["currency"], 12);
        assert_eq!(value["presentationReadiness"], "unresolved");
        assert!(value.get("decrypted").is_none());
        raw["requiredUpgradeVisualKeys"] = serde_json::json!([]);
        assert_eq!(decode(&raw).unwrap().presentation_readiness, "ready");
    }
    #[test]
    fn rejects_mismatched_ids_invalid_sessions_and_missing_fields() {
        for (field, value) in [
            ("id", serde_json::json!("REPO_SAVE_2026_08_08_10_20_31")),
            ("path", serde_json::json!(" ")),
            ("displayName", serde_json::Value::Null),
            ("lastModified", serde_json::json!("bad-date")),
            ("fingerprint", serde_json::json!("A".repeat(64))),
            ("level", serde_json::json!(0)),
            ("currency", serde_json::json!(1.5)),
            ("currency", serde_json::json!(9_007_199_254_740_992i64)),
            ("playerCount", serde_json::json!(-1)),
            ("resumeLocation", serde_json::json!("")),
        ] {
            let mut raw = response();
            raw["session"][field] = value;
            assert_eq!(decode(&raw).unwrap_err(), BackendError::Invalid, "{field}");
        }
        for field in ["id", "fingerprint", "currency", "resumeLocation"] {
            let mut raw = response();
            raw["session"].as_object_mut().unwrap().remove(field);
            assert!(decode(&raw).is_err());
        }
        assert_eq!(parse(b"", ID).unwrap_err(), BackendError::Empty);
        assert_eq!(parse(b"{", ID).unwrap_err(), BackendError::Malformed);
    }
    #[test]
    fn bounds_and_validates_required_visual_keys() {
        for keys in [
            serde_json::json!(["bad"]),
            serde_json::json!(["playerUpgrade"]),
            serde_json::json!(["playerUpgradeX", "playerUpgradeX"]),
            serde_json::json!([null]),
            serde_json::json!(["playerUpgrade\0x"]),
            serde_json::json!([format!("playerUpgrade{}", "x".repeat(512))]),
            serde_json::json!(vec!["playerUpgradeX"; 513]),
        ] {
            let mut raw = response();
            raw["requiredUpgradeVisualKeys"] = keys;
            assert_eq!(decode(&raw).unwrap_err(), BackendError::Invalid);
        }
    }
    #[test]
    fn preserves_missing_stale_failures_but_sanitizes_messages() {
        for code in [
            "save_missing",
            "save_stale",
            "save_corrupt",
            "backend_unavailable",
        ] {
            let raw = serde_json::json!({"ok":false,"error":{"code":code,"message":"private path and diagnostic"}});
            let result = crate::error::Outcome::<SaveOpenResult>::for_service(
                decode(&raw),
                crate::error::Service::Save,
            );
            let value = serde_json::to_value(result).unwrap();
            assert_eq!(value["error"]["code"], code);
            assert!(!value.to_string().contains("private"));
        }
        for error in [
            serde_json::json!({"code":"new_unknown_code","message":"private"}),
            serde_json::json!({"code":"save_missing","message":null}),
        ] {
            assert_eq!(
                decode(&serde_json::json!({"ok":false,"error":error})).unwrap_err(),
                BackendError::Invalid
            );
        }
    }
}

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
        if !key.starts_with("playerUpgrade")
            || key == "playerUpgrade"
            || key.len() > 512
            || key.contains('\0')
            || !seen.insert(key)
        {
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

fn domain_error(raw: &serde_json::Value) -> Result<BackendError, BackendError> {
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
        Some("save_corrupt") => ("save_corrupt", "The selected save is corrupted."),
        Some("save_decrypt_failed") => (
            "save_decrypt_failed",
            "The selected save could not be decrypted.",
        ),
        Some("save_unsupported") => (
            "save_unsupported",
            "The selected save format is not supported.",
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
