#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
mod error;
mod projections;
#[cfg(feature = "synthetic-health-recovery")]
mod synthetic;

use backend::{artwork, HostState, Operation};
use error::{BackendError, Outcome, Service};
use projections::{cosmetics, discovery, game, items, maps, players, run, saves, upgrades};
use std::sync::{atomic::Ordering, Arc};
#[cfg(feature = "synthetic-health-recovery")]
use synthetic::recovery;
use tauri::Manager;

const PROJECT_SOURCE_URL: &str = "https://github.com/Yoruxyv/RepoDitor";

fn handle_project_window(url: &tauri::Url, open: impl FnOnce()) {
    if url.as_str() == PROJECT_SOURCE_URL {
        open();
    }
}

fn open_project_source() {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let url: Vec<_> = PROJECT_SOURCE_URL.encode_utf16().chain(Some(0)).collect();
    // WebView2 dispatches this handler on its COM-initialized UI thread.
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            windows_sys::w!("open"),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
    }
}

#[cfg(all(windows, feature = "native-ui-test"))]
fn ui_test_args(template: &str, e2e: &str, port: &str) -> Result<String, &'static str> {
    if e2e != "1"
        || !port.parse::<u16>().is_ok_and(|value| value >= 1024)
        || template.matches("{{CDP_PORT}}").count() != 1
    {
        return Err("Invalid isolated UI test configuration");
    }
    Ok(template.replace("{{CDP_PORT}}", port))
}

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
    let state = app.state::<Arc<HostState>>().inner().clone();
    state.artwork.lock().unwrap().clear();
    backend::request(app, Operation::Open(id.clone()), move |bytes| {
        let opened = saves::parse(bytes, &id)?;
        state.artwork.lock().unwrap().open(&id);
        #[cfg(feature = "synthetic-health-recovery")]
        state.open_editor(&id, opened.fingerprint());
        Ok(opened)
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
async fn players_avatar(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
    player_id: Option<serde_json::Value>,
) -> Outcome<players::Avatar> {
    let ids = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .zip(
            player_id
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .filter(|id| players::valid_id(id)),
        );
    let Some((save, player)) = ids else {
        return Outcome::for_service(Err(BackendError::Request), Service::Player);
    };
    let player = player.to_owned();
    backend::request(
        app,
        Operation::Avatar(save.to_owned(), player.clone()),
        move |bytes| players::parse_avatar(bytes, &player),
    )
    .await
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
    let state = app.state::<Arc<HostState>>().inner().clone();
    let generation = state.artwork.lock().unwrap().generation(&id);
    backend::request(app, Operation::Upgrades(id.clone()), move |bytes| {
        let mut values = upgrades::parse(bytes)?;
        let raw = error::json(bytes)?;
        state.artwork.lock().unwrap().register(
            &id,
            generation,
            raw["fingerprint"].as_str(),
            &mut values,
        );
        Ok(values)
    })
    .await
}

#[tauri::command]
async fn upgrade_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
) -> Outcome<Option<artwork::Image>> {
    get_artwork(app, token, artwork::Scope::Upgrade, Service::Upgrade).await
}

#[tauri::command]
async fn item_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
) -> Outcome<Option<artwork::Image>> {
    get_artwork(app, token, artwork::Scope::Item, Service::Items).await
}

#[tauri::command]
async fn map_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
) -> Outcome<Option<artwork::Image>> {
    get_artwork(app, token, artwork::Scope::Map, Service::Maps).await
}

#[tauri::command]
async fn cosmetic_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
) -> Outcome<Option<artwork::Image>> {
    get_artwork(app, token, artwork::Scope::Cosmetic, Service::Cosmetics).await
}

async fn get_artwork(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    scope: artwork::Scope,
    service: Service,
) -> Outcome<Option<artwork::Image>> {
    let Some(token) = token
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|token| scope.accepts(token))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), service);
    };
    let state = app.state::<Arc<HostState>>().inner().clone();
    let request = state.artwork.lock().unwrap().begin(&token);
    let (save, fingerprint, key, cancelled) = match request {
        Ok(request) => request,
        Err(error) => return Outcome::for_service(Err(error), service),
    };
    let token_check = token.clone();
    let revision = match scope {
        artwork::Scope::Map => Some(fingerprint.clone()),
        artwork::Scope::Cosmetic => fingerprint
            .split_once(':')
            .map(|(revision, _)| revision.to_owned()),
        _ => None,
    };
    let response = backend::request(
        app,
        Operation::Artwork(scope, save, fingerprint, key.clone(), cancelled.clone()),
        move |bytes| artwork::parse(bytes, &key, &token_check, revision.as_deref()),
    )
    .await;
    let mut registry = state.artwork.lock().unwrap();
    if registry.finish(&token, &cancelled) {
        if scope == artwork::Scope::Cosmetic
            && matches!(&response, Outcome::Success { data: None, .. })
        {
            registry.retire_cosmetic(&token);
        }
        response
    } else {
        Outcome::for_service(Err(BackendError::Failed), service)
    }
}

#[tauri::command]
fn upgrade_artwork_cancel(app: tauri::AppHandle, token: Option<String>, save_id: Option<String>) {
    let state = app.state::<Arc<HostState>>();
    let mut registry = state.artwork.lock().unwrap();
    if let Some(token) = token
        .as_deref()
        .filter(|token| artwork::Scope::Upgrade.accepts(token))
    {
        registry.cancel(token);
    } else if token.is_none()
        && save_id
            .as_deref()
            .is_some_and(|id| saves::valid_id(id) && registry.generation(id).is_some())
    {
        registry.clear();
    }
}

#[tauri::command]
fn item_artwork_cancel(app: tauri::AppHandle, token: String) {
    if artwork::Scope::Item.accepts(&token) {
        app.state::<Arc<HostState>>()
            .artwork
            .lock()
            .unwrap()
            .cancel(&token);
    }
}

#[tauri::command]
fn map_artwork_cancel(app: tauri::AppHandle, token: String) {
    if artwork::Scope::Map.accepts(&token) {
        app.state::<Arc<HostState>>()
            .artwork
            .lock()
            .unwrap()
            .cancel(&token);
    }
}

#[tauri::command]
fn cosmetic_artwork_cancel(app: tauri::AppHandle, token: Option<String>) {
    let state = app.state::<Arc<HostState>>();
    let mut registry = state.artwork.lock().unwrap();
    match token {
        Some(token) if artwork::Scope::Cosmetic.accepts(&token) => registry.cancel(&token),
        None => {
            registry.revoke_cosmetics();
        }
        _ => {}
    }
}

#[tauri::command]
async fn cosmetics_get(app: tauri::AppHandle) -> Outcome<cosmetics::Cosmetics> {
    let state = app.state::<Arc<HostState>>().inner().clone();
    let generation = state.artwork.lock().unwrap().revoke_cosmetics();
    backend::request(app, Operation::Cosmetics, move |bytes| {
        let mut data = cosmetics::parse(bytes)?;
        state
            .artwork
            .lock()
            .unwrap()
            .register_cosmetics(generation, &mut data);
        Ok(data)
    })
    .await
}

#[tauri::command]
async fn maps_list(app: tauri::AppHandle) -> Outcome<maps::InstalledMaps> {
    let state = app.state::<Arc<HostState>>().inner().clone();
    backend::request(app, Operation::Maps, move |bytes| {
        let mut data = maps::parse(bytes)?;
        state.artwork.lock().unwrap().register_maps(&mut data);
        Ok(data)
    })
    .await
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
    let state = app.state::<Arc<HostState>>().inner().clone();
    let generation = state.artwork.lock().unwrap().generation(&id);
    backend::request(app, Operation::Items(id.clone()), move |bytes| {
        let mut values = items::parse(bytes)?;
        let raw = error::json(bytes)?;
        state.artwork.lock().unwrap().register_items(
            &id,
            generation,
            raw["fingerprint"].as_str(),
            &mut values,
        );
        Ok(values)
    })
    .await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_meta_state(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::State {
    synthetic::meta::state(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_meta_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::Result {
    synthetic::meta::write(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_meta_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::Result {
    synthetic::meta::recover(app, request).await
}

#[tauri::command]
fn preview_close(app: tauri::AppHandle) -> Result<(), &'static str> {
    app.get_webview_window("main")
        .ok_or("Preview window unavailable")?
        .close()
        .map_err(|_| "Preview could not close")
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_health_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_upgrades_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write_upgrades(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_run_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write_run(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_items_refill(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write_refills(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_health_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::recover(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_health_state(app: tauri::AppHandle, save_id: String) -> recovery::HealthState {
    recovery::state(app, save_id).await
}

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(HostState::default()))
        .invoke_handler(tauri::generate_handler![
            environment_detect,
            saves_open,
            game_status,
            players_list,
            players_avatar,
            upgrades_list,
            upgrade_artwork_get,
            upgrade_artwork_cancel,
            item_artwork_get,
            item_artwork_cancel,
            map_artwork_get,
            map_artwork_cancel,
            cosmetic_artwork_get,
            cosmetic_artwork_cancel,
            run_get,
            advanced_get,
            maps_list,
            cosmetics_get,
            preview_close,
            #[cfg(feature = "synthetic-health-recovery")]
            test_health_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_upgrades_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_run_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_items_refill,
            #[cfg(feature = "synthetic-health-recovery")]
            test_meta_state,
            #[cfg(feature = "synthetic-health-recovery")]
            test_meta_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_meta_recover,
            #[cfg(feature = "synthetic-health-recovery")]
            test_health_recover,
            #[cfg(feature = "synthetic-health-recovery")]
            test_health_state,
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
            let window = tauri::WebviewWindowBuilder::new(app, "main", url);
            #[cfg(all(windows, feature = "native-ui-test"))]
            let window = {
                let template = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "main")
                    .and_then(|window| window.additional_browser_args.as_deref())
                    .ok_or("Missing isolated UI test browser arguments")?;
                window.additional_browser_args(&ui_test_args(
                    template,
                    &std::env::var("REPODITOR_E2E").unwrap_or_default(),
                    &std::env::var("REPODITOR_TEST_CDP_PORT").unwrap_or_default(),
                )?)
            };
            window
                .title("RepoDitor Preview")
                .inner_size(1200.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .data_directory(profile)
                .on_navigation(allowed_navigation)
                .on_new_window(|url, _| {
                    handle_project_window(&url, open_project_source);
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<HostState>>().inner().clone();
                let already_closing = state.closing.swap(true, Ordering::SeqCst);
                state.artwork.lock().unwrap().clear_all();
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
#[path = "../tests/unit/entry.rs"]
mod tests;
