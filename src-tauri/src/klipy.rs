//! KLIPY GIF search (trending / search) plus a local GIF cache for file pastes.
//!
//! The API key comes from settings, or from `KLIPY_API_KEY` at build time so a release
//! build can bake one in from CI without committing it. GIFs are pasted as real files
//! (CF_HDROP), so they're downloaded into `{app_cache_dir}/gifs` first.

use crate::db::{AppSettings, Database};
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager, Url};

const API_BASE: &str = "https://api.klipy.com/api/v1";
const CUSTOMER_ID_KEY: &str = "klipy_customer_id";
const MAX_GIF_BYTES: u64 = 25 * 1024 * 1024;
const CACHE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Frontend shows the "add your KLIPY key" setup card for this one.
pub const ERR_KEY_MISSING: &str = "KLIPY_KEY_MISSING";
pub const ERR_KEY_INVALID: &str = "KLIPY_KEY_INVALID";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifItem {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub preview_url: String,
    pub preview_width: u32,
    pub preview_height: u32,
    pub gif_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifPage {
    pub items: Vec<GifItem>,
    pub page: u32,
    pub has_next: bool,
}

/// User's own key first, then the one baked in at compile time.
pub fn api_key(settings: &AppSettings) -> Option<String> {
    let own = settings.klipy_api_key.trim();
    if !own.is_empty() {
        return Some(own.to_string());
    }
    option_env!("KLIPY_API_KEY")
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_string)
}

/// Stable per-install id KLIPY uses for personalisation / rate limits. Created on first use.
pub fn customer_id(db: &Database) -> String {
    if let Ok(Some(id)) = db.get_setting(CUSTOMER_ID_KEY) {
        let id = id.trim();
        if !id.is_empty() {
            return id.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    // a failed write only costs KLIPY a stable id for this session — never block search on it
    let _ = db.set_setting(CUSTOMER_ID_KEY, &id);
    id
}

/// Trending (empty / no query) or search results for one page.
pub fn fetch_gifs(
    key: &str,
    customer_id: &str,
    query: Option<&str>,
    page: u32,
    per_page: u32,
) -> Result<GifPage, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err(ERR_KEY_MISSING.into());
    }
    let query = query.map(str::trim).filter(|q| !q.is_empty());
    let page = page.max(1);
    let per_page = per_page.clamp(8, 50);
    let endpoint = if query.is_some() { "search" } else { "trending" };

    // path_segments_mut percent-encodes the key, so a pasted key can't reshape the URL
    let mut url = Url::parse(API_BASE).map_err(|e| e.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Invalid KLIPY API address".to_string())?
        .extend([key, "gifs", endpoint]);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(8))
        .build();
    let page_param = page.to_string();
    let per_page_param = per_page.to_string();
    let send = |filtered: bool| {
        let mut req = agent
            .get(url.as_str())
            .query("page", &page_param)
            .query("per_page", &per_page_param)
            .query("customer_id", customer_id);
        if let Some(q) = query {
            req = req.query("q", q);
        }
        if filtered {
            req = req.query("content_filter", "medium");
        }
        req.call()
    };

    let response = match send(true) {
        // some keys / plans reject content_filter — unfiltered results beat an empty panel
        Err(ureq::Error::Status(400 | 422, _)) => send(false),
        other => other,
    }
    .map_err(describe_api_error)?;

    let body: Value = response
        .into_json()
        .map_err(|_| "KLIPY sent an unreadable response".to_string())?;
    if body.get("result").and_then(Value::as_bool) == Some(false) {
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or("KLIPY couldn't load GIFs");
        return Err(message.chars().take(160).collect());
    }
    Ok(parse_page(&body, page, per_page))
}

fn describe_api_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(401 | 403, _) => ERR_KEY_INVALID.into(),
        ureq::Error::Status(429, _) => "KLIPY rate limit reached — try again in a moment".into(),
        ureq::Error::Status(code, _) => format!("KLIPY returned an error (HTTP {code})"),
        ureq::Error::Transport(_) => "Couldn't reach KLIPY — check your connection".into(),
    }
}

fn parse_page(body: &Value, requested_page: u32, per_page: u32) -> GifPage {
    let data = body.get("data").unwrap_or(&Value::Null);
    // normally { data: { data: [...], current_page, has_next } }, but accept a bare array too
    let (list, meta): (&[Value], &Value) = match data {
        Value::Array(items) => (items.as_slice(), &Value::Null),
        Value::Object(_) => (
            data.get("data")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            data,
        ),
        _ => (&[], &Value::Null),
    };

    let page = meta
        .get("current_page")
        .and_then(as_u32)
        .filter(|p| *p > 0)
        .unwrap_or(requested_page);
    // no has_next flag → assume more while pages come back full
    let has_next = meta
        .get("has_next")
        .and_then(Value::as_bool)
        .unwrap_or(list.len() as u32 >= per_page);

    GifPage {
        items: list.iter().filter_map(parse_item).collect(),
        page,
        has_next,
    }
}

fn parse_item(raw: &Value) -> Option<GifItem> {
    let is_ad = raw
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|t| t.eq_ignore_ascii_case("ad"));
    if is_ad {
        return None;
    }
    let file = raw.get("file")?;
    // md keeps pastes small; hd only when md is missing
    let gif = first_rendition(file, &[("md", "gif"), ("hd", "gif"), ("sm", "gif")])?;
    let preview = first_rendition(
        file,
        &[("sm", "webp"), ("sm", "gif"), ("xs", "gif"), ("md", "gif")],
    )
    .unwrap_or_else(|| gif.clone());

    let text = |field: &str| {
        raw.get(field)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    let slug = text("slug");
    let id = match raw.get("id") {
        Some(Value::String(s)) if !s.trim().is_empty() => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ if !slug.is_empty() => slug.clone(),
        _ => gif.url.clone(),
    };

    Some(GifItem {
        id,
        slug,
        title: text("title"),
        preview_url: preview.url,
        preview_width: preview.width,
        preview_height: preview.height,
        gif_url: gif.url,
    })
}

#[derive(Clone)]
struct Rendition {
    url: String,
    width: u32,
    height: u32,
}

fn first_rendition(file: &Value, order: &[(&str, &str)]) -> Option<Rendition> {
    order.iter().find_map(|(size, format)| {
        let r = file.get(*size)?.get(*format)?;
        let url = r.get("url")?.as_str()?.trim();
        // webview is a secure context — http previews would be blocked anyway
        if !url.starts_with("https://") {
            return None;
        }
        Some(Rendition {
            url: url.to_string(),
            width: r.get("width").and_then(as_u32).unwrap_or(0),
            height: r.get("height").and_then(as_u32).unwrap_or(0),
        })
    })
}

fn as_u32(v: &Value) -> Option<u32> {
    match v {
        Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_f64().filter(|f| *f >= 0.0).map(|f| f.round() as u64))
            .and_then(|n| u32::try_from(n).ok()),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub fn gif_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("gifs"))
        .map_err(|e| e.to_string())
}

/// Only fetch from KLIPY's own hosts — the URL comes from the webview.
fn checked_klipy_url(raw: &str) -> Result<Url, String> {
    let rejected = || "Only KLIPY GIF links can be downloaded".to_string();
    let url = Url::parse(raw.trim()).map_err(|_| rejected())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(rejected());
    }
    let host = url
        .host_str()
        .ok_or_else(rejected)?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "klipy.com" || host.ends_with(".klipy.com") {
        Ok(url)
    } else {
        Err(rejected())
    }
}

/// `[A-Za-z0-9_-]`, max 80 chars; random name when nothing usable is left.
fn file_stem(slug: &str) -> String {
    let cleaned: String = slug
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(80)
        .collect();
    let cleaned = cleaned.trim_matches('-');
    if cleaned.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        cleaned.to_string()
    }
}

/// Download a KLIPY GIF into the cache (reusing an earlier copy) and return its path.
pub fn download_gif(app: &AppHandle, url: &str, slug: &str) -> Result<PathBuf, String> {
    let url = checked_klipy_url(url)?;
    let dir = gif_cache_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    prune_old_gifs(&dir);

    let dest = dir.join(format!("{}.gif", file_stem(slug)));
    if dest.metadata().is_ok_and(|m| m.is_file() && m.len() > 0) {
        // fresh mtime so a GIF still on the clipboard isn't pruned out from under it
        if let Ok(file) = std::fs::File::options().write(true).open(&dest) {
            let _ = file.set_modified(SystemTime::now());
        }
        return Ok(dest);
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .build();
    let response = agent.get(url.as_str()).call().map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("GIF download failed (HTTP {code})"),
        ureq::Error::Transport(_) => "Couldn't download the GIF — check your connection".into(),
    })?;
    // redirects are followed — the final hop must still be KLIPY
    checked_klipy_url(response.get_url())?;

    let too_big = || "GIF is too large to paste (over 25 MB)".to_string();
    let declared = response
        .header("content-length")
        .and_then(|v| v.trim().parse::<u64>().ok());
    if declared.is_some_and(|len| len > MAX_GIF_BYTES) {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_GIF_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "GIF download was interrupted".to_string())?;
    if bytes.len() as u64 > MAX_GIF_BYTES {
        return Err(too_big());
    }
    // an HTML error page saved as .gif would paste as a broken attachment
    if !bytes.starts_with(b"GIF8") {
        return Err("KLIPY didn't return a GIF file".into());
    }

    // temp name + rename so a half-written file is never reused or pasted
    let tmp = dir.join(format!(".{}.part", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        let _ = std::fs::remove_file(&tmp);
        // a parallel download of the same GIF may hold the destination open — use theirs
        if dest.metadata().is_ok_and(|m| m.is_file() && m.len() > 0) {
            return Ok(dest);
        }
        return Err(e.to_string());
    }
    Ok(dest)
}

/// Best-effort: drop cached GIFs (and stray temp files) older than a week.
fn prune_old_gifs(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let stale = meta.is_file()
            && meta
                .modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
                .is_some_and(|age| age > CACHE_MAX_AGE);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Resolve `path` to a downloaded GIF — paste_file must never stage arbitrary files.
pub fn resolve_cached_gif(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let rejected = || "Only downloaded GIFs can be pasted".to_string();
    let dir = gif_cache_dir(app)?
        .canonicalize()
        .map_err(|_| "GIF not found — download it again".to_string())?;
    let file = Path::new(path.trim())
        .canonicalize()
        .map_err(|_| "GIF not found — download it again".to_string())?;
    let is_gif = file
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("gif"));
    // canonical on both sides, so `..` and symlinks can't escape the cache folder
    if !file.starts_with(&dir) || !file.is_file() || !is_gif {
        return Err(rejected());
    }
    Ok(file)
}
