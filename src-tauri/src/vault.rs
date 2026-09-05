//! Password-protected vault: AES-256-GCM file-level encryption for the SQLite vault.
//!
//! The vault lives in `snipclip.db`. When locked, the plain DB is replaced by an
//! encrypted `snipclip.db.enc` and the plain file is wiped. On launch,
//! if the encrypted file exists, the app prompts for the password, decrypts, and opens.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 16-byte salt for Argon2id key derivation + 12-byte nonce prefix stored alongside.
pub const SALT_LEN: usize = 16;
pub const NONCE_PREFIX_LEN: usize = 12;

/// Argon2id v19 with tuned params (m=32 MiB, t=2, p=1).
/// About 50 ms on a cold start, billions of GPU-hours per guess.
fn argon2() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(32_768, 2, 1, None).unwrap(),
    )
}

/// Derive a 32-byte AES-256 key from the password and salt using Argon2id.
fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let argon = argon2();
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .expect("argon2 key derivation failed");
    key
}

/// Generate a fresh 16-byte salt.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Argon2id hash of the password + salt — stored in settings so we can
/// verify the password on unlock without keeping the password itself.
pub fn hash_password(password: &str, salt: &[u8]) -> [u8; 32] {
    let argon = argon2();
    let mut hash = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut hash)
        .expect("argon2 hash failed");
    hash
}

/// Constant-time comparison so a wrong password leaks no timing signal.
pub fn verify_password(password: &str, hash: &[u8], salt: &[u8]) -> bool {
    let candidate = hash_password(password, salt);
    let mut diff = 0u8;
    for (a, b) in candidate.iter().zip(hash.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// 12-byte nonce: 4-byte fixed prefix (so we can tell our nonces apart) + 8-byte random suffix.
fn build_nonce(salt: &[u8]) -> [u8; NONCE_PREFIX_LEN] {
    let mut nonce = [0u8; NONCE_PREFIX_LEN];
    nonce[..SALT_LEN].copy_from_slice(salt);
    OsRng.fill_bytes(&mut nonce[SALT_LEN..]);
    nonce
}

/// Read the 12-byte nonce prepended to the encrypted file.
fn read_nonce(enc_path: &Path) -> Option<[u8; NONCE_PREFIX_LEN]> {
    let mut f = fs::File::open(enc_path).ok()?;
    let mut head = [0u8; NONCE_PREFIX_LEN];
    if f.read_exact(&mut head).is_ok() {
        return Some(head);
    }
    None
}

/// Encrypt `snipclip.db` (plus -wal / -shm) into `snipclip.db.enc`.
/// The plain DB is wiped after a successful encrypt. Returns the encrypted path.
pub fn encrypt_vault(
    db_path: &Path,
    password: &str,
    salt: &[u8],
) -> Result<PathBuf, String> {
    if !db_path.exists() {
        return Err("vault database file not found".into());
    }
    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = build_nonce(salt);

    let plain = fs::read(db_path).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_ref())
        .map_err(|e| e.to_string())?;

    let enc_path = db_path.with_extension("db.enc");
    let mut out = Vec::with_capacity(ciphertext.len() + NONCE_PREFIX_LEN);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    fs::write(&enc_path, &out).map_err(|e| e.to_string())?;

    // Wipe the plain DB and its sidecar files so the vault is at-rest only.
    let _ = fs::remove_file(db_path);
    let _ = fs::remove_file(db_path.with_extension("db-wal"));
    let _ = fs::remove_file(db_path.with_extension("db-shm"));
    Ok(enc_path)
}

/// Decrypt `snipclip.db.enc` back to `snipclip.db` using the password + salt.
pub fn decrypt_vault(
    enc_path: &Path,
    password: &str,
    salt: &[u8],
) -> Result<PathBuf, String> {
    if !enc_path.exists() {
        return Err("encrypted vault file not found".into());
    }
    let nonce = read_nonce(enc_path).ok_or_else(|| "vault is corrupt (missing nonce)".to_string())?;
    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut enc = fs::read(enc_path).map_err(|e| e.to_string())?;
    if enc.len() < NONCE_PREFIX_LEN {
        return Err("vault is corrupt (truncated)".into());
    }
    let ciphertext = enc.split_off(NONCE_PREFIX_LEN);
    let plain = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|e| e.to_string())?;

    let db_path = enc_path.with_extension("db");
    fs::write(&db_path, &plain).map_err(|e| e.to_string())?;
    // Remove the sidecar files so SQLite rebuilds them cleanly on open.
    let _ = fs::remove_file(db_path.with_extension("db-wal"));
    let _ = fs::remove_file(db_path.with_extension("db-shm"));
    let _ = fs::remove_file(enc_path);
    Ok(db_path)
}

/// True when `snipclip.db.enc` exists — the vault is locked.
pub fn is_vault_locked(app_data: &Path) -> bool {
    app_data.join("snipclip.db.enc").exists()
}
