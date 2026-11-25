//! Request admission, fixed sidecar execution, and response handling.
#[cfg(test)]
use super::operation::{DEADLINE, OPERATIONS};
#[cfg(feature = "health-transport")]
use super::session::EditorWrite;
use super::{
    operation::{Operation, ARTWORK_SLOT, AVATAR_SLOT},
    process,
    session::HostState,
};
use crate::error::{BackendError, Outcome};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

struct Request {
    host: Arc<HostState>,
    slot: usize,
    cancelled: Arc<AtomicBool>,
    background: bool,
    #[cfg(feature = "health-transport")]
    editor: Option<EditorWrite>,
    #[cfg(feature = "health-transport")]
    meta_generation: Option<u64>,
}
impl Request {
    fn reserve(state: Arc<HostState>, slot: usize) -> Result<Self, BackendError> {
        if state.closing.load(Ordering::SeqCst) {
            return Err(BackendError::Cancelled);
        }
        state.requests[slot]
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| BackendError::Failed)?;
        let cancelled = state.closing.clone();
        Ok(Self {
            host: state,
            slot,
            cancelled,
            background: false,
            #[cfg(feature = "health-transport")]
            editor: None,
            #[cfg(feature = "health-transport")]
            meta_generation: None,
        })
    }
}
impl Drop for Request {
    fn drop(&mut self) {
        self.host.requests[self.slot].store(false, Ordering::SeqCst);
    }
}

fn execute(
    request: &Request,
    executable: &Path,
    args: &[&str],
    started: Instant,
    deadline: Duration,
) -> Result<Vec<u8>, BackendError> {
    let state = &request.host;
    // Advisory discovery, status and artwork reads each have their own bounded request lane.
    let _domain_worker = if request.background
        || request.slot == Operation::Discovery.slot()
        || request.slot == Operation::Game.slot()
        || request.slot == AVATAR_SLOT
        || request.slot == ARTWORK_SLOT
    {
        None
    } else {
        Some(loop {
            if state.closing.load(Ordering::SeqCst) || request.cancelled.load(Ordering::SeqCst) {
                return Err(BackendError::Cancelled);
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
    if state.closing.load(Ordering::SeqCst) || request.cancelled.load(Ordering::SeqCst) {
        return Err(BackendError::Cancelled);
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
    let publication = (args.first() == Some(&"production-health") && args.get(1) == Some(&"apply"))
        .then_some(|input: std::process::ChildStdin| {
            #[cfg(feature = "production-health")]
            if let Some(editor) = &request.editor {
                use std::io::Write;

                let mut input = input;
                let _ = state.launch_editor_write(editor, || {
                    if request.cancelled.load(Ordering::SeqCst) {
                        return Err(BackendError::Request);
                    }
                    input.write_all(&[1]).map_err(|_| BackendError::Failed)
                });
                return;
            }
            drop(input);
        });
    let result = process::run(
        executable,
        args,
        remaining,
        request.cancelled.clone(),
        cosmetic_key,
        request.background,
        publication,
        |command| {
            #[cfg(feature = "health-transport")]
            if let Some(editor) = &request.editor {
                return state.launch_editor_write(editor, || process::spawn(command));
            }
            #[cfg(feature = "health-transport")]
            if let Some(generation) = request.meta_generation {
                return state
                    .meta_session
                    .lock()
                    .map_err(|_| BackendError::Request)?
                    .launch(generation, || process::spawn(command));
            }
            process::spawn(command)
        },
    );
    #[cfg(feature = "health-transport")]
    if request.slot == 9
        && !(args.first() == Some(&"production-health") && args.get(1) == Some(&"prepare"))
        && !matches!(
            args.first(),
            Some(
                &"meta-prepare"
                    | &"production-meta-prepare"
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

#[cfg(feature = "health-transport")]
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
        #[cfg(feature = "health-transport")]
        None,
    )
    .await
}

pub async fn request_with_editor<T, F>(
    app: tauri::AppHandle,
    operation: Operation,
    parse: F,
    #[cfg(feature = "health-transport")] editor: Option<EditorWrite>,
) -> Outcome<T>
where
    T: Serialize + Send + 'static,
    F: FnOnce(&[u8]) -> Result<T, BackendError> + Send + 'static,
{
    let service = operation.service();
    #[cfg(feature = "health-transport")]
    let started = match &operation {
        #[cfg(feature = "production-health")]
        Operation::ProductionHealth(.., started) => *started,
        #[cfg(feature = "health-transport")]
        Operation::MetaPrepare(.., started) | Operation::MetaWrite(.., started) => *started,
        #[cfg(feature = "synthetic-health-recovery")]
        Operation::TestHealth(.., started)
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
    #[cfg(not(feature = "health-transport"))]
    let started = Instant::now();
    let state = app.state::<Arc<HostState>>().inner().clone();
    let mut request = match Request::reserve(state, operation.slot()) {
        Ok(request) => request,
        Err(error) => return Outcome::for_service(Err(error), service),
    };
    #[cfg(feature = "health-transport")]
    {
        request.editor = editor;
        if let Operation::MetaPrepare(_, generation, ..) | Operation::MetaWrite(_, generation, ..) =
            &operation
        {
            request.meta_generation = Some(*generation);
        }
    }
    match &operation {
        Operation::Artwork(.., cancelled) => request.cancelled = cancelled.clone(),
        Operation::ArtworkBatch(batch) => request.cancelled = batch.cancelled.clone(),
        Operation::Entry(_, _, cancelled) | Operation::Open(_, _, cancelled) => {
            request.cancelled = cancelled.clone();
        }
        Operation::Avatar(_, _, Some(cancelled)) => request.cancelled = cancelled.clone(),
        Operation::Items(_, Some(cancelled), background) => {
            request.cancelled = cancelled.clone();
            request.background = *background;
        }
        Operation::Upgrades(_, Some(cancelled)) => {
            request.cancelled = cancelled.clone();
            request.background = true;
        }
        _ => {}
    }
    #[cfg(feature = "health-transport")]
    let is_write = match &operation {
        #[cfg(feature = "production-health")]
        Operation::ProductionHealth(action, ..) => action == "apply",
        #[cfg(feature = "health-transport")]
        Operation::MetaWrite(..) => true,
        #[cfg(feature = "synthetic-health-recovery")]
        Operation::TestHealth(..)
        | Operation::TestHealthBatch(..)
        | Operation::TestRefill(..)
        | Operation::TestUpgrades(..)
        | Operation::TestRun(..)
        | Operation::TestMixed(..) => true,
        _ => false,
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
            operation.deadline(),
        )?;
        let result = parse(&bytes);
        #[cfg(feature = "health-transport")]
        if is_write {
            return result.map_err(|_| BackendError::WriteUncertain);
        }
        result
    })
    .await;
    #[cfg(feature = "health-transport")]
    let result = worker_result(result, is_write);
    #[cfg(not(feature = "health-transport"))]
    let result = result.unwrap_or(Err(BackendError::Failed));
    Outcome::for_service(result, service)
}

#[cfg(test)]
#[path = "../../tests/unit/backend/transport.rs"]
mod tests;
