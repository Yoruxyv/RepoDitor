//! App discovery, game process status, and installed-apps navigation.
use crate::{
    backend::{self, Operation},
    error::{BackendError, Outcome, Service},
    legacy_install,
    projections::{discovery, game},
    window::open_system_url,
};
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
pub(crate) fn legacy_install_registered() -> bool {
    legacy_install::is_registered()
}

#[tauri::command]
pub(crate) fn open_installed_apps() -> bool {
    open_system_url("ms-settings:appsfeatures")
}

#[derive(Default)]
pub(crate) struct InitialDiscovery(
    Mutex<Option<tauri::async_runtime::JoinHandle<Outcome<discovery::EnvironmentDiscovery>>>>,
);

#[tauri::command]
pub(crate) async fn environment_detect(
    app: tauri::AppHandle,
) -> Outcome<discovery::EnvironmentDiscovery> {
    let initial = app.state::<InitialDiscovery>().0.lock().unwrap().take();
    if let Some(initial) = initial {
        return initial.await.unwrap_or_else(|_| {
            Outcome::for_service(Err(BackendError::Failed), Service::Discovery)
        });
    }
    backend::request(app, Operation::Discovery, discovery::parse).await
}

#[tauri::command]
pub(crate) async fn game_status(app: tauri::AppHandle) -> Outcome<game::GameState> {
    backend::request(app, Operation::Game, game::parse).await
}

pub(crate) fn start_discovery(app: &tauri::App) {
    let handle = app.handle().clone();
    *app.state::<InitialDiscovery>().0.lock().unwrap() =
        Some(tauri::async_runtime::spawn(async move {
            backend::request(handle, Operation::Discovery, discovery::parse).await
        }));
}

#[tauri::command]
pub(crate) fn preview_close(app: tauri::AppHandle) -> Result<(), &'static str> {
    app.get_webview_window("main")
        .ok_or("Preview window unavailable")?
        .close()
        .map_err(|_| "Preview could not close")
}
