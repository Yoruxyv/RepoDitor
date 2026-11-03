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
const OPERATIONS: usize = 3;

#[derive(Default)]
pub struct HostState {
    requests: [AtomicBool; OPERATIONS],
    worker: Mutex<()>,
    pub closing: Arc<AtomicBool>,
}
struct Request(Arc<HostState>, usize);
impl Request {
    fn reserve(state: Arc<HostState>, slot: usize) -> Result<Self, BackendError> {
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
}
impl Operation {
    fn slot(&self) -> usize {
        match self {
            Self::Discovery => 0,
            Self::Open(_) => 1,
            Self::Game => 2,
        }
    }
    fn service(&self) -> Service {
        match self {
            Self::Discovery => Service::Discovery,
            Self::Open(_) => Service::Save,
            Self::Game => Service::Game,
        }
    }
    fn arguments(&self) -> Vec<&str> {
        match self {
            Self::Discovery => vec!["environment"],
            Self::Open(id) => vec!["saves-open", id],
            Self::Game => vec!["game-status"],
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
    let _worker = loop {
        if state.closing.load(Ordering::SeqCst) {
            return Err(BackendError::Failed);
        }
        if started.elapsed() >= deadline {
            return Err(BackendError::Timeout);
        }
        match state.worker.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::Poisoned(_)) => return Err(BackendError::Failed),
            Err(std::sync::TryLockError::WouldBlock) => thread::sleep(Duration::from_millis(5)),
        }
    };
    process::run(
        executable,
        args,
        deadline.saturating_sub(started.elapsed()),
        state.closing.clone(),
    )
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
    fn admission_is_bounded_and_released_on_failure() {
        let state = Arc::new(HostState::default());
        let requests: Vec<_> = (0..OPERATIONS)
            .map(|slot| Request::reserve(state.clone(), slot).unwrap())
            .collect();
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
        let _held = state.worker.lock().unwrap();
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
        assert_eq!(
            execute(&request, path, &[], Instant::now(), DEADLINE).unwrap_err(),
            BackendError::Failed
        );
    }
}
