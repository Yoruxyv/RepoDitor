//! Feature-only synthetic transport; never compiled into the normal preview.
use crate::{
    backend::{self, Operation},
    error::{BackendError, Outcome},
    projections::{players, saves, upgrades},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::{path::PathBuf, time::Instant};
use tauri::Manager;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    operation_id: String,
    status: String,
    fingerprint: Option<String>,
    backup_available: bool,
    reason: Option<String>,
    #[serde(skip_deserializing)]
    canonical: Option<Canonical>,
}

#[derive(Debug, Serialize)]
pub struct Canonical {
    opened: saves::SaveOpenResult,
    players: Vec<players::Player>,
    upgrades: Vec<upgrades::Upgrade>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthIntent {
    player_id: String,
    health: i64,
    before: i64,
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
    Upgrades(UpgradeIntent),
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeIntent {
    upgrades: Vec<UpgradeEdit>,
}

fn valid_upgrade_intent(intent: &UpgradeIntent) -> bool {
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    operation_id: String,
    fingerprint: String,
    intent: Option<Intent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthState {
    enabled: bool,
    state: String,
    pending: Option<Pending>,
    canonical: Option<Canonical>,
    upgrade_session: Option<String>,
}

fn unavailable(enabled: bool, state: &str) -> HealthState {
    HealthState {
        enabled,
        state: state.into(),
        pending: None,
        canonical: None,
        upgrade_session: None,
    }
}

fn canonical(
    raw: &Value,
    save: &str,
    fingerprint: Option<&str>,
) -> Result<Canonical, BackendError> {
    if fingerprint.is_some_and(|fp| raw["opened"]["session"]["fingerprint"].as_str() != Some(fp)) {
        return Err(BackendError::Invalid);
    }
    Ok(Canonical {
        opened: saves::parse(
            &serde_json::to_vec(&raw["opened"]).map_err(|_| BackendError::Invalid)?,
            save,
        )?,
        players: players::parse(
            &serde_json::to_vec(&json!({"ok":true,"players":raw["players"]}))
                .map_err(|_| BackendError::Invalid)?,
        )?,
        upgrades: upgrades::parse(
            &serde_json::to_vec(&json!({"ok":true,"upgrades":raw["upgrades"]}))
                .map_err(|_| BackendError::Invalid)?,
        )?,
    })
}

fn parse_state(bytes: &[u8], save: &str) -> Result<HealthState, BackendError> {
    let raw = crate::error::json(bytes)?;
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    let state = raw["state"].as_str().ok_or(BackendError::Invalid)?;
    let mut result = unavailable(true, state);
    match state {
        "idle" => result.canonical = Some(canonical(&raw["canonical"], save, None)?),
        "pending" => {
            let pending: Pending = serde_json::from_value(raw["pending"].clone())
                .map_err(|_| BackendError::Invalid)?;
            if !hex(&pending.operation_id, 32)
                || !hex(&pending.fingerprint, 64)
                || pending.intent.as_ref().is_some_and(|intent| match intent {
                    Intent::Health(i) => {
                        !players::valid_id(&i.player_id)
                            || !(0..=2_147_483_647).contains(&i.health)
                            || !(0..=9_007_199_254_740_991).contains(&i.before)
                    }
                    Intent::Upgrades(i) => !valid_upgrade_intent(i),
                })
            {
                return Err(BackendError::Invalid);
            }
            result.pending = Some(pending);
        }
        "blocked" | "busy" => (),
        _ => return Err(BackendError::Invalid),
    }
    Ok(result)
}

pub async fn state(app: tauri::AppHandle, save: String) -> HealthState {
    if !cfg!(feature = "synthetic-health-ui") || !test_root() || !saves::valid_id(&save) {
        return unavailable(false, "disabled");
    }
    if app.state::<Arc<backend::HostState>>().health_busy() {
        return unavailable(true, "busy");
    }
    let expected = save.clone();
    let host = app.state::<Arc<backend::HostState>>().inner().clone();
    let session_save = save.clone();
    match backend::request(app, Operation::TestHealthState(save), move |bytes| {
        parse_state(bytes, &expected)
    })
    .await
    {
        Outcome::Success { mut data, .. } => {
            if let Some(projection) = &data.canonical {
                host.update_editor(&session_save, projection.opened.fingerprint());
            }
            data.upgrade_session = host.upgrade_session(&session_save);
            data
        }
        Outcome::Failure { .. } => unavailable(true, "blocked"),
    }
}

fn hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

pub fn test_root() -> bool {
    std::env::var("REPODITOR_E2E").as_deref() == Ok("1")
        && std::env::var_os("REPODITOR_E2E_LOCAL_APP_DATA_LOW")
            .and_then(|root| PathBuf::from(root).canonicalize().ok())
            .is_some_and(|root| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../build/recovery-checkpoint")
                    .canonicalize()
                    .is_ok_and(|allowed| root.starts_with(allowed))
            })
}

fn failure(operation: &str, status: &str, reason: &str) -> Transaction {
    Transaction {
        operation_id: operation.into(),
        status: status.into(),
        fingerprint: None,
        backup_available: false,
        reason: Some(reason.into()),
        canonical: None,
    }
}

fn identity(raw: &Value) -> Option<(&str, &str)> {
    let save = raw
        .get("saveId")?
        .as_str()
        .filter(|id| saves::valid_id(id))?;
    let operation = raw.get("operationId")?.as_str().filter(|id| hex(id, 32))?;
    Some((save, operation))
}

fn parse(bytes: &[u8], operation: &str, save: &str) -> Result<Transaction, BackendError> {
    let mut raw = crate::error::json(bytes)?;
    if raw.get("ok") != Some(&Value::Bool(true)) {
        return Err(BackendError::Invalid);
    }
    let projection = raw["transaction"].get("canonical").cloned();
    let mut transaction: Transaction = serde_json::from_value(
        raw.get_mut("transaction")
            .ok_or(BackendError::Invalid)?
            .take(),
    )
    .map_err(|_| BackendError::Invalid)?;
    if transaction.operation_id != operation
        || !hex(&transaction.operation_id, 32)
        || !matches!(
            transaction.status.as_str(),
            "prepared" | "rejected" | "uncertain" | "applied" | "unchanged" | "conflict" | "busy"
        )
        || transaction
            .fingerprint
            .as_deref()
            .is_some_and(|fp| !hex(fp, 64))
        || (matches!(transaction.status.as_str(), "applied" | "unchanged")
            && transaction.fingerprint.is_none())
        || (transaction.status == "applied" && !transaction.backup_available)
        || transaction.reason.as_deref().is_some_and(|reason| {
            !matches!(
                reason,
                "invalid_request"
                    | "save_missing"
                    | "save_corrupt"
                    | "save_decrypt_failed"
                    | "save_unsupported"
                    | "save_stale"
                    | "save_validation_failed"
                    | "game_running"
                    | "game_status_unknown"
                    | "backup_failed"
                    | "save_write_failed"
                    | "save_verification_failed"
                    | "backend_unavailable"
                    | "write_conflict"
                    | "write_busy"
                    | "write_duplicate"
                    | "write_recovery_required"
            )
        })
    {
        return Err(BackendError::Invalid);
    }
    if let Some(projection) = projection {
        transaction.canonical = Some(canonical(
            &projection,
            save,
            transaction.fingerprint.as_deref(),
        )?);
    }
    Ok(transaction)
}

async fn dispatch(
    app: tauri::AppHandle,
    operation: Operation,
    id: String,
    write: bool,
    save: &str,
) -> Transaction {
    let expected = id.clone();
    let save = save.to_owned();
    match backend::request(app, operation, move |bytes| parse(bytes, &expected, &save)).await {
        Outcome::Success { data, .. } => data,
        Outcome::Failure { error, .. } => failure(
            &id,
            if error.code == "write_uncertain" {
                "uncertain"
            } else if write {
                "rejected"
            } else {
                "conflict"
            },
            error.code,
        ),
    }
}

pub async fn write(app: tauri::AppHandle, raw: Value) -> Transaction {
    let Some((save, operation)) = identity(&raw) else {
        return failure("", "rejected", "invalid_request");
    };
    let valid = raw.as_object().is_some_and(|r| r.len() == 5)
        && raw
            .get("fingerprint")
            .and_then(Value::as_str)
            .is_some_and(|fp| hex(fp, 64))
        && raw
            .get("playerId")
            .and_then(Value::as_str)
            .is_some_and(players::valid_id)
        && raw
            .get("health")
            .and_then(Value::as_i64)
            .is_some_and(|n| (0..=2_147_483_647).contains(&n));
    if !valid || !test_root() {
        return failure(operation, "rejected", "invalid_request");
    }
    let payload = json!([{"feature":"players","entity":raw["playerId"],"field":"health","after":raw["health"]}]).to_string();
    let started = Instant::now();
    let prepared = dispatch(
        app.clone(),
        Operation::TestHealthPrepare(
            save.into(),
            raw["fingerprint"].as_str().unwrap().into(),
            payload.clone(),
            operation.into(),
            started,
        ),
        operation.into(),
        true,
        save,
    )
    .await;
    if prepared.status != "prepared" {
        return prepared;
    }
    let command = Operation::TestHealth(
        save.into(),
        raw["fingerprint"].as_str().unwrap().into(),
        payload,
        operation.into(),
        started,
    );
    dispatch(app, command, operation.into(), true, save).await
}

pub async fn write_upgrades(app: tauri::AppHandle, raw: Value) -> Transaction {
    let Some((save, operation)) = identity(&raw) else {
        return failure("", "rejected", "invalid_request");
    };
    let intent: Result<UpgradeIntent, _> =
        serde_json::from_value(json!({"upgrades":raw["upgrades"]}));
    let host = app.state::<Arc<backend::HostState>>().inner().clone();
    let valid = cfg!(feature = "synthetic-health-ui")
        && test_root()
        && raw.as_object().is_some_and(|r| r.len() == 5)
        && raw["fingerprint"].as_str().is_some_and(|fp| {
            hex(fp, 64)
                && raw["session"]
                    .as_str()
                    .is_some_and(|session| host.accepts_upgrade(save, fp, session))
        })
        && intent.as_ref().is_ok_and(valid_upgrade_intent);
    if !valid {
        return failure(operation, "rejected", "invalid_request");
    }
    let payload = raw["upgrades"].to_string();
    let fingerprint = raw["fingerprint"].as_str().unwrap();
    let started = Instant::now();
    let prepared = dispatch(
        app.clone(),
        Operation::TestUpgradesPrepare(
            save.into(),
            fingerprint.into(),
            payload.clone(),
            operation.into(),
            started,
        ),
        operation.into(),
        true,
        save,
    )
    .await;
    if prepared.status != "prepared" {
        return prepared;
    }
    if !host.accepts_upgrade(save, fingerprint, raw["session"].as_str().unwrap()) {
        return failure(operation, "uncertain", "invalid_request");
    }
    dispatch(
        app,
        Operation::TestUpgrades(
            save.into(),
            fingerprint.into(),
            payload,
            operation.into(),
            started,
        ),
        operation.into(),
        true,
        save,
    )
    .await
}

pub async fn recover(app: tauri::AppHandle, raw: Value) -> Transaction {
    let Some((save, operation)) = identity(&raw) else {
        return failure("", "conflict", "invalid_request");
    };
    let canonical = cfg!(feature = "synthetic-health-ui");
    let acknowledge = raw
        .get("acknowledge")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !raw.as_object().is_some_and(|r| {
        r.len() == 2
            || (canonical && r.len() == 3 && r.get("acknowledge").is_some_and(Value::is_boolean))
    }) || !test_root()
    {
        return failure(operation, "conflict", "invalid_request");
    }
    let host = app.state::<Arc<backend::HostState>>().inner().clone();
    let result = dispatch(
        app,
        Operation::TestHealthRecover(save.into(), operation.into(), canonical, acknowledge),
        operation.into(),
        false,
        save,
    )
    .await;
    if let Some(projection) = &result.canonical {
        host.update_editor(save, projection.opened.fingerprint());
    }
    result
}

#[cfg(test)]
#[path = "../../tests/unit/synthetic/recovery.rs"]
mod tests;
