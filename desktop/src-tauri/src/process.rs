//! Bounded direct child execution. No renderer command, executable or path inputs.
use crate::error::BackendError;
use std::{
    io::Read,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::System::JobObjects::*;

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

pub fn run(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<u8>, BackendError> {
    if cancelled.load(Ordering::SeqCst) {
        return Err(BackendError::Failed);
    }
    let job = Job::new()?;
    let started = Instant::now();
    let mut child = Command::new(executable)
        .args(args)
        .current_dir(executable.parent().ok_or(BackendError::Unavailable)?)
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| BackendError::Unavailable)?;
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
    let mut output = Vec::new();
    let mut counts = [0usize; 2];
    let mut status = None;
    let result = loop {
        if cancelled.load(Ordering::SeqCst) {
            break Err(BackendError::Failed);
        }
        if started.elapsed() >= timeout {
            break Err(BackendError::Timeout);
        }
        match receiver.recv_timeout(Duration::from_millis(5)) {
            Ok((stream, Ok(bytes))) => {
                counts[stream] += bytes.len();
                if counts[stream] > [2 * 1024 * 1024, 64 * 1024][stream] {
                    break Err(BackendError::Malformed);
                }
                if stream == 0 {
                    output.extend(bytes);
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
    result
}

#[cfg(test)]
#[path = "process_tests.rs"]
mod tests;
