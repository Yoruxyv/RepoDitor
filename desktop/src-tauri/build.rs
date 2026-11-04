fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
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
            "test_health_recover",
            #[cfg(feature = "synthetic-health-recovery")]
            "test_health_state",
        ]),
    ))
    .expect("Unable to build the desktop preview");
}
