//! Feature-gated Run and MetaSave mutation and recovery commands.
#[cfg(feature = "production-health")]
use crate::backend::HostState;
use crate::transactions::{meta, recovery};
#[cfg(feature = "production-health")]
use tauri::Manager;

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_meta_state(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> meta::State {
    meta::state(app, request, false).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_meta_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> meta::Result {
    meta::write(app, request, false).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_meta_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> meta::Result {
    meta::recover(app, request, false).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_health_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::synthetic::write(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_upgrades_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::synthetic::write_upgrades(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_run_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::synthetic::write_run(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_items_refill(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::synthetic::write_refills(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_health_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::synthetic::recover(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
pub(crate) async fn test_health_state(
    app: tauri::AppHandle,
    save_id: String,
) -> recovery::HealthState {
    recovery::synthetic::state(app, save_id).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
pub(crate) async fn production_meta_state(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> meta::State {
    meta::state(app, request, true).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
pub(crate) async fn production_meta_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> meta::Result {
    meta::write(app, request, true).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
pub(crate) async fn production_meta_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> meta::Result {
    meta::recover(app, request, true).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
pub(crate) fn production_meta_close(app: tauri::AppHandle) {
    app.state::<std::sync::Arc<HostState>>()
        .meta_session
        .lock()
        .unwrap()
        .close();
}

#[cfg(feature = "production-health")]
#[tauri::command]
pub(crate) async fn production_health_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::production_write(app, request).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
pub(crate) async fn production_health_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::production_recover(app, request).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
pub(crate) async fn production_health_state(
    app: tauri::AppHandle,
    save_id: String,
) -> recovery::HealthState {
    recovery::production_state(app, save_id).await
}
