//! Bounded direct child execution. No renderer command, executable or path inputs.
use crate::error::BackendError;
use std::{
    io::Read,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::Threading::{BELOW_NORMAL_PRIORITY_CLASS, CREATE_NO_WINDOW};

pub(crate) const STDOUT_LIMIT: usize = 2 * 1024 * 1024;
pub(crate) const COSMETIC_BATCH_STDOUT_LIMIT: usize = 4 * 1024 * 1024;
pub(crate) const LARGE_ARTWORK_BATCH_STDOUT_LIMIT: usize = 8 * 1024 * 1024;
const PUBLICATION_READY: &[u8] = b"REPODITOR_READY_TO_PUBLISH\n";

struct Job(OwnedHandle);
impl Job {
    fn new() -> Result<Self, BackendError> {
        unsafe {
            let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if raw.is_null() {
                return Err(BackendError::Failed);
            }
            let job = Self(OwnedHandle::from_raw_handle(raw));
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                raw,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                return Err(BackendError::Failed);
            }
            Ok(job)
        }
    }
}

pub(super) fn spawn(command: &mut Command) -> Result<Child, BackendError> {
    command.spawn().map_err(|_| BackendError::Unavailable)
}

pub fn run(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    cancelled: Arc<AtomicBool>,
    cosmetic_key: Option<&str>,
    background: bool,
    publication: Option<impl FnOnce(ChildStdin)>,
    launch: impl FnOnce(&mut Command) -> Result<Child, BackendError>,
) -> Result<Vec<u8>, BackendError> {
    if cancelled.load(Ordering::SeqCst) {
        return Err(BackendError::Cancelled);
    }
    let job = Job::new()?;
    let started = Instant::now();
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(executable.parent().ok_or(BackendError::Unavailable)?)
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .env_remove("REPODITOR_NATIVE_COSMETIC_KEY")
        .creation_flags(
            CREATE_NO_WINDOW
                | if background {
                    BELOW_NORMAL_PRIORITY_CLASS
                } else {
                    0
                },
        )
        .stdin(if publication.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(key) = cosmetic_key {
        command.env("REPODITOR_NATIVE_COSMETIC_KEY", key);
    }
    let launching = Instant::now();
    let mut child = launch(&mut command)?;
    let spawn_ms = launching.elapsed().as_secs_f64() * 1000.0;
    let mut publication = publication.zip(child.stdin.take());
    unsafe {
        if AssignProcessToJobObject(job.0.as_raw_handle(), child.as_raw_handle()) == 0 {
            let _ = child.kill();
            let _ = child.wait();
            return Err(BackendError::Failed);
        }
    }
    let (sender, receiver) = mpsc::sync_channel(8);
    let readers: Vec<_> = [
        Box::new(child.stdout.take().unwrap()) as Box<dyn Read + Send>,
        Box::new(child.stderr.take().unwrap()),
    ]
    .into_iter()
    .enumerate()
    .map(|(stream, mut pipe)| {
        let sender = sender.clone();
        thread::spawn(move || {
            let mut buffer = [0; 4096];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        if sender.send((stream, Ok(buffer[..n].to_vec()))).is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        let _ = sender.send((stream, Err(BackendError::Failed)));
                        break;
                    }
                }
            }
        })
    })
    .collect();
    drop(sender);
    let setup_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut output = Vec::new();
    let mut counts = [0usize; 2];
    let stdout_limit = match args.first().copied() {
        Some("native-cosmetic-artwork-batch") => COSMETIC_BATCH_STDOUT_LIMIT,
        Some("map-artwork-batch" | "item-artwork-batch") => LARGE_ARTWORK_BATCH_STDOUT_LIMIT,
        Some("editor-entry") => 5 * STDOUT_LIMIT + 4096,
        _ => STDOUT_LIMIT,
    };
    let mut status = None;
    let profiling = super::timing::enabled();
    let mut diagnostics = Vec::new();
    let mut first_output = None;
    let mut ready_ms = None;
    let result = loop {
        if cancelled.load(Ordering::SeqCst) {
            break Err(BackendError::Cancelled);
        }
        if started.elapsed() >= timeout {
            break Err(BackendError::Timeout);
        }
        match receiver.recv_timeout(Duration::from_millis(5)) {
            Ok((stream, Ok(bytes))) => {
                counts[stream] += bytes.len();
                if counts[stream] > [stdout_limit, 64 * 1024][stream] {
                    break Err(BackendError::Malformed);
                }
                if stream == 0 {
                    if profiling && first_output.is_none() {
                        first_output = Some(started.elapsed());
                    }
                    output.extend(bytes);
                    if publication.is_some() {
                        if output.starts_with(PUBLICATION_READY) {
                            let (permit, input) = publication.take().unwrap();
                            output.drain(..PUBLICATION_READY.len());
                            permit(input);
                        } else if !PUBLICATION_READY.starts_with(&output) {
                            // Preparation may finish with a rejection and never ask to publish.
                            publication.take();
                        }
                    }
                } else if profiling {
                    diagnostics.extend(bytes);
                    if ready_ms.is_none() && diagnostics.starts_with(b"REPODITOR_PROFILE_READY") {
                        ready_ms = Some(started.elapsed().as_secs_f64() * 1000.0);
                    }
                }
            }
            Ok((_, Err(error))) => break Err(error),
            Err(mpsc::RecvTimeoutError::Disconnected) if status.is_some() => {
                break if status.unwrap() {
                    Ok(output)
                } else {
                    Err(BackendError::Failed)
                };
            }
            Err(_) => {}
        }
        match child.try_wait() {
            Ok(Some(exit)) => status = Some(exit.success()),
            Ok(None) => {}
            Err(_) => break Err(BackendError::Failed),
        }
    };
    drop(job);
    let _ = child.kill();
    let _ = child.wait();
    drop(receiver);
    for reader in readers {
        let _ = reader.join();
    }
    if profiling {
        let diagnostics = String::from_utf8_lossy(&diagnostics);
        let elapsed = |prefix| {
            diagnostics
                .lines()
                .find_map(|line| line.strip_prefix(prefix))
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite() && *value >= 0.0)
        };
        let handler = elapsed("REPODITOR_PROFILE_HANDLER_MS=");
        let source = elapsed("REPODITOR_PROFILE_SOURCE_MS=");
        let save = elapsed("REPODITOR_PROFILE_SAVE_MS=");
        let json = elapsed("REPODITOR_PROFILE_JSON_MS=");
        let command = args.first().copied().unwrap_or("unknown");
        let phase = if command == "production-health" {
            args.get(1).copied().unwrap_or("")
        } else {
            ""
        };
        let first_ms = first_output.map(|elapsed| elapsed.as_secs_f64() * 1000.0);
        eprintln!(
            "[repoditor-perf] sidecar command={command} phase={phase} total_ms={:.2} spawn_ms={spawn_ms:.2} setup_ms={setup_ms:.2} ready_ms={ready_ms:?} first_output_ms={first_ms:?} handler_ms={handler:?} source_ms={source:?} save_ms={save:?} json_ms={json:?} ok={}",
            started.elapsed().as_secs_f64() * 1000.0,
            result.is_ok()
        );
    }
    result
}

#[cfg(test)]
#[path = "../../tests/unit/backend/process.rs"]
pub(crate) mod tests;
