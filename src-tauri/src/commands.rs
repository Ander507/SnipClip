use crate::apps;
use crate::clipboard;
use crate::db::{AppSettings, ClipboardItem, Database};
use crate::hotkeys::{self, HotkeyState};
use crate::snip::{self, CaptureResult};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

fn sync_main_ui_visible(app: &AppHandle) {
    let visible = app
        .get_webview_window("main")
        .map(|w| {
            w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false)
        })
        .unwrap_or(false);
    clipboard::set_main_ui_visible(visible);
}

fn decode_image_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .or_else(|| data_url.strip_prefix("data:image/webp;base64,"))
        .unwrap_or(data_url);
    B64.decode(b64).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_items(
    db: State<'_, Arc<Database>>,
    category: Option<String>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ClipboardItem>, String> {
    db.list(
        category.as_deref(),
        query.as_deref(),
        limit.unwrap_or(200),
    )
}

#[tauri::command]
pub fn get_item(db: State<'_, Arc<Database>>, id: i64) -> Result<Option<ClipboardItem>, String> {
    db.get(id)
}

#[tauri::command]
pub fn toggle_pin(db: State<'_, Arc<Database>>, id: i64) -> Result<bool, String> {
    db.toggle_pin(id)
}

#[tauri::command]
pub fn delete_item(db: State<'_, Arc<Database>>, id: i64) -> Result<(), String> {
    db.delete(id)
}

#[tauri::command]
pub fn clear_history(db: State<'_, Arc<Database>>) -> Result<(), String> {
    db.clear_unpinned()
}

#[tauri::command]
pub fn copy_item(db: State<'_, Arc<Database>>, id: i64) -> Result<(), String> {
    let item = db.get(id)?.ok_or_else(|| "item not found".to_string())?;
    match item.content_type.as_str() {
        "image" => clipboard::write_image_to_clipboard(&item.content),
        _ => clipboard::write_text_to_clipboard(&item.content),
    }
}

#[tauri::command]
pub fn capture_screen() -> Result<CaptureResult, String> {
    snip::capture_primary_monitor()
}

#[tauri::command]
pub fn capture_screen_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<CaptureResult, String> {
    snip::capture_screen_region(x, y, width, height)
}

#[tauri::command]
pub fn save_snip(data_url: String, path: String) -> Result<(), String> {
    snip::save_png_data_url(&data_url, &path)
}

#[tauri::command]
pub fn copy_image(data_url: String) -> Result<(), String> {
    clipboard::write_image_to_clipboard(&data_url)
}

#[tauri::command]
pub fn save_snip_to_vault(
    db: State<'_, Arc<Database>>,
    data_url: String,
    width: u32,
    height: u32,
) -> Result<ClipboardItem, String> {
    // Build a tiny preview thumbnail so list stays light
    let preview = build_thumb_preview(&data_url).unwrap_or_else(|_| format!("{width}×{height} snip"));
    db.insert("image", &data_url, &preview)
}

fn build_thumb_preview(data_url: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use image::imageops;
    use std::io::Cursor;

    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .ok_or_else(|| "invalid data url".to_string())?;
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let thumb = imageops::thumbnail(&img.to_rgba8(), 64, 64);
    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        B64.encode(buf.into_inner())
    ))
}

#[tauri::command]
pub fn toggle_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
    sync_main_ui_visible(&app);
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    sync_main_ui_visible(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    sync_main_ui_visible(&app);
    Ok(())
}

/// Instant show/focus of the preloaded translucent snipper — no pre-capture lag.
#[tauri::command]
pub fn begin_snip(app: AppHandle) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Emitter;

    static BUSY: AtomicBool = AtomicBool::new(false);
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    // Hide vault so it doesn't sit under the translucent overlay
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    sync_main_ui_visible(&app);

    let snipper = match app.get_webview_window("snipper") {
        Some(w) => w,
        None => {
            BUSY.store(false, Ordering::SeqCst);
            let _ = show_main_window(app);
            return Err("snipper window missing".into());
        }
    };

    // Single synchronous dispatch — window webview is already warm
    let _ = snipper.set_always_on_top(true);
    let _ = snipper.set_fullscreen(true);
    let _ = snipper.show();
    let _ = snipper.set_focus();
    let _ = snipper.emit("snip-ready", ());

    BUSY.store(false, Ordering::SeqCst);
    Ok(())
}

/// Hide snipper only (keep warm). Caller restores main after capture if needed.
#[tauri::command]
pub fn hide_snipper(app: AppHandle) -> Result<(), String> {
    if let Some(snipper) = app.get_webview_window("snipper") {
        let _ = snipper.hide();
        let _ = snipper.set_fullscreen(false);
        let _ = snipper.set_always_on_top(false);
    }
    Ok(())
}

/// Hide the preloaded snipper and restore the main vault.
#[tauri::command]
pub fn close_snipper(app: AppHandle) -> Result<(), String> {
    let _ = hide_snipper(app.clone());
    show_main_window(app)
}

#[tauri::command]
pub fn get_settings(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
) -> Result<AppSettings, String> {
    let mut settings = db.get_settings()?;
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        if let Ok(enabled) = app.autolaunch().is_enabled() {
            settings.launch_at_startup = enabled;
        }
    }
    Ok(settings)
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    _hotkeys: State<'_, Arc<HotkeyState>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    hotkeys::apply_hotkeys(&app, &settings)?;
    db.save_settings(&settings)?;
    clipboard::set_ignore_list(settings.ignore_list.clone());

    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        if settings.launch_at_startup {
            autolaunch
                .enable()
                .map_err(|e| format!("Failed to enable launch at startup: {e}"))?;
        } else {
            let _ = autolaunch.disable();
        }
    }

    Ok(settings)
}

/// Spec alias — same as `update_settings`.
#[tauri::command]
pub fn update_hotkeys(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    hotkeys_state: State<'_, Arc<HotkeyState>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    update_settings(app, db, hotkeys_state, settings)
}

#[tauri::command]
pub fn get_clipboard_paused() -> bool {
    clipboard::is_paused()
}

#[tauri::command]
pub fn set_clipboard_paused(app: AppHandle, paused: bool) -> bool {
    let state = clipboard::set_paused(paused);
    let _ = app.emit("clipboard-paused", state);
    state
}

#[tauri::command]
pub fn toggle_clipboard_paused(app: AppHandle) -> bool {
    let state = clipboard::toggle_paused();
    let _ = app.emit("clipboard-paused", state);
    state
}

#[tauri::command]
pub fn get_running_apps() -> Vec<String> {
    apps::list_running_apps()
}

/// OCR text from a vault image and copy it to the system clipboard.
#[tauri::command]
pub fn copy_text_from_image(db: State<'_, Arc<Database>>, id: i64) -> Result<String, String> {
    let item = db.get(id)?.ok_or_else(|| "item not found".to_string())?;
    if item.content_type != "image" {
        return Err("item is not an image".into());
    }
    let bytes = decode_image_data_url(&item.content)?;
    let text = crate::ocr::ocr_png_bytes(&bytes)?
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("No text found in image".into());
    }
    clipboard::write_text_to_clipboard(&text)?;
    Ok(text)
}

#[tauri::command]
pub fn is_ocr_available() -> bool {
    crate::ocr::is_available()
}
