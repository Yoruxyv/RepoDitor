//! Standalone synthetic child compiled only by process tests, never packaged.
use std::{
    io::{self, Write},
    process::{Command, Stdio},
    time::Duration,
};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    match args[1].as_str() {
        "success" => println!("{{\"ok\":true}}"),
        "fail" => {
            eprintln!("private diagnostic path");
            std::process::exit(7);
        }
        "stdout" => loop {
            io::stdout().write_all(&[b'x'; 4096]).unwrap();
        },
        "stderr" => loop {
            io::stderr().write_all(&[b'x'; 4096]).unwrap();
        },
        "hang" => std::thread::sleep(Duration::from_secs(60)),
        "descendant" => {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .arg("hang")
                .stdin(Stdio::null())
                .spawn()
                .unwrap();
            std::fs::write(&args[2], child.id().to_string()).unwrap();
            child.wait().unwrap();
        }
        "environment" | "saves-open" | "game-status" => {
            let hang = std::env::var("REPODITOR_TEST_HANG_COMMAND")
                .unwrap_or_else(|_| "environment".into());
            if hang != args[1] {
                if let Some(root) = std::env::var_os("REPODITOR_TEST_RESPONSES_DIR") {
                    let response = std::fs::read_to_string(
                        std::path::PathBuf::from(root).join(format!("{}.json", args[1])),
                    )
                    .unwrap();
                    if response == "exit7" {
                        eprintln!("private backend diagnostic");
                        std::process::exit(7);
                    }
                    print!("{response}");
                } else {
                    assert_eq!(args[1], "game-status");
                    println!("{{\"ok\":true,\"status\":\"not_running\",\"running\":false}}");
                }
                return;
            }
            let mut child = Command::new(std::env::current_exe().unwrap())
                .arg("hang")
                .stdin(Stdio::null())
                .spawn()
                .unwrap();
            std::fs::write(
                std::env::var_os("REPODITOR_TEST_PID_FILE").unwrap(),
                format!("[{},{}]", std::process::id(), child.id()),
            )
            .unwrap();
            child.wait().unwrap();
        }
        _ => panic!("Unknown fixture mode"),
    }
}
