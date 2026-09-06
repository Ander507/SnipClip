//! Password-protected vault: AES-256-GCM file-level encryption for the SQLite vault.
//!
//! File format for `snipclip.db.enc`:
//! `[salt 16][nonce 12][ciphertext…]`
//!
//! Salt lives in the encrypted file so unlock works when the plain DB is gone.
//! While the app is running, a derived session key is kept in memory so we can
//! encrypt + wipe the plain DB on exit without prompting again.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use parking_lot::Mutex;
use rand::RngCore;
use std::fs;
use std::path::{Path, PathBuf};

pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
const HEADER_LEN: usize = SALT_LEN + NONCE_LEN;

struct SessionKey {
    key: [u8; 32],
    salt: [u8; SALT_LEN],
}

static SESSION: Mutex<Option<SessionKey>> = Mutex::new(None);

fn argon2() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(32_768, 2, 1, None).unwrap(),
    )
}

fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let argon = argon2();
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .expect("argon2 key derivation failed");
    key
}

pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn hash_password(password: &str, salt: &[u8]) -> [u8; 32] {
    let argon = argon2();
    let mut hash = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut hash)
        .expect("argon2 hash failed");
    hash
}

pub fn verify_password(password: &str, hash: &[u8], salt: &[u8]) -> bool {
    let candidate = hash_password(password, salt);
    let mut diff = 0u8;
    for (a, b) in candidate.iter().zip(hash.iter()) {
        diff |= a ^ b;
    }
    // Length mismatch must not look like success
    if hash.len() != candidate.len() {
        return false;
    }
    diff == 0
}

fn random_nonce() -> [u8; NONCE_LEN] {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    nonce
}

/// `snipclip.db.enc` → `snipclip.db` (Path::with_extension would yield `snipclip.db.db`).
pub fn plain_db_path(enc_path: &Path) -> PathBuf {
    if let Some(name) = enc_path.file_name().and_then(|s| s.to_str()) {
        if let Some(stem) = name.strip_suffix(".enc") {
            return enc_path.with_file_name(stem);
        }
    }
    enc_path.with_extension("db")
}

pub fn enc_db_path(db_path: &Path) -> PathBuf {
    db_path.with_file_name(format!(
        "{}.enc",
        db_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("snipclip.db")
    ))
}

fn sidecar(db_path: &Path, suffix: &str) -> PathBuf {
    db_path.with_file_name(format!(
        "{}{}",
        db_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("snipclip.db"),
        suffix
    ))
}

pub fn remember_session(password: &str, salt: &[u8]) {
    let mut salt_arr = [0u8; SALT_LEN];
    let copy_len = salt.len().min(SALT_LEN);
    salt_arr[..copy_len].copy_from_slice(&salt[..copy_len]);
    *SESSION.lock() = Some(SessionKey {
        key: derive_key(password, &salt_arr),
        salt: salt_arr,
    });
}

pub fn clear_session() {
    *SESSION.lock() = None;
}

pub fn has_session() -> bool {
    SESSION.lock().is_some()
}

fn encrypt_bytes(key: &[u8; 32], salt: &[u8; SALT_LEN], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = random_nonce();
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt_bytes(password: &str, enc: &[u8]) -> Result<Vec<u8>, String> {
    if enc.len() < HEADER_LEN {
        return Err("vault is corrupt (truncated)".into());
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&enc[..SALT_LEN]);
    let nonce = &enc[SALT_LEN..HEADER_LEN];
    let ciphertext = &enc[HEADER_LEN..];
    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "incorrect password or corrupt vault".to_string())
}

/// Encrypt `snipclip.db` into `snipclip.db.enc`.
/// When `wipe_plain` is false (in-session lock), leave the open DB alone.
pub fn encrypt_vault(
    db_path: &Path,
    password: &str,
    salt: &[u8],
    wipe_plain: bool,
) -> Result<PathBuf, String> {
    if !db_path.exists() {
        return Err("vault database file not found".into());
    }
    let mut salt_arr = [0u8; SALT_LEN];
    let copy_len = salt.len().min(SALT_LEN);
    salt_arr[..copy_len].copy_from_slice(&salt[..copy_len]);
    let key = derive_key(password, &salt_arr);
    let plain = fs::read(db_path).map_err(|e| e.to_string())?;
    let out = encrypt_bytes(&key, &salt_arr, &plain)?;
    let enc_path = enc_db_path(db_path);
    fs::write(&enc_path, &out).map_err(|e| e.to_string())?;
    remember_session(password, &salt_arr);

    if wipe_plain {
        wipe_plain_db(db_path);
    }
    Ok(enc_path)
}

/// Encrypt using the in-memory session key (for app exit).
pub fn encrypt_vault_with_session(db_path: &Path, wipe_plain: bool) -> Result<(), String> {
    let session = SESSION
        .lock()
        .as_ref()
        .map(|s| (s.key, s.salt))
        .ok_or_else(|| "no vault session key — password was not set this run".to_string())?;
    if !db_path.exists() {
        return Ok(());
    }
    let plain = fs::read(db_path).map_err(|e| e.to_string())?;
    let out = encrypt_bytes(&session.0, &session.1, &plain)?;
    let enc_path = enc_db_path(db_path);
    fs::write(&enc_path, &out).map_err(|e| e.to_string())?;
    if wipe_plain {
        wipe_plain_db(db_path);
    }
    Ok(())
}

fn wipe_plain_db(db_path: &Path) {
    let _ = fs::remove_file(db_path);
    let _ = fs::remove_file(sidecar(db_path, "-wal"));
    let _ = fs::remove_file(sidecar(db_path, "-shm"));
}

/// Decrypt `snipclip.db.enc` → `snipclip.db`. Salt is read from the file header.
pub fn decrypt_vault(enc_path: &Path, password: &str) -> Result<PathBuf, String> {
    if !enc_path.exists() {
        return Err("encrypted vault file not found".into());
    }
    let enc = fs::read(enc_path).map_err(|e| e.to_string())?;
    if enc.len() < HEADER_LEN {
        return Err("vault is corrupt (truncated)".into());
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&enc[..SALT_LEN]);
    let plain = decrypt_bytes(password, &enc)?;
    let db_path = plain_db_path(enc_path);
    fs::write(&db_path, &plain).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(sidecar(&db_path, "-wal"));
    let _ = fs::remove_file(sidecar(&db_path, "-shm"));
    let _ = fs::remove_file(enc_path);
    remember_session(password, &salt);
    Ok(db_path)
}

/// True when only the encrypted vault exists (plain DB wiped).
pub fn is_vault_locked(app_data: &Path) -> bool {
    let enc = app_data.join("snipclip.db.enc");
    let db = app_data.join("snipclip.db");
    enc.exists() && !db.exists()
}
