//! Google Maps API key storage.
//!
//! The key lives in the OS credential store (Windows Credential Manager),
//! not in a file next to the database. Anything that copies, syncs, or backs
//! up the app config folder therefore never carries the key.
//!
//! Older builds (0.2.7 and earlier) wrote `google-maps-api-key.json`. On first
//! read we move that key into the credential store and wipe the file.

use std::path::Path;

pub const GOOGLE_KEY_MAX_LEN: usize = 256;
const SERVICE: &str = "DispatchBoard Local";
const ACCOUNT: &str = "google-maps-api-key";

pub fn acceptable_key(raw: &str) -> bool {
    !raw.is_empty()
        && raw.len() <= GOOGLE_KEY_MAX_LEN
        && !raw.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Minimal surface so the logic can be tested without touching the real OS store.
pub trait SecretStore {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

/// Real store. Errors never include the secret.
pub struct OsStore;

impl OsStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT)
            .map_err(|_| "Windows Credential Manager is not available for this user.".to_string())
    }
}

impl SecretStore for OsStore {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read the Google key from Windows Credential Manager.".into()),
        }
    }

    fn set(&self, value: &str) -> Result<(), String> {
        Self::entry()?
            .set_password(value)
            .map_err(|_| "Could not save the Google key to Windows Credential Manager.".to_string())
    }

    fn clear(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove the Google key from Windows Credential Manager.".into()),
        }
    }
}

#[derive(serde::Deserialize)]
struct LegacyKeyFile {
    api_key: String,
}

/// Overwrite then delete. Best effort: SSDs and journaling can keep old blocks,
/// which is why the key should also be restricted in Google Cloud.
fn wipe_file(path: &Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        let zeros = vec![0u8; meta.len() as usize];
        let _ = std::fs::write(path, zeros);
    }
    let _ = std::fs::remove_file(path);
}

/// Move a key from the old plaintext file into the store, then wipe the file.
/// If the store write fails the file is left alone so the key is not lost.
pub fn migrate_legacy_file(store: &dyn SecretStore, legacy: &Path) -> Result<(), String> {
    if !legacy.exists() {
        return Ok(());
    }
    let parsed = std::fs::read_to_string(legacy)
        .ok()
        .and_then(|raw| serde_json::from_str::<LegacyKeyFile>(&raw).ok());
    let key = parsed.map(|p| p.api_key.trim().to_string()).unwrap_or_default();
    if acceptable_key(&key) {
        // A key already in the store wins; the file is stale either way.
        if store.get()?.is_none() {
            store.set(&key)?;
        }
    }
    wipe_file(legacy);
    Ok(())
}

pub fn get(store: &dyn SecretStore, legacy: &Path) -> Result<Option<String>, String> {
    migrate_legacy_file(store, legacy)?;
    match store.get()? {
        Some(v) if acceptable_key(v.trim()) => Ok(Some(v.trim().to_string())),
        _ => Ok(None),
    }
}

/// Empty string clears the key everywhere (store and any leftover file).
pub fn set(store: &dyn SecretStore, legacy: &Path, key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        store.clear()?;
        wipe_file(legacy);
        return Ok(());
    }
    if !acceptable_key(trimmed) {
        return Err("Paste the API key only, with no spaces or line breaks.".into());
    }
    store.set(trimmed)?;
    wipe_file(legacy);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Mem(Mutex<Option<String>>);
    impl SecretStore for Mem {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, v: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(v.to_string());
            Ok(())
        }
        fn clear(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    struct Broken;
    impl SecretStore for Broken {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(None)
        }
        fn set(&self, _: &str) -> Result<(), String> {
            Err("nope".into())
        }
        fn clear(&self) -> Result<(), String> {
            Ok(())
        }
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dbl-secret-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("google-maps-api-key.json")
    }

    #[test]
    fn rejects_bad_keys() {
        assert!(!acceptable_key(""));
        assert!(!acceptable_key("has space"));
        assert!(!acceptable_key("line\nbreak"));
        assert!(!acceptable_key(&"a".repeat(GOOGLE_KEY_MAX_LEN + 1)));
        assert!(acceptable_key("AIzaFAKEKEY123"));
    }

    #[test]
    fn migrates_legacy_file_and_wipes_it() {
        let p = tmp("migrate");
        std::fs::write(&p, r#"{"api_key":"AIzaFAKEKEY123"}"#).unwrap();
        let s = Mem::default();
        assert_eq!(get(&s, &p).unwrap().as_deref(), Some("AIzaFAKEKEY123"));
        assert!(!p.exists());
        assert_eq!(s.get().unwrap().as_deref(), Some("AIzaFAKEKEY123"));
    }

    #[test]
    fn keeps_legacy_file_when_store_write_fails() {
        let p = tmp("broken");
        std::fs::write(&p, r#"{"api_key":"AIzaFAKEKEY123"}"#).unwrap();
        assert!(get(&Broken, &p).is_err());
        assert!(p.exists());
        std::fs::remove_file(&p).unwrap();
    }

    #[test]
    fn existing_store_key_beats_stale_file() {
        let p = tmp("stale");
        std::fs::write(&p, r#"{"api_key":"OLDKEY"}"#).unwrap();
        let s = Mem::default();
        s.set("NEWKEY").unwrap();
        assert_eq!(get(&s, &p).unwrap().as_deref(), Some("NEWKEY"));
        assert!(!p.exists());
    }

    #[test]
    fn garbage_legacy_file_is_wiped_and_reads_as_no_key() {
        let p = tmp("garbage");
        std::fs::write(&p, "not json").unwrap();
        assert_eq!(get(&Mem::default(), &p).unwrap(), None);
        assert!(!p.exists());
    }

    #[test]
    fn set_and_clear_round_trip() {
        let p = tmp("roundtrip");
        let s = Mem::default();
        set(&s, &p, "  AIzaFAKEKEY123 ").unwrap();
        assert_eq!(get(&s, &p).unwrap().as_deref(), Some("AIzaFAKEKEY123"));
        assert!(set(&s, &p, "bad key").is_err());
        set(&s, &p, "").unwrap();
        assert_eq!(get(&s, &p).unwrap(), None);
    }
}
