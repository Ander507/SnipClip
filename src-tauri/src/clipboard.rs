use crate::db::Database;
use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{imageops, ImageBuffer, RgbaImage};
use parking_lot::Mutex;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

static MONITORING: AtomicBool = AtomicBool::new(false);
static SUPPRESS_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
static CLIPBOARD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

const RETRIES: u32 = 5;
const RETRY_DELAY_MS: u64 = 20;

fn clipboard_lock() -> &'static Mutex<()> {
    CLIPBOARD_LOCK.get_or_init(|| Mutex::new(()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn suppress_monitor(ms: u64) {
    SUPPRESS_UNTIL_MS.store(now_ms().saturating_add(ms), Ordering::SeqCst);
}

fn is_suppressed() -> bool {
    now_ms() < SUPPRESS_UNTIL_MS.load(Ordering::SeqCst)
}

fn with_clipboard_retry<T, F>(mut op: F) -> Result<T, String>
where
    F: FnMut(&mut Clipboard) -> Result<T, arboard::Error>,
{
    let _guard = clipboard_lock().lock();
    let mut last_err = String::new();

    // Prefer one Clipboard context across retries (Win32 open/close is expensive / racy).
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            // Cold-open can also hit 1418 — retry acquiring the context itself.
            last_err = e.to_string();
            let mut acquired = None;
            for attempt in 1..RETRIES {
                thread::sleep(Duration::from_millis(RETRY_DELAY_MS * attempt as u64));
                match Clipboard::new() {
                    Ok(c) => {
                        acquired = Some(c);
                        break;
                    }
                    Err(e2) => last_err = e2.to_string(),
                }
            }
            match acquired {
                Some(c) => c,
                None => {
                    return Err(format!(
                        "Failed to acquire clipboard after retries: {last_err}"
                    ));
                }
            }
        }
    };

    for attempt in 0..RETRIES {
        match op(&mut clipboard) {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = e.to_string();
                thread::sleep(Duration::from_millis(15 + RETRY_DELAY_MS * attempt as u64));
                // Re-open between failed writes — another process may have stolen the lock.
                if let Ok(c) = Clipboard::new() {
                    clipboard = c;
                }
            }
        }
    }
    Err(format!(
        "Failed to acquire clipboard after retries: {last_err}"
    ))
}

fn classify_text(text: &str) -> (&'static str, String) {
    let trimmed = text.trim();
    let preview: String = trimmed.chars().take(120).collect();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("www.")
    {
        ("link", preview)
    } else {
        ("text", preview)
    }
}

fn image_to_png_b64(img: &ImageData<'_>) -> Result<(String, String), String> {
    let width = img.width as u32;
    let height = img.height as u32;
    let mut rgba = RgbaImage::new(width, height);
    for (i, pixel) in img.bytes.chunks(4).enumerate() {
        if pixel.len() < 4 {
            break;
        }
        let x = (i as u32) % width;
        let y = (i as u32) / width;
        if y >= height {
            break;
        }
        rgba.put_pixel(x, y, image::Rgba([pixel[0], pixel[1], pixel[2], pixel[3]]));
    }

    let mut full_buf = Cursor::new(Vec::new());
    rgba.write_to(&mut full_buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let full_b64 = B64.encode(full_buf.into_inner());

    let thumb = imageops::thumbnail(&rgba, 64, 64);
    let mut thumb_buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut thumb_buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let thumb_preview = format!(
        "data:image/png;base64,{}",
        B64.encode(thumb_buf.into_inner())
    );

    Ok((full_b64, thumb_preview))
}

pub fn start_monitor(app: AppHandle) {
    if MONITORING.swap(true, Ordering::SeqCst) {
        return;
    }

    thread::spawn(move || {
        let mut last_text: Option<String> = None;
        let mut last_image_hash: Option<u64> = None;

        loop {
            if !MONITORING.load(Ordering::SeqCst) {
                break;
            }

            if is_suppressed() {
                thread::sleep(Duration::from_millis(100));
                continue;
            }

            let db = match app.try_state::<Arc<Database>>() {
                Some(d) => d.clone(),
                None => {
                    thread::sleep(Duration::from_millis(500));
                    continue;
                }
            };

            if let Ok(text) = with_clipboard_retry(|c| c.get_text()) {
                if !text.is_empty() && Some(&text) != last_text.as_ref() {
                    last_text = Some(text.clone());
                    last_image_hash = None;
                    let (ctype, preview) = classify_text(&text);
                    if let Ok(item) = db.insert(ctype, &text, &preview) {
                        let _ = app.emit("clipboard-item", &item.for_event());
                    }
                }
            } else if let Ok(img) = with_clipboard_retry(|c| c.get_image()) {
                let hash = {
                    use std::collections::hash_map::DefaultHasher;
                    use std::hash::{Hash, Hasher};
                    let mut h = DefaultHasher::new();
                    img.width.hash(&mut h);
                    img.height.hash(&mut h);
                    img.bytes.len().hash(&mut h);
                    let step = (img.bytes.len() / 32).max(1);
                    for b in img.bytes.iter().step_by(step) {
                        b.hash(&mut h);
                    }
                    h.finish()
                };

                if Some(hash) != last_image_hash {
                    last_image_hash = Some(hash);
                    last_text = None;
                    if let Ok((b64, thumb)) = image_to_png_b64(&img) {
                        let content = format!("data:image/png;base64,{b64}");
                        if let Ok(item) = db.insert("image", &content, &thumb) {
                            let _ = app.emit("clipboard-item", &item.for_event());
                        }
                    }
                }
            }

            thread::sleep(Duration::from_millis(500));
        }
    });
}

pub fn stop_monitor() {
    MONITORING.store(false, Ordering::SeqCst);
}

pub fn write_text_to_clipboard(text: &str) -> Result<(), String> {
    suppress_monitor(800);
    let owned = text.to_string();
    with_clipboard_retry(move |c| c.set_text(owned.clone()))
}

pub fn write_image_to_clipboard(data_url: &str) -> Result<(), String> {
    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .unwrap_or(data_url);
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let raw = rgba.into_raw();

    suppress_monitor(800);
    with_clipboard_retry(move |c| {
        c.set_image(ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(raw.clone()),
        })
    })
}

#[allow(dead_code)]
pub fn encode_rgba_png_b64(width: u32, height: u32, pixels: &[u8]) -> Result<String, String> {
    let img: ImageBuffer<image::Rgba<u8>, _> =
        ImageBuffer::from_raw(width, height, pixels.to_vec())
            .ok_or_else(|| "invalid image buffer".to_string())?;
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(B64.encode(buf.into_inner()))
}
