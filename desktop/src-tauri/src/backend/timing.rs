//! Opt-in, path-free timing diagnostics for local packaged profiling.

use std::{sync::OnceLock, time::Instant};

pub fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("REPODITOR_PROFILE_TIMING").as_deref() == Ok("1"))
}

pub fn span(phase: &str, started: Instant) {
    if enabled() {
        eprintln!(
            "[repoditor-perf] {phase} ms={:.2}",
            started.elapsed().as_secs_f64() * 1000.0
        );
    }
}
