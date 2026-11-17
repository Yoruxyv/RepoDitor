//! Fixed backend operations, bounded request admission, and lifetime ownership.
pub(crate) mod artwork;
pub(crate) mod cache_activity;
pub(crate) mod process;

use crate::error::{BackendError, Outcome, Service};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

const DEADLINE: Duration = Duration::from_secs(30);
const AVATAR_SLOT: usize = if cfg!(feature = "synthetic-health-recovery") {
    12
} else {
    9
};
const ARTWORK_SLOT: usize = AVATAR_SLOT + 1;
const OPERATIONS: usize = ARTWORK_SLOT + 1;

#[derive(Default)]
pub struct HostState {
    requests: [AtomicBool; OPERATIONS],
    domain_worker: Mutex<()>,
    pub closing: Arc<AtomicBool>,
    pub artwork: Mutex<artwork::Registry>,
    cosmetic_key: OnceLock<String>,
    #[cfg(feature = "synthetic-health-recovery")]
    editor_session: Mutex<(u64, Option<(String, String)>)>,
    #[cfg(feature = "synthetic-health-recovery")]
    pub meta_session: Mutex<crate::synthetic::meta::Session>,
}
#[cfg(feature = "synthetic-health-recovery")]
#[derive(Clone)]
pub struct EditorWrite {
    pub save: String,
    pub fingerprint: String,
    pub token: String,
}

impl HostState {
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn open_editor(&self, save: &str, fingerprint: &str) {
        let mut session = self.editor_session.lock().unwrap();
        session.0 += 1;
        session.1 = Some((save.into(), fingerprint.into()));
    }
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn close_editor(&self, save: &str) {
        if let Ok(mut session) = self.editor_session.lock() {
            if session.1.as_ref().is_some_and(|(id, _)| id == save) {
                session.0 += 1;
                session.1 = None;
            }
        }
    }
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn upgrade_session(&self, save: &str) -> Option<String> {
        let session = self.editor_session.lock().ok()?;
        (session.1.as_ref()?.0 == save).then(|| format!("{}-{}", std::process::id(), session.0))
    }
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn accepts_upgrade(&self, save: &str, fingerprint: &str, token: &str) -> bool {
        let Ok(session) = self.editor_session.lock() else {
            return false;
        };
        Self::editor_matches(&session, save, fingerprint, token)
    }
    #[cfg(feature = "synthetic-health-recovery")]
    fn editor_matches(
        session: &(u64, Option<(String, String)>),
        save: &str,
        fingerprint: &str,
        token: &str,
    ) -> bool {
        session
            .1
            .as_ref()
            .is_some_and(|(id, fp)| id == save && fp == fingerprint)
            && token == format!("{}-{}", std::process::id(), session.0)
    }
    #[cfg(feature = "synthetic-health-recovery")]
    fn launch_editor_write<T>(
        &self,
        editor: &EditorWrite,
        spawn: impl FnOnce() -> Result<T, BackendError>,
    ) -> Result<T, BackendError> {
        let session = self
            .editor_session
            .lock()
            .map_err(|_| BackendError::Request)?;
        if !Self::editor_matches(&session, &editor.save, &editor.fingerprint, &editor.token) {
            return Err(BackendError::Request);
        }
        // Close and open share this lock through process creation, then the writer owns recovery.
        spawn()
    }
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn update_editor(&self, save: &str, fingerprint: &str, token: &str) {
        if let Ok(mut session) = self.editor_session.lock() {
            if token == format!("{}-{}", std::process::id(), session.0) {
                if let Some((id, fp)) = &mut session.1 {
                    if id == save {
                        *fp = fingerprint.into();
                    }
                }
            }
        }
    }
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn health_busy(&self) -> bool {
        self.requests[9].load(Ordering::SeqCst) || self.requests[10].load(Ordering::SeqCst)
    }
    pub fn idle(&self) -> bool {
        self.requests
            .iter()
            .all(|slot| !slot.load(Ordering::SeqCst))
    }
}
struct Request(
    Arc<HostState>,
    usize,
    Arc<AtomicBool>,
    bool,
    #[cfg(feature = "synthetic-health-recovery")] Option<EditorWrite>,
);
impl Request {
    fn reserve(state: Arc<HostState>, slot: usize) -> Result<Self, BackendError> {
        if state.closing.load(Ordering::SeqCst) {
            return Err(BackendError::Failed);
        }
        state.requests[slot]
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| BackendError::Failed)?;
        let cancelled = state.closing.clone();
        Ok(Self(
            state,
            slot,
            cancelled,
            false,
            #[cfg(feature = "synthetic-health-recovery")]
            None,
        ))
    }
}
impl Drop for Request {
    fn drop(&mut self) {
        self.0.requests[self.1].store(false, Ordering::SeqCst);
    }
}

pub enum Operation {
    Discovery,
    Open(String),
    Game,
    Players(String),
    Avatar(String, String),
    Artwork(
        artwork::Scope,
        Option<String>,
        String,
        String,
        Arc<AtomicBool>,
    ),
    ArtworkBatch(Arc<artwork::ArtworkBatch>),
    Upgrades(String, Option<Arc<AtomicBool>>),
    Run(String),
    Items(String),
    Maps(bool, Option<String>),
    Cosmetics(bool),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealth(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthBatch(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthBatchPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRefill(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRefillPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestUpgrades(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestUpgradesPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRun(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRunPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMixed(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMixedPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthRecover(String, String, bool, bool),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthState(String),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMetaState(Option<String>),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMetaPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMetaWrite(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMetaRecover(String, String),
}
impl Operation {
    fn slot(&self) -> usize {
        match self {
            Self::Discovery => 0,
            Self::Open(_) => 1,
            Self::Game => 2,
            Self::Players(_) => 3,
            Self::Avatar(..) => AVATAR_SLOT,
            Self::Artwork(..) | Self::ArtworkBatch(_) => ARTWORK_SLOT,
            Self::Upgrades(..) => 4,
            Self::Run(_) => 5,
            Self::Items(_) => 6,
            Self::Maps(..) => 7,
            Self::Cosmetics(_) => 8,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMetaPrepare(..)
            | Self::TestMetaWrite(..)
            | Self::TestHealth(..)
            | Self::TestHealthPrepare(..)
            | Self::TestHealthBatch(..)
            | Self::TestHealthBatchPrepare(..)
            | Self::TestRefill(..)
            | Self::TestRefillPrepare(..)
            | Self::TestUpgrades(..)
            | Self::TestUpgradesPrepare(..)
            | Self::TestRun(..)
            | Self::TestRunPrepare(..)
            | Self::TestMixed(..)
            | Self::TestMixedPrepare(..) => 9,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthRecover(..) | Self::TestMetaRecover(..) => 10,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthState(..) | Self::TestMetaState(..) => 11,
        }
    }
    fn service(&self) -> Service {
        match self {
            Self::Discovery => Service::Discovery,
            Self::Open(_) => Service::Save,
            Self::Game => Service::Game,
            Self::Players(_) | Self::Avatar(..) => Service::Player,
            Self::Upgrades(..) | Self::Artwork(artwork::Scope::Upgrade, ..) => Service::Upgrade,
            Self::Run(_) => Service::Run,
            Self::Items(_) | Self::Artwork(artwork::Scope::Item, ..) => Service::Items,
            Self::Maps(..) | Self::Artwork(artwork::Scope::Map, ..) => Service::Maps,
            Self::Cosmetics(_) | Self::Artwork(artwork::Scope::Cosmetic, ..) => Service::Cosmetics,
            Self::ArtworkBatch(batch) if batch.scope == artwork::Scope::Upgrade => Service::Upgrade,
            Self::ArtworkBatch(batch) if batch.scope == artwork::Scope::Item => Service::Items,
            Self::ArtworkBatch(batch) if batch.scope == artwork::Scope::Map => Service::Maps,
            Self::ArtworkBatch(_) => Service::Cosmetics,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMetaState(..)
            | Self::TestMetaPrepare(..)
            | Self::TestMetaWrite(..)
            | Self::TestMetaRecover(..)
            | Self::TestHealth(..)
            | Self::TestHealthPrepare(..)
            | Self::TestHealthBatch(..)
            | Self::TestHealthBatchPrepare(..)
            | Self::TestRefill(..)
            | Self::TestRefillPrepare(..)
            | Self::TestUpgrades(..)
            | Self::TestUpgradesPrepare(..)
            | Self::TestRun(..)
            | Self::TestRunPrepare(..)
            | Self::TestMixed(..)
            | Self::TestMixedPrepare(..)
            | Self::TestHealthRecover(..)
            | Self::TestHealthState(..) => Service::Save,
        }
    }
    fn arguments(&self) -> Vec<&str> {
        match self {
            Self::Discovery => vec!["environment"],
            Self::Open(id) => vec!["saves-open", id],
            Self::Game => vec!["game-status"],
            Self::Players(id) => vec!["players-list", id],
            Self::Avatar(id, player) => vec!["players-avatar", id, player],
            Self::Artwork(scope, id, fingerprint, key, _) => {
                let mut args = vec![match scope {
                    artwork::Scope::Upgrade => "upgrade-artwork",
                    artwork::Scope::Item => "item-artwork",
                    artwork::Scope::Map => "map-artwork",
                    artwork::Scope::Cosmetic => "native-cosmetic-artwork",
                }];
                args.extend(id.as_deref());
                args.push(fingerprint);
                if *scope == artwork::Scope::Map {
                    args.push("--");
                }
                args.push(key);
                args
            }
            Self::ArtworkBatch(batch) => {
                if batch.scope == artwork::Scope::Map {
                    let mut args = vec!["map-artwork-batch", batch.fingerprint.as_str(), "--"];
                    args.extend(batch.members.iter().map(|member| member.key.as_str()));
                    return args;
                }
                if let Some(save) = &batch.save {
                    let mut args = vec![
                        if batch.scope == artwork::Scope::Item {
                            "item-artwork-batch"
                        } else {
                            "upgrade-artwork-batch"
                        },
                        save,
                        batch.fingerprint.as_str(),
                        "--",
                    ];
                    args.extend(batch.members.iter().map(|member| member.key.as_str()));
                    return args;
                }
                let mut args = vec!["native-cosmetic-artwork-batch", batch.fingerprint.as_str()];
                for member in &batch.members {
                    args.extend([
                        member.proof.as_deref().unwrap_or_default(),
                        member.key.as_str(),
                    ]);
                }
                args
            }
            Self::Upgrades(id, _) => vec!["upgrades-list", id],
            Self::Run(id) => vec!["run-get", id],
            Self::Items(id) => vec!["advanced-get", id],
            Self::Maps(proof, save) => {
                let mut args = vec!["maps-list"];
                if *proof {
                    args.push("--entry-artwork-proof");
                }
                if let Some(save) = save {
                    args.extend(["--verify-save", save]);
                }
                args
            }
            Self::Cosmetics(true) => vec!["cosmetics-get", "--native-artwork", "--warm-artwork"],
            Self::Cosmetics(false) => vec!["cosmetics-get", "--native-artwork"],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealth(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--health-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthPrepare(id, fingerprint, payload, operation, _) => {
                let mut args = vec!["health-prepare", id, fingerprint, payload, operation];
                if cfg!(feature = "synthetic-health-ui") {
                    args.push("--intent");
                }
                args
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestUpgrades(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--upgrade-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthBatch(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--health-batch-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthBatchPrepare(id, fingerprint, payload, operation, _) => {
                vec!["health-batch-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRefill(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--refill-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRefillPrepare(id, fingerprint, payload, operation, _) => {
                vec!["refill-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestUpgradesPrepare(id, fingerprint, payload, operation, _) => {
                vec!["upgrade-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRun(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--run-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRunPrepare(id, fingerprint, payload, operation, _) => {
                vec!["run-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMixed(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--mixed-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMixedPrepare(id, fingerprint, payload, operation, _) => {
                vec!["mixed-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthRecover(id, operation, canonical, acknowledge) => {
                let mut args = vec!["health-recover", id, operation];
                if *canonical {
                    args.push("--canonical");
                }
                if *acknowledge {
                    args.push("--acknowledge");
                }
                args
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthState(id) => vec!["health-state", id],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMetaState(operation) => {
                let mut args = vec!["meta-state"];
                if let Some(id) = operation {
                    args.push(id);
                }
                args
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMetaPrepare(id, fingerprint, intent, namespace, _) => {
                vec!["meta-prepare", id, fingerprint, intent, namespace]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMetaWrite(id, fingerprint, intent, namespace, _) => {
                vec!["meta-write", id, fingerprint, intent, namespace]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMetaRecover(id, proof) => vec!["meta-recover", id, proof],
        }
    }
}

fn execute(
    request: &Request,
    executable: &Path,
    args: &[&str],
    started: Instant,
    deadline: Duration,
) -> Result<Vec<u8>, BackendError> {
    let state = &request.0;
    // Each optional/status lane has one permit; network lookup cannot delay save work.
    let _domain_worker = if request.3
        || request.1 == Operation::Game.slot()
        || request.1 == AVATAR_SLOT
        || request.1 == ARTWORK_SLOT
    {
        None
    } else {
        Some(loop {
            if state.closing.load(Ordering::SeqCst) {
                return Err(BackendError::Failed);
            }
            if started.elapsed() >= deadline {
                return Err(BackendError::Timeout);
            }
            match state.domain_worker.try_lock() {
                Ok(guard) => break guard,
                Err(std::sync::TryLockError::Poisoned(_)) => return Err(BackendError::Failed),
                Err(std::sync::TryLockError::WouldBlock) => thread::sleep(Duration::from_millis(5)),
            }
        })
    };
    if state.closing.load(Ordering::SeqCst) {
        return Err(BackendError::Failed);
    }
    let remaining = deadline
        .checked_sub(started.elapsed())
        .filter(|remaining| !remaining.is_zero())
        .ok_or(BackendError::Timeout)?;
    let cosmetic_key = matches!(
        args.first().copied(),
        Some("cosmetics-get" | "native-cosmetic-artwork" | "native-cosmetic-artwork-batch")
    )
    .then(|| {
        state
            .cosmetic_key
            .get_or_init(|| {
                format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                )
            })
            .as_str()
    });
    let result = process::run(
        executable,
        args,
        remaining,
        request.2.clone(),
        cosmetic_key,
        request.3,
        |command| {
            #[cfg(feature = "synthetic-health-recovery")]
            if let Some(editor) = &request.4 {
                return state.launch_editor_write(editor, || process::spawn(command));
            }
            process::spawn(command)
        },
    );
    #[cfg(feature = "synthetic-health-recovery")]
    if request.1 == 9
        && !matches!(
            args.first(),
            Some(
                &"meta-prepare"
                    | &"health-prepare"
                    | &"health-batch-prepare"
                    | &"refill-prepare"
                    | &"upgrade-prepare"
                    | &"run-prepare"
                    | &"mixed-prepare"
            )
        )
    {
        return result.map_err(|error| {
            if matches!(error, BackendError::Unavailable | BackendError::Request) {
                error
            } else {
                BackendError::WriteUncertain
            }
        });
    }
    result
}

#[cfg(feature = "synthetic-health-recovery")]
fn worker_result<T>(
    result: tauri::Result<Result<T, BackendError>>,
    write: bool,
) -> Result<T, BackendError> {
    result.unwrap_or(Err(if write {
        BackendError::WriteUncertain
    } else {
        BackendError::Failed
    }))
}

pub async fn request<T, F>(app: tauri::AppHandle, operation: Operation, parse: F) -> Outcome<T>
where
    T: Serialize + Send + 'static,
    F: FnOnce(&[u8]) -> Result<T, BackendError> + Send + 'static,
{
    request_with_editor(
        app,
        operation,
        parse,
        #[cfg(feature = "synthetic-health-recovery")]
        None,
    )
    .await
}

pub async fn request_with_editor<T, F>(
    app: tauri::AppHandle,
    operation: Operation,
    parse: F,
    #[cfg(feature = "synthetic-health-recovery")] editor: Option<EditorWrite>,
) -> Outcome<T>
where
    T: Serialize + Send + 'static,
    F: FnOnce(&[u8]) -> Result<T, BackendError> + Send + 'static,
{
    let service = operation.service();
    #[cfg(feature = "synthetic-health-recovery")]
    let started = match &operation {
        Operation::TestMetaPrepare(.., started)
        | Operation::TestMetaWrite(.., started)
        | Operation::TestHealth(.., started)
        | Operation::TestHealthPrepare(.., started)
        | Operation::TestHealthBatch(.., started)
        | Operation::TestHealthBatchPrepare(.., started)
        | Operation::TestRefill(.., started)
        | Operation::TestRefillPrepare(.., started)
        | Operation::TestUpgrades(.., started)
        | Operation::TestUpgradesPrepare(.., started)
        | Operation::TestRun(.., started)
        | Operation::TestRunPrepare(.., started)
        | Operation::TestMixed(.., started)
        | Operation::TestMixedPrepare(.., started) => *started,
        _ => Instant::now(),
    };
    #[cfg(not(feature = "synthetic-health-recovery"))]
    let started = Instant::now();
    let state = app.state::<Arc<HostState>>().inner().clone();
    let mut request = match Request::reserve(state, operation.slot()) {
        Ok(request) => request,
        Err(error) => return Outcome::for_service(Err(error), service),
    };
    #[cfg(feature = "synthetic-health-recovery")]
    {
        request.4 = editor;
    }
    match &operation {
        Operation::Artwork(.., cancelled) => request.2 = cancelled.clone(),
        Operation::ArtworkBatch(batch) => request.2 = batch.cancelled.clone(),
        Operation::Upgrades(_, Some(cancelled)) => {
            request.2 = cancelled.clone();
            request.3 = true;
        }
        _ => {}
    }
    #[cfg(feature = "synthetic-health-recovery")]
    let is_write = matches!(
        operation,
        Operation::TestMetaWrite(..)
            | Operation::TestHealth(..)
            | Operation::TestHealthBatch(..)
            | Operation::TestRefill(..)
            | Operation::TestUpgrades(..)
            | Operation::TestRun(..)
            | Operation::TestMixed(..)
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../build/backend/repoditor-backend")
        } else {
            app.path()
                .resource_dir()
                .map_err(|_| BackendError::Unavailable)?
                .join("backend")
        };
        let bytes = execute(
            &request,
            &root.join("repoditor-backend.exe"),
            &operation.arguments(),
            started,
            DEADLINE,
        )?;
        let result = parse(&bytes);
        #[cfg(feature = "synthetic-health-recovery")]
        if is_write {
            return result.map_err(|_| BackendError::WriteUncertain);
        }
        result
    })
    .await;
    #[cfg(feature = "synthetic-health-recovery")]
    let result = worker_result(result, is_write);
    #[cfg(not(feature = "synthetic-health-recovery"))]
    let result = result.unwrap_or(Err(BackendError::Failed));
    Outcome::for_service(result, service)
}

#[cfg(test)]
#[path = "../../tests/unit/backend/mod.rs"]
mod tests;
