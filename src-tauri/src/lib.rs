use tauri::Manager;

mod geo;
mod secret;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(geo::client())
        .invoke_handler(tauri::generate_handler![
            db_path,
            google_api_key_get,
            google_api_key_set,
            backup_target,
            geo_http_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running DispatchBoard (Local)");
}
