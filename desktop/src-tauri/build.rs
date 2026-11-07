fn main() {
    let authority = if cfg!(feature = "native-ui-test")
        || cfg!(feature = "synthetic-health-recovery")
        || cfg!(feature = "synthetic-health-ui")
    {
        "synthetic"
    } else if tauri_build::is_dev() {
        "development"
    } else {
        "read-only"
    };
    let windows = tauri_build::WindowsAttributes::new().append_rc_content(format!(
        "REPODITOR_AUTHORITY RCDATA {{ \"repoditor-tauri-authority-v2:{authority}\" }}"
    ));
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(windows)
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "environment_detect",
                "saves_open",
                "game_status",
                "players_list",
                "upgrades_list",
                "run_get",
                "advanced_get",
                "maps_list",
                "cosmetics_get",
                "preview_close",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_health_write",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_upgrades_write",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_run_write",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_items_refill",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_health_recover",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_health_state",
            ])),
    )
    .expect("Unable to build the desktop preview");
}
