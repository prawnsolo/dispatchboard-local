fn main() {
    // Without an app manifest Tauri lets the webview call every #[tauri::command].
    // Listing them here makes each one need an explicit `allow-<name>` permission in
    // capabilities/default.json, so a new command is denied until it is added on purpose.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "db_path",
            "google_api_key_get",
            "google_api_key_set",
            "backup_target",
            "geo_http_get",
            "list_backups",
            "restore_stage",
            "restore_cancel",
            "restore_result_take",
            "restart_app",
        ])),
    )
    .expect("failed to run tauri build script");
}
