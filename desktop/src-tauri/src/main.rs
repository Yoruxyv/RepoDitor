#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
mod commands;
mod error;
mod legacy_install;
mod projections;
#[cfg(feature = "health-transport")]
mod transactions;
mod window;

use backend::HostState;
use std::{
    sync::{atomic::Ordering, Arc, Mutex},
    time::Instant,
};
use tauri::Manager;
#[cfg(all(windows, feature = "native-ui-test"))]
use window::ui_test_args;
use window::{allowed_navigation, handle_project_window, open_system_url};

fn main() {
    let started = Instant::now();
    let fixture = std::env::var("REPODITOR_E2E").as_deref() == Ok("1");
    let _cache_activity =
        backend::cache_activity::retain(fixture).expect("Unable to coordinate artwork cache use");
    tauri::Builder::default()
        .manage(Arc::new(HostState::default()))
        .manage(commands::environment::InitialDiscovery::default())
        .manage(Mutex::new(commands::workspace::EntryCache::default()))
        .invoke_handler(tauri::generate_handler![
            commands::environment::environment_detect,
            commands::environment::legacy_install_registered,
            commands::environment::open_installed_apps,
            commands::workspace::saves_open,
            commands::workspace::editor_entry,
            commands::environment::game_status,
            commands::reads::players_list,
            commands::reads::players_avatar,
            commands::reads::upgrades_list,
            commands::artwork::upgrade_artwork_get,
            commands::artwork::upgrade_artwork_cancel,
            commands::artwork::item_artwork_get,
            commands::artwork::item_artwork_cancel,
            commands::artwork::map_artwork_get,
            commands::artwork::map_artwork_cancel,
            commands::artwork::cosmetic_artwork_get,
            commands::artwork::cosmetic_artwork_cancel,
            commands::reads::run_get,
            commands::reads::advanced_get,
            commands::reads::maps_list,
            commands::reads::cosmetics_get,
            commands::environment::preview_close,
            #[cfg(feature = "production-health")]
            commands::transactions::production_health_write,
            #[cfg(feature = "production-health")]
            commands::transactions::production_health_recover,
            #[cfg(feature = "production-health")]
            commands::transactions::production_meta_state,
            #[cfg(feature = "production-health")]
            commands::transactions::production_meta_write,
            #[cfg(feature = "production-health")]
            commands::transactions::production_meta_recover,
            #[cfg(feature = "production-health")]
            commands::transactions::production_meta_close,
            #[cfg(feature = "production-health")]
            commands::transactions::production_health_state,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_health_write,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_upgrades_write,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_run_write,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_items_refill,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_meta_state,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_meta_write,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_meta_recover,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_health_recover,
            #[cfg(feature = "synthetic-health-recovery")]
            commands::transactions::test_health_state,
        ])
        .setup(move |app| {
            backend::timing::span("host_setup", started);
            let profile = if fixture {
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
            commands::environment::start_discovery(app);
            let webview_started = Instant::now();
            window
                .title("RepoDitor")
                .inner_size(1200.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .data_directory(profile)
                .on_navigation(allowed_navigation)
                .on_new_window(|url, _| {
                    handle_project_window(&url, |target| {
                        open_system_url(target);
                    });
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            backend::timing::span("webview_build", webview_started);
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
        .expect("Unable to start RepoDitor");
}
