use super::*;
use std::{path::PathBuf, sync::OnceLock};

pub(crate) fn fixture() -> &'static Path {
    static EXE: OnceLock<PathBuf> = OnceLock::new();
    EXE.get_or_init(|| {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let output = root.join("target/test-fixtures/sidecar.exe");
        std::fs::create_dir_all(output.parent().unwrap()).unwrap();
        let result = Command::new(std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into()))
            .args(["--edition=2021", "-O"])
            .arg(root.join("tests/sidecar_fixture.rs"))
            .arg("-o")
            .arg(&output)
            .status()
            .unwrap();
        assert!(result.success());
        output
    })
}
fn invoke(
    mode: &str,
    timeout: Duration,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<u8>, BackendError> {
    run(fixture(), &[mode], timeout, cancelled)
}
#[test]
fn success_is_repeatable_and_failed_exit_is_sanitized() {
    for _ in 0..3 {
        let result = invoke("success", Duration::from_secs(5), Arc::default()).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&result).unwrap()["ok"],
            true
        );
    }
    assert_eq!(
        invoke("fail", Duration::from_secs(5), Arc::default()).unwrap_err(),
        BackendError::Failed
    );
}
#[test]
fn startup_failure_is_public_and_not_a_raw_path() {
    assert_eq!(
        run(
            &fixture().with_file_name("missing.exe"),
            &[],
            Duration::from_secs(1),
            Arc::default()
        )
        .unwrap_err(),
        BackendError::Unavailable
    );
    let json = serde_json::to_string(&crate::error::Outcome::<()>::from(Err(
        BackendError::Unavailable,
    )))
    .unwrap();
    assert!(!json.contains("missing.exe"));
    assert!(json.contains("python_unavailable"));
}
#[test]
fn stdout_and_stderr_have_separate_finite_budgets() {
    for mode in ["stdout", "stderr"] {
        assert_eq!(
            invoke(mode, Duration::from_secs(5), Arc::default()).unwrap_err(),
            BackendError::Malformed
        );
    }
}
#[test]
fn stalled_child_times_out_and_can_be_cancelled_in_flight() {
    assert_eq!(
        invoke("hang", Duration::from_millis(80), Arc::default()).unwrap_err(),
        BackendError::Timeout
    );
    let cancel = Arc::new(AtomicBool::new(false));
    let signal = cancel.clone();
    let waiter = thread::spawn(move || {
        thread::sleep(Duration::from_millis(80));
        signal.store(true, Ordering::SeqCst);
    });
    assert_eq!(
        invoke("hang", Duration::from_secs(5), cancel).unwrap_err(),
        BackendError::Failed
    );
    waiter.join().unwrap();
}
#[test]
fn closing_job_kills_descendants_and_releases_inherited_pipes() {
    let pid_file = fixture().with_file_name("descendant.pid");
    let _ = std::fs::remove_file(&pid_file);
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let output_path = pid_file.clone();
    let worker = thread::spawn(move || {
        run(
            fixture(),
            &["descendant", output_path.to_str().unwrap()],
            Duration::from_secs(10),
            cancelled,
        )
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while !pid_file.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    signal.store(true, Ordering::SeqCst);
    assert_eq!(worker.join().unwrap().unwrap_err(), BackendError::Failed);
    let pid = std::fs::read_to_string(&pid_file)
        .unwrap()
        .parse::<u32>()
        .unwrap();
    unsafe {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER},
            System::Threading::*,
        };
        let handle = OpenProcess(0x00100000, 0, pid);
        if handle.is_null() {
            assert_eq!(GetLastError(), ERROR_INVALID_PARAMETER);
        } else {
            let exited = WaitForSingleObject(handle, 2000);
            CloseHandle(handle);
            assert_eq!(exited, 0);
        }
    }
    std::fs::remove_file(pid_file).unwrap();
}
