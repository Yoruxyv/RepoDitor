//! Feature-gated Health transaction transport and synthetic domain adapters.
use crate::{
    backend::{self, EditorWrite, Operation},
    error::{BackendError, Outcome},
    projections::{items, players, run, saves, upgrades},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(feature = "synthetic-health-recovery")]
use std::path::PathBuf;
use std::sync::Arc;
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
pub struct HealthEdit {
    player_id: String,
    before: i64,
    value: i64,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HealthBatchIntent {
    health: Vec<HealthEdit>,
}

fn valid_health_batch_intent(intent: &HealthBatchIntent) -> bool {
    let mut seen = std::collections::HashSet::new();
    !intent.health.is_empty()
        && intent.health.len() <= 512
        && intent.health.iter().all(|edit| {
            players::valid_id(&edit.player_id)
                && (0..=9_007_199_254_740_991).contains(&edit.before)
                && (0..=2_147_483_647).contains(&edit.value)
                && edit.before != edit.value
                && seen.insert(&edit.player_id)
        })
        && serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 2048)
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
    HealthBatch(HealthBatchIntent),
    Upgrades(UpgradeIntent),
    Run(RunIntent),
    Refill(RefillIntent),
    Mixed(MixedIntent),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MixedIntent {
    mixed: Value,
}

fn valid_mixed_intent(intent: &MixedIntent) -> bool {
    let Some(groups) = intent.mixed.as_object() else {
        return false;
    };
    if groups.len() != 4 || !serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 2048) {
        return false;
    }
    let mut populated = 0;
    for field in ["health", "upgrades", "run", "refillToFull"] {
        let Some(edits) = groups.get(field).and_then(Value::as_array) else {
            return false;
        };
        if edits.is_empty() {
            continue;
        }
        populated += 1;
        let group = json!({(field): edits});
        let valid = match field {
            "health" => serde_json::from_value::<HealthBatchIntent>(group)
                .is_ok_and(|i| valid_health_batch_intent(&i)),
            "upgrades" => serde_json::from_value::<UpgradeIntent>(group)
                .is_ok_and(|i| valid_upgrade_intent(&i)),
            "run" => serde_json::from_value::<RunIntent>(group).is_ok_and(|i| valid_run_intent(&i)),
            _ => {
                serde_json::from_value::<RefillIntent>(group).is_ok_and(|i| valid_refill_intent(&i))
            }
        };
        if !valid {
            return false;
        }
    }
    populated >= 2
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefillEdit {
    save_key: String,
    before: i64,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefillIntent {
    refill_to_full: Vec<RefillEdit>,
}
fn valid_refill_intent(intent: &RefillIntent) -> bool {
    let mut seen = std::collections::HashSet::new();
    !intent.refill_to_full.is_empty()
        && intent.refill_to_full.len() <= 512
        && intent.refill_to_full.iter().all(|edit| {
            edit.save_key.rsplit_once('/').is_some_and(|(name, id)| {
                name.starts_with("Item ")
                    && name.len() > 5
                    && !name.contains(['\n', '\0'])
                    && !id.is_empty()
                    && id.bytes().all(|b| b.is_ascii_digit())
            }) && (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&edit.before)
                && seen.insert(&edit.save_key)
        })
        && serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 2048)
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeIntent {
    upgrades: Vec<UpgradeEdit>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RunEdit {
    field: String,
    before: Value,
    value: Value,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RunIntent {
    run: Vec<RunEdit>,
}
fn valid_run_intent(intent: &RunIntent) -> bool {
    let mut seen = std::collections::HashSet::new();
    !intent.run.is_empty()
        && intent.run.len() <= 5
        && intent.run.iter().all(|edit| {
            edit.before != edit.value
                && seen.insert(&edit.field)
                && match edit.field.as_str() {
                    "resumeLocation" => {
                        edit.before.as_str().is_some_and(|s| s.len() <= 64)
                            && matches!(
                                edit.value.as_str(),
                                Some("Normal" | "Shop / Service Station")
                            )
                    }
                    "level" | "currency" | "lives" | "totalHaul" => {
                        let level = edit.field == "level";
                        edit.before.as_i64().is_some_and(|n| {
                            (if level { 1 } else { -9_007_199_254_740_991 }..=9_007_199_254_740_991)
                                .contains(&n)
                        }) && edit.value.as_i64().is_some_and(|n| {
                            (if level { 1 } else { -2_147_483_648 }..=if level {
                                2_147_483_648
                            } else {
                                2_147_483_647
                            })
                                .contains(&n)
                        })
                    }
                    _ => false,
                }
        })
        && serde_json::to_vec(intent).is_ok_and(|bytes| bytes.len() <= 512)
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
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    draft_only: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    domains: Vec<String>,
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
    })
}

fn parse_state(bytes: &[u8], save: &str) -> Result<HealthState, BackendError> {
    let raw = crate::error::json(bytes)?;
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    let state = raw["state"].as_str().ok_or(BackendError::Invalid)?;
    if state == "disabled" {
        return Ok(unavailable(false, state));
    }
    let mut result = unavailable(true, state);
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

#[cfg(feature = "synthetic-health-recovery")]
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
    let session = host.upgrade_session(&save);
    let draft_only = !save_permissions(&app, "test-health-write", "test-health-recover");
    match backend::request(app, Operation::TestHealthState(save), move |bytes| {
        parse_state(bytes, &expected)
    })
    .await
    {
        Outcome::Success { mut data, .. } => {
            data.draft_only = draft_only;
            if let (Some(projection), Some(token)) = (&data.canonical, &session) {
                host.update_editor(&session_save, projection.opened.fingerprint(), token);
            }
            data.upgrade_session =
                session.filter(|token| host.upgrade_session(&session_save).as_ref() == Some(token));
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

#[cfg(feature = "synthetic-health-recovery")]
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

#[cfg(feature = "synthetic-health-recovery")]
pub async fn write(app: tauri::AppHandle, raw: Value) -> Transaction {
    if raw.get("mixed").is_some() {
        return write_batch(app, raw, Batch::Mixed).await;
    }
    if raw["health"].is_array() {
        return write_batch(app, raw, Batch::Health).await;
    }
    let Some((save, operation)) = identity(&raw) else {
        return failure("", "rejected", "invalid_request");
    };
    // The protocol-only recovery harness still exercises legacy, non-workspace transactions.
    let editor = if cfg!(feature = "synthetic-health-ui") {
        let Some(editor) = editor_write(&app, save, &raw) else {
            return failure(operation, "rejected", "invalid_request");
        };
        Some(editor)
    } else {
        None
    };
    let valid = raw
        .as_object()
        .is_some_and(|r| r.len() == 5 + usize::from(editor.is_some()))
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
        editor.clone(),
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
    dispatch(app, command, operation.into(), true, save, editor).await
}

#[cfg(feature = "synthetic-health-recovery")]
pub async fn write_upgrades(app: tauri::AppHandle, raw: Value) -> Transaction {
    write_batch(app, raw, Batch::Upgrades).await
}

#[cfg(feature = "synthetic-health-recovery")]
pub async fn write_run(app: tauri::AppHandle, raw: Value) -> Transaction {
    write_batch(app, raw, Batch::Run).await
}

#[cfg(feature = "synthetic-health-recovery")]
pub async fn write_refills(app: tauri::AppHandle, raw: Value) -> Transaction {
    write_batch(app, raw, Batch::Refill).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[derive(Clone, Copy)]
enum Batch {
    Health,
    Upgrades,
    Run,
    Refill,
    Mixed,
}

fn valid_batch(field: &str, raw: &Value) -> bool {
    match field {
        "refillToFull" => {
            serde_json::from_value::<RefillIntent>(json!({"refillToFull":raw[field]}))
                .is_ok_and(|i| valid_refill_intent(&i))
        }
        "health" => serde_json::from_value::<HealthBatchIntent>(json!({"health":raw[field]}))
            .is_ok_and(|i| valid_health_batch_intent(&i)),
        "run" => serde_json::from_value::<RunIntent>(json!({"run":raw[field]}))
            .is_ok_and(|i| valid_run_intent(&i)),
        "upgrades" => serde_json::from_value::<UpgradeIntent>(json!({"upgrades":raw[field]}))
            .is_ok_and(|i| valid_upgrade_intent(&i)),
        "mixed" => valid_mixed_intent(&MixedIntent {
            mixed: raw[field].clone(),
        }),
        _ => false,
    }
}

#[cfg(feature = "synthetic-health-recovery")]
async fn write_batch(app: tauri::AppHandle, raw: Value, batch: Batch) -> Transaction {
    let Some((save, operation)) = identity(&raw) else {
        return failure("", "rejected", "invalid_request");
    };
    let field = match batch {
        Batch::Health => "health",
        Batch::Upgrades => "upgrades",
        Batch::Run => "run",
        Batch::Refill => "refillToFull",
        Batch::Mixed => "mixed",
    };
    if !cfg!(feature = "synthetic-health-ui")
        || !test_root()
        || !raw.as_object().is_some_and(|r| r.len() == 5)
        || !valid_batch(field, &raw)
    {
        return failure(operation, "rejected", "invalid_request");
    }
    let Some(editor) = editor_write(&app, save, &raw) else {
        return failure(operation, "rejected", "invalid_request");
    };
    let payload = raw[field].to_string();
    let fingerprint = &editor.fingerprint;
    let started = Instant::now();
    let prepared = dispatch(
        app.clone(),
        match batch {
            Batch::Refill => Operation::TestRefillPrepare(
                save.into(),
                fingerprint.into(),
                payload.clone(),
                operation.into(),
                started,
            ),
            Batch::Health => Operation::TestHealthBatchPrepare(
                save.into(),
                fingerprint.into(),
                payload.clone(),
                operation.into(),
                started,
            ),
            Batch::Run => Operation::TestRunPrepare(
                save.into(),
                fingerprint.into(),
                payload.clone(),
                operation.into(),
                started,
            ),
            Batch::Upgrades => Operation::TestUpgradesPrepare(
                save.into(),
                fingerprint.into(),
                payload.clone(),
                operation.into(),
                started,
            ),
            Batch::Mixed => Operation::TestMixedPrepare(
                save.into(),
                fingerprint.into(),
                payload.clone(),
                operation.into(),
                started,
            ),
        },
        operation.into(),
        true,
        save,
        Some(editor.clone()),
    )
    .await;
    if prepared.status != "prepared" {
        return prepared;
    }
    dispatch(
        app,
        match batch {
            Batch::Refill => Operation::TestRefill(
                save.into(),
                fingerprint.into(),
                payload,
                operation.into(),
                started,
            ),
            Batch::Health => Operation::TestHealthBatch(
                save.into(),
                fingerprint.into(),
                payload,
                operation.into(),
                started,
            ),
            Batch::Run => Operation::TestRun(
                save.into(),
                fingerprint.into(),
                payload,
                operation.into(),
                started,
            ),
            Batch::Upgrades => Operation::TestUpgrades(
                save.into(),
                fingerprint.into(),
                payload,
                operation.into(),
                started,
            ),
            Batch::Mixed => Operation::TestMixed(
                save.into(),
                fingerprint.into(),
                payload,
                operation.into(),
                started,
            ),
        },
        operation.into(),
        true,
        save,
        Some(editor),
    )
    .await
}

#[cfg(feature = "synthetic-health-recovery")]
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
    let token = host.upgrade_session(save);
    let result = dispatch(
        app,
        Operation::TestHealthRecover(save.into(), operation.into(), canonical, acknowledge),
        operation.into(),
        false,
        save,
        None,
    )
    .await;
    if let (Some(projection), Some(token)) = (&result.canonical, token) {
        host.update_editor(save, projection.opened.fingerprint(), &token);
    }
    result
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
            if let Some(canonical) = &data.canonical {
                if enrolling && !host.accepts_upgrade(&save, canonical.opened.fingerprint(), &token)
                {
                    return unavailable(false, "disabled");
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
        if let Some(advanced) = &mut projection.advanced {
            projection.item_artwork_retained = host.artwork.lock().unwrap().retain_item_artwork(
                save,
                generation,
                projection.opened.fingerprint(),
                projection.artwork_revision.as_deref(),
                advanced,
            );
        }
        host.update_editor(save, projection.opened.fingerprint(), &token);
    }
    result
}

#[cfg(test)]
#[path = "../../tests/unit/synthetic/recovery.rs"]
mod tests;
