//! Standalone synthetic child compiled only by process tests, never packaged.
use std::{
    io::{self, Write},
    process::{Command, Stdio},
    time::Duration,
};

fn overflow(mut stream: impl Write) -> ! {
    loop {
        stream.write_all(&[b'x'; 4096]).unwrap();
    }
}

fn record_pids(command: &str, pids: &[u32]) {
    let path = std::env::var_os("REPODITOR_TEST_PID_DIR")
        .map(|root| std::path::PathBuf::from(root).join(format!("{command}.json")))
        .or_else(|| std::env::var_os("REPODITOR_TEST_PID_FILE").map(std::path::PathBuf::from));
    if let Some(path) = path {
        std::fs::write(path, format!("{pids:?}")).unwrap();
    }
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    match args[1].as_str() {
        "success" => println!("{{\"ok\":true}}"),
        "fail" => {
            eprintln!("private diagnostic path");
            std::process::exit(7);
        }
        "stdout" => overflow(io::stdout()),
        "stderr" => overflow(io::stderr()),
        "hang" => {
            if let Some(marker) = args.get(2) {
                std::fs::write(marker, "started").unwrap();
            }
            std::thread::sleep(Duration::from_secs(60));
        }
        "descendant" => {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .arg("hang")
                .stdin(Stdio::null())
                .spawn()
                .unwrap();
            std::fs::write(&args[2], child.id().to_string()).unwrap();
            child.wait().unwrap();
        }
        "environment" | "saves-open" | "game-status" | "players-list" | "upgrades-list"
        | "run-get" | "advanced-get" | "maps-list" | "cosmetics-get" | "upgrade-artwork"
        | "item-artwork" | "map-artwork" => {
            let started = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis();
            let hang = std::env::var("REPODITOR_TEST_HANG_COMMAND")
                .unwrap_or_else(|_| "environment".into());
            if hang != args[1] {
                if let Some(root) = std::env::var_os("REPODITOR_TEST_RESPONSES_DIR") {
                    let response = std::fs::read_to_string(
                        std::path::PathBuf::from(root).join(format!("{}.json", args[1])),
                    )
                    .unwrap();
                    if matches!(response.as_str(), "exit7" | "stdout" | "stderr") {
                        record_pids(&args[1], &[std::process::id()]);
                    }
                    if response == "exit7" {
                        eprintln!("private backend diagnostic");
                        std::process::exit(7);
                    }
                    if response == "stdout" {
                        overflow(io::stdout());
                    }
                    if response == "stderr" {
                        overflow(io::stderr());
                    }
                    if response != "hang" {
                        let delay = std::env::var("REPODITOR_TEST_DELAY_MS")
                            .ok()
                            .and_then(|value| value.parse::<u64>().ok())
                            .unwrap_or(0)
                            .min(5000);
                        if std::env::var("REPODITOR_TEST_DELAY_COMMAND")
                            .ok()
                            .is_none_or(|command| command == args[1])
                        {
                            if let Some(marker) = std::env::var_os("REPODITOR_TEST_STARTED_FILE") {
                                std::fs::write(marker, &args[1]).unwrap();
                            }
                            std::thread::sleep(Duration::from_millis(delay));
                        }
                        if let Some(root) = std::env::var_os("REPODITOR_TEST_TIMING_DIR") {
                            let finished = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis();
                            std::fs::write(std::path::PathBuf::from(root).join(format!("{}-{}.json", args[1], std::process::id())),
                                format!("{{\"operation\":\"{}\",\"started\":{started},\"finished\":{finished}}}", args[1])).unwrap();
                        }
                        print!("{response}");
                        return;
                    }
                } else {
                    assert_eq!(args[1], "game-status");
                    println!("{{\"ok\":true,\"status\":\"not_running\",\"running\":false}}");
                    return;
                }
            }
            let mut child = Command::new(std::env::current_exe().unwrap())
                .arg("hang")
                .stdin(Stdio::null())
                .spawn()
                .unwrap();
            record_pids(&args[1], &[std::process::id(), child.id()]);
            child.wait().unwrap();
        }
        _ => panic!("Unknown fixture mode"),
    }
}
