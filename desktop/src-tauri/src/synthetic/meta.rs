//! Independent synthetic MetaSave authority; Python owns evidence and save semantics.
use super::{meta_anchor, recovery::test_root};
use crate::{
    backend::{self, HostState, Operation},
    error::{BackendError, Outcome},
    projections::cosmetics,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, path::PathBuf, sync::Arc, time::Instant};
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Intent {
    meta_cosmetics: Action,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", deny_unknown_fields)]
enum Action {
    #[serde(rename = "unlockIds")]
    UnlockIds { admission: String, ids: Vec<u16> },
    #[serde(rename = "unlockAll")]
    UnlockAll { admission: String },
    #[serde(rename = "lockAll")]
    LockAll { admission: String },
    #[serde(rename = "clearPresets")]
    ClearPresets { admission: String },
}
impl Intent {
    fn admission(&self) -> &str {
        match &self.meta_cosmetics {
            Action::UnlockIds { admission, .. }
            | Action::UnlockAll { admission }
            | Action::LockAll { admission }
            | Action::ClearPresets { admission } => admission,
        }
    }
    fn valid(&self) -> bool {
        let expected: Value = serde_json::from_str(meta_anchor::manifest()).unwrap();
        let ids = expected["catalog"].as_array().unwrap();
        hex(self.admission(), 64)
            && match &self.meta_cosmetics {
                Action::UnlockIds { ids: selected, .. } => {
                    !selected.is_empty()
                        && selected.len() <= 512
                        && selected.iter().collect::<HashSet<_>>().len() == selected.len()
                        && selected
                            .iter()
                            .all(|i| ids.iter().any(|row| row["id"] == *i))
                }
                _ => true,
            }
            && serde_json::to_vec(self).is_ok_and(|bytes| bytes.len() <= 2048)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Admission {
    manifest: String,
    identity: String,
    build: String,
    digest: String,
}
impl Admission {
    fn valid(&self) -> bool {
        self.manifest == meta_anchor::PIN
            && self.identity == "repoditor-synthetic-meta-v1"
            && self.build == "26294889"
            && hex(&self.digest, 64)
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    operation_id: String,
    status: String,
    fingerprint: String,
    backup_available: bool,
    proof: String,
    intent: Option<Intent>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    state: String,
    view: Option<cosmetics::Cosmetics>,
    admission: Option<Admission>,
    namespace: Option<String>,
    pending: Option<Pending>,
    session: Option<String>,
    recovery_session: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result {
    operation_id: String,
    status: String,
    reason: Option<String>,
    fingerprint: Option<String>,
    #[serde(default)]
    backup_available: bool,
    #[serde(skip_deserializing)]
    view: Option<cosmetics::Cosmetics>,
}
struct MutationGrant {
    token: String,
    fingerprint: String,
    namespace: String,
    admission: String,
}
struct RecoveryGrant {
    token: String,
    operation: String,
    proof: String,
}
#[derive(Default)]
pub struct Session {
    generation: u64,
    instance: Option<String>,
    mutation: Option<MutationGrant>,
    recovery: Option<RecoveryGrant>,
}

fn hex(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn disabled(state: &str) -> State {
    State {
        state: state.into(),
        view: None,
        admission: None,
        namespace: None,
        pending: None,
        session: None,
        recovery_session: None,
    }
}
fn failure(id: &str, status: &str) -> Result {
    Result {
        operation_id: id.into(),
        status: status.into(),
        reason: Some("invalid_request".into()),
        fingerprint: None,
        backup_available: false,
        view: None,
    }
}
fn view(raw: &Value) -> std::result::Result<cosmetics::Cosmetics, BackendError> {
    cosmetics::parse(
        &serde_json::to_vec(&json!({"ok":true,"cosmetics":raw}))
            .map_err(|_| BackendError::Invalid)?,
    )
}
fn parse_state(bytes: &[u8]) -> std::result::Result<State, BackendError> {
    let raw = crate::error::json(bytes)?;
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    let state = raw["state"].as_str().ok_or(BackendError::Invalid)?;
    if matches!(state, "busy" | "blocked") {
        return Ok(disabled(state));
    }
    if !matches!(state, "idle" | "pending") {
        return Err(BackendError::Invalid);
    }
    let mut result = disabled(state);
    result.view = Some(view(&raw["view"])?);
    let namespace = raw["namespace"]
        .as_str()
        .filter(|s| hex(s, 64))
        .ok_or(BackendError::Invalid)?;
    result.namespace = Some(namespace.into());
    if !raw["admission"].is_null() {
        let proof: Admission =
            serde_json::from_value(raw["admission"].clone()).map_err(|_| BackendError::Invalid)?;
        if !proof.valid() {
            return Err(BackendError::Invalid);
        }
        result.admission = Some(proof);
    }
    if state == "pending" {
        let pending: Pending =
            serde_json::from_value(raw["pending"].clone()).map_err(|_| BackendError::Invalid)?;
        if !hex(&pending.operation_id, 32)
            || !hex(&pending.proof, 64)
            || !hex(&pending.fingerprint, 64)
            || !matches!(pending.status.as_str(), "applied" | "unchanged")
            || (pending.status == "applied" && !pending.backup_available)
            || pending.intent.as_ref().is_some_and(|i| !i.valid())
        {
            return Err(BackendError::Invalid);
        }
        if raw["view"]["fingerprint"] != pending.fingerprint {
            return Err(BackendError::Invalid);
        }
        result.pending = Some(pending);
    }
    Ok(result)
}
fn parse_result(bytes: &[u8], id: &str) -> std::result::Result<Result, BackendError> {
    let raw = crate::error::json(bytes)?;
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    let mut result: Result =
        serde_json::from_value(raw.clone()).map_err(|_| BackendError::Invalid)?;
    if result.operation_id != id
        || !hex(id, 32)
        || !matches!(
            result.status.as_str(),
            "prepared" | "applied" | "unchanged" | "uncertain" | "rejected" | "conflict" | "busy"
        )
        || result.reason.as_ref().is_some_and(|s| {
            !matches!(
                s.as_str(),
                "invalid_request"
                    | "write_conflict"
                    | "write_busy"
                    | "write_duplicate"
                    | "write_recovery_required"
                    | "save_stale"
                    | "save_validation_failed"
                    | "save_unsupported"
                    | "game_running"
                    | "game_status_unknown"
                    | "meta_missing"
                    | "save_decrypt_failed"
                    | "backend_unavailable"
                    | "backup_failed"
                    | "save_write_failed"
                    | "save_verification_failed"
            )
        })
    {
        return Err(BackendError::Invalid);
    }
    if !raw["view"].is_null() {
        result.view = Some(view(&raw["view"])?);
    }
    if matches!(result.status.as_str(), "applied" | "unchanged")
        && (result.view.is_none()
            || result
                .fingerprint
                .as_deref()
                .is_none_or(|fp| !hex(fp, 64) || raw["view"]["fingerprint"] != fp)
            || (result.status == "applied" && !result.backup_available))
    {
        return Err(BackendError::Invalid);
    }
    Ok(result)
}
impl Session {
    fn issue(&mut self, state: &mut State) {
        self.generation += 1;
        self.mutation = None;
        self.recovery = None;
        let instance = self
            .instance
            .get_or_insert_with(|| uuid::Uuid::new_v4().to_string());
        let token = format!("meta-{instance}-{}", self.generation);
        if let Some(pending) = &state.pending {
            let token = format!("{token}-recovery");
            self.recovery = Some(RecoveryGrant {
                token: token.clone(),
                operation: pending.operation_id.clone(),
                proof: pending.proof.clone(),
            });
            state.recovery_session = Some(token);
        } else if state.state == "idle" {
            if let (Some(admission), Some(namespace), Some(projection)) =
                (&state.admission, &state.namespace, &state.view)
            {
                let raw = serde_json::to_value(projection).unwrap();
                self.mutation = Some(MutationGrant {
                    token: token.clone(),
                    fingerprint: raw["fingerprint"].as_str().unwrap().into(),
                    namespace: namespace.clone(),
                    admission: admission.digest.clone(),
                });
                state.session = Some(token);
            }
        }
    }
}
fn admitted() -> bool {
    if !cfg!(feature = "synthetic-health-ui") || !test_root() {
        return false;
    }
    let Some(low) = std::env::var_os("REPODITOR_E2E_LOCAL_APP_DATA_LOW").map(PathBuf::from) else {
        return false;
    };
    if low.file_name().and_then(|n| n.to_str()) != Some("LocalLow")
        || low
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            != Some("AppData")
    {
        return false;
    }
    let allowed = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../build/recovery-checkpoint")
        .canonicalize();
    low.parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.canonicalize().ok())
        .zip(allowed.ok())
        .is_some_and(|(home, fence)| home.starts_with(fence))
}

pub async fn state(app: tauri::AppHandle, raw: Value) -> State {
    if !admitted()
        || !raw.as_object().is_some_and(|o| {
            o.is_empty()
                || (o.len() == 1 && raw["operationId"].as_str().is_some_and(|s| hex(s, 32)))
        })
    {
        return disabled("disabled");
    }
    let operation = raw["operationId"].as_str().map(str::to_owned);
    let host = app.state::<Arc<HostState>>().inner().clone();
    match backend::request(app, Operation::TestMetaState(operation), parse_state).await {
        Outcome::Success { mut data, .. } => {
            host.meta_session.lock().unwrap().issue(&mut data);
            data
        }
        Outcome::Failure { .. } => {
            host.meta_session
                .lock()
                .unwrap()
                .issue(&mut disabled("blocked"));
            disabled("blocked")
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Write {
    operation_id: String,
    fingerprint: String,
    session: String,
    intent: Intent,
}
async fn dispatch(app: tauri::AppHandle, operation: Operation, id: &str) -> Result {
    let preparing = matches!(operation, Operation::TestMetaPrepare(..));
    let expected = id.to_owned();
    match backend::request(app, operation, move |bytes| parse_result(bytes, &expected)).await {
        Outcome::Success { data, .. } => data,
        Outcome::Failure { error, .. } => failure(
            id,
            if error.code == "write_uncertain" || (preparing && error.code != "python_unavailable")
            {
                "uncertain"
            } else {
                "rejected"
            },
        ),
    }
}
pub async fn write(app: tauri::AppHandle, raw: Value) -> Result {
    let Ok(request) = serde_json::from_value::<Write>(raw) else {
        return failure("", "rejected");
    };
    let id = &request.operation_id;
    if !admitted() || !hex(id, 32) || !hex(&request.fingerprint, 64) || !request.intent.valid() {
        return failure(id, "rejected");
    }
    let host = app.state::<Arc<HostState>>().inner().clone();
    let grant = host.meta_session.lock().unwrap().mutation.take();
    let Some(grant) = grant.filter(|g| {
        g.token == request.session
            && g.fingerprint == request.fingerprint
            && g.admission == request.intent.admission()
    }) else {
        return failure(id, "rejected");
    };
    let started = Instant::now();
    let payload = serde_json::to_string(&request.intent).unwrap();
    let prepared = dispatch(
        app.clone(),
        Operation::TestMetaPrepare(
            id.clone(),
            request.fingerprint.clone(),
            payload.clone(),
            grant.namespace.clone(),
            started,
        ),
        id,
    )
    .await;
    if prepared.status != "prepared" {
        return prepared;
    }
    dispatch(
        app,
        Operation::TestMetaWrite(
            id.clone(),
            request.fingerprint,
            payload,
            grant.namespace,
            started,
        ),
        id,
    )
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Recover {
    operation_id: String,
    session: String,
}
pub async fn recover(app: tauri::AppHandle, raw: Value) -> Result {
    let Ok(request) = serde_json::from_value::<Recover>(raw) else {
        return failure("", "conflict");
    };
    if !cfg!(feature = "synthetic-health-ui") || !test_root() || !hex(&request.operation_id, 32) {
        return failure(&request.operation_id, "conflict");
    }
    let host = app.state::<Arc<HostState>>().inner().clone();
    let grant = host.meta_session.lock().unwrap().recovery.take();
    let Some(grant) =
        grant.filter(|g| g.operation == request.operation_id && g.token == request.session)
    else {
        return failure(&request.operation_id, "conflict");
    };
    dispatch(
        app,
        Operation::TestMetaRecover(request.operation_id.clone(), grant.proof),
        &request.operation_id,
    )
    .await
}

#[cfg(test)]
#[path = "../../tests/unit/synthetic/meta.rs"]
mod tests;
