use tauri::Manager;

mod geo;
mod restore;
mod secret;
mod winstate;

/// Same file the SQL plugin opens for `sqlite:dispatchboard.db`.
#[tauri::command]
fn db_path(app: tauri::AppHandle) -> Result<String, String> {
    // plugin-sql resolves `sqlite:dispatchboard.db` under app_config_dir.
    let base = config_dir(&app)?;
    Ok(base.join("dispatchboard.db").to_string_lossy().to_string())
}

/// Pre-0.3 builds stored the key in this file. It is migrated into the OS
/// credential store on first read and then wiped. See `secret.rs`.
const LEGACY_KEY_FILE: &str = "google-maps-api-key.json";

fn config_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app.path().app_config_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&base).map_err(|err| err.to_string())?;
    Ok(base)
}

fn legacy_key_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(config_dir(app)?.join(LEGACY_KEY_FILE))
}

/// Read the pasted Google Maps API key from Windows Credential Manager.
/// Missing is "no key", not an error. Never log the key.
#[tauri::command]
fn google_api_key_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    secret::get(&secret::OsStore, &legacy_key_path(&app)?)
}

/// Save or clear the key. An empty string clears it.
#[tauri::command]
fn google_api_key_set(app: tauri::AppHandle, key: String) -> Result<(), String> {
    secret::set(&secret::OsStore, &legacy_key_path(&app)?, &key)
}

const BACKUP_KEEP: usize = 14;

/// Pick the next backup file name inside `<config>/backups`, creating the folder
/// and pruning old ones. The frontend runs `VACUUM INTO` on the returned path,
/// which writes a consistent snapshot even while the app has the DB open.
/// `stamp` must look like `20261008-142501` so it cannot escape the folder.
#[tauri::command]
fn backup_target(app: tauri::AppHandle, stamp: String) -> Result<String, String> {
    if stamp.is_empty() || stamp.len() > 20 || !stamp.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("Invalid backup stamp.".into());
    }
    let dir = config_dir(&app)?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    prune_backups(&dir, BACKUP_KEEP.saturating_sub(1));
    let path = dir.join(format!("dispatchboard-{stamp}.db"));
    if path.exists() {
        return Err("A backup with this timestamp already exists.".into());
    }
    Ok(path.to_string_lossy().to_string())
}

/// Keep the newest `keep` backups (names sort by timestamp).
fn prune_backups(dir: &std::path::Path, keep: usize) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> = read
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("dispatchboard-") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    let excess = files.len().saturating_sub(keep);
    for old in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
}

/// Census, Google, and Nominatim geocoding GET from the native side (no CORS here).
/// `provider` picks the only host + path that `url` may target. See `geo.rs`.
#[tauri::command]
async fn geo_http_get(
    client: tauri::State<'_, reqwest::Client>,
    provider: String,
    url: String,
) -> Result<geo::GeoResponse, String> {
    let provider = geo::Provider::parse(&provider)?;
    geo::get(&client, provider, &url).await
}

/// Backups in `<config>/backups` that can be restored, newest first.
#[derive(serde::Serialize)]
struct BackupEntry {
    name: String,
    size: u64,
    modified_ms: u64,
    before_restore: bool,
}

#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupEntry>, String> {
    Ok(restore::list(&config_dir(&app)?)
        .into_iter()
        .map(|b| BackupEntry {
            name: b.name,
            size: b.size,
            modified_ms: b.modified_ms,
            before_restore: b.before_restore,
        })
        .collect())
}

/// Schedule a restore for the next launch. The frontend then calls `restart_app`.
#[tauri::command]
fn restore_stage(app: tauri::AppHandle, name: String) -> Result<(), String> {
    restore::stage(&config_dir(&app)?, &name)
}

/// Undo a staged restore that has not happened yet.
#[tauri::command]
fn restore_cancel(app: tauri::AppHandle) -> Result<(), String> {
    restore::cancel(&config_dir(&app)?);
    Ok(())
}

/// What happened to the last restore, once. None when there was none.
#[tauri::command]
fn restore_result_take(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(restore::take_result(&config_dir(&app)?))
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Put the window back where it was, and save its place when it closes.
fn remember_window(app: &tauri::App, base: std::path::PathBuf) {
    let Some(window) = app.get_webview_window("main") else { return };

    if let Some(saved) = winstate::load(&base) {
        let screens: Vec<winstate::Screen> = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height))
            .collect();
        if winstate::fits(&saved, &screens) {
            let _ = window.set_size(tauri::PhysicalSize::new(saved.width, saved.height));
            let _ = window.set_position(tauri::PhysicalPosition::new(saved.x, saved.y));
            if saved.maximized {
                let _ = window.maximize();
            }
        }
    }

    let tracked = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let maximized = tracked.is_maximized().unwrap_or(false);
            let (Ok(pos), Ok(size)) = (tracked.outer_position(), tracked.outer_size()) else { return };
            let mut state = winstate::WinState { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized };
            if maximized {
                // Keep the last normal size so un-maximizing later has somewhere to go.
                if let Some(prev) = winstate::load(&base) {
                    state.x = prev.x;
                    state.y = prev.y;
                    state.width = prev.width;
                    state.height = prev.height;
                }
            }
            winstate::save(&base, &state);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(geo::client())
        .setup(|app| {
            // A restore staged by the last session runs now, before the webview can
            // open the database file. Problems are recorded for the UI, never fatal.
            if let Ok(base) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&base);
                let _ = restore::apply_pending(&base);
                remember_window(app, base);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_path,
            google_api_key_get,
            google_api_key_set,
            backup_target,
            geo_http_get,
            list_backups,
            restore_stage,
            restore_cancel,
            restore_result_take,
            restart_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running DispatchBoard (Local)");
}
