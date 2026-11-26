//! Run transaction transport for state, production writes, and recovery.
mod intent;
#[cfg(feature = "synthetic-health-recovery")]
pub(crate) mod synthetic;

use intent::{
    valid_batch, valid_health_batch_intent, valid_mixed_intent, valid_refill_intent,
    valid_run_intent, valid_upgrade_intent, Intent,
};

use crate::{
    backend::{self, EditorWrite, Operation},
    error::{BackendError, Outcome},
    projections::{items, players, run, saves, upgrades},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
#[cfg(feature = "production-health")]
use std::time::Instant;
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
    run: Option<run::RunState>,
    advanced: Option<items::Advanced>,
    #[serde(skip)]
    #[cfg(feature = "production-health")]
    artwork_revision: Option<String>,
    #[serde(rename = "itemArtworkRetained")]
    item_artwork_retained: bool,
    #[serde(
        rename = "upgradeArtworkRetained",
        skip_serializing_if = "Option::is_none"
    )]
    upgrade_artwork_retained: Option<bool>,
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
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    draft_only: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    domains: Vec<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    compatibility: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resume_allowed: Option<bool>,
    state: String,
    pending: Option<Pending>,
    canonical: Option<Canonical>,
    upgrade_session: Option<String>,
}

fn unavailable(enabled: bool, state: &str) -> HealthState {
    HealthState {
        enabled,
        draft_only: false,
        domains: Vec::new(),
        compatibility: BTreeMap::new(),
        resume_allowed: None,
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
        // Unsupported numeric projections must not round or disable unrelated editors.
        run: run::parse(
            &serde_json::to_vec(&json!({"ok":true,"run":raw["run"]}))
                .map_err(|_| BackendError::Invalid)?,
        )
        .ok(),
        advanced: items::parse(
            &serde_json::to_vec(&json!({"ok":true,"advanced":raw["advanced"]}))
                .map_err(|_| BackendError::Invalid)?,
        )
        .ok(),
        #[cfg(feature = "production-health")]
        artwork_revision: raw["artworkRevision"]
            .as_str()
            .filter(|revision| saves::valid_fingerprint(revision))
            .map(str::to_owned),
        item_artwork_retained: false,
        upgrade_artwork_retained: None,
    })
}

fn parse_state(bytes: &[u8], save: &str) -> Result<HealthState, BackendError> {
    let raw = crate::error::json(bytes)?;
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    let state = raw["state"].as_str().ok_or(BackendError::Invalid)?;
    let mut result = unavailable(state != "disabled", state);
    if let Some(compatibility) = raw.get("compatibility") {
        result.compatibility =
            serde_json::from_value(compatibility.clone()).map_err(|_| BackendError::Invalid)?;
        if result.compatibility.len() != 5
            || result.compatibility.iter().any(|(operation, status)| {
                !matches!(
                    operation.as_str(),
                    "health" | "upgrades" | "run" | "resume" | "refillToFull"
                ) || !matches!(status.as_str(), "verified" | "unverified" | "incompatible")
            })
        {
            return Err(BackendError::Invalid);
        }
    }
    if let Some(value) = raw.get("resumeAllowed") {
        result.resume_allowed = Some(value.as_bool().ok_or(BackendError::Invalid)?);
    }
    if state == "disabled" {
        return Ok(result);
    }
    if let Some(domains) = raw.get("domains") {
        result.domains =
            serde_json::from_value(domains.clone()).map_err(|_| BackendError::Invalid)?;
        if result.domains.is_empty()
            || result.domains.len() > 4
            || result.domains.iter().any(|domain| {
                !matches!(
                    domain.as_str(),
                    "health" | "upgrades" | "run" | "refillToFull"
                )
            })
        {
            return Err(BackendError::Invalid);
        }
    }
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
                    Intent::HealthBatch(i) => !valid_health_batch_intent(i),
                    Intent::Upgrades(i) => !valid_upgrade_intent(i),
                    Intent::Run(i) => !valid_run_intent(i),
                    Intent::Refill(i) => !valid_refill_intent(i),
                    Intent::Mixed(i) => !valid_mixed_intent(i),
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

pub(crate) fn save_permissions(app: &tauri::AppHandle, write: &str, recover: &str) -> bool {
    use tauri::utils::config::CapabilityEntry;

    let permissions = app
        .config()
        .app
        .security
        .capabilities
        .iter()
        .filter_map(|entry| match entry {
            CapabilityEntry::Inlined(capability)
                if capability.local && capability.windows.iter().any(|name| name == "main") =>
            {
                Some(&capability.permissions)
            }
            _ => None,
        })
        .flatten()
        .map(|permission| permission.identifier().get());
    let mut can_write = false;
    let mut can_recover = false;
    for permission in permissions {
        match permission {
            value if value.strip_prefix("allow-") == Some(write) => can_write = true,
            value if value.strip_prefix("allow-") == Some(recover) => can_recover = true,
            value
                if value
                    .strip_prefix("deny-")
                    .is_some_and(|name| name == write || name == recover) =>
            {
                return false;
            }
            _ => {}
        }
    }
    can_write && can_recover
}

fn hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
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

fn editor_write(app: &tauri::AppHandle, save: &str, raw: &Value) -> Option<EditorWrite> {
    let fingerprint = raw["fingerprint"].as_str()?;
    let token = raw["session"].as_str()?;
    let host = app.state::<Arc<backend::HostState>>();
    (hex(fingerprint, 64) && host.accepts_upgrade(save, fingerprint, token)).then(|| EditorWrite {
        save: save.into(),
        fingerprint: fingerprint.into(),
        token: token.into(),
    })
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
                    | "save_in_use"
                    | "save_verification_unavailable"
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
    editor: Option<EditorWrite>,
) -> Transaction {
    let expected = id.clone();
    let save = save.to_owned();
    match backend::request_with_editor(
        app,
        operation,
        move |bytes| parse(bytes, &expected, &save),
        editor,
    )
    .await
    {
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

#[cfg(feature = "production-health")]
pub async fn production_state(app: tauri::AppHandle, save: String) -> HealthState {
    if !save_permissions(&app, "production-health-write", "production-health-recover") {
        return unavailable(false, "disabled");
    }
    let host = app.state::<Arc<backend::HostState>>().inner().clone();
    let Some(token) = host.upgrade_session(&save) else {
        return unavailable(false, "disabled");
    };
    let enrolling = !private_run_allowed(&host, &token);
    let generation = host.artwork.lock().unwrap().generation(&save);
    let expected = save.clone();
    let operation = Operation::ProductionHealth(
        "state".into(),
        save.clone(),
        String::new(),
        String::new(),
        "null".into(),
        Instant::now(),
    );
    match backend::request(app, operation, move |bytes| parse_state(bytes, &expected)).await {
        Outcome::Success { mut data, .. }
            if (!data.enabled || !data.domains.is_empty())
                && host.upgrade_session(&save).as_ref() == Some(&token) =>
        {
            if enrolling && !matches!(data.state.as_str(), "idle" | "pending") {
                return data;
            }
            if let Some(canonical) = &mut data.canonical {
                if enrolling && !host.accepts_upgrade(&save, canonical.opened.fingerprint(), &token)
                {
                    return unavailable(false, "disabled");
                }
                if canonical.artwork_revision.is_some() {
                    retain_canonical_artwork(&host, &save, generation, canonical);
                }
                host.update_editor(&save, canonical.opened.fingerprint(), &token);
            }
            #[cfg(feature = "private-editing")]
            if enrolling && data.enabled {
                *host.private_run_scope.lock().unwrap() = Some(token.clone());
            }
            data.upgrade_session = data.enabled.then_some(token);
            data
        }
        _ => unavailable(false, "disabled"),
    }
}

#[cfg(feature = "production-health")]
fn private_run_allowed(host: &backend::HostState, token: &str) -> bool {
    #[cfg(feature = "private-editing")]
    return host.private_run_scope.lock().unwrap().as_deref() == Some(token);
    #[cfg(not(feature = "private-editing"))]
    {
        let _ = (host, token);
        true
    }
}

#[cfg(feature = "production-health")]
pub async fn production_write(app: tauri::AppHandle, raw: Value) -> Transaction {
    let Some((save, operation)) = identity(&raw) else {
        return failure("", "rejected", "invalid_request");
    };
    let Some(field) = ["health", "upgrades", "run", "refillToFull", "mixed"]
        .into_iter()
        .find(|field| raw.get(field).is_some())
    else {
        return failure(operation, "rejected", "invalid_request");
    };
    if !raw.as_object().is_some_and(|r| r.len() == 5) || !valid_batch(field, &raw) {
        return failure(operation, "rejected", "invalid_request");
    }
    let Some(editor) = editor_write(&app, save, &raw) else {
        return failure(operation, "rejected", "invalid_request");
    };
    let host = app.state::<Arc<backend::HostState>>();
    if !private_run_allowed(&host, &editor.token) {
        return failure(operation, "rejected", "save_unsupported");
    }
    dispatch(
        app,
        Operation::ProductionHealth(
            "apply".into(),
            save.into(),
            operation.into(),
            editor.fingerprint.clone(),
            json!({(field): raw[field]}).to_string(),
            Instant::now(),
        ),
        operation.into(),
        true,
        save,
        Some(editor),
    )
    .await
}

#[cfg(feature = "production-health")]
pub async fn production_recover(app: tauri::AppHandle, raw: Value) -> Transaction {
    let Some((save, operation)) = identity(&raw) else {
        return failure("", "conflict", "invalid_request");
    };
    let Some(acknowledge) = raw["acknowledge"].as_bool() else {
        return failure(operation, "conflict", "invalid_request");
    };
    let host = app.state::<Arc<backend::HostState>>().inner().clone();
    let Some(token) = host.upgrade_session(save) else {
        return failure(operation, "conflict", "invalid_request");
    };
    if !raw.as_object().is_some_and(|r| r.len() == 3) {
        return failure(operation, "conflict", "invalid_request");
    }
    if !private_run_allowed(&host, &token) {
        return failure(operation, "conflict", "save_unsupported");
    }
    let action = if acknowledge {
        "acknowledge"
    } else {
        "inspect"
    };
    let generation = host.artwork.lock().unwrap().generation(save);
    let mut result = dispatch(
        app,
        Operation::ProductionHealth(
            action.into(),
            save.into(),
            operation.into(),
            String::new(),
            "null".into(),
            Instant::now(),
        ),
        operation.into(),
        false,
        save,
        None,
    )
    .await;
    if let Some(projection) = &mut result.canonical {
        retain_canonical_artwork(&host, save, generation, projection);
        host.update_editor(save, projection.opened.fingerprint(), &token);
    }
    result
}

#[cfg(feature = "production-health")]
fn retain_canonical_artwork(
    host: &backend::HostState,
    save: &str,
    generation: Option<uuid::Uuid>,
    projection: &mut Canonical,
) {
    let mut artwork = host.artwork.lock().unwrap();
    let fingerprint = projection.opened.fingerprint();
    let revision = projection.artwork_revision.as_deref();
    projection.upgrade_artwork_retained = Some(artwork.retain_upgrade_artwork(
        save,
        generation,
        fingerprint,
        revision,
        &mut projection.upgrades,
    ));
    if let Some(advanced) = &mut projection.advanced {
        projection.item_artwork_retained =
            artwork.retain_item_artwork(save, generation, fingerprint, revision, advanced);
    }
}

#[cfg(test)]
#[path = "../../tests/unit/transactions/recovery.rs"]
mod tests;
