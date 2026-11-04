#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod artwork;
mod backend;
mod cosmetics;
mod discovery;
mod error;
mod game;
mod items;
mod maps;
mod players;
mod process;
mod run;
mod saves;
mod upgrades;

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
async fn players_list(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
) -> Outcome<Vec<players::Player>> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Player);
    };
    backend::request(app, Operation::Players(id), players::parse).await
}

#[tauri::command]
async fn upgrades_list(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
) -> Outcome<Vec<upgrades::Upgrade>> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Upgrade);
    };
    backend::request(app, Operation::Upgrades(id), upgrades::parse).await
}

#[tauri::command]
async fn cosmetics_get(app: tauri::AppHandle) -> Outcome<cosmetics::Cosmetics> {
    backend::request(app, Operation::Cosmetics, cosmetics::parse).await
}

#[tauri::command]
async fn maps_list(app: tauri::AppHandle) -> Outcome<maps::InstalledMaps> {
    backend::request(app, Operation::Maps, maps::parse).await
}

#[tauri::command]
async fn run_get(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
) -> Outcome<run::RunState> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Run);
    };
    backend::request(app, Operation::Run(id), run::parse).await
}

#[tauri::command]
async fn advanced_get(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
) -> Outcome<items::Advanced> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Items);
    };
    backend::request(app, Operation::Items(id), items::parse).await
}

#[tauri::command]
fn preview_close(app: tauri::AppHandle) -> Result<(), &'static str> {
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
            players_list,
            upgrades_list,
            run_get,
            advanced_get,
            maps_list,
            cosmetics_get,
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<HostState>>().inner().clone();
                let already_closing = state.closing.swap(true, Ordering::SeqCst);
                if !state.idle() {
                    api.prevent_close();
                    if !already_closing {
                        let window = window.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            // Permit release follows child reaping and pipe-reader joins.
                            while !state.idle() {
                                std::thread::sleep(std::time::Duration::from_millis(5));
                            }
                            let _ = window.close();
                        });
                    }
                }
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
