//! Fixed backend operations, bounded request admission, and lifetime ownership.
use crate::{
    error::{BackendError, Outcome, Service},
    process,
};
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
}
impl HostState {
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
    TestHealthRecover(String, String, bool, bool),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthState(String),
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
            Self::TestHealth(..) | Self::TestHealthPrepare(..) => 9,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthRecover(..) => 10,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthState(..) => 11,
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
            Self::TestHealth(..)
            | Self::TestHealthPrepare(..)
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
    if request.1 == 9 && args.first() != Some(&"health-prepare") {
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
        Operation::TestHealth(.., started) | Operation::TestHealthPrepare(.., started) => *started,
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
    let is_write = matches!(operation, Operation::TestHealth(..));
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
mod tests {
    use super::*;
    #[cfg(feature = "synthetic-health-recovery")]
    #[test]
    fn a_worker_panic_after_work_cannot_be_reported_as_a_rejected_write() {
        for write in [true, false] {
            let worked = Arc::new(AtomicBool::new(false));
            let worker_flag = worked.clone();
            let joined = tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking(
                move || -> Result<(), BackendError> {
                    worker_flag.store(true, Ordering::SeqCst);
                    panic!("controlled worker failure after work");
                },
            ));
            assert!(worked.load(Ordering::SeqCst));
            assert_eq!(
                worker_result(joined, write),
                Err(if write {
                    BackendError::WriteUncertain
                } else {
                    BackendError::Failed
                })
            );
        }
    }
    #[cfg(feature = "synthetic-health-recovery")]
    #[test]
    fn health_transport_has_only_fixed_arguments_and_exclusive_admission() {
        let op = Operation::TestHealth(
            "save".into(),
            "fp".into(),
            "payload".into(),
            "op".into(),
            Instant::now(),
        );
        assert_eq!(
            op.arguments(),
            [
                "saves-write",
                "save",
                "fp",
                "payload",
                "--health-operation",
                "op"
            ]
        );
        let state = Arc::new(HostState::default());
        let request = Request::reserve(state.clone(), op.slot()).unwrap();
        assert!(Request::reserve(state.clone(), op.slot()).is_err());
        drop(request);
        assert!(state.idle());
    }
    #[cfg(feature = "synthetic-health-recovery")]
    #[test]
    fn queued_write_timeout_is_rejected_but_started_timeout_is_uncertain() {
        let state = Arc::new(HostState::default());
        let held = state.domain_worker.lock().unwrap();
        let request = Request::reserve(state.clone(), 9).unwrap();
        assert_eq!(
            execute(
                &request,
                Path::new("never-spawn.exe"),
                &[],
                Instant::now(),
                Duration::from_millis(20)
            )
            .unwrap_err(),
            BackendError::Timeout
        );
        drop(held);
        assert_eq!(
            execute(
                &request,
                process::tests::fixture(),
                &["hang"],
                Instant::now(),
                Duration::from_millis(40)
            )
            .unwrap_err(),
            BackendError::WriteUncertain
        );
        drop(request);
        assert!(state.idle());
    }
    #[test]
    fn maps_has_fixed_arguments_and_uses_the_bounded_domain_queue() {
        assert_eq!(Operation::Maps.arguments(), ["maps-list"]);
        let state = Arc::new(HostState::default());
        let held = state.domain_worker.lock().unwrap();
        let request = Request::reserve(state.clone(), Operation::Maps.slot()).unwrap();
        assert!(Request::reserve(state.clone(), Operation::Maps.slot()).is_err());
        assert_eq!(
            execute(
                &request,
                Path::new("must-never-spawn.exe"),
                &[],
                Instant::now(),
                Duration::from_millis(20)
            )
            .unwrap_err(),
            BackendError::Timeout
        );
        state.closing.store(true, Ordering::SeqCst);
        assert_eq!(
            execute(
                &request,
                Path::new("must-never-spawn.exe"),
                &[],
                Instant::now(),
                DEADLINE
            )
            .unwrap_err(),
            BackendError::Failed
        );
        drop(held);
        drop(request);
        assert!(state.idle());
    }

    #[test]
    fn admission_is_bounded_and_released_on_failure() {
        let state = Arc::new(HostState::default());
        assert!(state.idle());
        let requests: Vec<_> = (0..OPERATIONS)
            .map(|slot| Request::reserve(state.clone(), slot).unwrap())
            .collect();
        assert!(!state.idle());
        assert!(Request::reserve(state.clone(), 0).is_err());
        drop(requests);
        assert!(state
            .requests
            .iter()
            .all(|slot| !slot.load(Ordering::SeqCst)));
        assert!(Request::reserve(state, 0).is_ok());
    }
    #[test]
    fn queued_requests_observe_cancellation_and_original_deadline() {
        let state = Arc::new(HostState::default());
        let _held = state.domain_worker.lock().unwrap();
        let request = Request::reserve(state.clone(), 0).unwrap();
        let path = Path::new("must-never-spawn.exe");
        assert_eq!(
            execute(
                &request,
                path,
                &[],
                Instant::now(),
                Duration::from_millis(20)
            )
            .unwrap_err(),
            BackendError::Timeout
        );
        state.closing.store(true, Ordering::SeqCst);
        assert!(Request::reserve(state.clone(), Operation::Open(String::new()).slot()).is_err());
        assert_eq!(
            execute(&request, path, &[], Instant::now(), DEADLINE).unwrap_err(),
            BackendError::Failed
        );
    }

    #[test]
    fn status_bypasses_domain_worker_but_its_admission_remains_exclusive() {
        let fixture = process::tests::fixture();
        let state = Arc::new(HostState::default());
        let _held = state.domain_worker.lock().unwrap();
        let request = Request::reserve(state.clone(), Operation::Game.slot()).unwrap();
        assert!(Request::reserve(state.clone(), Operation::Game.slot()).is_err());
        let bytes = execute(
            &request,
            fixture,
            &["success"],
            Instant::now(),
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["ok"],
            true
        );
        drop(request);
        assert!(Request::reserve(state.clone(), Operation::Game.slot()).is_ok());
    }

    #[test]
    fn status_checks_original_deadline_and_close_before_spawning() {
        let state = Arc::new(HostState::default());
        let request = Request::reserve(state.clone(), Operation::Game.slot()).unwrap();
        let missing = Path::new("must-never-spawn.exe");
        assert_eq!(
            execute(&request, missing, &[], Instant::now() - DEADLINE, DEADLINE).unwrap_err(),
            BackendError::Timeout
        );
        state.closing.store(true, Ordering::SeqCst);
        assert_eq!(
            execute(&request, missing, &[], Instant::now(), DEADLINE).unwrap_err(),
            BackendError::Failed
        );
    }

    #[test]
    fn status_failures_preserve_process_bounds_and_release_admission() {
        let fixture = process::tests::fixture();
        let state = Arc::new(HostState::default());
        let _held = state.domain_worker.lock().unwrap();
        for (mode, expected, timeout) in [
            ("fail", BackendError::Failed, Duration::from_secs(5)),
            ("stdout", BackendError::Malformed, Duration::from_secs(5)),
            ("stderr", BackendError::Malformed, Duration::from_secs(5)),
            ("hang", BackendError::Timeout, Duration::from_millis(80)),
        ] {
            let request = Request::reserve(state.clone(), Operation::Game.slot()).unwrap();
            assert_eq!(
                execute(&request, fixture, &[mode], Instant::now(), timeout).unwrap_err(),
                expected
            );
            drop(request);
        }
        let request = Request::reserve(state.clone(), Operation::Game.slot()).unwrap();
        assert_eq!(
            execute(
                &request,
                &fixture.with_file_name("missing.exe"),
                &[],
                Instant::now(),
                DEADLINE
            )
            .unwrap_err(),
            BackendError::Unavailable
        );
    }
}
