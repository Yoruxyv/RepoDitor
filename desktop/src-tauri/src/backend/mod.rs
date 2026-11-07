//! Fixed backend operations, bounded request admission, and lifetime ownership.
pub(crate) mod process;

use crate::error::{BackendError, Outcome, Service};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

const DEADLINE: Duration = Duration::from_secs(30);
const OPERATIONS: usize = if cfg!(feature = "synthetic-health-recovery") {
    12
} else {
    9
};

#[derive(Default)]
pub struct HostState {
    requests: [AtomicBool; OPERATIONS],
    domain_worker: Mutex<()>,
    pub closing: Arc<AtomicBool>,
    #[cfg(feature = "synthetic-health-recovery")]
    editor_session: Mutex<(u64, Option<(String, String)>)>,
    #[cfg(feature = "synthetic-health-recovery")]
    pub meta_session: Mutex<crate::synthetic::meta::Session>,
}
impl HostState {
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn open_editor(&self, save: &str, fingerprint: &str) {
        let mut session = self.editor_session.lock().unwrap();
        session.0 += 1;
        session.1 = Some((save.into(), fingerprint.into()));
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
        session
            .1
            .as_ref()
            .is_some_and(|(id, fp)| id == save && fp == fingerprint)
            && token == format!("{}-{}", std::process::id(), session.0)
    }
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn update_editor(&self, save: &str, fingerprint: &str) {
        if let Ok(mut session) = self.editor_session.lock() {
            if let Some((id, fp)) = &mut session.1 {
                if id == save {
                    *fp = fingerprint.into();
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
struct Request(Arc<HostState>, usize);
impl Request {
    fn reserve(state: Arc<HostState>, slot: usize) -> Result<Self, BackendError> {
        if state.closing.load(Ordering::SeqCst) {
            return Err(BackendError::Failed);
        }
        state.requests[slot]
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| BackendError::Failed)?;
        Ok(Self(state, slot))
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
    Upgrades(String),
    Run(String),
    Items(String),
    Maps,
    Cosmetics,
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
            Self::Upgrades(_) => 4,
            Self::Run(_) => 5,
            Self::Items(_) => 6,
            Self::Maps => 7,
            Self::Cosmetics => 8,
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
            | Self::TestRunPrepare(..) => 9,
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
            Self::Players(_) => Service::Player,
            Self::Upgrades(_) => Service::Upgrade,
            Self::Run(_) => Service::Run,
            Self::Items(_) => Service::Items,
            Self::Maps => Service::Maps,
            Self::Cosmetics => Service::Cosmetics,
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
            Self::Upgrades(id) => vec!["upgrades-list", id],
            Self::Run(id) => vec!["run-get", id],
            Self::Items(id) => vec!["advanced-get", id],
            Self::Maps => vec!["maps-list"],
            Self::Cosmetics => vec!["cosmetics-get"],
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
    // The status admission permit already bounds its lane to one request.
    let _domain_worker = if request.1 == Operation::Game.slot() {
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
    let result = process::run(executable, args, remaining, state.closing.clone());
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
            )
        )
    {
        return result.map_err(|error| {
            if error == BackendError::Unavailable {
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
        | Operation::TestRunPrepare(.., started) => *started,
        _ => Instant::now(),
    };
    #[cfg(not(feature = "synthetic-health-recovery"))]
    let started = Instant::now();
    let state = app.state::<Arc<HostState>>().inner().clone();
    let request = match Request::reserve(state, operation.slot()) {
        Ok(request) => request,
        Err(error) => return Outcome::for_service(Err(error), service),
    };
    #[cfg(feature = "synthetic-health-recovery")]
    let is_write = matches!(
        operation,
        Operation::TestMetaWrite(..)
            | Operation::TestHealth(..)
            | Operation::TestHealthBatch(..)
            | Operation::TestRefill(..)
            | Operation::TestUpgrades(..)
            | Operation::TestRun(..)
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
