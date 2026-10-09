//! Restore the local database from one of its own backups.
//!
//! The SQL plugin keeps the database file open while the app runs, and Windows
//! will not let you swap an open file. So a restore happens in two steps:
//!
//! 1. `stage` writes a small marker file naming the backup, then the app restarts.
//! 2. On the next launch, before anything opens the database, `apply_pending`
//!    sets the current database aside, copies the backup into place, and clears
//!    the marker.
//!
//! The current database is never discarded. It is copied to
//! `backups/before-restore-<unix seconds>.db` first, and the newest three of
//! those are kept. Only files inside the `backups` folder can be restored, by
//! name, so a crafted name cannot point anywhere else.
//!
//! Pure `std` on purpose: it is tested with `rustc --test` without the Tauri
//! toolchain. See the tests at the bottom.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const DB_FILE: &str = "dispatchboard.db";
pub const BACKUP_DIR: &str = "backups";
const MARKER: &str = "restore-pending.txt";
const RESULT: &str = "restore-result.txt";
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const KEEP_BEFORE_RESTORE: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    /// Milliseconds since the Unix epoch. 0 when the file system does not say.
    pub modified_ms: u64,
    /// True for the safety copy made just before a restore.
    pub before_restore: bool,
}

/// Names we create ourselves: `dispatchboard-<digits and dashes>.db` and
/// `before-restore-<digits>.db`. Nothing else is ever listed or restored.
pub fn is_backup_name(name: &str) -> bool {
    let Some(core) = name.strip_suffix(".db") else {
        return false;
    };
    if let Some(rest) = core.strip_prefix("dispatchboard-") {
        return !rest.is_empty() && rest.len() <= 24 && rest.chars().all(|c| c.is_ascii_digit() || c == '-');
    }
    if let Some(rest) = core.strip_prefix("before-restore-") {
        return !rest.is_empty() && rest.len() <= 20 && rest.chars().all(|c| c.is_ascii_digit());
    }
    false
}

fn has_sqlite_header(path: &Path) -> bool {
    let mut buf = [0u8; 16];
    match fs::File::open(path).and_then(|mut f| f.read_exact(&mut buf)) {
        Ok(()) => &buf == SQLITE_MAGIC,
        Err(_) => false,
    }
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Backups that exist and look like SQLite files, newest first.
pub fn list(config: &Path) -> Vec<BackupInfo> {
    let dir = config.join(BACKUP_DIR);
    let Ok(read) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<BackupInfo> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !is_backup_name(&name) {
                return None;
            }
            let path = e.path();
            let meta = fs::metadata(&path).ok()?;
            if !meta.is_file() || meta.len() < 512 || !has_sqlite_header(&path) {
                return None;
            }
            Some(BackupInfo {
                before_restore: name.starts_with("before-restore-"),
                modified_ms: modified_ms(&path),
                size: meta.len(),
                name,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| b.name.cmp(&a.name)));
    out
}

/// Check the named backup and leave a marker so the next launch restores it.
pub fn stage(config: &Path, name: &str) -> Result<(), String> {
    if !is_backup_name(name) {
        return Err("That is not a backup file name.".into());
    }
    let path = config.join(BACKUP_DIR).join(name);
    if !path.is_file() {
        return Err("That backup no longer exists.".into());
    }
    if !has_sqlite_header(&path) {
        return Err("That backup is not a valid database file.".into());
    }
    fs::write(config.join(MARKER), name).map_err(|e| format!("Could not schedule the restore: {e}"))
}

/// Remove a staged restore before it happens.
pub fn cancel(config: &Path) {
    let _ = fs::remove_file(config.join(MARKER));
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn prune_before_restore(dir: &Path) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = read
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("before-restore-") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    let excess = files.len().saturating_sub(KEEP_BEFORE_RESTORE);
    for old in files.into_iter().take(excess) {
        let _ = fs::remove_file(old);
    }
}

fn record(config: &Path, message: &str) {
    let _ = fs::write(config.join(RESULT), message);
}

/// Run at startup, before the database is opened. Returns what happened, or
/// None when no restore was staged. On any problem the live database is left
/// exactly as it was.
pub fn apply_pending(config: &Path) -> Option<Result<String, String>> {
    let marker = config.join(MARKER);
    let name = fs::read_to_string(&marker).ok()?.trim().to_string();
    // Clear the marker first so a failure cannot loop on every launch.
    let _ = fs::remove_file(&marker);

    let outcome = (|| -> Result<String, String> {
        if !is_backup_name(&name) {
            return Err("The staged restore had an invalid name, so nothing was changed.".into());
        }
        let backup = config.join(BACKUP_DIR).join(&name);
        if !backup.is_file() || !has_sqlite_header(&backup) {
            return Err("The backup could not be read, so nothing was changed.".into());
        }
        let live = config.join(DB_FILE);
        let dir = config.join(BACKUP_DIR);
        if live.is_file() {
            let safety = dir.join(format!("before-restore-{}.db", unix_seconds()));
            fs::copy(&live, &safety).map_err(|e| format!("Could not set the current database aside ({e}), so nothing was changed."))?;
            prune_before_restore(&dir);
        }
        let staging = config.join("restore-staging.tmp");
        fs::copy(&backup, &staging).map_err(|e| format!("Could not copy the backup ({e}), so nothing was changed."))?;
        // A leftover journal from the old file would be replayed onto the restored one.
        for suffix in ["-wal", "-shm", "-journal"] {
            let _ = fs::remove_file(config.join(format!("{DB_FILE}{suffix}")));
        }
        fs::rename(&staging, &live).map_err(|e| {
            let _ = fs::remove_file(&staging);
            format!("Could not put the backup in place ({e}). Your previous database was set aside in the backups folder.")
        })?;
        Ok(format!("Restored {name}. The database you had before is saved as a before-restore backup."))
    })();

    match &outcome {
        Ok(msg) | Err(msg) => record(config, msg),
    }
    Some(outcome)
}

/// The message from the last restore attempt, once. The next call returns None.
pub fn take_result(config: &Path) -> Option<String> {
    let path = config.join(RESULT);
    let text = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dbl-restore-{}-{}-{}", tag, std::process::id(), unix_seconds()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(BACKUP_DIR)).unwrap();
        dir
    }

    fn fake_db(path: &Path, tag: &str) {
        let mut bytes = SQLITE_MAGIC.to_vec();
        bytes.extend_from_slice(tag.as_bytes());
        bytes.resize(1024, 0);
        fs::write(path, bytes).unwrap();
    }

    fn tag_of(path: &Path) -> String {
        let bytes = fs::read(path).unwrap();
        String::from_utf8_lossy(&bytes[16..22]).to_string()
    }

    #[test]
    fn names_are_strict() {
        assert!(is_backup_name("dispatchboard-20261008-142501.db"));
        assert!(is_backup_name("before-restore-1760000000.db"));
        assert!(!is_backup_name("../dispatchboard-1.db"));
        assert!(!is_backup_name("dispatchboard-1/../x.db"));
        assert!(!is_backup_name("dispatchboard-.db"));
        assert!(!is_backup_name("dispatchboard-1.db.exe"));
        assert!(!is_backup_name("notes.db"));
        assert!(!is_backup_name("dispatchboard-12a.db"));
        assert!(!is_backup_name("C:\\dispatchboard-1.db"));
    }

    #[test]
    fn list_skips_junk_and_sorts_newest_first() {
        let dir = tmp("list");
        fake_db(&dir.join(BACKUP_DIR).join("dispatchboard-20261001-000000.db"), "OLDONE");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fake_db(&dir.join(BACKUP_DIR).join("dispatchboard-20261002-000000.db"), "NEWONE");
        fs::write(dir.join(BACKUP_DIR).join("dispatchboard-20261003-000000.db"), b"not sqlite at all").unwrap();
        fs::write(dir.join(BACKUP_DIR).join("readme.txt"), b"hi").unwrap();
        let found = list(&dir);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].name, "dispatchboard-20261002-000000.db");
        assert!(!found[0].before_restore);
    }

    #[test]
    fn stage_rejects_bad_input() {
        let dir = tmp("stage");
        assert!(stage(&dir, "../../evil.db").is_err());
        assert!(stage(&dir, "dispatchboard-1.db").is_err());
        fs::write(dir.join(BACKUP_DIR).join("dispatchboard-2.db"), b"garbage garbage garbage").unwrap();
        assert!(stage(&dir, "dispatchboard-2.db").is_err());
        assert!(!dir.join(MARKER).exists());
    }

    #[test]
    fn restore_swaps_files_and_keeps_the_old_database() {
        let dir = tmp("swap");
        fake_db(&dir.join(DB_FILE), "LIVEDB");
        fs::write(dir.join("dispatchboard.db-wal"), b"stale").unwrap();
        fake_db(&dir.join(BACKUP_DIR).join("dispatchboard-20261001-000000.db"), "BACKUP");
        stage(&dir, "dispatchboard-20261001-000000.db").unwrap();
        let out = apply_pending(&dir).expect("a restore was staged");
        assert!(out.is_ok(), "{out:?}");
        assert_eq!(tag_of(&dir.join(DB_FILE)), "BACKUP");
        assert!(!dir.join("dispatchboard.db-wal").exists());
        assert!(!dir.join(MARKER).exists());
        let saved: Vec<_> = list(&dir).into_iter().filter(|b| b.before_restore).collect();
        assert_eq!(saved.len(), 1);
        assert_eq!(tag_of(&dir.join(BACKUP_DIR).join(&saved[0].name)), "LIVEDB");
        assert!(take_result(&dir).unwrap().starts_with("Restored"));
        assert!(take_result(&dir).is_none());
    }

    #[test]
    fn missing_backup_leaves_live_database_alone() {
        let dir = tmp("missing");
        fake_db(&dir.join(DB_FILE), "LIVEDB");
        fs::write(dir.join(MARKER), "dispatchboard-9.db").unwrap();
        let out = apply_pending(&dir).unwrap();
        assert!(out.is_err());
        assert_eq!(tag_of(&dir.join(DB_FILE)), "LIVEDB");
        assert!(!dir.join(MARKER).exists());
    }

    #[test]
    fn no_marker_means_no_restore() {
        let dir = tmp("none");
        assert!(apply_pending(&dir).is_none());
    }

    #[test]
    fn before_restore_copies_are_capped() {
        let dir = tmp("cap");
        for n in 1..=5 {
            fake_db(&dir.join(BACKUP_DIR).join(format!("before-restore-{n:010}.db")), "SAFETY");
        }
        prune_before_restore(&dir.join(BACKUP_DIR));
        assert_eq!(list(&dir).len(), KEEP_BEFORE_RESTORE);
    }

    #[test]
    fn works_when_there_is_no_live_database_yet() {
        let dir = tmp("fresh");
        fake_db(&dir.join(BACKUP_DIR).join("dispatchboard-20261001-000000.db"), "BACKUP");
        stage(&dir, "dispatchboard-20261001-000000.db").unwrap();
        assert!(apply_pending(&dir).unwrap().is_ok());
        assert_eq!(tag_of(&dir.join(DB_FILE)), "BACKUP");
    }
}
