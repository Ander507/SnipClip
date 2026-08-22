use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePack {
    pub id: String,
    pub name: String,
    pub theme_mode: String,
    pub accent_color: String,
    #[serde(default)]
    pub colors: Option<serde_json::Value>,
    #[serde(default)]
    pub glassmorphic: bool,
    /// 0–100: how translucent surfaces are (0 = solid).
    #[serde(default)]
    pub translucency: u8,
    /// Optional data URL or relative filename under theme-bg/.
    #[serde(default)]
    pub background_image: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemesFile {
    version: u32,
    themes: Vec<ThemePack>,
}

fn themes_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("themes.json"))
}

fn bg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("theme-bg");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_file(app: &AppHandle) -> Result<ThemesFile, String> {
    let path = themes_path(app)?;
    if !path.exists() {
        return Ok(ThemesFile {
            version: 1,
            themes: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_file(app: &AppHandle, file: &ThemesFile) -> Result<(), String> {
    let path = themes_path(app)?;
    let raw = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn list_theme_packs(app: &AppHandle) -> Result<Vec<ThemePack>, String> {
    let mut themes = read_file(app)?.themes;
    for pack in &mut themes {
        resolve_pack_background(app, pack);
    }
    Ok(themes)
}

fn resolve_pack_background(app: &AppHandle, pack: &mut ThemePack) {
    if let Some(ref bg) = pack.background_image {
        if !bg.starts_with("data:") {
            if let Ok(resolved) = resolve_background_url(app, bg) {
                pack.background_image = Some(resolved);
            }
        }
    }
}

pub fn save_theme_pack(app: &AppHandle, mut pack: ThemePack) -> Result<ThemePack, String> {
    let name = pack.name.trim();
    if name.is_empty() {
        return Err("Theme name is required".into());
    }
    if name.len() > 64 {
        return Err("Theme name is too long".into());
    }
    pack.name = name.to_string();
    pack.translucency = pack.translucency.min(100);

    if pack.id.is_empty() {
        pack.id = Uuid::new_v4().to_string();
    }
    if pack.created_at.is_empty() {
        pack.created_at = chrono::Utc::now().to_rfc3339();
    }

    if let Some(ref bg) = pack.background_image {
        if bg.starts_with("data:image/") {
            let saved = store_background_data_url(app, &pack.id, bg)?;
            pack.background_image = Some(saved);
        }
    }

    let mut file = read_file(app)?;
    if let Some(existing) = file.themes.iter_mut().find(|t| t.id == pack.id) {
        *existing = pack.clone();
    } else {
        file.themes.push(pack.clone());
    }
    if file.themes.len() > 40 {
        let skip = file.themes.len() - 40;
        file.themes = file.themes.split_off(skip);
    }
    write_file(app, &file)?;
    resolve_pack_background(app, &mut pack);
    Ok(pack)
}

pub fn delete_theme_pack(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut file = read_file(app)?;
    let before = file.themes.len();
    file.themes.retain(|t| t.id != id);
    if file.themes.len() == before {
        return Err("theme not found".into());
    }
    write_file(app, &file)?;
    let bg = bg_dir(app)?;
    for ext in ["png", "jpg", "jpeg", "webp"] {
        let _ = fs::remove_file(bg.join(format!("{id}.{ext}")));
    }
    Ok(())
}

pub fn export_theme_pack_json(app: &AppHandle, id: &str) -> Result<String, String> {
    let file = read_file(app)?;
    let pack = file
        .themes
        .iter()
        .find(|t| t.id == id)
        .cloned()
        .ok_or_else(|| "theme not found".to_string())?;
    let mut export = pack;
    if let Some(ref bg) = export.background_image {
        if !bg.starts_with("data:") {
            if let Ok(data) = load_background_as_data_url(app, bg) {
                export.background_image = Some(data);
            }
        }
    }
    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

pub fn import_theme_pack_json(app: &AppHandle, json: &str) -> Result<ThemePack, String> {
    let mut pack: ThemePack = serde_json::from_str(json).map_err(|e| e.to_string())?;
    pack.id = Uuid::new_v4().to_string();
    pack.created_at = chrono::Utc::now().to_rfc3339();
    if pack.name.trim().is_empty() {
        pack.name = "Imported theme".into();
    }
    save_theme_pack(app, pack)
}

pub fn resolve_background_url(app: &AppHandle, stored: &str) -> Result<String, String> {
    if stored.starts_with("data:") || stored.starts_with("http://") || stored.starts_with("https://")
    {
        return Ok(stored.to_string());
    }
    load_background_as_data_url(app, stored)
}

/// Store an active theme background (data URL → theme-bg/active.*). Returns relative filename.
pub fn store_active_background(app: &AppHandle, data_url: &str) -> Result<String, String> {
    store_background_data_url(app, "active", data_url)
}

fn store_background_data_url(app: &AppHandle, id: &str, data_url: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};

    let (ext, b64) = if let Some(rest) = data_url.strip_prefix("data:image/png;base64,") {
        ("png", rest)
    } else if let Some(rest) = data_url.strip_prefix("data:image/jpeg;base64,") {
        ("jpg", rest)
    } else if let Some(rest) = data_url.strip_prefix("data:image/webp;base64,") {
        ("webp", rest)
    } else {
        return Err("unsupported background image format".into());
    };
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    if bytes.len() > 8_000_000 {
        return Err("Background image is too large (max 8 MB)".into());
    }
    let dir = bg_dir(app)?;
    let filename = format!("{id}.{ext}");
    fs::write(dir.join(&filename), bytes).map_err(|e| e.to_string())?;
    Ok(filename)
}

fn load_background_as_data_url(app: &AppHandle, filename: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};

    let safe = std::path::Path::new(filename)
        .file_name()
        .ok_or_else(|| "invalid background path".to_string())?;
    let path = bg_dir(app)?.join(safe);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{}", B64.encode(bytes)))
}

/// Read a user-picked image path into a data URL (for theme background picker).
pub fn read_image_path_as_data_url(path: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};

    let path = std::path::Path::new(path);
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 8_000_000 {
        return Err("Background image is too large (max 8 MB)".into());
    }
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        _ => return Err("unsupported image type (use png, jpg, or webp)".into()),
    };
    Ok(format!("data:{mime};base64,{}", B64.encode(bytes)))
}

pub fn write_text_file(path: &str, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| e.to_string())
}

pub fn read_text_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}
