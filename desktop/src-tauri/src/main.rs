#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
mod discovery;
mod error;
mod game;
mod process;
mod saves;

use backend::{HostState, Operation};
use error::{BackendError, Outcome, Service};
use std::sync::{atomic::Ordering, Arc};
use tauri::Manager;

fn allowed_navigation(url: &tauri::Url) -> bool {
    url.path() == "/tauri.html"
        && ((url.port().is_none()
            && ((url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                || (url.scheme() == "tauri" && url.host_str() == Some("localhost"))))
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(1420)))
}

#[tauri::command]
async fn environment_detect(app: tauri::AppHandle) -> Outcome<discovery::EnvironmentDiscovery> {
    backend::request(app, Operation::Discovery, discovery::parse).await
}

#[tauri::command]
async fn saves_open(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
) -> Outcome<saves::SaveOpenResult> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Save);
    };
    backend::request(app, Operation::Open(id.clone()), move |bytes| {
        saves::parse(bytes, &id)
    })
    .await
}

#[tauri::command]
async fn game_status(app: tauri::AppHandle) -> Outcome<game::GameState> {
    backend::request(app, Operation::Game, game::parse).await
}

#[tauri::command]
fn preview_close(app: tauri::AppHandle) -> Result<(), &'static str> {
    app.state::<Arc<HostState>>()
        .closing
        .store(true, Ordering::SeqCst);
    app.get_webview_window("main")
        .ok_or("Preview window unavailable")?
        .close()
        .map_err(|_| "Preview could not close")
}

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(HostState::default()))
        .invoke_handler(tauri::generate_handler![
            environment_detect,
            saves_open,
            game_status,
            preview_close
        ])
        .setup(|app| {
            let profile = if std::env::var("REPODITOR_E2E").as_deref() == Ok("1") {
                std::path::PathBuf::from(
                    std::env::var_os("LOCALAPPDATA").ok_or("Missing isolated test profile")?,
                )
                .join("RepoDitorPreview")
            } else {
                app.path().app_local_data_dir()?
            };
            let url = if cfg!(debug_assertions) {
                tauri::WebviewUrl::External("http://127.0.0.1:1420/tauri.html".parse()?)
            } else {
                tauri::WebviewUrl::App("tauri.html".into())
            };
            tauri::WebviewWindowBuilder::new(app, "main", url)
                .title("RepoDitor Preview")
                .inner_size(1200.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .data_directory(profile)
                .on_navigation(allowed_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window
                    .state::<Arc<HostState>>()
                    .closing
                    .store(true, Ordering::SeqCst);
            }
        })
        .run(tauri::generate_context!())
        .expect("Unable to start RepoDitor Preview");
}

#[cfg(test)]
mod tests {
    use super::allowed_navigation;

    #[test]
    fn navigation_is_limited_to_the_preview_page_and_origin() {
        for url in [
            "http://tauri.localhost/tauri.html",
            "tauri://localhost/tauri.html",
        ] {
            assert!(allowed_navigation(&url.parse().unwrap()));
        }
        for url in [
            "https://example.com/tauri.html",
            "http://tauri.localhost:9000/tauri.html",
            "tauri://localhost:9000/tauri.html",
            "http://tauri.localhost/other.html",
            "http://127.0.0.1:5173/tauri.html",
            "file:///tauri.html",
        ] {
            assert!(!allowed_navigation(&url.parse().unwrap()), "{url}");
        }
        assert_eq!(
            allowed_navigation(&"http://127.0.0.1:1420/tauri.html".parse().unwrap()),
            cfg!(debug_assertions)
        );
    }
}
