//! Synthetic command transport and isolated test root admission.
use super::{
    dispatch, editor_write, failure, hex, identity, parse_state, save_permissions, unavailable,
    valid_batch, HealthState, Transaction,
};
use crate::{
    backend::{self, Operation},
    error::Outcome,
    projections::{players, saves},
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc, time::Instant};
use tauri::Manager;

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

pub async fn write_upgrades(app: tauri::AppHandle, raw: Value) -> Transaction {
    write_batch(app, raw, Batch::Upgrades).await
}

pub async fn write_run(app: tauri::AppHandle, raw: Value) -> Transaction {
    write_batch(app, raw, Batch::Run).await
}

pub async fn write_refills(app: tauri::AppHandle, raw: Value) -> Transaction {
    write_batch(app, raw, Batch::Refill).await
}

#[derive(Clone, Copy)]
enum Batch {
    Health,
    Upgrades,
    Run,
    Refill,
    Mixed,
}

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
