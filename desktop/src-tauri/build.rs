use sha2::{Digest, Sha256};
#[path = "src/synthetic/meta_anchor.rs"]
mod meta_anchor;

fn main() {
    assert_eq!(
        format!("{:x}", Sha256::digest(meta_anchor::manifest().as_bytes())),
        meta_anchor::PIN,
        "Synthetic MetaSave anchor mismatch"
    );
    println!(
        "cargo:rerun-if-changed=../python/repo_save_editor/services/cosmetics/synthetic_fixture.py"
    );
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
                "players_avatar",
                "upgrades_list",
                "upgrade_artwork_get",
                "upgrade_artwork_cancel",
                "item_artwork_get",
                "item_artwork_cancel",
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
                "test_meta_state",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_meta_write",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_meta_recover",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_health_recover",
                #[cfg(feature = "synthetic-health-recovery")]
                "test_health_state",
            ])),
    )
    .expect("Unable to build the desktop preview");
}
