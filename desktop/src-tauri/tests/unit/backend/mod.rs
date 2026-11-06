use super::*;
#[cfg(feature = "synthetic-health-recovery")]
#[test]
fn upgrade_requests_are_bound_to_the_current_open_session_and_share_health_admission() {
    let host = Arc::new(HostState::default());
    let save = "REPO_SAVE_2026_08_08_10_20_30";
    assert!(host.upgrade_session(save).is_none());
    host.open_editor(save, &"a".repeat(64));
    let first = host.upgrade_session(save).unwrap();
    assert!(host.accepts_upgrade(save, &"a".repeat(64), &first));
    assert!(!host.accepts_upgrade(save, &"b".repeat(64), &first));
    host.open_editor(save, &"a".repeat(64));
    let current = host.upgrade_session(save).unwrap();
    assert_ne!(first, current);
    assert!(!host.accepts_upgrade(save, &"a".repeat(64), &first));
    host.update_editor(save, &"b".repeat(64));
    assert!(host.accepts_upgrade(save, &"b".repeat(64), &current));
    assert!(!host.accepts_upgrade("REPO_SAVE_2026_08_08_10_20_31", &"b".repeat(64), &current));
    let upgrade = Operation::TestUpgrades(
        save.into(),
        "b".repeat(64),
        "[]".into(),
        "c".repeat(32),
        Instant::now(),
    );
    let held = Request::reserve(host.clone(), upgrade.slot()).unwrap();
    let health = Operation::TestHealth(
        save.into(),
        "b".repeat(64),
        "[]".into(),
        "d".repeat(32),
        Instant::now(),
    );
    assert!(Request::reserve(host.clone(), health.slot()).is_err());
    assert!(host.health_busy());
    drop(held);
    assert!(Request::reserve(host, health.slot()).is_ok());
}
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
