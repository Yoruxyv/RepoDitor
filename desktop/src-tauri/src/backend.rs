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
const OPERATIONS: usize = 9;

#[derive(Default)]
pub struct HostState {
    requests: [AtomicBool; OPERATIONS],
    domain_worker: Mutex<()>,
    pub closing: Arc<AtomicBool>,
}
impl HostState {
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
    process::run(executable, args, remaining, state.closing.clone())
}

pub async fn request<T, F>(app: tauri::AppHandle, operation: Operation, parse: F) -> Outcome<T>
where
    T: Serialize + Send + 'static,
    F: FnOnce(&[u8]) -> Result<T, BackendError> + Send + 'static,
{
    let service = operation.service();
    let started = Instant::now();
    let state = app.state::<Arc<HostState>>().inner().clone();
    let request = match Request::reserve(state, operation.slot()) {
        Ok(request) => request,
        Err(error) => return Outcome::for_service(Err(error), service),
    };
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
        parse(&bytes)
    })
    .await
    .unwrap_or(Err(BackendError::Failed));
    Outcome::for_service(result, service)
}

#[cfg(test)]
mod tests {
    use super::*;
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
